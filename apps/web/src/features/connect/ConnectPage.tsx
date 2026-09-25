import { Link } from '@tanstack/react-router';
import type { ConnectView, McpClientId } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatWhen } from '../../lib/format';
import { useConfig, useConnect, useCreateMcpJson, useSetTools } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { BackIcon } from '../../ui/icons';
import page from '../../ui/Page.module.css';
import { ErrorState, Loading } from '../../ui/States';
import { useCopy } from '../../ui/useCopy';
import { useSynced } from '../../ui/useSynced';
import styles from './ConnectPage.module.css';

function ToolRow({
  tool,
  onChange,
}: {
  tool: ConnectView['tools'][number];
  onChange: (enabled: boolean, reset: () => void) => void;
}) {
  const { t } = useTranslation();
  const [on, setOn] = useSynced(tool.enabled);
  return (
    <li>
      <label className={styles.tool}>
        <span className={tool.write ? styles.badgeW : styles.badgeR} aria-hidden="true">
          {tool.write ? 'W' : 'R'}
        </span>
        <span className={styles.toolText}>
          <span className={styles.toolName}>{tool.name}</span>
          <span className={styles.toolDesc}>{t(`tools.${tool.name}`)}</span>
        </span>
        <input
          type="checkbox"
          className={styles.toggle}
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            onChange(e.target.checked, () => setOn(tool.enabled));
          }}
        />
      </label>
    </li>
  );
}

export function ConnectPage() {
  const { t, i18n } = useTranslation();
  const connect = useConnect();
  const config = useConfig();
  const setTools = useSetTools();
  const createMcp = useCreateMcpJson();
  const snippet = useCopy();
  const [client, setClient] = useState<McpClientId>('claude-code');

  if (connect.isPending) return <Loading />;
  if (connect.isError) return <ErrorState error={connect.error} onRetry={() => void connect.refetch()} />;
  const view = connect.data;
  const current = view.clients.find((c) => c.id === client) ?? view.clients[0];
  const configured = view.clients.filter((c) => c.configured).length;

  return (
    <main className={`${page.page} ${styles.page}`}>
      <div className={page.crumbs}>
        <Link to="/" className={page.back}>
          <BackIcon />
          {t('nav.board')}
        </Link>
        <span className={styles.status}>
          <span className={`dot ${configured ? 'dot-live' : styles.off}`} />
          {t('connect.status', { count: configured })}
          {config.data && <code className={styles.home}>{config.data.home}</code>}
        </span>
      </div>

      <header className={styles.header}>
        <h1 className={`display ${styles.h1}`}>
          {t('connect.title1')}
          <br />
          <span className={styles.accent}>{t('connect.title2')}</span>
        </h1>
        <p className={styles.intro}>{t('connect.intro')}</p>
      </header>

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="clients-heading">
          <h2 id="clients-heading" className="label">
            {t('connect.step1')}
          </h2>
          <div role="tablist" aria-label={t('connect.clients')} className={styles.tabs}>
            {view.clients.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                id={`tab-${c.id}`}
                aria-selected={c.id === client}
                aria-controls="client-panel"
                className={styles.tab}
                onClick={() => setClient(c.id)}
              >
                <span className={styles.tabName}>{c.label}</span>
                <span className={c.configured ? styles.ok : styles.no}>
                  {c.configured ? t('connect.connected') : t('connect.notConnected')}
                </span>
              </button>
            ))}
          </div>
          {current && (
            <div id="client-panel" role="tabpanel" aria-labelledby={`tab-${current.id}`} className={styles.clientPanel}>
              <p className={styles.how}>{t(`connect.how.${current.id}`)}</p>
              {current.file && <p className={styles.file}>{t('connect.file', { file: current.file })}</p>}
              {current.canCreate === false && <p className={styles.how}>{t('connect.needsKit')}</p>}
              {current.canCreate && <p className={styles.how}>{t('connect.missingMcp')}</p>}
              <div className={styles.commandsLabel}>{t('connect.commands')}</div>
              <pre className={styles.commands}>{current.commands.map((c) => `$ ${c}`).join('\n')}</pre>
              {current.error ? (
                <p className={styles.error}>{current.error}</p>
              ) : current.snippet ? (
                // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable code must be reachable by keyboard
                <pre className={styles.snippet} tabIndex={0}>
                  {current.snippet}
                </pre>
              ) : (
                <p className={styles.how}>{t('connect.noSnippet')}</p>
              )}
              <div className={styles.buttons}>
                <Button
                  variant="primary"
                  size="lg"
                  disabled={!current.snippet}
                  onClick={() => void snippet.copy(current.snippet)}
                >
                  <span aria-live="polite">{snippet.copied ? t('common.copied') : t('common.copy')}</span>
                </Button>
                {current.canCreate && (
                  <Button
                    variant="dark"
                    size="lg"
                    disabled={createMcp.isPending}
                    onClick={() =>
                      createMcp.mutate(undefined, { onSuccess: () => toast.success(t('connect.mcpCreated')) })
                    }
                  >
                    {t('connect.createMcp')}
                  </Button>
                )}
                {current.lastUsed && (
                  <span className={styles.last}>
                    {t('connect.lastUsed', { when: formatWhen(current.lastUsed, i18n.language as 'pl' | 'en') })}
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="tools-heading">
          <div className={page.sectionHead}>
            <h2 id="tools-heading" className="label">
              {t('connect.step2')}
            </h2>
            <span className={styles.legend}>
              <span>
                <strong className={styles.r}>R</strong> {t('connect.read')}
              </span>
              <span>
                <strong>W</strong> {t('connect.write')}
              </span>
            </span>
          </div>
          <ul className={styles.tools}>
            {view.tools.map((tool) => (
              <ToolRow
                key={tool.name}
                tool={tool}
                onChange={(enabled, reset) =>
                  setTools.mutate(
                    { name: tool.name, enabled },
                    { onSuccess: () => toast.success(t('connect.saved')), onError: reset },
                  )
                }
              />
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
