import styles from './FilterChips.module.css';

export interface ChipOption<T extends string> {
  id: T;
  label: string;
}

/** Toggle chips (one pressed at a time), e.g. board filters or gallery categories. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  tone = 'ink',
  size = 'md',
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  tone?: 'ink' | 'brown';
  size?: 'md' | 'sm';
}) {
  return (
    <fieldset className={styles.group}>
      <legend className="visually-hidden">{label}</legend>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          className={`${styles.chip} ${styles[tone]} ${styles[size]}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
