import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'ghost' | 'dark' | 'quiet' | 'light';
export type ButtonSize = 'lg' | 'md' | 'sm';

/** Class names for a button-looking element (also used on router links). */
export function buttonClass(variant: ButtonVariant = 'ghost', size: ButtonSize = 'md', extra?: string): string {
  return [styles.button, styles[variant], styles[size], extra].filter(Boolean).join(' ');
}

export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
