import { useQueryClient } from '@tanstack/react-query';
import type { ActivityView, ChangeEvent } from '@taskpack/api';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { actorName } from './format';
import { invalidateProject, keys } from './queries';

/** Group agent activity per actor and project: "Claude Code · Witrynka: +2 todo, kroki: +1". */
function describe(activity: ActivityView[]): { actor: string; project?: string; summaries: string[] }[] {
  const groups = new Map<string, { actor: string; project?: string; summaries: string[] }>();
  for (const a of activity) {
    if (a.actor === 'user' || a.op === 'question.delivered') continue;
    const key = `${a.actor}\u0000${a.project ?? ''}`;
    const g = groups.get(key) ?? { actor: a.actor, ...(a.project ? { project: a.project } : {}), summaries: [] };
    if (!g.summaries.includes(a.summary)) g.summaries.push(a.summary);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * Listen to `/api/events`: every change (UI, CLI, MCP, an editor) refreshes the affected
 * queries; changes by agents or outside Taskpack also show a toast.
 */
export function useLiveUpdates(projectName: (slug: string) => string | undefined): void {
  const qc = useQueryClient();
  const { t } = useTranslation();

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('changed', (msg) => {
      const event = JSON.parse((msg as MessageEvent<string>).data) as ChangeEvent;
      if (event.root) {
        invalidateProject(qc);
        void qc.invalidateQueries({ queryKey: keys.config });
        void qc.invalidateQueries({ queryKey: keys.connect });
      } else for (const p of event.projects) invalidateProject(qc, p);

      for (const g of describe(event.activity)) {
        const project = g.project ? (projectName(g.project) ?? g.project) : undefined;
        toast(t('toast.agentChange', { actor: actorName(g.actor, t), project: project ?? t('toast.workspace') }), {
          description: g.summaries.join(' · '),
        });
      }
      if (event.activity.length === 0 && event.files.length > 0) {
        toast(t('toast.external'), { description: event.files.slice(0, 3).join(', ') });
      }
    });
    return () => source.close();
  }, [qc, t, projectName]);
}
