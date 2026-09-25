import type { DemoBackend } from './backend';
import { SCRIPT } from './strings';

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A short scripted Claude session on the first project, written through the demo backend as
 * actor `claude`: two todos, a ticked step with a note, the summary, a session note (which can
 * be undone) and finally a question. Every write reaches the UI as a `changed` event, the same
 * way an MCP session on a local install does. Returns the session note's path.
 */
export async function simulateClaude(backend: DemoBackend, step = 1100): Promise<string> {
  const lang = backend.state.lang;
  const script = SCRIPT[lang];
  const project = backend.state.projects.find((p) => !p.archived);
  if (!project) throw new Error('no project to work on');
  const slug = project.slug;
  const task = backend.openTasks(project).find((t) => t.status === 'in_progress' && t.steps.some((s) => !s.done));
  const before = backend.snapshot();
  const since = backend.state.activity.length;

  backend.addTodos('claude', slug, script.todos);
  await pause(step);
  const next = task?.steps.find((s) => !s.done);
  if (task && next) {
    backend.patchTask('claude', slug, task.slug, { check_steps: [next.id], note: script.note });
    await pause(step);
  }
  backend.setSummary('claude', slug, script.summary);
  await pause(step);

  const changes = [
    ...new Set(
      backend.state.activity
        .slice(since)
        .filter((e) => e.actor === 'claude' && e.project === slug)
        .map((e) => e.summary),
    ),
  ];
  const session = backend.logSession('claude', slug, script.session, changes);
  backend.registerUndo(session.file, slug, before, [
    { path: `projects/${slug}/todos.md`, status: 'M' },
    ...(task ? [{ path: `projects/${slug}/tasks/${task.slug}.md`, status: 'M' }] : []),
    { path: `projects/${slug}/project.md`, status: 'M' },
    { path: session.file, status: 'A' },
  ]);
  await pause(step);

  const asked = backend.state.tasks.some((t) => t.project === slug && t.slug === script.question.task);
  backend.askUser('claude', {
    question: script.question.question,
    context: script.question.context,
    options: script.question.options,
    project: slug,
    ...(asked ? { task: script.question.task } : {}),
  });
  return session.file;
}
