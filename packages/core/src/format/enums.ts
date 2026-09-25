// Enum values used in workspace files. Always English, independent of `taskpack.yaml: lang`.

export const LANGS = ['pl', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export const ACTORS = ['user', 'claude-code', 'claude', 'chatgpt', 'codex', 'cursor', 'other'] as const;
export type Actor = (typeof ACTORS)[number];

export const PROJECT_KINDS = ['physical', 'digital', 'life'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const TASK_STATUSES = ['inbox', 'todo', 'in_progress', 'waiting', 'done', 'canceled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const IMAGE_CATEGORIES = ['visualization', 'drawing', 'inspiration', 'progress', 'other'] as const;
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];

/** How an agent session reached the workspace. */
export const SESSION_VIA = ['mcp', 'cli', 'files', 'ui'] as const;
export type SessionVia = (typeof SESSION_VIA)[number];

export const QUESTION_STATUSES = ['open', 'answered', 'delivered'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const AUTOCOMMIT_MODES = ['session', 'off'] as const;

/** MCP tool names; keys of `taskpack.yaml: tools`. */
export const TOOL_NAMES = [
  'list_projects',
  'get_project',
  'get_task',
  'get_images',
  'search',
  'add_todo',
  'create_task',
  'create_project',
  'update_task',
  'set_summary',
  'log_session',
  'attach_image',
  'ask_user',
  'toggle_todo',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const MAX_PINNED_IMAGES = 5;
