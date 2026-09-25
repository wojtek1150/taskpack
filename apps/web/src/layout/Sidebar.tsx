import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { actorName } from '../lib/format';
import { useConnect, useProjects, useQuestions } from '../lib/queries';
import { BoardIcon, GridIcon, LogoMark, NotesIcon, QuestionIcon, SettingsIcon, SunIcon } from '../ui/icons';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const { t } = useTranslation();
  const projects = useProjects();
  const connect = useConnect();
  const questions = useQuestions();
  const open = questions.data?.filter((q) => q.status === 'open').length ?? 0;
  const configured = connect.data?.clients.filter((c) => c.configured) ?? [];

  return (
    <nav className={styles.sidebar} aria-label={t('nav.main')}>
      <Link to="/" className={styles.logo} aria-label="Taskpack">
        <span className={styles.mark}>
          <LogoMark />
        </span>
        <span className={styles.word}>
          taskpack<span className={styles.period}>.</span>
        </span>
      </Link>

      <div className={styles.group}>
        <Link to="/today" className={styles.item} activeProps={{ 'aria-current': 'page' }}>
          <SunIcon />
          {t('nav.today')}
        </Link>
        <Link to="/" className={styles.item} activeOptions={{ exact: true }} activeProps={{ 'aria-current': 'page' }}>
          <BoardIcon />
          {t('nav.board')}
        </Link>
        <Link
          to="/projects"
          className={styles.item}
          activeOptions={{ exact: true }}
          activeProps={{ 'aria-current': 'page' }}
        >
          <GridIcon />
          {t('nav.projects')}
        </Link>
        <Link to="/questions" className={styles.item} activeProps={{ 'aria-current': 'page' }}>
          <QuestionIcon />
          {t('nav.questions')}
          {open > 0 && (
            <span className={styles.badge}>
              <span aria-hidden="true">{open}</span>
              <span className="visually-hidden">{t('nav.openQuestions', { count: open })}</span>
            </span>
          )}
        </Link>
        <Link to="/notes" className={styles.item} activeProps={{ 'aria-current': 'page' }}>
          <NotesIcon />
          {t('nav.notes')}
        </Link>
        <Link to="/settings" className={styles.item} activeProps={{ 'aria-current': 'page' }}>
          <SettingsIcon />
          {t('nav.settings')}
        </Link>
      </div>

      <div className={styles.group}>
        <div className={styles.heading}>{t('nav.projectsHeading')}</div>
        {projects.data?.sidebar.map((p) => (
          <Link
            key={p.slug}
            to="/p/$project"
            params={{ project: p.slug }}
            className={styles.project}
            activeProps={{ 'aria-current': 'page' }}
          >
            <span className={styles.swatch} style={{ background: p.color }} />
            <span className={styles.name}>{p.name}</span>
            <span className={styles.count}>
              <span aria-hidden="true">{p.openTasks}</span>
              <span className="visually-hidden">{t('nav.openTasks', { count: p.openTasks })}</span>
            </span>
          </Link>
        ))}
      </div>

      <Link to="/connect" className={styles.mcp}>
        <span className={styles.mcpStatus}>
          <span className={`dot ${configured.length ? 'dot-live' : styles.dotOff}`} />
          {configured.length ? t('mcp.ready') : t('mcp.notConnected')}
        </span>
        <span className={styles.mcpText}>
          {configured.length
            ? t('mcp.sees', { clients: configured.map((c) => actorName(c.actor, t)).join(', ') })
            : t('mcp.connectHint')}
        </span>
        <span className={styles.mcpLink}>{t('mcp.manage')}</span>
      </Link>
    </nav>
  );
}
