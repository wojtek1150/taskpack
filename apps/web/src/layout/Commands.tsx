import type { BoardStatus } from '@taskpack/api';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NewTaskDialog } from '../features/board/NewTaskDialog';
import { Palette } from '../features/palette/Palette';
import { ProjectDialog } from '../features/projects/ProjectDialog';
import { useProjects } from '../lib/queries';

export interface Commands {
  openPalette(): void;
  newTask(opts?: { project?: string; status?: BoardStatus }): void;
  newProject(): void;
}

const CommandsContext = createContext<Commands>({
  openPalette: () => undefined,
  newTask: () => undefined,
  newProject: () => undefined,
});

export const useCommands = () => useContext(CommandsContext);

type OpenDialog =
  | { kind: 'task'; n: number; project?: string; status?: BoardStatus }
  | { kind: 'project'; n: number }
  | null;

/**
 * Remembers whether the last interaction was the keyboard or a pointer (`<html data-modality>`),
 * so CSS can skip enter animations for keyboard-triggered UI.
 */
function useInputModality(): void {
  useEffect(() => {
    const root = document.documentElement;
    const key = (e: KeyboardEvent) => {
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) root.dataset.modality = 'keyboard';
    };
    const pointer = () => {
      root.dataset.modality = 'pointer';
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', pointer, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', pointer, true);
    };
  }, []);
}

/** App-wide commands: the ⌘K palette and the "new task" / "new project" dialogs it can open. */
export function CommandsProvider({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState(0);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const projects = useProjects();
  useInputModality();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((n) => (n ? 0 : Date.now()));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openPalette = useCallback(() => setPalette(Date.now()), []);
  const newTask = useCallback(
    (opts: { project?: string; status?: BoardStatus } = {}) => setDialog({ kind: 'task', n: Date.now(), ...opts }),
    [],
  );
  const newProject = useCallback(() => setDialog({ kind: 'project', n: Date.now() }), []);
  const value = useMemo(() => ({ openPalette, newTask, newProject }), [openPalette, newTask, newProject]);
  const refs = projects.data?.sidebar.map(({ slug, name, color }) => ({ slug, name, color })) ?? [];

  return (
    <CommandsContext.Provider value={value}>
      {children}
      {palette > 0 && <Palette key={palette} onClose={() => setPalette(0)} />}
      {dialog?.kind === 'task' && (
        <NewTaskDialog
          key={dialog.n}
          open
          projects={refs}
          {...(dialog.project ? { project: dialog.project } : {})}
          {...(dialog.status ? { status: dialog.status } : {})}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'project' && <ProjectDialog key={dialog.n} onClose={() => setDialog(null)} />}
    </CommandsContext.Provider>
  );
}
