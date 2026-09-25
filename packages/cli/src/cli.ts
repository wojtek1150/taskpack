import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTORS,
  type Actor,
  type AddImageResult,
  addImage,
  addTodos,
  answerQuestion,
  askUser,
  baseDir,
  buildProjectPack,
  buildStatus,
  type Context,
  createProject,
  createTask,
  formatImageRef,
  generateVariants,
  hasWorkspaceConfig,
  IMAGE_CATEGORIES,
  type ImageCategory,
  type ImageEntry,
  initWorkspace,
  installKit,
  KIT_LAUNCHER,
  KIT_SHIM,
  LANGS,
  type Lang,
  LEGACY_CONFIG_FILE,
  LEGACY_KIT,
  loadWorkspace,
  logSession,
  markDelivered,
  messages,
  migrateLayout,
  PROJECT_KINDS,
  type ProjectKind,
  type ProjectPackData,
  parseImageRef,
  parseRef,
  pinnedImages,
  readConfig,
  readKitManifest,
  reindex,
  requireProject,
  resolveHome,
  SEARCH_TYPES,
  type SearchType,
  search,
  sessionUndoInfo,
  setLang,
  setSummary,
  sortImages,
  TASK_STATUSES,
  TaskpackError,
  toggleTodo,
  undoSession,
  updateImage,
  updateProject,
  updateTask,
  validateWorkspace,
} from '@taskpack/core';
import { Command, CommanderError, Option } from 'commander';
import { HOOKS, type HookName, parseHookInput, runHook } from './hooks.js';
import {
  type ConfigTarget,
  hasTaskpackEntry,
  lineDiff,
  MCP_CLIENTS,
  type McpClient,
  mcpConfigTarget,
} from './mcpconfig.js';
import { buildSkillZips } from './skillzip.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  /** Interactive terminal: `taskpack init` asks for the language when no `--lang` is given. */
  isTTY: boolean;
  prompt?: (question: string) => Promise<string>;
  /** Folder holding `workspace-pl` / `workspace-en` for `taskpack init --example`. */
  examplesDir: string;
  /** The repository's `agent-kit/` folder. */
  kitDir: string;
  /** How the installed kit and MCP client configs start the CLI and the MCP server. */
  commands: { cli: string[]; mcp: string[] };
  /** Standard input (hook payloads). */
  readStdin?: () => Promise<string>;
}

interface GlobalOpts {
  home?: string;
  actor?: string;
  lang?: Lang;
  json?: boolean;
  requestId?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const { version } = JSON.parse(readFileSync(join(HERE, '../package.json'), 'utf8')) as { version: string };

export function defaultIo(): Io {
  return {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    env: process.env,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt: async (question) => {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    // packages/cli/{src,dist} → repository root
    examplesDir: resolve(REPO, 'examples'),
    kitDir: resolve(REPO, 'agent-kit'),
    commands: defaultCommands(),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

/**
 * Absolute path of `node` for config files (GUI apps such as Claude Desktop do not get the
 * shell's PATH). The `node` found on PATH is preferred over `process.execPath`, which is often
 * a versioned install path (e.g. Homebrew's Cellar) that disappears on the next upgrade.
 */
export function nodePath(env: NodeJS.ProcessEnv = process.env): string {
  const names = process.platform === 'win32' ? ['node.exe'] : ['node'];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (dir && isAbsolute(dir) && existsSync(candidate)) return candidate;
    }
  }
  return process.execPath;
}

/** `node <repo>/packages/{cli,mcp}/dist/index.js`, with absolute paths (config files need them). */
export function defaultCommands(): Io['commands'] {
  const node = nodePath();
  return {
    cli: [node, resolve(REPO, 'packages/cli/dist/index.js')],
    mcp: [node, resolve(REPO, 'packages/mcp/dist/index.js')],
  };
}

const collect = (value: string, previous: string[] = []) => [...previous, value];
const int = (value: string) => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new TaskpackError('invalid', `not an integer: ${value}`);
  return n;
};

/** Run the CLI with `argv` (without `node taskpack`). Returns the exit code. */
export async function runCli(argv: string[], io: Io = defaultIo()): Promise<number> {
  let exitCode = 0;
  const program = new Command('taskpack');

  const globals = (cmd: Command) => cmd.optsWithGlobals() as GlobalOpts;
  /** Node recorded in the kit manifest for the shim: the absolute node these commands configure. */
  const kitNode = () => {
    const node = io.commands.cli[0];
    return node && isAbsolute(node) ? { node } : {};
  };
  const home = (cmd: Command) => resolveHome(globals(cmd).home, io.env);
  const context = (cmd: Command): Context => {
    const g = globals(cmd);
    const actor = g.actor ?? io.env.TASKPACK_ACTOR ?? io.env.GROOVE_ACTOR ?? 'user';
    if (!(ACTORS as readonly string[]).includes(actor)) {
      throw new TaskpackError('invalid', `unknown actor "${actor}" (${ACTORS.join(', ')})`);
    }
    return { home: home(cmd), actor: actor as Actor, via: 'cli', ...(g.requestId ? { requestId: g.requestId } : {}) };
  };
  /** Output language: `--lang`, else the workspace language, else English. */
  const langOf = (cmd: Command | null, root?: string): Lang => {
    const flag = cmd ? globals(cmd).lang : program.opts<GlobalOpts>().lang;
    if (flag) return flag;
    try {
      return readConfig(root ?? (cmd ? home(cmd) : resolveHome(undefined, io.env))).lang;
    } catch {
      return 'en';
    }
  };
  const print = (cmd: Command, data: unknown, human: string | (() => string)) => {
    if (globals(cmd).json) io.stdout(`${JSON.stringify(data, null, 2)}\n`);
    else io.stdout(`${typeof human === 'function' ? human() : human}\n`);
  };
  const dup = (cmd: Command, result: { duplicate?: boolean }) =>
    result.duplicate ? ` ${messages(langOf(cmd)).cli.duplicate}` : '';

  program
    .description('Taskpack: local-first project manager for you and your AI agents')
    .version(version, '-v, --version')
    .option('--home <dir>', 'workspace folder (default: $TASKPACK_HOME or ~/Taskpack)')
    .option('--actor <actor>', `who is making changes: ${ACTORS.join(' | ')} (default: $TASKPACK_ACTOR or user)`)
    .addOption(new Option('--lang <lang>', 'output language (default: workspace language)').choices(LANGS))
    .option('--json', 'machine-readable JSON output')
    .option('--request-id <id>', 'deduplicate retried writes (same actor + id within 24 h)')
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  // -------------------------------------------------------------------------
  program
    .command('init')
    .description('create a workspace (taskpack.yaml, inbox.md, questions.md, projects/, git repo)')
    .option('--example', 'copy the example workspace in the chosen language')
    .option('--no-git', 'do not create a git repository')
    .option('--no-kit', 'do not install the agent kit (AGENTS.md, CLAUDE.md, .claude/, .mcp.json)')
    .action(async (opts: { example?: boolean; git: boolean; kit: boolean }, cmd: Command) => {
      let lang = globals(cmd).lang;
      if (!lang && io.isTTY && io.prompt) {
        const answer = (await io.prompt('Language / Język [en/pl] (en): ')).trim().toLowerCase();
        lang = answer === 'pl' ? 'pl' : 'en';
      }
      lang ??= 'en';
      const result = initWorkspace({
        home: home(cmd),
        lang,
        git: opts.git,
        ...(opts.example ? { exampleDir: join(io.examplesDir, `workspace-${lang}`) } : {}),
        ...(opts.kit ? { kit: { kitDir: io.kitDir, ...kitNode() } } : {}),
      });
      print(cmd, result, () => {
        const m = messages(lang);
        return [
          m.cli.initDone(result.home),
          ...(result.kit ? [m.kit.installed(result.kit.written.length)] : []),
          ...(result.commit ? [`git: ${result.commit}`] : []),
        ].join('\n');
      });
    });

  program
    .command('validate [path]')
    .description('check the workspace (or one file in it) against the format; exit 1 on errors')
    .action((path: string | undefined, _opts: unknown, cmd: Command) => {
      let root = home(cmd);
      let only: string | undefined;
      if (path) {
        const abs = resolve(baseDir(io.env), path);
        if (!existsSync(abs)) throw new TaskpackError('not_found', `${path} not found`);
        if (statSync(abs).isDirectory() && hasWorkspaceConfig(abs)) {
          root = abs;
        } else {
          // A file: validate its workspace (nearest folder with taskpack.yaml), report only that file.
          let dir = statSync(abs).isDirectory() ? abs : dirname(abs);
          while (!hasWorkspaceConfig(dir) && dirname(dir) !== dir) dir = dirname(dir);
          if (hasWorkspaceConfig(dir)) root = dir;
          only = relative(root, abs).split('\\').join('/');
        }
      }
      const result = validateWorkspace(root, { lang: langOf(cmd, root) });
      const issues = only
        ? result.issues.filter((i) => i.file === only || i.file.startsWith(`${only}/`))
        : result.issues;
      const errors = issues.filter((i) => i.severity === 'error').length;
      if (errors) exitCode = 1;
      print(cmd, { ok: errors === 0, issues }, () => {
        const m = messages(langOf(cmd, root)).cli;
        if (!issues.length) return m.valid;
        const lines = issues.map(
          (i) =>
            `${i.file}${i.line ? `:${i.line}` : ''}  ${i.severity === 'error' ? m.error : m.warning}  ${i.message}`,
        );
        return [...lines, m.issues(errors, issues.length - errors)].join('\n');
      });
    });

  program
    .command('pack <ref>')
    .description('context pack for taskpack://project or taskpack://project/task (what an agent gets)')
    .option('--since <iso>', 'only changes since this date/timestamp')
    .option('--max-tokens <n>', 'token budget (default: taskpack.yaml pack.max_tokens)', int)
    .option('--mark-delivered', 'mark the answers included in the pack as delivered (as MCP get_project does)')
    .action((ref: string, opts: { since?: string; maxTokens?: number; markDelivered?: boolean }, cmd: Command) => {
      const pack = buildProjectPack(home(cmd), ref, {
        lang: langOf(cmd),
        ...(opts.since ? { since: opts.since } : {}),
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
      });
      if (opts.markDelivered && 'answers' in pack.data) {
        const ids = (pack.data as ProjectPackData).answers.flatMap((a) => (a.id ? [a.id] : []));
        if (ids.length) markDelivered(context(cmd), { question_ids: ids });
      }
      print(cmd, pack, pack.markdown.trimEnd());
    });

  program
    .command('status')
    .description('short dashboard: projects, next steps, open questions')
    .action((_opts: unknown, cmd: Command) => {
      const status = buildStatus(home(cmd), { lang: langOf(cmd) });
      print(cmd, status.data, status.markdown.trimEnd());
    });

  // -------------------------------------------------------------------------
  const todo = program.command('todo').description('quick todos of a project (or `inbox`)');
  todo
    .command('add <project> [text...]')
    .description('add a todo; the words form one item, use --item for more')
    .option('-i, --item <text>', 'another todo (repeatable)', collect)
    .action((project: string, words: string[], opts: { item?: string[] }, cmd: Command) => {
      const text = words.join(' ').trim();
      const result = addTodos(context(cmd), {
        project,
        ...(text ? { text } : {}),
        ...(opts.item ? { items: opts.item } : {}),
      });
      print(cmd, result, () =>
        [
          `${messages(langOf(cmd)).cli.added(result.added.length)}${dup(cmd, result)}`,
          ...result.added.map((t) => `  ${t.id}  ${t.text}`),
        ].join('\n'),
      );
    });
  todo
    .command('done <id>')
    .description('tick a todo by id (td_…)')
    .option('--undo', 'untick instead')
    .action((id: string, opts: { undo?: boolean }, cmd: Command) => {
      const result = toggleTodo(context(cmd), { todo_id: id, done: !opts.undo });
      const m = messages(langOf(cmd)).cli;
      print(cmd, result, `${result.done ? m.todoDone : m.todoUndone}: ${result.id} ${result.text}${dup(cmd, result)}`);
    });

  // -------------------------------------------------------------------------
  const task = program.command('task').description('tasks: bigger items with status, weight and steps');
  const status = new Option('--status <status>', 'task status').choices(TASK_STATUSES);
  task
    .command('create <project> <title...>')
    .description('create tasks/<slug>.md')
    .option('-d, --description <text>', 'description')
    .option('-w, --weight <1-5>', 'weight (impact × urgency)', int)
    .addOption(status)
    .option('--due <date>', 'due date YYYY-MM-DD')
    .option('--estimate <text>', 'estimate, e.g. "~4 h"')
    .option('-s, --step <text>', 'step (repeatable)', collect)
    .option('--slug <slug>', 'file name (default: from the title)')
    .action((project: string, title: string[], opts: Record<string, unknown>, cmd: Command) => {
      const result = createTask(context(cmd), {
        project,
        title: title.join(' '),
        ...pick(opts, ['description', 'weight', 'status', 'due', 'estimate', 'slug']),
        ...(opts.step ? { steps: opts.step as string[] } : {}),
      });
      print(cmd, result, `${messages(langOf(cmd)).cli.taskCreated}: ${result.ref}${dup(cmd, result)}`);
    });
  task
    .command('update <ref>')
    .description('change a task: fields, steps, a note or a decision')
    .addOption(new Option('--status <status>', 'task status').choices(TASK_STATUSES))
    .option('-w, --weight <1-5>', 'weight', int)
    .option('--due <date>', 'due date YYYY-MM-DD, or "none" to remove')
    .option('--title <text>', 'title')
    .option('-d, --description <text>', 'replace the description')
    .option('--estimate <text>', 'estimate')
    .option('--add-step <text>', 'add a step (repeatable)', collect)
    .option('--check <step>', 'tick a step by id or 1-based number (repeatable)', collect)
    .option('--uncheck <step>', 'untick a step (repeatable)', collect)
    .option('--note <text>', 'append a note')
    .option('--decision <text>', 'append a decision')
    .action((ref: string, opts: Record<string, unknown>, cmd: Command) => {
      const result = updateTask(context(cmd), {
        task: ref,
        ...pick(opts, ['status', 'weight', 'title', 'description', 'estimate', 'note', 'decision']),
        ...(opts.due !== undefined ? { due: opts.due === 'none' ? null : (opts.due as string) } : {}),
        ...(opts.addStep ? { add_steps: opts.addStep as string[] } : {}),
        ...(opts.check ? { check_steps: opts.check as string[] } : {}),
        ...(opts.uncheck ? { uncheck_steps: opts.uncheck as string[] } : {}),
      });
      const m = messages(langOf(cmd)).cli;
      print(
        cmd,
        result,
        `${m.taskUpdated}: ${result.ref} (${m.changed}: ${result.changed.join(', ') || '—'}; ${m.progress} ${result.progress}%)${dup(cmd, result)}`,
      );
    });

  // -------------------------------------------------------------------------
  program
    .command('summary')
    .description('project summary (Now / Blocker / Next)')
    .command('set <project>')
    .description('update the Summary section; omitted parts are kept, "" removes one')
    .option('--body <text>', 'summary paragraph(s)')
    .option('--now <text>', 'what is being worked on now')
    .option('--blocker <text>', 'what blocks progress')
    .option('--next <text>', 'what comes next')
    .action((project: string, opts: Record<string, unknown>, cmd: Command) => {
      const result = setSummary(context(cmd), { project, ...pick(opts, ['body', 'now', 'blocker', 'next']) });
      print(cmd, result, `${messages(langOf(cmd)).cli.summarySet}: ${result.project}${dup(cmd, result)}`);
    });

  const session = program.command('session').description('agent session notes');
  session
    .command('log <project>')
    .description('write sessions/YYYY-MM-DD-<actor>.md; changes come from the activity log')
    .requiredOption('--summary <text>', 'what happened in this session')
    .option('-c, --change <text>', 'extra change chip (repeatable)', collect)
    .addOption(new Option('--via <via>', 'how the agent worked').choices(['mcp', 'cli', 'files', 'ui']))
    .option('--started <iso>', 'session start (default: first write of this session)')
    .action((project: string, opts: Record<string, unknown>, cmd: Command) => {
      const result = logSession(context(cmd), {
        project,
        summary: opts.summary as string,
        ...(opts.change ? { changes: opts.change as string[] } : {}),
        ...pick(opts, ['via', 'started']),
      });
      const m = messages(langOf(cmd)).cli;
      print(cmd, result, () =>
        [
          `${m.sessionLogged}: ${result.file}${dup(cmd, result)}`,
          ...result.recorded_changes.map((c) => `  · ${c}`),
          ...(result.commit ? [`${m.committed}: ${result.commit}`] : []),
        ].join('\n'),
      );
    });

  session
    .command('undo <ref>')
    .description(
      'undo an agent session with git revert (ref: projects/<p>/sessions/<file>.md, <p>/sessions/<file>, or <p> for its latest session)',
    )
    .option('--dry-run', 'show the commits and files it would revert, change nothing')
    .option('--commit-pending', 'commit uncommitted changes first (as "Manual changes") instead of refusing')
    .action((ref: string, opts: { dryRun?: boolean; commitPending?: boolean }, cmd: Command) => {
      const m = messages(langOf(cmd)).undo;
      if (opts.dryRun) {
        const info = sessionUndoInfo(home(cmd), ref);
        if (!info.available) exitCode = 1;
        print(cmd, info, () =>
          info.available
            ? [
                info.session,
                ...info.commits.map((c) => `  ${c.hash.slice(0, 7)}  ${c.subject}`),
                ...info.files.map((f) => `  ${f.status} ${f.path}`),
                ...(info.dirty.length ? [m.dirty(info.dirty.join(', '))] : []),
              ].join('\n')
            : (info.message ?? ''),
        );
        return;
      }
      const result = undoSession(context(cmd), { session: ref, commit_pending: Boolean(opts.commitPending) });
      print(cmd, result, () =>
        [
          ...(result.pending_commit ? [m.pending(result.pending_commit)] : []),
          m.done(result.session, result.commit),
          ...result.files.map((f) => `  ${f}`),
        ].join('\n'),
      );
    });

  // -------------------------------------------------------------------------
  const project = program.command('project').description('projects: create, change, archive');
  const kind = () => new Option('--kind <kind>', 'physical | digital | life').choices(PROJECT_KINDS);
  project
    .command('create <name...>')
    .description('create projects/<slug>/project.md')
    .addOption(kind().makeOptionMandatory())
    .option('--kind-label <text>', 'label next to the kind, e.g. "woodwork"')
    .option('-d, --description <text>', 'description')
    .option('--color <hex>', 'accent colour #RRGGBB')
    .option('--target <date>', 'target date YYYY-MM-DD')
    .option('--target-label <text>', 'target as text, e.g. "end of October"')
    .option('--slug <slug>', 'folder name (default: from the name)')
    .action((name: string[], opts: Record<string, unknown>, cmd: Command) => {
      const result = createProject(context(cmd), {
        name: name.join(' '),
        kind: opts.kind as ProjectKind,
        ...renameKeys(pick(opts, ['kindLabel', 'description', 'color', 'target', 'targetLabel', 'slug'])),
      });
      print(cmd, result, `${messages(langOf(cmd)).projectOps.cliCreated}: ${result.ref}${dup(cmd, result)}`);
    });
  project
    .command('update <project>')
    .description('change project fields; "none" removes an optional one')
    .option('--name <text>', 'name')
    .addOption(kind())
    .option('--kind-label <text>', 'label next to the kind')
    .option('-d, --description <text>', 'replace the description ("" removes it)')
    .option('--color <hex>', 'accent colour #RRGGBB')
    .option('--target <date>', 'target date YYYY-MM-DD')
    .option('--target-label <text>', 'target as text')
    .option('--archived', 'archive the project')
    .option('--no-archived', 'restore an archived project')
    .action((ref: string, opts: Record<string, unknown>, cmd: Command) => {
      const fields: Record<string, unknown> = renameKeys(
        pick(opts, ['name', 'kind', 'kindLabel', 'description', 'color', 'target', 'targetLabel']),
      );
      for (const key of ['kind_label', 'color', 'target', 'target_label'])
        if (fields[key] === 'none') fields[key] = null;
      const result = updateProject(context(cmd), {
        project: ref,
        ...fields,
        ...(typeof opts.archived === 'boolean' && cmd.getOptionValueSource('archived') === 'cli'
          ? { archived: opts.archived }
          : {}),
      });
      const m = messages(langOf(cmd)).cli;
      print(
        cmd,
        result,
        `${messages(langOf(cmd)).projectOps.cliUpdated}: ${result.ref} (${m.changed}: ${result.changed.join(', ') || '—'})${dup(cmd, result)}`,
      );
    });
  for (const [name, archived] of [
    ['archive', true],
    ['unarchive', false],
  ] as const) {
    project
      .command(`${name} <project>`)
      .description(archived ? 'archive a project (hidden from the board and lists)' : 'restore an archived project')
      .action((ref: string, _opts: unknown, cmd: Command) => {
        const result = updateProject(context(cmd), { project: ref, archived });
        const m = messages(langOf(cmd)).cli;
        print(
          cmd,
          result,
          `${messages(langOf(cmd)).projectOps.cliUpdated}: ${result.ref} (${m.changed}: ${result.changed.join(', ') || '—'})${dup(cmd, result)}`,
        );
      });
  }

  // -------------------------------------------------------------------------
  const question = program.command('question').description('agent questions for the user (questions.md)');
  question
    .command('ask <project> <question...>')
    .description('ask the user a question')
    .option('--task <slug>', 'task the question is about')
    .option('--context <text>', 'paragraph shown under the question')
    .option('-o, --option <text>', 'suggested answer (repeatable, max 4)', collect)
    .action((project: string, words: string[], opts: Record<string, unknown>, cmd: Command) => {
      const result = askUser(context(cmd), {
        project,
        question: words.join(' '),
        ...pick(opts, ['task', 'context']),
        ...(opts.option ? { options: opts.option as string[] } : {}),
      });
      print(cmd, result, `${messages(langOf(cmd)).cli.questionAsked}: ${result.question_id}${dup(cmd, result)}`);
    });
  question
    .command('answer <id> <answer...>')
    .description('answer a question by id (q_…)')
    .action((id: string, words: string[], _opts: unknown, cmd: Command) => {
      const result = answerQuestion(context(cmd), { question_id: id, answer: words.join(' ') });
      print(cmd, result, `${messages(langOf(cmd)).cli.questionAnswered}: ${result.question_id}${dup(cmd, result)}`);
    });

  // -------------------------------------------------------------------------
  program
    .command('search <query...>')
    .description('full-text search over tasks, todos, notes, sessions and image captions')
    .option('-p, --project <slug>', 'only this project')
    .option('-t, --type <type>', `${SEARCH_TYPES.join(' | ')} (repeatable)`, collect)
    .option('-n, --limit <n>', 'max results (≤ 20)', int)
    .action((words: string[], opts: { project?: string; type?: string[]; limit?: number }, cmd: Command) => {
      for (const t of opts.type ?? []) {
        if (!(SEARCH_TYPES as readonly string[]).includes(t)) throw new TaskpackError('invalid', `unknown type "${t}"`);
      }
      const hits = search(home(cmd), {
        query: words.join(' '),
        ...(opts.project ? { project: opts.project } : {}),
        ...(opts.type ? { types: opts.type as SearchType[] } : {}),
        ...(opts.limit ? { limit: opts.limit } : {}),
      });
      print(cmd, hits, () =>
        hits.length
          ? hits
              .map((h) => `${h.type.padEnd(7)} ${h.ref}${h.id ? ` ${h.id}` : ''}  ${h.title}\n        ${h.snippet}`)
              .join('\n')
          : messages(langOf(cmd)).cli.noResults,
      );
    });

  // -------------------------------------------------------------------------
  const image = program.command('image').description('project images (gallery, images/images.yaml)');
  const category = new Option('--category <category>', 'image category').choices(IMAGE_CATEGORIES).default('other');
  image
    .command('add <project> <files...>')
    .description('copy image files into projects/<project>/images/ and list them in images.yaml')
    .option('--title <text>', 'title (default: from the file name)')
    .addOption(category)
    .option('--caption <text>', 'what an agent should know about the picture')
    .option('--pin', 'make it a current image (at most 5)')
    .option('--task <task>', 'link to a task (repeatable)', collect)
    .action(
      async (
        project: string,
        files: string[],
        opts: { title?: string; category: ImageCategory; caption?: string; pin?: boolean; task?: string[] },
        cmd: Command,
      ) => {
        const results: AddImageResult[] = [];
        for (const file of files) {
          results.push(
            await addImage(context(cmd), {
              project,
              source_path: resolve(baseDir(io.env), file),
              ...(opts.title ? { title: files.length > 1 ? `${opts.title} ${results.length + 1}` : opts.title } : {}),
              category: opts.category,
              ...(opts.caption ? { caption: opts.caption } : {}),
              ...(opts.pin ? { pin: true } : {}),
              ...(opts.task ? { tasks: opts.task } : {}),
            }),
          );
        }
        const m = messages(langOf(cmd)).cli;
        print(cmd, results.length === 1 ? results[0] : results, () =>
          results
            .map(
              (r) =>
                `${m.imageAdded}: ${r.ref}${r.pinned ? ` (${m.pinned})` : ''}${r.warning ? `\n  ${r.warning}` : ''}`,
            )
            .join('\n'),
        );
      },
    );
  for (const [name, pinned] of [
    ['pin', true],
    ['unpin', false],
  ] as const) {
    image
      .command(`${name} <ref>`)
      .description(`${pinned ? 'pin' : 'unpin'} an image: taskpack://project/images/<file> or project/<file>`)
      .action((ref: string, _opts: unknown, cmd: Command) => {
        const { project, file } = parseImageRef(ref);
        const result = updateImage(context(cmd), { project, file, pinned });
        const m = messages(langOf(cmd)).cli;
        print(cmd, result, `${pinned ? m.imagePinned : m.imageUnpinned}: ${formatImageRef(project, file)}`);
      });
  }
  image
    .command('list <project>')
    .description('current (pinned) images; --all for every image')
    .option('--all', 'every image, not only the current ones')
    .action((project: string, opts: { all?: boolean }, cmd: Command) => {
      const p = requireProject(loadWorkspace(home(cmd)), parseRef(project).project);
      const list: ImageEntry[] = opts.all ? sortImages(p.images) : pinnedImages(p.images);
      const data = list.map((i) => ({ ...i, ref: formatImageRef(p.slug, i.file) }));
      print(cmd, data, () =>
        [
          messages(langOf(cmd)).cli.images(list.length, p.images.length),
          ...data.map(
            (i) =>
              `  ${i.pinned ? '*' : ' '} ${i.ref}  ${i.title} [${i.category}]${i.caption ? ` — ${i.caption}` : ''}`,
          ),
        ].join('\n'),
      );
    });
  image
    .command('thumbs [project]')
    .description('generate missing thumbnails and agent variants in .taskpack/ (--force: all again)')
    .option('--force', 'render every variant again')
    .action(async (project: string | undefined, opts: { force?: boolean }, cmd: Command) => {
      const report = await generateVariants(home(cmd), {
        ...(project ? { project: parseRef(project).project } : {}),
        ...(opts.force ? { force: true } : {}),
      });
      print(cmd, report, () =>
        [
          messages(langOf(cmd)).cli.variants(report.images, report.generated),
          ...report.placeholders.map((p) => `  ${p.project}/${p.file}: ${p.reason}`),
          ...report.failed.map((f) => `  ! ${f.project}/${f.file}: ${f.error}`),
        ].join('\n'),
      );
    });

  program
    .command('reindex')
    .description('rebuild .taskpack/index.sqlite from the files and make missing image variants')
    .action(async (_opts: unknown, cmd: Command) => {
      const count = reindex(home(cmd));
      const variants = await generateVariants(home(cmd));
      const m = messages(langOf(cmd)).cli;
      print(cmd, { documents: count, variants: variants.generated }, () =>
        [m.reindexed(count), ...(variants.generated ? [m.variants(variants.images, variants.generated)] : [])].join(
          '\n',
        ),
      );
    });

  program
    .command('lang <lang>')
    .description('set the workspace language (pl | en)')
    .action((lang: string, _opts: unknown, cmd: Command) => {
      const result = setLang(context(cmd), { lang: lang as Lang });
      print(cmd, result, messages(result.lang).cli.langSet(result.lang));
    });

  // -------------------------------------------------------------------------
  /**
   * The taskpack-mcp entry for a client. With the kit installed: the workspace shim, which finds
   * Node itself (on Windows, where the POSIX shim cannot run: node + the launcher). Without the
   * kit: node + the repository's MCP server and TASKPACK_HOME.
   */
  const clientTarget = (client: McpClient, root: string): ConfigTarget => {
    const node = io.commands.mcp[0] ?? 'node';
    if (process.platform !== 'win32' && existsSync(join(root, KIT_SHIM))) {
      return mcpConfigTarget(client, { command: [join(root, KIT_SHIM), '--mcp'], env: io.env });
    }
    if (existsSync(join(root, KIT_LAUNCHER))) {
      return mcpConfigTarget(client, { command: [node, join(root, KIT_LAUNCHER), '--mcp'], env: io.env });
    }
    return mcpConfigTarget(client, { command: io.commands.mcp, serverEnv: { TASKPACK_HOME: root }, env: io.env });
  };

  /** Show the diff, confirm (unless --yes), back up and write a client config. */
  const writeConfig = async (
    target: ConfigTarget,
    root: string,
    yes: boolean,
  ): Promise<'written' | 'unchanged' | 'aborted'> => {
    const m = messages(langOf(null, root)).kit;
    const current = existsSync(target.file) ? readFileSync(target.file, 'utf8') : undefined;
    const next = target.merge(current);
    if (next === current) {
      io.stdout(`${m.configTarget(target.file)}\n${m.unchanged}\n`);
      return 'unchanged';
    }
    io.stdout(`${m.configTarget(target.file)}\n${lineDiff(current ?? '', next)}\n`);
    if (!yes) {
      if (!io.isTTY || !io.prompt) throw new TaskpackError('invalid', m.needsTty);
      const answer = (await io.prompt(m.confirm)).trim().toLowerCase();
      if (!['y', 'yes', 't', 'tak'].includes(answer)) {
        io.stdout(`${m.aborted}\n`);
        return 'aborted';
      }
    }
    let backup: string | undefined;
    if (current !== undefined) {
      backup = `${target.file}.taskpack-backup-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
      writeFileSync(backup, current);
    }
    mkdirSync(dirname(target.file), { recursive: true });
    writeFileSync(target.file, next);
    io.stdout(`${m.written(target.file, backup)}\n`);
    return 'written';
  };

  const kit = program.command('kit').description('the agent kit: AGENTS.md, CLAUDE.md, skills, subagents, hooks');
  const updateKit = (cmd: Command, force: boolean) => {
    const root = home(cmd);
    const result = installKit({
      home: root,
      lang: readConfig(root).lang,
      kitDir: io.kitDir,
      ...kitNode(),
      ...(force ? { force } : {}),
    });
    const m = messages(langOf(cmd, root)).kit;
    return {
      root,
      result,
      text: [
        m.installed(result.written.length),
        ...result.written.map((f) => `  ${f}`),
        ...result.kept.map(m.kept),
        ...result.removed.map(m.removed),
      ].join('\n'),
    };
  };
  kit
    .command('update')
    .description('install or update the kit in the workspace (keeps your own text and edited kit files)')
    .option('--force', 'also overwrite kit files you edited')
    .action((opts: { force?: boolean }, cmd: Command) => {
      const { result, text } = updateKit(cmd, Boolean(opts.force));
      print(cmd, result, text);
    });
  kit
    .command('repair')
    .description(
      'after moving Taskpack or the workspace: point the kit and the MCP client configs at the current places',
    )
    .option('-y, --yes', 'rewrite client configs without asking')
    .action(async (opts: { yes?: boolean }, cmd: Command) => {
      const before = readKitManifest(home(cmd));
      const { root, result, text } = updateKit(cmd, false);
      const m = messages(langOf(cmd, root)).kit;
      const out = [text];
      if (before?.repo && before.repo !== result.repo) out.push(m.repoMoved(before.repo, result.repo));
      io.stdout(`${out.join('\n')}\n`);
      const clients: Record<string, string> = {};
      for (const client of MCP_CLIENTS) {
        const target = clientTarget(client, root);
        const current = existsSync(target.file) ? readFileSync(target.file, 'utf8') : undefined;
        if (current === undefined || !hasTaskpackEntry(target, current)) continue;
        clients[client] = await writeConfig(target, root, Boolean(opts.yes));
      }
      if (!Object.keys(clients).length) io.stdout(`${m.noClients}\n`);
    });
  program
    .command('migrate')
    .description(
      'after the rename Groove → Taskpack: rename groove.yaml and .groove/, update the kit, rewrite the MCP client configs',
    )
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (opts: { yes?: boolean }, cmd: Command) => {
      const root = home(cmd);
      const oldDefault = join(homedir(), 'Groove');
      if (!hasWorkspaceConfig(root)) {
        const hint = existsSync(join(oldDefault, LEGACY_CONFIG_FILE))
          ? ` Your old workspace is ${oldDefault}: \`taskpack migrate --home "${oldDefault}"\`, or move it to the new default first (\`mv "${oldDefault}" "${join(homedir(), 'Taskpack')}"\`, then \`taskpack migrate\`).`
          : '';
        throw new TaskpackError('not_workspace', `${root} is not a workspace.${hint}`);
      }
      const m = messages(langOf(cmd, root)).kit;
      const plan = migrateLayout(root, true);
      if (plan.length) {
        io.stdout(`${m.migratePlan}\n${plan.map((c) => `  ${c}`).join('\n')}\n`);
        if (!opts.yes) {
          if (!io.isTTY || !io.prompt) throw new TaskpackError('invalid', m.needsTty);
          const answer = (await io.prompt(m.confirm)).trim().toLowerCase();
          if (!['y', 'yes', 't', 'tak'].includes(answer)) {
            io.stdout(`${m.aborted}\n`);
            return;
          }
        }
        migrateLayout(root);
      } else io.stdout(`${m.migrateNothing}\n`);
      if (readKitManifest(root)) io.stdout(`${updateKit(cmd, false).text}\n`);
      // Client configs with a Taskpack or legacy Groove entry now start this workspace's new shim.
      const legacyShim = join(root, LEGACY_KIT.shim);
      const stillUsing: string[] = [];
      for (const client of MCP_CLIENTS) {
        const target = clientTarget(client, root);
        const current = existsSync(target.file) ? readFileSync(target.file, 'utf8') : undefined;
        if (current === undefined) continue;
        if (hasTaskpackEntry(target, current)) await writeConfig(target, root, Boolean(opts.yes));
        if (readFileSync(target.file, 'utf8').includes(legacyShim)) stillUsing.push(target.file);
      }
      if (existsSync(legacyShim)) {
        if (stillUsing.length) io.stdout(`${m.legacyShimKept(stillUsing.join(', '))}\n`);
        else {
          rmSync(legacyShim);
          io.stdout(`${m.legacyShimRemoved}\n`);
        }
      }
      io.stdout(`${m.migrateDone}\n`);
    });

  kit
    .command('build')
    .description('zip the kit skills for Claude Desktop / claude.ai (Customize → Skills)')
    .option('-o, --out <dir>', 'output folder (default: dist/skills in the repository)')
    .action((opts: { out?: string }, cmd: Command) => {
      const out = opts.out ? resolve(baseDir(io.env), opts.out) : resolve(io.kitDir, '../dist/skills');
      const built = buildSkillZips(io.kitDir, out);
      print(cmd, built, () =>
        [messages(langOf(cmd)).kit.built(built.length, out), ...built.map((b) => `  ${b.file}`)].join('\n'),
      );
    });

  // -------------------------------------------------------------------------
  program
    .command('hook')
    .description('Claude Code hooks (called from .claude/settings.json; JSON on stdin)')
    .argument('<name>', HOOKS.join(' | '))
    .action(async (name: string, _opts: unknown, cmd: Command) => {
      if (!(HOOKS as readonly string[]).includes(name)) throw new TaskpackError('invalid', `unknown hook "${name}"`);
      const input = parseHookInput((await io.readStdin?.()) ?? '');
      const g = globals(cmd);
      const result = runHook(name as HookName, input, {
        env: io.env,
        ...(g.home ? { home: resolve(baseDir(io.env), g.home) } : {}),
      });
      if (result.stdout) io.stdout(result.stdout);
      if (result.stderr) io.stderr(result.stderr);
      exitCode = result.code;
    });

  program
    .command('mcp')
    .description('MCP server setup for other clients')
    .command('config')
    .description('print (or with --write merge) the taskpack-mcp entry for a client config file')
    .argument('<client>', MCP_CLIENTS.join(' | '))
    .option('--write', 'merge the entry into the client config file (shows a diff, asks, keeps a backup)')
    .option('-y, --yes', 'with --write: do not ask for confirmation')
    .action(async (client: string, opts: { write?: boolean; yes?: boolean }, cmd: Command) => {
      if (!(MCP_CLIENTS as readonly string[]).includes(client)) {
        throw new TaskpackError('invalid', `unknown client "${client}" (${MCP_CLIENTS.join(', ')})`);
      }
      const root = home(cmd);
      const target = clientTarget(client as McpClient, root);
      if (opts.write) {
        await writeConfig(target, root, Boolean(opts.yes));
        return;
      }
      const m = messages(langOf(cmd, root)).kit;
      print(cmd, { file: target.file, format: target.format, snippet: target.snippet }, () =>
        [m.configTarget(target.file), '', target.snippet.trimEnd()].join('\n'),
      );
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help / --version exit with 0; usage errors were already printed.
      return err.exitCode === 0 ? exitCode : 2;
    }
    io.stderr(`taskpack: ${(err as Error).message}\n`);
    return err instanceof TaskpackError ? 1 : 3;
  }
  return exitCode;
}

function pick(opts: Record<string, unknown>, keys: string[]): Record<string, never> {
  return Object.fromEntries(keys.filter((k) => opts[k] !== undefined).map((k) => [k, opts[k]])) as Record<
    string,
    never
  >;
}

/** Commander's camelCase option names → snake_case input keys (`kindLabel` → `kind_label`). */
function renameKeys(opts: Record<string, unknown>): Record<string, never> {
  return Object.fromEntries(
    Object.entries(opts).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]),
  ) as Record<string, never>;
}
