import { Link } from '@tanstack/react-router';
import type { QuestionView } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import { actorName, formatWhen } from '../../lib/format';
import { useQuestions } from '../../lib/queries';
import { Markdown } from '../../ui/Markdown';
import page from '../../ui/Page.module.css';
import { EmptyState, ErrorState, Loading } from '../../ui/States';
import { QuestionAnswer } from './QuestionAnswer';
import styles from './QuestionsPage.module.css';

const STATUSES = ['open', 'answered', 'delivered'] as const;

function QuestionItem({ q }: { q: QuestionView }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'pl' | 'en';
  return (
    <article className={styles.card} aria-labelledby={`q-${q.id}`}>
      <div className={styles.meta}>
        <span className={styles[q.status]}>{t(`questions.status.${q.status}`)}</span>
        <span>
          {actorName(q.by, t)}
          {q.at ? ` · ${formatWhen(q.at, lang)}` : ''}
        </span>
        {q.project && (
          <span className={styles.where}>
            <span className={styles.swatch} style={{ background: q.project.color }} />
            {q.task ? (
              <Link to="/p/$project/t/$task" params={{ project: q.project.slug, task: q.task.slug }}>
                {q.project.name} · {q.task.title}
              </Link>
            ) : (
              <Link to="/p/$project" params={{ project: q.project.slug }}>
                {q.project.name}
              </Link>
            )}
          </span>
        )}
      </div>
      <h3 id={`q-${q.id}`} className={styles.question}>
        {q.question}
      </h3>
      {q.context && <Markdown className={styles.context}>{q.context}</Markdown>}
      {q.status === 'open' ? (
        <QuestionAnswer q={q} expanded />
      ) : (
        <div className={styles.answer}>
          <span className={styles.answerLabel}>{t('questions.yourAnswer')}</span>
          <Markdown>{q.answer}</Markdown>
          {q.status === 'answered' && <p className={styles.hint}>{t('questions.waitingForAgent')}</p>}
        </div>
      )}
    </article>
  );
}

/** Questions agents asked (MCP ask_user, questions.md): open ones to answer, then the answered history. */
export function QuestionsPage() {
  const { t } = useTranslation();
  const questions = useQuestions();
  if (questions.isPending) return <Loading />;
  if (questions.isError) return <ErrorState error={questions.error} onRetry={() => void questions.refetch()} />;
  const list = [...questions.data].reverse();
  const open = list.filter((q) => q.status === 'open').length;

  return (
    <main className={`${page.page} ${page.wide}`}>
      <header>
        <div className={page.eyebrow}>{t('questions.eyebrow', { count: open })}</div>
        <h1 className={`display ${styles.h1}`}>
          {t('questions.title')}
          <span className={styles.period}>.</span>
        </h1>
        <p className={page.hint}>{t('questions.intro')}</p>
      </header>
      {list.length === 0 && <EmptyState>{t('questions.empty')}</EmptyState>}
      {STATUSES.map((status) => {
        const items = list.filter((q) => q.status === status);
        if (!items.length) return null;
        return (
          <section key={status} className={styles.section} aria-labelledby={`qs-${status}`}>
            <h2 id={`qs-${status}`} className={page.h2}>
              {t(`questions.section.${status}`)} <span className={styles.count}>{items.length}</span>
            </h2>
            <div className={styles.list}>
              {items.map((q) => (
                <QuestionItem key={q.id || q.question} q={q} />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
