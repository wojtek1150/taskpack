import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useRouterState } from '@tanstack/react-router';
import type { ProjectsView } from '@taskpack/api';
import { useCallback } from 'react';
import { Toaster } from 'sonner';
import { useLiveUpdates } from '../lib/events';
import { keys } from '../lib/queries';
import styles from './AppShell.module.css';
import { CommandsProvider } from './Commands';
import { Sidebar } from './Sidebar';

/** Screens designed without the sidebar (task view with its agent rail, connections). */
const FULL_WIDTH = [/^\/p\/[^/]+\/t\//, /^\/connect/];

export function AppShell() {
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const projectName = useCallback(
    (slug: string) => qc.getQueryData<ProjectsView>(keys.projects)?.sidebar.find((p) => p.slug === slug)?.name,
    [qc],
  );
  useLiveUpdates(projectName);
  const full = FULL_WIDTH.some((re) => re.test(path));

  return (
    <CommandsProvider>
      <div className={styles.shell}>
        {!full && <Sidebar />}
        <div className={styles.main}>
          <Outlet />
        </div>
        <Toaster
          position="bottom-right"
          // Inline styles win over Sonner's own attribute selectors without !important.
          toastOptions={{
            style: { fontFamily: 'var(--font-body)', borderRadius: 'var(--r-xl)', border: '1px solid var(--line)' },
          }}
        />
      </div>
    </CommandsProvider>
  );
}
