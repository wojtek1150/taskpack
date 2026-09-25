import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { parseFrontmatter, renderFrontmatter, TaskpackError } from '@taskpack/core';

/**
 * `taskpack kit build`: one zip per model-invoked kit skill, for Claude Desktop / claude.ai
 * (Customize → Skills), where `.claude/` files in a folder are not read.
 *
 * Upload format (https://support.claude.com/en/articles/12512198-how-to-create-custom-skills and
 * https://code.claude.com/docs/en/skills#using-skill-frontmatter-outside-claude-code):
 * - the zip contains the skill folder as its root: `taskpack-workspace.zip → taskpack-workspace/SKILL.md, reference/…`;
 * - frontmatter may only use `name, description, license, compatibility, metadata, allowed-tools`
 *   (other keys fail the upload), so Claude Code-only keys such as `when_to_use` are dropped;
 * - `name` ≤ 64 characters, `description` ≤ 200 characters.
 * Command skills (`disable-model-invocation: true`, the `/taskpack-*` commands) are zipped too: in
 * Claude Desktop / claude.ai they are ordinary skills picked by their description, so their body gets
 * a note that `$ARGUMENTS` means what the user asked for.
 */

const ALLOWED_KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Minimal zip writer (deflate, no zip64): enough for a few small text files. */
export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  // 1980-01-01 00:00 in DOS format keeps builds reproducible.
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const compressed = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => n !== '.DS_Store')
    .flatMap((n) => (statSync(join(dir, n)).isDirectory() ? listFiles(join(dir, n)) : [join(dir, n)]));
}

const COMMAND_NOTE =
  '> Outside Claude Code this is not a slash command: `$ARGUMENTS` below means the project and text the user gave in their message.\n';

/** SKILL.md with only the frontmatter keys skill uploads accept. */
export function uploadableSkill(source: string, skill: string): string {
  const parsed = parseFrontmatter(source);
  const { data } = parsed;
  const command = data['disable-model-invocation'] === true;
  const body = command ? `\n${COMMAND_NOTE}${parsed.body.startsWith('\n') ? '' : '\n'}${parsed.body}` : parsed.body;
  const kept = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED_KEYS.includes(k)));
  const name = String(kept.name ?? skill);
  const description = String(kept.description ?? '');
  if (name.length > 64) throw new TaskpackError('invalid', `${skill}: name longer than 64 characters`);
  if (!description || description.length > 200) {
    throw new TaskpackError('invalid', `${skill}: description must be 1–200 characters (has ${description.length})`);
  }
  return `${renderFrontmatter(kept).join('\n')}\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}

export interface BuiltSkill {
  skill: string;
  file: string;
  entries: string[];
}

/** Zip every skill of the kit (`common/dot-claude/skills`, installed as `.claude/skills`), commands included. */
export function buildSkillZips(kitDir: string, outDir: string): BuiltSkill[] {
  const skillsDir = join(kitDir, 'common', 'dot-claude', 'skills');
  if (!existsSync(skillsDir)) throw new TaskpackError('not_found', `no skills in ${skillsDir}`);
  mkdirSync(outDir, { recursive: true });
  const built: BuiltSkill[] = [];
  for (const skill of readdirSync(skillsDir).sort()) {
    const dir = join(skillsDir, skill);
    const skillMd = join(dir, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    const source = readFileSync(skillMd, 'utf8');
    const entries = listFiles(dir)
      .sort()
      .map((path) => {
        const rel = relative(dir, path).split('\\').join('/');
        const data = rel === 'SKILL.md' ? Buffer.from(uploadableSkill(source, skill)) : readFileSync(path);
        return { name: `${skill}/${rel}`, data };
      });
    const file = join(outDir, `${skill}.zip`);
    writeFileSync(file, zip(entries));
    built.push({ skill, file, entries: entries.map((e) => e.name) });
  }
  return built;
}
