import type { BoardCard } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import { actorName, formatShortDate } from '../../lib/format';
import { CalendarIcon, CheckIcon } from '../../ui/icons';
import { ProgressBar } from '../../ui/ProgressBar';
import { WeightBars } from '../../ui/WeightBars';
import styles from './TaskCard.module.css';

/** Card content (shared by the board, the drag overlay and tests). */
export function TaskCardBody({ card }: { card: BoardCard }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'pl' | 'en';
  return (
    <>
      <div className={styles.top}>
        <WeightBars weight={card.weight} label={t('board.weightTitle', { weight: card.weight })} />
        <span className={styles.project} style={{ color: card.project.color }}>
          {card.project.name}
        </span>
        {card.hasQuestion ? (
          <span className={styles.question}>{t('board.questionBadge')}</span>
        ) : card.isNew ? (
          <span className={styles.new}>
            <span className={styles.newDot} />
            {t('board.newFromAgent')}
          </span>
        ) : null}
      </div>
      <div className={styles.title}>{card.title}</div>
      {card.status === 'in_progress' && card.stepsTotal > 0 && (
        <div className={styles.progress}>
          <ProgressBar value={card.progress} label={t('board.progress')} />
          <span>{card.progress}%</span>
        </div>
      )}
      <div className={styles.meta}>
        <span className={styles.metaItem}>
          <CalendarIcon />
          {card.due ? formatShortDate(card.due, lang) : t('common.noDue')}
        </span>
        <span className={styles.metaItem}>
          <CheckIcon />
          <span aria-hidden="true">
            {card.stepsDone}/{card.stepsTotal}
          </span>
          <span className="visually-hidden">{t('board.steps', { done: card.stepsDone, total: card.stepsTotal })}</span>
        </span>
        {card.agent && <span className={styles.agent}>{actorName(card.agent, t)}</span>}
      </div>
    </>
  );
}

export const cardClass = (card: BoardCard, extra = '') =>
  `${styles.card} ${card.isNew || card.hasQuestion ? styles.flagged : ''} ${extra}`;

export { styles as cardStyles };
