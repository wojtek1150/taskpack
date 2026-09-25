import { z } from 'zod';
import {
  ACTORS,
  AUTOCOMMIT_MODES,
  IMAGE_CATEGORIES,
  LANGS,
  PROJECT_KINDS,
  QUESTION_STATUSES,
  SESSION_VIA,
  TASK_STATUSES,
  TOOL_NAMES,
} from './enums.js';
import { SLUG_MAX_LENGTH, SLUG_RE } from './slug.js';

// Dates are written as ISO 8601 strings. YAML is parsed with the 1.2 core schema,
// so unquoted `2026-09-28` stays a string.
export const isoDate = z.iso.date();
export const isoDateTime = z.iso.datetime({ offset: true, local: true });
/** Either `2026-09-22` or `2026-09-22T21:40:00+02:00`. */
export const isoDateOrDateTime = z.union([isoDate, isoDateTime]);

export const slug = z.string().max(SLUG_MAX_LENGTH).regex(SLUG_RE, 'invalid slug (use a-z, 0-9 and "-")');
export const actor = z.enum(ACTORS);
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #RRGGBB');
/** Sort key: number or fractional-index string. */
export const order = z.union([z.number(), z.string().min(1)]);
/** Short id carried in HTML comments / frontmatter, e.g. `td_8k2f`. */
export const itemId = z.string().regex(/^[a-z]{1,3}_[a-z0-9]{3,24}$/, 'invalid id (expected e.g. td_8k2f)');

// ---------------------------------------------------------------------------
// taskpack.yaml

export const clientSchema = z.object({
  name: z.string().min(1),
  actor,
  via: z.enum(SESSION_VIA),
  /** Per-client tool overrides, e.g. `{ set_summary: false }`. */
  tools: z.partialRecord(z.enum(TOOL_NAMES), z.boolean()).default({}),
});

export const taskpackConfigSchema = z.object({
  version: z.literal(1),
  lang: z.enum(LANGS),
  git: z
    .object({
      autocommit: z.enum(AUTOCOMMIT_MODES).default('session'),
    })
    .default({ autocommit: 'session' }),
  pack: z
    .object({
      max_tokens: z.number().int().positive().default(2500),
      max_open_todos: z.number().int().positive().default(15),
      max_images: z.number().int().min(0).max(5).default(5),
      max_image_kb: z.number().int().positive().default(700),
      session_chars: z.number().int().positive().default(400),
    })
    .default({ max_tokens: 2500, max_open_todos: 15, max_images: 5, max_image_kb: 700, session_chars: 400 }),
  /** Globally enabled MCP tools. Missing keys are enabled. */
  tools: z.partialRecord(z.enum(TOOL_NAMES), z.boolean()).default({}),
  clients: z.array(clientSchema).default([]),
});
export type TaskpackConfig = z.infer<typeof taskpackConfigSchema>;

// ---------------------------------------------------------------------------
// projects/<slug>/project.md

export const projectFrontmatterSchema = z
  .object({
    name: z.string().min(1).max(200),
    kind: z.enum(PROJECT_KINDS),
    kind_label: z.string().max(40).optional(),
    color: hexColor.optional(),
    cover_color: hexColor.optional(),
    monogram: z.string().max(4).optional(),
    target: isoDate.optional(),
    target_label: z.string().max(80).optional(),
    progress_mode: z.enum(['auto', 'manual']).default('auto'),
    progress: z.number().int().min(0).max(100).optional(),
    archived: z.boolean().default(false),
    order: order.optional(),
    created: isoDateOrDateTime.optional(),
  })
  .refine((p) => p.progress_mode !== 'manual' || p.progress !== undefined, {
    message: 'progress is required when progress_mode is manual',
    path: ['progress'],
  });
export type ProjectFrontmatter = z.infer<typeof projectFrontmatterSchema>;

// ---------------------------------------------------------------------------
// projects/<slug>/tasks/<slug>.md

export const taskFrontmatterSchema = z.object({
  title: z.string().min(1).max(200),
  status: z.enum(TASK_STATUSES).default('inbox'),
  weight: z.number().int().min(1).max(5).default(3),
  due: isoDate.optional(),
  estimate: z.string().max(40).optional(),
  order: order.optional(),
  /** What this task blocks or waits for, e.g. "blocks assembly". */
  blocked_note: z.string().max(200).optional(),
  created: isoDateOrDateTime.optional(),
  created_by: actor.optional(),
  done_at: isoDateOrDateTime.optional(),
});
export type TaskFrontmatter = z.infer<typeof taskFrontmatterSchema>;

// ---------------------------------------------------------------------------
// projects/<slug>/sessions/YYYY-MM-DD-<agent>[-n].md

export const sessionFrontmatterSchema = z.object({
  agent: actor,
  started: isoDateTime,
  ended: isoDateTime.optional(),
  via: z.enum(SESSION_VIA).optional(),
  /** Short change list, e.g. "+2 todo", "pinned: Dimensions". */
  changes: z.array(z.string().min(1)).default([]),
  /** When the session's changes were undone (`taskpack session undo`, UI "Undo"); the note is kept. */
  undone: isoDateTime.optional(),
});
export type SessionFrontmatter = z.infer<typeof sessionFrontmatterSchema>;
export const SESSION_FILE_RE = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})-(${ACTORS.join('|')})(?:-(\\d+))?\\.md$`);

// ---------------------------------------------------------------------------
// projects/<slug>/notes/YYYY-MM-DD-<slug>.md

export const noteFrontmatterSchema = z.object({
  title: z.string().max(200).optional(),
  author: actor,
  created: isoDateOrDateTime,
  /** Task slug this note belongs to. */
  task: slug.optional(),
});
export type NoteFrontmatter = z.infer<typeof noteFrontmatterSchema>;
export const NOTE_FILE_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

// ---------------------------------------------------------------------------
// projects/<slug>/images/images.yaml

export const imageEntrySchema = z.object({
  /** File name relative to the `images/` folder. */
  file: z
    .string()
    .min(1)
    .regex(/^[^/\\]+$/, 'file must be a plain file name inside images/'),
  title: z.string().min(1).max(200),
  category: z.enum(IMAGE_CATEGORIES),
  caption: z.string().max(1000).default(''),
  pinned: z.boolean().default(false),
  order: order.optional(),
  /** Position among the pinned images (1 = the big tile); only meaningful while pinned. */
  pinned_order: z.number().optional(),
  /** Task slugs this image is attached to. The only place the task↔image link is stored. */
  tasks: z.array(slug).default([]),
  /** Who added the image (UI shows "from Claude" for agents). */
  created_by: actor.optional(),
  created: isoDateOrDateTime.optional(),
});
export const imagesFileSchema = z.object({
  images: z.array(imageEntrySchema).default([]),
});
export type ImageEntry = z.infer<typeof imageEntrySchema>;

// ---------------------------------------------------------------------------
// Metadata carried in HTML comments: `<!-- id:td_8k2f by:claude at:2026-09-22 -->`

export const itemMetaSchema = z.object({
  id: itemId.optional(),
  by: actor.optional(),
  at: isoDateOrDateTime.optional(),
  /** When a checklist item was ticked. */
  done: isoDateOrDateTime.optional(),
});
export type ItemMeta = z.infer<typeof itemMetaSchema>;

/** Metadata of a question in `questions.md`. */
export const questionMetaSchema = itemMetaSchema.extend({
  by: actor,
  at: isoDateOrDateTime,
  project: slug.optional(),
  task: slug.optional(),
  status: z.enum(QUESTION_STATUSES).default('open'),
});
export type QuestionMeta = z.infer<typeof questionMetaSchema>;

/** Top-level keys each frontmatter schema knows; other keys produce a warning. */
export function knownKeys(schema: z.ZodType): string[] {
  return schema instanceof z.ZodObject ? Object.keys(schema.shape) : [];
}
