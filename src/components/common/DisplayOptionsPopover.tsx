import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconSlidersHorizontal } from '@/components/ui/icons';
import { usePanelPreferencesStore } from '@/stores';
import styles from './DisplayOptionsPopover.module.scss';

export interface DisplayOptionRow {
  key: string;
  label: string;
  /** Id of the control inside `control`, when it is a native input. */
  htmlFor?: string;
  control: ReactNode;
}

export interface DisplayOptionsPopoverProps {
  /** Page-specific rows, shown above the shared compact / hide-email toggles. */
  rows?: DisplayOptionRow[];
}

/**
 * The "display options" button and its popover. The compact view and email masking
 * are panel-wide preferences, so both pages bind the same two toggles to the store.
 */
export function DisplayOptionsPopover({ rows = [] }: DisplayOptionsPopoverProps) {
  const { t } = useTranslation();
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const display = usePanelPreferencesStore((state) => state.prefs.display);
  const syncState = usePanelPreferencesStore((state) => state.syncState);
  const update = usePanelPreferencesStore((state) => state.update);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const allRows: DisplayOptionRow[] = [
    ...rows,
    {
      key: 'compact',
      label: t('display_options.compact'),
      control: (
        <ToggleSwitch
          checked={display.compact}
          onChange={(compact) => update({ display: { compact } })}
          ariaLabel={t('display_options.compact')}
        />
      ),
    },
    {
      key: 'maskEmail',
      label: t('display_options.mask_email'),
      control: (
        <ToggleSwitch
          checked={display.maskEmail}
          onChange={(maskEmail) => update({ display: { maskEmail } })}
          ariaLabel={t('display_options.mask_email')}
        />
      ),
    },
  ];
  const scopeKey =
    syncState === 'synced' || syncState === 'syncing'
      ? 'scope_synced'
      : syncState === 'error'
        ? 'scope_error'
        : 'scope_local';

  return (
    <div className={styles.display} ref={rootRef}>
      <button
        type="button"
        className={`${styles.displayButton} ${open ? styles.displayButtonActive : ''}`}
        aria-expanded={open}
        aria-controls={popoverId}
        title={t('display_options.label')}
        onClick={() => setOpen((current) => !current)}
      >
        <IconSlidersHorizontal size={15} />
        <span>{t('display_options.label')}</span>
      </button>

      {open && (
        <div id={popoverId} className={styles.popover}>
          {allRows.map((row) => (
            <div key={row.key} className={styles.popoverRow}>
              {row.htmlFor ? (
                <label htmlFor={row.htmlFor}>{row.label}</label>
              ) : (
                <span>{row.label}</span>
              )}
              {row.control}
            </div>
          ))}
          <p className={styles.scope}>{t(`display_options.${scopeKey}`)}</p>
        </div>
      )}
    </div>
  );
}
