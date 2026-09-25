import { useTranslation } from 'react-i18next';
import { useCommands } from '../../layout/Commands';
import { SearchIcon } from '../../ui/icons';
import styles from './SearchBox.module.css';

/** Looks like a search field; opens the ⌘K palette, the one place search lives. */
export function SearchBox() {
  const { t } = useTranslation();
  const { openPalette } = useCommands();
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button type="button" className={styles.box} onClick={openPalette} aria-keyshortcuts="Meta+K Control+K">
      <SearchIcon />
      <span className={styles.placeholder}>{t('board.searchPlaceholder')}</span>
      <kbd className={styles.kbd}>{mac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}
