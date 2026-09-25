import { getRouteApi, Link } from '@tanstack/react-router';
import type { ProjectCard } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import { useCommands } from '../../layout/Commands';
import { actorName, formatWhen } from '../../lib/format';
import { useProjects } from '../../lib/queries';
import type { KindFilter } from '../../router';
import { Button } from '../../ui/Button';
import { FilterChips } from '../../ui/FilterChips';
import { ImageArt } from '../../ui/ImageArt';
import { PlusIcon } from '../../ui/icons';
import page from '../../ui/Page.module.css';
import { ProgressBar } from '../../ui/ProgressBar';
import { EmptyState, ErrorState, Loading } from '../../ui/States';
import { Onboarding } from '../onboarding/Onboarding';
import styles from './ProjectsPage.module.css';

const route = getRouteApi('/projects');

const LIGHT = new Set(['#EAB308', '#ECEAE5', '#FFFFFF', '#FAFAF8', '#FBF1D3']);

function useLabels() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'pl' | 'en';
  return {
    kind: (p: ProjectCard) => [t(`kind.${p.kind}`), p.kindLabel].filter(Boolean).join(' · '),
    last: (p: ProjectCard) => (p.last ? `${actorName(p.last.actor, t)} · ${formatWhen(p.last.at, lang)}` : ''),
    counts: (p: ProjectCard) => ({
      todos: t('projects.todos', { count: p.openTodos }),
      tasks: t('projects.openTasks', { count: p.openTasks }),
      images: p.images ? t('projects.images', { count: p.images, pinned: p.pinned }) : t('projects.noImages'),
    }),
  };
}

function Featured({ p }: { p: ProjectCard }) {
  const { t } = useTranslation();
  const l = useLabels();
  const c = l.counts(p);
  return (
    <Link to="/p/$project" params={{ project: p.slug }} className={styles.featured}>
      <div className={styles.mosaic}>
        {p.cover.length > 0 ? (
          p.cover.map((img, i) => (
            <div key={img.file} className={i === 0 ? styles.mosaicBig : styles.mosaicTile}>
              <ImageArt image={img} size={i === 0 ? 200 : 90} />
            </div>
          ))
        ) : (
          <div className={styles.mosaicBig} style={{ background: 'var(--grad-accent)' }} />
        )}
      </div>
      <div className={styles.featuredBody}>
        <div className={styles.row}>
          <span className={styles.kindBadge}>{l.kind(p)}</span>
          <span className={styles.last}>{l.last(p)}</span>
        </div>
        <div className={`display ${styles.featuredTitle}`}>{p.name}</div>
        <div className={styles.summary}>{p.description}</div>
        {p.next && (
          <div className={styles.next}>
            <span className={styles.nextLabel}>{t('projects.nextStep')}</span>
            <span className={styles.nextText}>{p.next}</span>
          </div>
        )}
        <div className={styles.progress}>
          <ProgressBar value={p.progress} height={6} label={t('projects.progress')} />
          <strong>{p.progress}%</strong>
        </div>
        <div className={styles.counts}>
          <span>{c.todos}</span>
          <span>{c.tasks}</span>
          <span>{c.images}</span>
        </div>
      </div>
    </Link>
  );
}

function Regular({ p }: { p: ProjectCard }) {
  const { t } = useTranslation();
  const l = useLabels();
  const c = l.counts(p);
  const cover = p.coverColor ?? p.color;
  const mono = p.monogram ?? p.name.slice(0, 2);
  return (
    <Link to="/p/$project" params={{ project: p.slug }} className={styles.card}>
      <div className={styles.cover} style={{ background: `var(--grad-tile-sheen), ${cover}` }}>
        <span
          className={styles.mono}
          style={{ color: LIGHT.has(cover.toUpperCase()) ? 'var(--accent)' : 'var(--mustard)' }}
        >
          {mono}
        </span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.row}>
          <span className={styles.kind}>{l.kind(p)}</span>
          <span className={styles.last}>{l.last(p)}</span>
        </div>
        <div className={styles.cardTitle}>{p.name}</div>
        <div className={styles.cardNext}>{p.next ?? t('projects.noNext')}</div>
        <div className={styles.progress}>
          <ProgressBar value={p.progress} label={t('projects.progress')} />
          <strong>{p.progress}%</strong>
        </div>
        <div className={styles.counts}>
          <span>{c.todos}</span>
          <span>{c.images}</span>
        </div>
      </div>
    </Link>
  );
}

export function ProjectsPage() {
  const { t } = useTranslation();
  const { kind } = route.useSearch();
  const navigate = route.useNavigate();
  const projects = useProjects();
  const { newProject } = useCommands();
  if (projects.isPending) return <Loading />;
  if (projects.isError) return <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />;
  if (projects.data.projects.length === 0)
    return (
      <main className={`${page.page} ${page.wide}`}>
        <Onboarding />
      </main>
    );

  const active = projects.data.projects.filter((p) => !p.archived);
  const archived = projects.data.projects.filter((p) => p.archived);
  const list = kind === 'archived' ? archived : active.filter((p) => !kind || p.kind === kind);
  const featured = kind ? undefined : list[0];
  const physical = active.filter((p) => p.kind === 'physical').length;

  return (
    <main className={`${page.page} ${page.wide}`} style={{ gap: 22 }}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <div className={page.eyebrow}>
            {t('projects.active', { count: active.length })} · {t('projects.physical', { count: physical })}
          </div>
          <h1 className={`display ${styles.h1}`}>
            {t('projects.title')}
            <span className={styles.period}>.</span>
          </h1>
        </div>
        <Button variant="primary" size="lg" onClick={newProject}>
          <PlusIcon />
          {t('projects.new')}
        </Button>
      </header>
      <FilterChips<'all' | KindFilter>
        label={t('projects.filtersLabel')}
        value={kind ?? 'all'}
        onChange={(id) => void navigate({ search: id === 'all' ? {} : { kind: id }, replace: true })}
        options={[
          { id: 'all', label: t('projects.all') },
          { id: 'physical', label: t('projects.physicalFilter') },
          { id: 'digital', label: t('projects.digital') },
          { id: 'life', label: t('projects.life') },
          ...(archived.length
            ? [{ id: 'archived' as const, label: t('projects.archivedFilter', { count: archived.length }) }]
            : []),
        ]}
      />
      {list.length === 0 ? (
        <EmptyState>{kind === 'archived' ? t('projects.noArchived') : t('projects.empty')}</EmptyState>
      ) : (
        <section className={styles.grid} aria-label={t('projects.listLabel')}>
          {featured && <Featured p={featured} />}
          {list
            .filter((p) => p !== featured)
            .map((p) => (
              <Regular key={p.slug} p={p} />
            ))}
        </section>
      )}
    </main>
  );
}
