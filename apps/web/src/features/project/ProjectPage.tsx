import { getRouteApi, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatShortDate } from '../../lib/format';
import { usePatchProject, useProject } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { CopyField } from '../../ui/CopyField';
import { IssueBanner } from '../../ui/IssueBanner';
import { BackIcon, PlusIcon } from '../../ui/icons';
import page from '../../ui/Page.module.css';
import { ProgressBar } from '../../ui/ProgressBar';
import { ErrorState, Loading } from '../../ui/States';
import { NewTaskDialog } from '../board/NewTaskDialog';
import { ProjectDialog } from '../projects/ProjectDialog';
import { Gallery } from './Gallery';
import styles from './ProjectPage.module.css';
import { SummaryPanel } from './SummaryPanel';
import { TaskList } from './TaskList';
import { Timeline } from './Timeline';
import { TodoList } from './TodoList';

const route = getRouteApi('/p/$project');

export function ProjectPage() {
  const { t, i18n } = useTranslation();
  const { project: slug } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const query = useProject(slug);
  const patch = usePatchProject(slug);
  const [dialog, setDialog] = useState(0);
  const [edit, setEdit] = useState(0);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const p = query.data;
  const lang = i18n.language as 'pl' | 'en';
  const pinned = p.images.filter((i) => i.pinned).length;
  const target = p.targetLabel ?? (p.target ? formatShortDate(p.target, lang) : undefined);

  return (
    <main className={`${page.page} ${page.wide}`}>
      <div className={page.crumbs}>
        <Link to="/projects" className={page.back}>
          <BackIcon />
          {t('nav.projects')}
        </Link>
        <span>{[t(`kind.${p.kind}`), p.kindLabel].filter(Boolean).join(' · ')}</span>
        <span className={styles.actions}>
          <Button variant="ghost" onClick={() => setEdit(Date.now())}>
            {t('project.edit')}
          </Button>
          <Button
            variant="quiet"
            disabled={patch.isPending}
            onClick={() =>
              patch.mutate(
                { archived: !p.archived },
                { onSuccess: () => toast.success(p.archived ? t('project.restored') : t('project.archivedToast')) },
              )
            }
          >
            {p.archived ? t('project.restore') : t('project.archive')}
          </Button>
          <Button variant="primary" onClick={() => setDialog(Date.now())}>
            <PlusIcon size={14} />
            {t('project.addTask')}
          </Button>
        </span>
      </div>

      <IssueBanner issues={p.issues} />
      {p.archived && (
        <p className={styles.archived} role="note">
          {t('project.archivedNote')}
        </p>
      )}

      <header className={styles.header}>
        <div className={styles.intro}>
          <h1 className={`display ${styles.h1}`}>
            {p.name}
            <span style={{ color: p.color }}>.</span>
          </h1>
          {p.description && <p className={styles.desc}>{p.description}</p>}
          <div className={styles.progress}>
            <ProgressBar value={p.progress} height={6} solid className={styles.bar} label={t('projects.progress')} />
            <span>
              <strong>{p.progress}%</strong>
              {target ? ` · ${t('project.target', { target })}` : ''}
            </span>
          </div>
        </div>
        <aside className={styles.agentBox} aria-labelledby="agent-box">
          <div id="agent-box" className={styles.agentLabel}>
            <span className="dot" style={{ background: 'var(--accent)' }} />
            {t('project.forAgent')}
          </div>
          <p className={styles.agentText}>
            <Trans i18nKey="project.forAgentText" values={{ count: pinned }} components={{ b: <strong /> }} />
          </p>
          <CopyField text={t('project.agentPrompt', { ref: p.ref })} label={p.ref} />
        </aside>
      </header>

      <div className={styles.two}>
        <SummaryPanel project={p.slug} summary={p.summary} />
        <TodoList project={p.slug} todos={p.todos} />
      </div>

      <Gallery
        project={p.slug}
        images={p.images}
        tasks={p.tasks}
        view={search.gallery ?? 'current'}
        cat={search.cat}
        onView={(v) =>
          void navigate({ search: v === 'all' ? { gallery: 'all' } : {}, replace: true, resetScroll: false })
        }
        onCat={(cat) =>
          void navigate({ search: { gallery: 'all', ...(cat ? { cat } : {}) }, replace: true, resetScroll: false })
        }
      />

      <div className={styles.two}>
        <TaskList project={p.slug} tasks={p.tasks} />
        <Timeline project={p.slug} items={p.timeline} />
      </div>

      {edit > 0 && <ProjectDialog key={edit} project={p} onClose={() => setEdit(0)} />}
      {dialog > 0 && (
        <NewTaskDialog
          key={dialog}
          open
          project={p.slug}
          status="todo"
          projects={[{ slug: p.slug, name: p.name, color: p.color }]}
          onClose={() => setDialog(0)}
        />
      )}
    </main>
  );
}
