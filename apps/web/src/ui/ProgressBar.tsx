import styles from './ProgressBar.module.css';

/** Thin progress track; `solid` uses the flat accent (project header), otherwise the gradient. */
export function ProgressBar({
  value,
  height = 4,
  solid = false,
  label,
  className,
}: {
  value: number;
  height?: number;
  solid?: boolean;
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={`${styles.track} ${className ?? ''}`}
      style={{ height, borderRadius: height / 2 }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
    >
      <div className={solid ? styles.solid : styles.fill} style={{ width: `${pct}%`, height }} />
    </div>
  );
}
