import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  bodyStart,
  findSections,
  removeFrontmatterField,
  renderFrontmatter,
  replaceContent,
  setFrontmatterField,
  type TextDoc,
} from '../edit/doc.js';
import { PROJECT_KINDS } from '../format/enums.js';
import { hexColor, isoDate, slug as slugSchema } from '../format/schemas.js';
import { slugify } from '../format/slug.js';
import { messages } from '../messages.js';
import { formatRef, parseRef } from '../refs.js';
import { type Context, mutate, projectPath, requireProject, type Written } from '../workspace.js';
import { blockText, lineText, parseInput } from './common.js';

/** Slugs that would clash with other meanings of a reference (`inbox` = inbox.md). */
const RESERVED = new Set(['inbox']);

export const createProjectInput = z.object({
  name: lineText(200),
  kind: z.enum(PROJECT_KINDS),
  /** Free label next to the kind, e.g. "stolarka". */
  kind_label: lineText(40).optional(),
  description: blockText(5_000).optional(),
  color: hexColor.optional(),
  target: isoDate.optional(),
  target_label: lineText(80).optional(),
  /** Folder name; derived from the name when omitted. */
  slug: slugSchema.optional(),
});

export interface CreateProjectResult {
  ref: string;
  slug: string;
  file: string;
}

/** Create `projects/<slug>/project.md` (frontmatter + description). The slug gets `-2`, `-3`… when taken. */
export function createProject(ctx: Context, input: z.input<typeof createProjectInput>): Written<CreateProjectResult> {
  const args = parseInput(createProjectInput, input);
  return mutate(ctx, (tx) => {
    const base = args.slug ?? (slugify(args.name) || 'project');
    let slug = base;
    for (let n = 2; RESERVED.has(slug) || existsSync(projectPath(tx.ws.home, slug)); n++) slug = `${base}-${n}`;
    // New projects go last in the sidebar when the others are numbered.
    const orders = tx.ws.projects.map((p) => p.frontmatter.order).filter((o): o is number => typeof o === 'number');
    const lines = renderFrontmatter({
      name: args.name,
      kind: args.kind,
      kind_label: args.kind_label,
      color: args.color?.toUpperCase(),
      target: args.target,
      target_label: args.target_label,
      order: orders.length ? Math.floor(Math.max(...orders)) + 1 : undefined,
      created: tx.ts,
    });
    const file = `projects/${slug}/project.md`;
    tx.create(file, `${[...lines, ...(args.description ? [args.description] : [])].join('\n')}\n`);
    tx.log({
      op: 'project.create',
      project: slug,
      entity: slug,
      count: 1,
      summary: messages(tx.lang).projectOps.created(args.name),
    });
    return { ref: formatRef({ project: slug }), slug, file };
  });
}

const optional = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

export const updateProjectInput = z.object({
  project: z.string().min(1),
  name: lineText(200).optional(),
  kind: z.enum(PROJECT_KINDS).optional(),
  /** `null` removes the field (also for color, target, target_label). */
  kind_label: optional(lineText(40)),
  /** Replaces the text before the first `##` section; `""` removes it. */
  description: blockText(5_000).optional(),
  color: optional(hexColor),
  target: optional(isoDate),
  target_label: optional(lineText(80)),
  archived: z.boolean().optional(),
});

export interface UpdateProjectResult {
  ref: string;
  slug: string;
  changed: string[];
}

/** The description is the body text before the first `##` heading. */
function setDescription(doc: TextDoc, text: string): void {
  const start = bodyStart(doc);
  const end = findSections(doc)[0]?.line ?? doc.lines.length;
  const lines = text ? text.split('\n') : [];
  if (doc.contentEnd(start, end) > start && lines.length) replaceContent(doc, start, end, lines);
  else doc.lines.splice(start, end - start, ...lines, '');
}

/** Change project.md frontmatter fields and the description; only the touched lines change. */
export function updateProject(ctx: Context, input: z.input<typeof updateProjectInput>): Written<UpdateProjectResult> {
  const args = parseInput(updateProjectInput, input);
  return mutate(ctx, (tx) => {
    const project = requireProject(tx.ws, parseRef(args.project).project);
    const fm = project.frontmatter;
    const doc = tx.open(`projects/${project.slug}/project.md`);
    const changed: string[] = [];
    const fields = ['name', 'kind', 'kind_label', 'color', 'target', 'target_label'] as const;
    for (const key of fields) {
      const value = key === 'color' && args.color ? args.color.toUpperCase() : args[key];
      if (value === undefined || value === (fm[key] ?? null)) continue;
      if (value === null) removeFrontmatterField(doc, key);
      else setFrontmatterField(doc, key, value);
      changed.push(key);
    }
    if (args.description !== undefined && args.description !== project.description.trim()) {
      setDescription(doc, args.description);
      changed.push('description');
    }
    const m = messages(tx.lang).projectOps;
    const name = args.name ?? fm.name;
    if (changed.length)
      tx.log({ op: 'project.edit', project: project.slug, entity: project.slug, summary: m.edited(name) });
    if (args.archived !== undefined && args.archived !== fm.archived) {
      if (args.archived) setFrontmatterField(doc, 'archived', true);
      else removeFrontmatterField(doc, 'archived');
      changed.push('archived');
      tx.log({
        op: args.archived ? 'project.archive' : 'project.unarchive',
        project: project.slug,
        entity: project.slug,
        summary: args.archived ? m.archived(name) : m.unarchived(name),
      });
    }
    return { ref: formatRef({ project: project.slug }), slug: project.slug, changed };
  });
}
