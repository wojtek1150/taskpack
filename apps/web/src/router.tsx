import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { ImageCategory } from '@taskpack/api';
import { BoardPage } from './features/board/BoardPage';
import { ConnectPage } from './features/connect/ConnectPage';
import { NotesPage } from './features/notes/NotesPage';
import { ProjectPage } from './features/project/ProjectPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { QuestionsPage } from './features/questions/QuestionsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TaskPage } from './features/task/TaskPage';
import { TodayPage } from './features/today/TodayPage';
import { AppShell } from './layout/AppShell';
import { NotFound } from './ui/NotFound';

const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | undefined =>
  options.includes(value as T) ? (value as T) : undefined;

const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: NotFound });

export type BoardFilter = 'all' | 'heavy' | 'agent';
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: BoardPage,
  validateSearch: (s: Record<string, unknown>): { filter?: BoardFilter } => {
    const filter = oneOf(s.filter, ['heavy', 'agent'] as const);
    return filter ? { filter } : {};
  },
});

export type KindFilter = 'physical' | 'digital' | 'life' | 'archived';
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsPage,
  validateSearch: (s: Record<string, unknown>): { kind?: KindFilter } => {
    const kind = oneOf(s.kind, ['physical', 'digital', 'life', 'archived'] as const);
    return kind ? { kind } : {};
  },
});

const todayRoute = createRoute({ getParentRoute: () => rootRoute, path: '/today', component: TodayPage });
const questionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/questions', component: QuestionsPage });

export type NotesKind = 'note' | 'session';
const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notes',
  component: NotesPage,
  validateSearch: (s: Record<string, unknown>): { project?: string; actor?: string; kind?: NotesKind } => {
    const kind = oneOf(s.kind, ['note', 'session'] as const);
    return {
      ...(typeof s.project === 'string' && s.project ? { project: s.project } : {}),
      ...(typeof s.actor === 'string' && s.actor ? { actor: s.actor } : {}),
      ...(kind ? { kind } : {}),
    };
  },
});

const CATEGORIES = ['visualization', 'drawing', 'inspiration', 'progress', 'other'] as const;
export const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project',
  component: ProjectPage,
  validateSearch: (s: Record<string, unknown>): { gallery?: 'all'; cat?: ImageCategory } => {
    const cat = oneOf(s.cat, CATEGORIES);
    return { ...(s.gallery === 'all' ? { gallery: 'all' as const } : {}), ...(cat ? { cat } : {}) };
  },
});

export const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/t/$task',
  component: TaskPage,
});

const connectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/connect', component: ConnectPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage });

const routeTree = rootRoute.addChildren([
  boardRoute,
  todayRoute,
  questionsRoute,
  notesRoute,
  projectsRoute,
  projectRoute,
  taskRoute,
  connectRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  // `/` in the app, `/taskpack/` in the demo build on GitHub Pages.
  basepath: import.meta.env.BASE_URL,
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
