import { useState, type CSSProperties } from 'react';
import { getAuthFileRefreshKey } from '@/features/authFiles/manualRefresh';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Select } from '@/components/ui/Select';
import {
  IconChevronDown,
  IconChevronUp,
  IconChevronsDown,
  IconChevronsUp,
  IconDownload,
  IconInfo,
  IconModelCluster,
  IconRefreshCw,
  IconSettings,
  IconTrash2,
} from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import type { AuthFileItem } from '@/types';
import type { AccountGroup } from '@/services/api/accountGroups';
import { DEFAULT_GROUP_COLOR, getFileGroup } from '@/features/accountGroups/logic';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import { formatDateTimeValue, formatFileSize } from '@/utils/format';
import {
  formatModified,
  getAuthFileStatusMessage,
  hasAuthFileStatusWarning,
  getTypeColor,
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  supportsAuthFileManualRefresh,
  type AuthFileQuotaFilter,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { deriveAuthFileIdentity, maskAuthFileIdentity } from '@/features/authFiles/identity';
import { maskEmailsIn } from '@/utils/maskEmail';
import { resolveAuthFileQuotaType } from '@/features/authFiles/logic';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import { AuthFileQuotaSection } from '@/features/authFiles/components/AuthFileQuotaSection';
import { QuotaSummary } from '@/features/quota/components/QuotaSummary';
import { AuthFileCooldownSection } from './AuthFileCooldownSection';
import { getSiwcBindingStatus, supportsSiwcBinding } from '@/features/oauth/siwcBinding';
import { SiwcStatusBadge } from '@/features/oauth/components/SiwcStatusBadge';
import styles from './AuthFileCard.module.scss';

export type AuthFileMoveAction = 'top' | 'up' | 'down' | 'bottom';

export type AuthFileOrderControls = {
  isFirst: boolean;
  isLast: boolean;
  onMove: (file: AuthFileItem, action: AuthFileMoveAction) => void;
};

export type AuthFileCardProps = {
  file: AuthFileItem;
  compact: boolean;
  /** Display-only: masks the credential's email in text and tooltips. */
  maskEmail: boolean;
  selected: boolean;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  cooldownResetting: Record<string, boolean>;
  quotaFilterType: AuthFileQuotaFilter;
  statusBarCache: Map<string, AuthFileStatusBarData>;
  /** One-time entrance delay; null/undefined disables entrance motion. */
  entranceDelayMs?: number | null;
  onShowModels: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onManualRefresh: (file: AuthFileItem) => void;
  onCooldownReset: (file: AuthFileItem) => void;
  onOpenPrefixProxyEditor: (file: AuthFileItem) => void;
  onDelete: (name: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleSelect: (name: string) => void;
  /** Present only when the backend supports account groups. */
  groups?: AccountGroup[];
  onAssignGroup?: (file: AuthFileItem, groupId: string) => void;
  /** Present only in custom sort mode. */
  orderControls?: AuthFileOrderControls;
};

export function AuthFileCard(props: AuthFileCardProps) {
  const { t, i18n } = useTranslation();
  const {
    file,
    compact,
    maskEmail: shouldMaskEmail,
    selected,
    resolvedTheme,
    disableControls,
    deleting,
    statusUpdating,
    manualRefreshing,
    cooldownResetting,
    quotaFilterType,
    statusBarCache,
    entranceDelayMs,
    onShowModels,
    onDownload,
    onManualRefresh,
    onCooldownReset,
    onOpenPrefixProxyEditor,
    onDelete,
    onToggleStatus,
    onToggleSelect,
    groups,
    onAssignGroup,
    orderControls,
  } = props;

  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const providerKey = normalizeProviderKey(String(file.type ?? file.provider ?? 'unknown'));
  const isAistudio = providerKey === 'aistudio';
  const showModelsButton = !isRuntimeOnly || isAistudio;
  const showManualRefreshButton = !isRuntimeOnly && supportsAuthFileManualRefresh(providerKey);
  const isManualRefreshing = manualRefreshing[getAuthFileRefreshKey(file)] === true;
  const typeLabel = getTypeLabel(t, providerKey);
  const typeColor = getTypeColor(providerKey, resolvedTheme);

  const quotaType = resolveAuthFileQuotaType(file, quotaFilterType);
  const showQuotaLayout = Boolean(quotaType) && !isRuntimeOnly;

  const successCount = file.successCount ?? 0;
  const failureCount = file.failureCount ?? 0;
  const authIndexKey = typeof file.authIndex === 'string' ? file.authIndex : null;
  const isCooldownResetting = Boolean(authIndexKey && cooldownResetting[authIndexKey]);
  const statusData =
    (authIndexKey && statusBarCache.get(authIndexKey)) ||
    statusBarDataFromRecentRequests(file.recentRequests ?? []);

  const rawStatusMessage = getAuthFileStatusMessage(file);
  const hasStatusWarning = hasAuthFileStatusWarning(file);

  const priorityValue = Number.isSafeInteger(file.priority) ? file.priority : undefined;
  const weightValue = Number.isSafeInteger(file.weight) ? file.weight : undefined;
  const noteValue = typeof file.note === 'string' ? file.note.trim() : '';
  // Lead with account identity and use the file name as secondary text.
  const derivedIdentity = deriveAuthFileIdentity(file);
  const identity = shouldMaskEmail ? maskAuthFileIdentity(derivedIdentity, file) : derivedIdentity;
  const shownName = shouldMaskEmail ? maskEmailsIn(file.name, [file.email]) : file.name;
  const siwcExpires = file.siwcExpiresAt
    ? formatDateTimeValue(file.siwcExpiresAt, i18n.language)
    : '';

  const group = groups ? getFileGroup(file, groups) : null;
  const groupColor = group ? (group.color ?? DEFAULT_GROUP_COLOR) : undefined;
  // Runtime-only / config / plugin-virtual files cannot carry display metadata.
  const showOrganize =
    !isRuntimeOnly && (Boolean(groups && onAssignGroup) || Boolean(orderControls));
  const groupOptions = groups
    ? [
        { value: '', label: t('account_groups.card_ungrouped') },
        ...groups.map((item) => ({ value: item.id, label: item.name })),
      ]
    : [];

  // Capture the entrance delay once so subsequent updates do not interrupt it.
  const [mountEntranceDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const cardClasses = [
    styles.card,
    compact ? styles.cardCompact : '',
    selected ? styles.cardSelected : '',
    group ? styles.cardGrouped : '',
    file.disabled === true ? styles.cardDisabled : '',
    mountEntranceDelayMs != null ? styles.cardEnter : '',
  ]
    .filter(Boolean)
    .join(' ');
  const cardStyle =
    mountEntranceDelayMs != null || groupColor
      ? ({
          ...(mountEntranceDelayMs != null ? { '--card-delay': `${mountEntranceDelayMs}ms` } : {}),
          ...(groupColor ? { '--group-color': groupColor } : {}),
        } as CSSProperties)
      : undefined;

  return (
    <article className={cardClasses} style={cardStyle}>
      <header className={styles.head}>
        {!isRuntimeOnly && (
          <SelectionCheckbox
            checked={selected}
            onChange={() => onToggleSelect(file.name)}
            className={styles.selection}
            ariaLabel={t('auth_files.card_select', { name: file.name })}
            title={t('auth_files.card_select', { name: shownName })}
          />
        )}
        <h3 className={styles.identity}>
          <span
            className={styles.providerBadge}
            style={{
              backgroundColor: typeColor.bg,
              color: typeColor.text,
              ...(typeColor.border ? { border: typeColor.border } : {}),
            }}
          >
            {typeLabel}
          </span>
          <span
            className={`${styles.account} ${identity.kind === 'fileName' ? styles.accountMono : ''}`}
            title={identity.primary}
          >
            {identity.primary}
          </span>
        </h3>
        {isRuntimeOnly && (
          <span className={styles.runtimeLabel}>{t('auth_files.type_virtual')}</span>
        )}
      </header>

      {identity.secondary && (
        <p className={styles.fileName} title={identity.fullName}>
          {identity.secondary}
        </p>
      )}

      {group && (
        <p className={styles.groupBadge} title={group.name}>
          <span className={styles.groupDot} aria-hidden="true" />
          <span className={styles.groupName}>{group.name}</span>
        </p>
      )}

      {!compact && noteValue && (
        <p className={styles.note} title={noteValue}>
          {noteValue}
        </p>
      )}

      {rawStatusMessage && hasStatusWarning && (
        <div className={styles.warning} title={rawStatusMessage}>
          <IconInfo className={styles.warningIcon} size={14} />
          <span>{rawStatusMessage}</span>
        </div>
      )}

      <AuthFileCooldownSection
        snapshot={file.cooldownSnapshot}
        resetting={isCooldownResetting}
        resetDisabled={
          disableControls ||
          statusUpdating[getAuthFileRefreshKey(file)] === true ||
          isManualRefreshing
        }
        onReset={authIndexKey ? () => onCooldownReset(file) : undefined}
      />

      {!compact && (
        <>
          <div className={styles.health}>
            <div className={styles.healthHead}>
              <span className={styles.healthLabel}>{t('auth_files.card_requests')}</span>
              <span className={styles.healthCounts}>
                <span
                  className={`${styles.countOk} ${successCount > 0 ? styles.countLive : ''}`}
                  title={t('stats.success')}
                >
                  {t('stats.success')} {successCount}
                </span>
                <span
                  className={`${styles.countFail} ${failureCount > 0 ? styles.countLive : ''}`}
                  title={t('stats.failure')}
                >
                  {t('stats.failure')} {failureCount}
                </span>
              </span>
            </div>
            <ProviderStatusBar statusData={statusData} styles={styles} />
          </div>

          <div className={styles.metaRow}>
            <span title={t('auth_files.file_size')}>
              {file.size ? formatFileSize(file.size) : '-'}
            </span>
            <span className={styles.metaDivider} aria-hidden="true">
              ·
            </span>
            <span title={t('auth_files.file_modified')}>{formatModified(file)}</span>
            {priorityValue !== undefined && (
              <>
                <span className={styles.metaDivider} aria-hidden="true">
                  ·
                </span>
                <span className={styles.metaPriority} title={t('auth_files.priority_hint')}>
                  <span className={styles.metaMetricLabel}>{t('auth_files.priority_display')}</span>
                  <span>{priorityValue}</span>
                </span>
              </>
            )}
            {weightValue !== undefined && (
              <>
                <span className={styles.metaDivider} aria-hidden="true">
                  ·
                </span>
                <span className={styles.metaWeight} title={t('auth_files.weight_tooltip')}>
                  <span className={styles.metaMetricLabel}>{t('auth_files.weight_display')}</span>
                  <span>{weightValue}</span>
                </span>
              </>
            )}
          </div>
        </>
      )}

      {supportsSiwcBinding(file) && (
        <div className={styles.siwcRow}>
          <SiwcStatusBadge status={getSiwcBindingStatus(file)} />
          {siwcExpires && (
            <span className={styles.siwcExpires} title={file.siwcExpiresAt}>
              {t('siwc.expires', { date: siwcExpires })}
            </span>
          )}
        </div>
      )}

      {showQuotaLayout && quotaType && compact && (
        <QuotaSummary file={file} type={quotaType} disableControls={disableControls} />
      )}
      {showQuotaLayout && quotaType && !compact && (
        <AuthFileQuotaSection file={file} quotaType={quotaType} disableControls={disableControls} />
      )}

      {showOrganize && (
        <div className={styles.organize}>
          {groups && onAssignGroup && (
            <div className={styles.groupSelect}>
              <Select
                value={file.ui?.group && group ? group.id : ''}
                options={groupOptions}
                onChange={(value) => onAssignGroup(file, value)}
                ariaLabel={t('account_groups.card_group_label', { name: file.name })}
                disabled={disableControls}
                size="sm"
                fullWidth
              />
            </div>
          )}
          {orderControls && (
            <div
              className={styles.orderActions}
              role="group"
              aria-label={t('auth_files.order_label')}
            >
              {(
                [
                  ['top', IconChevronsUp, orderControls.isFirst],
                  ['up', IconChevronUp, orderControls.isFirst],
                  ['down', IconChevronDown, orderControls.isLast],
                  ['bottom', IconChevronsDown, orderControls.isLast],
                ] as const
              ).map(([action, Icon, atEdge]) => (
                <Button
                  key={action}
                  variant="ghost"
                  size="sm"
                  className={styles.orderButton}
                  title={t(`auth_files.order_${action}`)}
                  aria-label={t(`auth_files.order_${action}`)}
                  disabled={disableControls || atEdge}
                  onClick={() => orderControls.onMove(file, action)}
                >
                  <Icon size={14} />
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <footer className={styles.actions}>
        <div className={styles.actionsMain}>
          {showModelsButton && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onShowModels(file)}
              title={t('auth_files.models_button')}
              disabled={disableControls}
            >
              <IconModelCluster size={14} />
              {t('auth_files.models_button')}
            </Button>
          )}
          {!isRuntimeOnly && (
            <div className={styles.utilityActions}>
              {showManualRefreshButton && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onManualRefresh(file)}
                  className={styles.iconButton}
                  title={t('auth_files.manual_refresh_button')}
                  disabled={
                    disableControls ||
                    file.disabled ||
                    statusUpdating[getAuthFileRefreshKey(file)] === true ||
                    isManualRefreshing
                  }
                >
                  {isManualRefreshing ? <LoadingSpinner size={14} /> : <IconRefreshCw size={15} />}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onDownload(file.name)}
                className={styles.iconButton}
                title={t('auth_files.download_button')}
                disabled={disableControls}
              >
                <IconDownload size={15} />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenPrefixProxyEditor(file)}
                className={styles.iconButton}
                title={t('auth_files.prefix_proxy_button')}
                disabled={disableControls || isManualRefreshing}
              >
                <IconSettings size={15} />
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => onDelete(file.name)}
                className={styles.iconButton}
                title={t('auth_files.delete_button')}
                disabled={disableControls || deleting === file.name || isManualRefreshing}
              >
                {deleting === file.name ? <LoadingSpinner size={14} /> : <IconTrash2 size={15} />}
              </Button>
            </div>
          )}
        </div>
        {!isRuntimeOnly && (
          <div className={styles.toggleWrap}>
            <span className={styles.toggleLabel}>{t('auth_files.status_toggle_label')}</span>
            <ToggleSwitch
              ariaLabel={t('auth_files.card_toggle', { name: file.name })}
              checked={!file.disabled}
              disabled={
                disableControls ||
                statusUpdating[getAuthFileRefreshKey(file)] === true ||
                isManualRefreshing
              }
              onChange={(value) => onToggleStatus(file, value)}
            />
          </div>
        )}
      </footer>
    </article>
  );
}
