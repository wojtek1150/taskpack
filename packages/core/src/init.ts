import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lang } from './format/enums.js';
import { headingFor } from './format/i18n.js';
import { initRepo } from './git.js';
import { installKit, type KitOptions, type KitResult } from './kit.js';
import { CONFIG_FILE, DATA_DIR, hasWorkspaceConfig, LEGACY_DATA_DIR } from './layout.js';
import { TaskpackError } from './util.js';

export interface InitOptions {
  home: string;
  lang: Lang;
  /** Copy this example workspace (e.g. `examples/workspace-pl`) instead of an empty skeleton. */
  exampleDir?: string;
  /** Create a git repository with an initial commit (default true). */
  git?: boolean;
  /** Install the agent kit (AGENTS.md, CLAUDE.md, .claude/, .mcp.json). */
  kit?: Omit<KitOptions, 'home' | 'lang'>;
}

export interface InitResult {
  home: string;
  lang: Lang;
  example: boolean;
  kit?: KitResult;
  /** Short hash of the initial commit, when git is available. */
  commit?: string;
}

const configTemplate = (
  lang: Lang,
) => `# Taskpack workspace settings — see .claude/skills/taskpack-workspace/reference/format.md
version: 1
lang: ${lang} # pl | en: headings, summaries and agent output
git:
  autocommit: session # session (one commit per agent session) | off
pack:
  max_tokens: 2500
  max_open_todos: 15
  max_images: 5
  max_image_kb: 700
  session_chars: 400
`;

/**
 * Create a workspace: taskpack.yaml, inbox.md, questions.md, projects/, a .gitignore for the
 * derived .taskpack/ folder and the agent kit, then `git init` + initial commit. Refuses a
 * non-empty folder.
 */
export function initWorkspace(opts: InitOptions): InitResult {
  const { home, lang } = opts;
  if (hasWorkspaceConfig(home)) throw new TaskpackError('exists', `${home} is already a Taskpack workspace`);
  if (existsSync(home) && readdirSync(home).some((f) => f !== '.DS_Store')) {
    throw new TaskpackError('exists', `${home} is not empty`);
  }
  mkdirSync(home, { recursive: true });

  if (opts.exampleDir) {
    if (!existsSync(join(opts.exampleDir, CONFIG_FILE))) {
      throw new TaskpackError('not_found', `example workspace not found: ${opts.exampleDir}`);
    }
    cpSync(opts.exampleDir, home, {
      recursive: true,
      filter: (src) => !src.split(/[\\/]/).some((p) => p === DATA_DIR || p === LEGACY_DATA_DIR),
    });
  } else {
    writeFileSync(join(home, CONFIG_FILE), configTemplate(lang));
    writeFileSync(join(home, 'inbox.md'), `# ${headingFor('inbox', lang)}\n`);
    writeFileSync(join(home, 'questions.md'), `# ${headingFor('questions', lang)}\n`);
    mkdirSync(join(home, 'projects'), { recursive: true });
    writeFileSync(join(home, 'projects', '.gitkeep'), '');
  }
  if (!existsSync(join(home, '.gitignore')))
    writeFileSync(
      join(home, '.gitignore'),
      '# Derived data, rebuilt by `taskpack reindex`\n.taskpack/\n# Personal Claude Code settings\n.claude/settings.local.json\n',
    );

  const kit = opts.kit ? installKit({ ...opts.kit, home, lang }) : undefined;

  const commit = opts.git === false ? undefined : initRepo(home);
  return { home, lang, example: Boolean(opts.exampleDir), ...(kit ? { kit } : {}), ...(commit ? { commit } : {}) };
}
