import styles from './WeightBars.module.css';

const HEIGHTS = [6, 8, 10, 12, 14];

/** Weight 1–5 as five rising bars; `label` is read by screen readers ("Waga 4/5"). */
export function WeightBars({ weight, label }: { weight: number; label: string }) {
  return (
    <span className={styles.bars} role="img" aria-label={label} title={label}>
      {HEIGHTS.map((h, i) => (
        <span key={h} className={i < weight ? styles.on : styles.off} style={{ height: h }} data-on={i < weight} />
      ))}
    </span>
  );
}
