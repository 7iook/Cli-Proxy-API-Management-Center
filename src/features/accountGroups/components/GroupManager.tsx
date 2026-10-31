import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { IconChevronDown, IconChevronUp, IconPlus, IconTrash2 } from '@/components/ui/icons';
import type { AccountGroup } from '@/services/api/accountGroups';
import {
  DEFAULT_GROUP_COLOR,
  GROUP_PRESET_COLORS,
  MAX_ACCOUNT_GROUPS,
  MAX_GROUP_NAME_LENGTH,
  draftsFromGroups,
  draftsToGroups,
  moveDraft,
  validateGroupDrafts,
  type GroupDraft,
} from '../logic';
import styles from './GroupManager.module.scss';

export type GroupEditorProps = {
  drafts: GroupDraft[];
  onChange: (next: GroupDraft[]) => void;
  disabled?: boolean;
};

/** Editable ordered group list: name, colour, order, delete, add. Pure controlled view. */
export function GroupEditor({ drafts, onChange, disabled = false }: GroupEditorProps) {
  const { t } = useTranslation();
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const newKeyRef = useRef(0);
  const { errors, tooMany } = useMemo(() => validateGroupDrafts(drafts), [drafts]);

  const update = (key: string, patch: Partial<GroupDraft>) =>
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));

  const add = () => {
    newKeyRef.current += 1;
    onChange([
      ...drafts,
      {
        key: `new-${newKeyRef.current}`,
        id: '',
        name: '',
        color: GROUP_PRESET_COLORS[drafts.length % GROUP_PRESET_COLORS.length],
      },
    ]);
  };

  const remove = (draft: GroupDraft) => {
    // Saved groups need a confirmation: members are un-grouped, never deleted.
    if (draft.id && confirmingKey !== draft.key) {
      setConfirmingKey(draft.key);
      return;
    }
    setConfirmingKey(null);
    onChange(drafts.filter((item) => item.key !== draft.key));
  };

  return (
    <div className={styles.editor}>
      {drafts.length === 0 && <p className={styles.empty}>{t('account_groups.manager_empty')}</p>}
      <ul className={styles.list}>
        {drafts.map((draft, index) => {
          const error = errors[draft.key];
          const color = draft.color ?? DEFAULT_GROUP_COLOR;
          return (
            <li key={draft.key} className={styles.item}>
              <div className={styles.row}>
                <input
                  type="color"
                  className={styles.colorInput}
                  value={color.toLowerCase()}
                  disabled={disabled}
                  aria-label={t('account_groups.color_label')}
                  onChange={(event) =>
                    update(draft.key, { color: event.target.value.toUpperCase() })
                  }
                />
                <input
                  className={`input ${styles.nameInput}`}
                  value={draft.name}
                  maxLength={MAX_GROUP_NAME_LENGTH * 2}
                  disabled={disabled}
                  placeholder={t('account_groups.name_placeholder')}
                  aria-label={t('account_groups.name_label')}
                  aria-invalid={Boolean(error)}
                  onChange={(event) => update(draft.key, { name: event.target.value })}
                />
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={disabled || index === 0}
                    title={t('account_groups.move_up')}
                    aria-label={t('account_groups.move_up')}
                    onClick={() => onChange(moveDraft(drafts, index, -1))}
                  >
                    <IconChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={disabled || index === drafts.length - 1}
                    title={t('account_groups.move_down')}
                    aria-label={t('account_groups.move_down')}
                    onClick={() => onChange(moveDraft(drafts, index, 1))}
                  >
                    <IconChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${styles.danger}`}
                    disabled={disabled}
                    title={t('account_groups.delete')}
                    aria-label={t('account_groups.delete')}
                    onClick={() => remove(draft)}
                  >
                    <IconTrash2 size={14} />
                  </button>
                </div>
              </div>
              <div
                className={styles.presets}
                role="group"
                aria-label={t('account_groups.color_presets')}
              >
                {GROUP_PRESET_COLORS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`${styles.preset} ${
                      color.toUpperCase() === preset ? styles.presetActive : ''
                    }`}
                    style={{ backgroundColor: preset }}
                    disabled={disabled}
                    aria-label={preset}
                    aria-pressed={color.toUpperCase() === preset}
                    onClick={() => update(draft.key, { color: preset })}
                  />
                ))}
              </div>
              {error && (
                <p className={styles.error} role="alert">
                  {t(`account_groups.error_${error}`, { max: MAX_GROUP_NAME_LENGTH })}
                </p>
              )}
              {confirmingKey === draft.key && (
                <div className={styles.confirm} role="alert">
                  <span>{t('account_groups.delete_confirm')}</span>
                  <Button variant="danger" size="sm" onClick={() => remove(draft)}>
                    {t('common.confirm')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingKey(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {tooMany && (
        <p className={styles.error} role="alert">
          {t('account_groups.error_too_many', { max: MAX_ACCOUNT_GROUPS })}
        </p>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={add}
        disabled={disabled || drafts.length >= MAX_ACCOUNT_GROUPS}
      >
        <IconPlus size={14} />
        {t('account_groups.add')}
      </Button>
    </div>
  );
}

export type GroupManagerProps = {
  open: boolean;
  groups: AccountGroup[];
  onClose: () => void;
  /** Persists the ordered list; rejects on failure (the modal stays open). */
  onSave: (next: Array<{ id: string; name: string; color?: string }>) => Promise<void>;
};

export function GroupManager({ open, groups, onClose, onSave }: GroupManagerProps) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<GroupDraft[]>(() => draftsFromGroups(groups));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Start from the stored list every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setDrafts(draftsFromGroups(groups));
    setSaveError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { errors, tooMany } = useMemo(() => validateGroupDrafts(drafts), [drafts]);
  const invalid = Object.keys(errors).length > 0 || tooMany;

  const handleSave = async () => {
    if (invalid || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave(draftsToGroups(drafts));
      onClose();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : t('account_groups.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={saving}
      title={t('account_groups.manager_title')}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving} disabled={invalid}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className={styles.hint}>{t('account_groups.manager_hint')}</p>
      <GroupEditor drafts={drafts} onChange={setDrafts} disabled={saving} />
      {saveError && (
        <p className={styles.error} role="alert">
          {saveError}
        </p>
      )}
    </Modal>
  );
}
