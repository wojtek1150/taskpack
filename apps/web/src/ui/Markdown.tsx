import ReactMarkdown from 'react-markdown';
import styles from './Markdown.module.css';

/** Markdown from workspace files (raw HTML is not rendered). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`${styles.md} ${className ?? ''}`}>
      <ReactMarkdown skipHtml>{children}</ReactMarkdown>
    </div>
  );
}
