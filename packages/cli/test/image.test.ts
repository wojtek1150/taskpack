import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultCommands, runCli } from '../src/cli.js';

const EXAMPLES = resolve(import.meta.dirname, '../../../examples');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function workspace(): string {
  const home = join(mkdtempSync(join(tmpdir(), 'taskpack-cli-img-')), 'ws');
  cpSync(join(EXAMPLES, 'workspace-pl'), home, { recursive: true });
  return home;
}

function cli(home: string, cwd = home) {
  return async (...args: string[]) => {
    const buf = { out: '', err: '' };
    const code = await runCli(args, {
      stdout: (t) => {
        buf.out += t;
      },
      stderr: (t) => {
        buf.err += t;
      },
      env: { TASKPACK_HOME: home, INIT_CWD: cwd },
      isTTY: false,
      examplesDir: EXAMPLES,
      kitDir: resolve(EXAMPLES, '../agent-kit'),
      commands: defaultCommands(),
    });
    return { code, ...buf };
  };
}

describe('taskpack image', () => {
  it('adds files (relative to the caller), lists, pins and unpins', async () => {
    const home = workspace();
    const outside = mkdtempSync(join(tmpdir(), 'taskpack-src-'));
    writeFileSync(join(outside, 'Szuflada 1.png'), PNG);
    writeFileSync(join(outside, 'szuflada-2.png'), PNG);
    const taskpack = cli(home, outside);

    const add = await taskpack(
      '--actor',
      'claude-code',
      'image',
      'add',
      'witrynka',
      'Szuflada 1.png',
      'szuflada-2.png',
      '--category',
      'progress',
      '--caption',
      'Szuflada po klejeniu',
      '--task',
      'drzwiczki',
    );
    expect(add.err).toBe('');
    expect(add.code).toBe(0);
    expect(add.out).toBe(
      'Dodano obraz: taskpack://witrynka/images/szuflada-1.png\nDodano obraz: taskpack://witrynka/images/szuflada-2.png\n',
    );
    const yaml = readFileSync(join(home, 'projects/witrynka/images/images.yaml'), 'utf8');
    expect(yaml).toContain('  - file: szuflada-1.png\n    title: Szuflada 1\n    category: progress\n');
    expect(yaml).toContain('created_by: claude-code');

    const pinFull = await taskpack('image', 'pin', 'witrynka/szuflada-1.png');
    expect(pinFull.code).toBe(1);
    expect(pinFull.err).toMatch(/najwyżej 5/);

    expect((await taskpack('image', 'unpin', 'taskpack://witrynka/images/render-front.svg')).out).toBe(
      'Odpięto obraz: taskpack://witrynka/images/render-front.svg\n',
    );
    expect((await taskpack('image', 'pin', 'witrynka/images/szuflada-1.png')).code).toBe(0);

    const list = await taskpack('image', 'list', 'witrynka');
    expect(list.out.split('\n')[0]).toBe('Obrazy: 5 z 26');
    expect(list.out.trim().split('\n').at(-1)).toMatch(
      /^ {2}\* taskpack:\/\/witrynka\/images\/szuflada-1\.png {2}Szuflada 1/,
    );
    const all = JSON.parse((await taskpack('--json', 'image', 'list', 'witrynka', '--all')).out) as unknown[];
    expect(all).toHaveLength(26);

    const bad = await taskpack('image', 'add', 'witrynka', join(home, 'taskpack.yaml'));
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/Nieobsługiwany typ pliku/);
  });

  it('thumbs and reindex make missing variants', async () => {
    const home = workspace();
    const taskpack = cli(home);
    const first = JSON.parse((await taskpack('--json', 'image', 'thumbs', 'witrynka')).out) as {
      images: number;
      generated: number;
    };
    expect(first).toMatchObject({ images: 24, generated: 48 });
    rmSync(join(home, '.taskpack', 'thumbs'), { recursive: true });
    const re = await taskpack('reindex');
    expect(re.code).toBe(0);
    expect(re.out).toMatch(/wygenerowane warianty: \d+/);
    expect(existsSync(join(home, '.taskpack', 'thumbs'))).toBe(true);
    expect(readdirSync(join(home, '.taskpack', 'thumbs')).length).toBeGreaterThanOrEqual(24);
  });
});
