import type {
  BoardStatus,
  BoardView,
  ConfigView,
  ConnectView,
  ImageAdded,
  ImageCategory,
  Lang,
  NewProject,
  NotesView,
  ProjectPatch,
  ProjectsView,
  ProjectView,
  QuestionView,
  SearchHitView,
  SessionUndone,
  SessionUndoView,
  TaskStatus,
  TaskView,
  TodayView,
  ToolName,
} from '@taskpack/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
  if (!res.ok) throw new ApiError(res.status, data.error?.code ?? 'http', data.error?.message ?? res.statusText);
  return data as T;
}

const seg = encodeURIComponent;

export interface TaskPatch {
  status?: TaskStatus;
  weight?: number;
  due?: string | null;
  title?: string;
  description?: string;
  estimate?: string;
  add_steps?: string[];
  check_steps?: string[];
  uncheck_steps?: string[];
  note?: string;
  decision?: string;
}

export interface NewTask {
  title: string;
  status?: TaskStatus;
  weight?: number;
  due?: string;
  description?: string;
  steps?: string[];
}

export interface SummaryPatch {
  body?: string;
  now?: string;
  blocker?: string;
  next?: string;
}

export interface ImagePatch {
  pinned?: boolean;
  title?: string;
  caption?: string;
  category?: ImageCategory;
  tasks?: string[];
}

export const api = {
  board: () => request<BoardView>('GET', '/api/board'),
  projects: () => request<ProjectsView>('GET', '/api/projects'),
  project: (slug: string) => request<ProjectView>('GET', `/api/projects/${seg(slug)}`),
  task: (project: string, task: string) => request<TaskView>('GET', `/api/projects/${seg(project)}/tasks/${seg(task)}`),
  questions: () => request<QuestionView[]>('GET', '/api/questions'),
  search: (q: string, limit = 12) => request<SearchHitView[]>('GET', `/api/search?q=${seg(q)}&limit=${limit}`),
  today: () => request<TodayView>('GET', '/api/today'),
  notes: () => request<NotesView>('GET', '/api/notes'),
  undoInfo: (file: string) => request<SessionUndoView>('GET', `/api/sessions/undo?file=${seg(file)}`),
  undoSession: (file: string, commitPending: boolean) =>
    request<SessionUndone>('POST', '/api/sessions/undo', { file, commit_pending: commitPending }),
  createProject: (project: NewProject) =>
    request<{ ref: string; slug: string; file: string }>('POST', '/api/projects', project),
  patchProject: (slug: string, patch: ProjectPatch) => request('PATCH', `/api/projects/${seg(slug)}`, patch),
  config: () => request<ConfigView>('GET', '/api/config'),
  connect: () => request<ConnectView>('GET', '/api/connect'),

  addTodos: (project: string, items: string[]) =>
    request<{ added: { id: string; text: string }[] }>('POST', `/api/projects/${seg(project)}/todos`, { items }),
  patchTodo: (id: string, patch: { done?: boolean; text?: string }) => request('PATCH', `/api/todos/${seg(id)}`, patch),
  createTask: (project: string, task: NewTask) =>
    request<{ ref: string; id: string }>('POST', `/api/projects/${seg(project)}/tasks`, task),
  patchTask: (project: string, task: string, patch: TaskPatch) =>
    request('PATCH', `/api/projects/${seg(project)}/tasks/${seg(task)}`, patch),
  moveTask: (project: string, task: string, status: BoardStatus, index: number) =>
    request('POST', `/api/projects/${seg(project)}/tasks/${seg(task)}/move`, { status, index }),
  moveStep: (project: string, task: string, step: string, to: number) =>
    request('POST', `/api/projects/${seg(project)}/tasks/${seg(task)}/steps/move`, { step, to }),
  markSeen: (project: string, task: string) =>
    request<void>('POST', `/api/projects/${seg(project)}/tasks/${seg(task)}/seen`),
  setSummary: (project: string, summary: SummaryPatch) =>
    request('PUT', `/api/projects/${seg(project)}/summary`, summary),
  addNote: (project: string, note: { body: string; title?: string; task?: string }) =>
    request<{ file: string }>('POST', `/api/projects/${seg(project)}/notes`, note),
  patchImage: (project: string, file: string, patch: ImagePatch) =>
    request('PATCH', `/api/projects/${seg(project)}/images/${seg(file)}`, patch),
  reorderPinned: (project: string, files: string[]) =>
    request('POST', `/api/projects/${seg(project)}/images/reorder`, { files }),
  createMcpJson: () => request<{ file: string; written: boolean }>('POST', '/api/connect/claude-code/mcp-json'),
  answer: (id: string, answer: string) => request('POST', `/api/questions/${seg(id)}/answer`, { answer }),
  setTools: (tools: Partial<Record<ToolName, boolean>>) => request('PATCH', '/api/config/tools', { tools }),
  setLang: (lang: Lang) => request('PUT', '/api/config/lang', { lang }),
};

export interface NewImage {
  title?: string;
  category?: ImageCategory;
  caption?: string;
  pin?: boolean;
  tasks?: string[];
}

/**
 * Upload one image as multipart/form-data. XHR rather than fetch, because fetch has no upload
 * progress events.
 */
export function uploadImage(
  project: string,
  file: Blob,
  name: string,
  fields: NewImage = {},
  onProgress?: (fraction: number) => void,
): Promise<ImageAdded> {
  const form = new FormData();
  if (fields.title) form.append('title', fields.title);
  if (fields.category) form.append('category', fields.category);
  if (fields.caption) form.append('caption', fields.caption);
  if (fields.pin) form.append('pin', 'true');
  for (const task of fields.tasks ?? []) form.append('tasks', task);
  form.append('file', file, name);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${seg(project)}/images`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: { error?: { code: string; message: string } } = {};
      try {
        data = JSON.parse(xhr.responseText) as typeof data;
      } catch {
        // non-JSON error page
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as ImageAdded);
      else reject(new ApiError(xhr.status, data.error?.code ?? 'http', data.error?.message ?? xhr.statusText));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'network error'));
    xhr.send(form);
  });
}
