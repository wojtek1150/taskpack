import { type QueryClient, type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardStatus, BoardView, NewProject, ProjectPatch, ProjectView, TaskView } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, type ImagePatch, type NewTask, type SummaryPatch, type TaskPatch } from './api';

export const keys = {
  board: ['board'] as const,
  projects: ['projects'] as const,
  project: (slug: string) => ['project', slug] as const,
  task: (project: string, task: string) => ['task', project, task] as const,
  config: ['config'] as const,
  connect: ['connect'] as const,
  search: (q: string) => ['search', q] as const,
  questions: ['questions'] as const,
  today: ['today'] as const,
  notes: ['notes'] as const,
  undo: (file: string) => ['undo', file] as const,
};

export const useBoard = () => useQuery({ queryKey: keys.board, queryFn: api.board });
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects });
export const useProject = (slug: string) =>
  useQuery({ queryKey: keys.project(slug), queryFn: () => api.project(slug) });
export const useTask = (project: string, task: string) =>
  useQuery({ queryKey: keys.task(project, task), queryFn: () => api.task(project, task) });
export const useConfig = () => useQuery({ queryKey: keys.config, queryFn: api.config });
export const useConnect = () => useQuery({ queryKey: keys.connect, queryFn: api.connect });
export const useSearch = (q: string) =>
  useQuery({
    queryKey: keys.search(q),
    queryFn: () => api.search(q, 20),
    enabled: q.trim().length > 1,
    placeholderData: (previous) => previous,
  });
export const useQuestions = () => useQuery({ queryKey: keys.questions, queryFn: api.questions });
export const useToday = () => useQuery({ queryKey: keys.today, queryFn: api.today });
export const useNotes = () => useQuery({ queryKey: keys.notes, queryFn: api.notes });
export const useUndoInfo = (file: string) =>
  useQuery({ queryKey: keys.undo(file), queryFn: () => api.undoInfo(file), staleTime: 0 });

/** Everything that shows data of a project (after a write or an SSE event). */
export function invalidateProject(qc: QueryClient, project?: string): void {
  void qc.invalidateQueries({ queryKey: keys.board });
  void qc.invalidateQueries({ queryKey: keys.projects });
  void qc.invalidateQueries({ queryKey: keys.questions });
  void qc.invalidateQueries({ queryKey: keys.today });
  void qc.invalidateQueries({ queryKey: keys.notes });
  void qc.invalidateQueries({ queryKey: ['search'] });
  if (project) {
    void qc.invalidateQueries({ queryKey: keys.project(project) });
    void qc.invalidateQueries({ queryKey: ['task', project] });
  } else {
    void qc.invalidateQueries({ queryKey: ['project'] });
    void qc.invalidateQueries({ queryKey: ['task'] });
  }
}

/**
 * A write with an optional optimistic update of one cached query: the cache is patched at
 * once, rolled back on error (with a toast), and refetched when the write settles.
 */
function useWrite<V>(opts: {
  fn: (vars: V) => Promise<unknown>;
  project?: (vars: V) => string | undefined;
  optimistic?: { key: (vars: V) => QueryKey; update: (data: never, vars: V) => unknown };
  also?: QueryKey[];
  success?: (vars: V) => void;
  /** The caller shows errors itself (no toast). */
  silent?: boolean;
}) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: opts.fn,
    onMutate: async (vars: V) => {
      if (!opts.optimistic) return undefined;
      const key = opts.optimistic.key(vars);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData(key);
      if (previous !== undefined) qc.setQueryData(key, opts.optimistic.update(previous as never, vars));
      return { key, previous };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.previous !== undefined) qc.setQueryData(context.key, context.previous);
      if (!opts.silent) toast.error(t('toast.saveFailed'), { description: err.message });
    },
    onSuccess: (_data, vars) => opts.success?.(vars),
    onSettled: (_data, _err, vars) => {
      invalidateProject(qc, opts.project?.(vars));
      for (const key of opts.also ?? []) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

// --- todos ---------------------------------------------------------------------

export const useToggleTodo = (project: string) =>
  useWrite<{ id: string; done: boolean }>({
    fn: ({ id, done }) => api.patchTodo(id, { done }),
    project: () => project,
    optimistic: {
      key: () => keys.project(project),
      update: (p: ProjectView, { id, done }) => ({
        ...p,
        todos: p.todos.map((todo) => (todo.id === id ? { ...todo, done } : todo)),
      }),
    },
  });

export const useEditTodo = (project: string) =>
  useWrite<{ id: string; text: string }>({
    fn: ({ id, text }) => api.patchTodo(id, { text }),
    project: () => project,
    optimistic: {
      key: () => keys.project(project),
      update: (p: ProjectView, { id, text }) => ({
        ...p,
        todos: p.todos.map((todo) => (todo.id === id ? { ...todo, text } : todo)),
      }),
    },
  });

export const useAddTodos = (project: string) =>
  useWrite<{ items: string[] }>({ fn: ({ items }) => api.addTodos(project, items), project: () => project });

// --- tasks ---------------------------------------------------------------------

export const useCreateTask = () =>
  useWrite<{ project: string; task: NewTask }>({
    fn: ({ project, task }) => api.createTask(project, task),
    project: (v) => v.project,
  });

export const usePatchTask = (project: string, task: string) =>
  useWrite<TaskPatch>({
    fn: (patch) => api.patchTask(project, task, patch),
    project: () => project,
    optimistic: {
      key: () => keys.task(project, task),
      update: (view: TaskView, patch) => {
        const checked = new Set(patch.check_steps ?? []);
        const unchecked = new Set(patch.uncheck_steps ?? []);
        const steps = view.steps.map((s) => ({
          ...s,
          done: checked.has(s.id) ? true : unchecked.has(s.id) ? false : s.done,
        }));
        const next = steps.find((s) => !s.done);
        return {
          ...view,
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.weight ? { weight: patch.weight } : {}),
          steps: steps.map((s) => ({ ...s, next: s === next })),
        };
      },
    },
  });

export const useMoveStep = (project: string, task: string) =>
  useWrite<{ step: string; to: number }>({
    fn: ({ step, to }) => api.moveStep(project, task, step, to),
    project: () => project,
    optimistic: {
      key: () => keys.task(project, task),
      update: (view: TaskView, { step, to }) => {
        const steps = [...view.steps];
        const from = steps.findIndex((s) => s.id === step);
        const [moved] = steps.splice(from, 1);
        if (moved) steps.splice(to - 1, 0, moved);
        const next = steps.find((s) => !s.done);
        return { ...view, steps: steps.map((s) => ({ ...s, next: s === next })) };
      },
    },
  });

/** Move a board card; the board cache is reordered at once. */
export const useMoveTask = () =>
  useWrite<{ id: string; status: BoardStatus; index: number }>({
    fn: ({ id, status, index }) => {
      const [project = '', task = ''] = id.split('/');
      return api.moveTask(project, task, status, index);
    },
    project: (v) => v.id.split('/')[0],
    optimistic: {
      key: () => keys.board,
      update: (board: BoardView, { id, status, index }) => moveCard(board, id, status, index),
    },
  });

export function moveCard(board: BoardView, id: string, status: BoardStatus, index: number): BoardView {
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === id);
  if (!card) return board;
  return {
    ...board,
    columns: board.columns.map((col) => {
      const cards = col.cards.filter((c) => c.id !== id);
      if (col.status === status) cards.splice(Math.min(index, cards.length), 0, { ...card, status });
      return { ...col, cards };
    }),
  };
}

// --- project -------------------------------------------------------------------

export const useSetSummary = (project: string) =>
  useWrite<SummaryPatch>({ fn: (s) => api.setSummary(project, s), project: () => project });

export const useAddNote = (project: string) =>
  useWrite<{ body: string; title?: string; task?: string }>({
    fn: (n) => api.addNote(project, n),
    project: () => project,
  });

export const usePatchImage = (project: string) =>
  useWrite<{ file: string; patch: ImagePatch }>({
    fn: ({ file, patch }) => api.patchImage(project, file, patch),
    project: () => project,
    optimistic: {
      key: () => keys.project(project),
      update: (p: ProjectView, { file, patch }) => ({
        ...p,
        images: p.images.map((i) => (i.file === file ? { ...i, ...patch } : i)),
      }),
    },
  });

/** Reorder the pinned images; `pinnedRank` in the cache follows at once. */
export const useReorderPinned = (project: string) =>
  useWrite<{ files: string[] }>({
    fn: ({ files }) => api.reorderPinned(project, files),
    project: () => project,
    optimistic: {
      key: () => keys.project(project),
      update: (p: ProjectView, { files }) => ({
        ...p,
        images: p.images.map((i) => (i.pinned ? { ...i, pinnedRank: files.indexOf(i.file) + 1 } : i)),
      }),
    },
  });

export const useCreateProject = () => useWrite<NewProject>({ fn: (p) => api.createProject(p) });

export const usePatchProject = (project: string) =>
  useWrite<ProjectPatch>({
    fn: (patch) => api.patchProject(project, patch),
    project: () => project,
  });

export const useUndoSession = (project: string) =>
  useWrite<{ file: string; commitPending: boolean }>({
    fn: ({ file, commitPending }) => api.undoSession(file, commitPending),
    // A revert can touch any project.
    also: [['project'], ['task'], ['undo']],
    project: () => project,
    silent: true,
  });

// --- misc ----------------------------------------------------------------------

export const useCreateMcpJson = () => useWrite<void>({ fn: () => api.createMcpJson(), also: [keys.connect] });

export const useAnswer = () =>
  useWrite<{ id: string; answer: string; project?: string }>({
    fn: ({ id, answer }) => api.answer(id, answer),
    project: (v) => v.project,
  });

export const useSetTools = () =>
  useWrite<{ name: string; enabled: boolean }>({
    fn: ({ name, enabled }) => api.setTools({ [name]: enabled }),
    also: [keys.connect, keys.config],
    optimistic: {
      key: () => keys.connect,
      update: (view: { tools: { name: string; enabled: boolean }[] }, { name, enabled }) => ({
        ...view,
        tools: view.tools.map((t) => (t.name === name ? { ...t, enabled } : t)),
      }),
    },
  });
