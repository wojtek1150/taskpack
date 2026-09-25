import { type ReactNode, useEffect, useRef } from 'react';
import styles from './Dialog.module.css';

/** Native modal <dialog> (focus trap, Esc and backdrop handled by the browser). */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={() => undefined}
    >
      {open && (
        <div className={styles.body}>
          <h2 className={styles.title}>{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
