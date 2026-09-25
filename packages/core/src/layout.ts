import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Workspace settings file. */
export const CONFIG_FILE = 'taskpack.yaml';
/** Derived data (index, activity log, image variants, hook and UI state), git-ignored. */
export const DATA_DIR = '.taskpack';
/** Names from before the rename Groove → Taskpack (2026-09-25); `taskpack migrate` renames them. */
export const LEGACY_CONFIG_FILE = 'groove.yaml';
export const LEGACY_DATA_DIR = '.groove';

/**
 * A workspace not migrated yet: it has `groove.yaml` and no `taskpack.yaml`. Such a workspace
 * keeps using `groove.yaml` and `.groove/` (its .gitignore ignores `.groove/`), until
 * `taskpack migrate` renames both. New workspaces always get the new names.
 */
export function isLegacyWorkspace(home: string): boolean {
  return !existsSync(join(home, CONFIG_FILE)) && existsSync(join(home, LEGACY_CONFIG_FILE));
}

/** Whether `dir` holds a workspace config file (new or legacy name). */
export function hasWorkspaceConfig(dir: string): boolean {
  return existsSync(join(dir, CONFIG_FILE)) || existsSync(join(dir, LEGACY_CONFIG_FILE));
}

/** Workspace-relative name of the config file in use. */
export const configFile = (home: string) => (isLegacyWorkspace(home) ? LEGACY_CONFIG_FILE : CONFIG_FILE);

/** Workspace-relative name of the derived data folder in use. */
export const dataDirName = (home: string) => (isLegacyWorkspace(home) ? LEGACY_DATA_DIR : DATA_DIR);

/** Absolute path inside the derived data folder. */
export const dataPath = (home: string, ...rest: string[]) => join(home, dataDirName(home), ...rest);

/**
 * `taskpack migrate`: rename a legacy workspace's `groove.yaml` → `taskpack.yaml` and `.groove/`
 * → `.taskpack/`, and its `.gitignore` line `.groove/` → `.taskpack/`. Returns the changes
 * (`from → to`); with `dryRun` only lists them. A name already taken is left alone.
 */
export function migrateLayout(home: string, dryRun = false): string[] {
  const changes: string[] = [];
  const move = (from: string, to: string) => {
    if (!existsSync(join(home, from)) || existsSync(join(home, to))) return;
    changes.push(`${from} → ${to}`);
    if (!dryRun) renameSync(join(home, from), join(home, to));
  };
  move(LEGACY_CONFIG_FILE, CONFIG_FILE);
  move(LEGACY_DATA_DIR, DATA_DIR);
  const ignore = join(home, '.gitignore');
  if (existsSync(ignore)) {
    const text = readFileSync(ignore, 'utf8');
    const legacyLine = /^(\/?)\.groove(\/?)[ \t]*$/m;
    if (legacyLine.test(text)) {
      changes.push(`.gitignore: ${LEGACY_DATA_DIR}/ → ${DATA_DIR}/`);
      if (!dryRun) writeFileSync(ignore, text.replace(legacyLine, `$1${DATA_DIR}$2`));
    }
  }
  return changes;
}
