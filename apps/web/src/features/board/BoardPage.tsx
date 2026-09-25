import { getRouteApi } from '@tanstack/react-router';
import type { BoardStatus } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLongDay } from '../../lib/format';
import { useBoard } from '../../lib/queries';
import type { BoardFilter } from '../../router';
import { Button } from '../../ui/Button';
import { FilterChips } from '../../ui/FilterChips';
import { IssueBanner } from '../../ui/IssueBanner';
import { PlusIcon } from '../../ui/icons';
import page from '../../ui/Page.module.css';
import { ErrorState, Loading } from '../../ui/States';
import { WeightBars } from '../../ui/WeightBars';
import { Onboarding } from '../onboarding/Onboarding';
import { Board } from './Board';
import styles from './BoardPage.module.css';
import { FocusStrip } from './FocusStrip';
import { NewTaskDialog } from './NewTaskDialog';
import { SearchBox } from './SearchBox';

const route = getRouteApi('/');

export function BoardPage() {
  const { t, i18n } = useTranslation();
  const { filter } = route.useSearch();
  const navigate = route.useNavigate();
  const board = useBoard();
  const [dialog, setDialog] = useState<{ status: BoardStatus; n: number } | null>(null);

  if (board.isPending) return <Loading />;
  if (board.isError) return <ErrorState error={board.error} onRetry={() => void board.refetch()} />;
  const data = board.data;
  if (data.projects.length === 0)
    return (
      <main className={`${page.page} ${styles.page}`}>
        <IssueBanner issues={data.issues} />
        <Onboarding />
      </main>
    );
  const inPlay = data.columns.reduce((n, c) => n + c.cards.length, 0);
  const waiting = data.openQuestions + data.columns.flatMap((c) => c.cards).filter((c) => c.isNew).length;

  return (
    <main className={`${page.page} ${styles.page}`}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <div className={page.eyebrow}>{formatLongDay(new Date(), i18n.language as 'pl' | 'en')}</div>
          <h1 className={`display ${styles.h1}`}>
            {t('board.inPlay', { count: inPlay })}
            <br />
            <span className="gradient-text">
              {waiting ? t('board.waitingForYou', { count: waiting }) : t('board.nothingWaiting')}
            </span>
          </h1>
        </div>
        <div className={styles.tools}>
          <SearchBox />
          <Button variant="primary" size="lg" onClick={() => setDialog({ status: 'inbox', n: Date.now() })}>
            <PlusIcon />
            {t('board.newTask')}
          </Button>
        </div>
      </header>

      <IssueBanner issues={data.issues} />
      <FocusStrip focus={data.focus} />

      <div className={styles.filters}>
        <FilterChips<'all' | BoardFilter>
          label={t('board.filtersLabel')}
          value={filter ?? 'all'}
          onChange={(id) => void navigate({ search: id === 'all' ? {} : { filter: id }, replace: true })}
          options={[
            { id: 'all', label: t('board.filterAll') },
            { id: 'heavy', label: t('board.filterHeavy') },
            { id: 'agent', label: t('board.filterAgent') },
          ]}
        />
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            {t('board.weight')}
            <WeightBars weight={3} label={t('board.weightTitle', { weight: 3 })} />
            {t('board.weightLegend')}
          </span>
          <span>
            {t('board.doneThisWeek')} <strong>{data.doneThisWeek}</strong>
          </span>
        </div>
      </div>

      <Board board={data} filter={filter} onAdd={(status) => setDialog({ status, n: Date.now() })} />

      {dialog && (
        <NewTaskDialog
          key={dialog.n}
          open
          status={dialog.status}
          projects={data.projects}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
}
