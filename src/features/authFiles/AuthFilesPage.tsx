import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useRevealOnScroll } from '@/hooks/motion';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useSortFieldOptions } from '@/components/common/useSortFieldOptions';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { copyToClipboard } from '@/utils/clipboard';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { GroupChipRow } from '@/features/accountGroups/components/GroupChipRow';
import { GroupManager } from '@/features/accountGroups/components/GroupManager';
import {
  GROUP_FILTER_ALL,
  countFilesByGroup,
  filterFilesByGroup,
  normalizeGroupFilter,
  removedGroupIds,
} from '@/features/accountGroups/logic';
import {
  planMove,
  planMoveToBottom,
  planMoveToTop,
  type OrderedItem,
} from '@/features/authFiles/customOrder';
import { getQuotaRankPlan } from '@/features/quota/constants';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { useQuotaSortNow } from '@/features/quota/hooks/useQuotaSortNow';
import type { AuthFileItem } from '@/types';
import type { QuotaProviderType as QuotaCardProviderType } from '@/features/quota/providers/types';
import type { QuotaCardState } from '@/features/quota/providers';
import {
  QUOTA_PROVIDER_TYPES,
  clampCardPageSize,
  getTypeLabel,
  isProblemAuthFile,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  type AuthFileQuotaFilter,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import {
  AuthFileCard,
  type AuthFileMoveAction,
} from '@/features/authFiles/components/AuthFileCard';
import { AuthFileDetailsSheet } from '@/features/authFiles/components/AuthFileDetailsSheet';
import { getAuthFileRefreshKey } from '@/features/authFiles/manualRefresh';
import { AuthFileRefreshResults } from '@/features/authFiles/components/AuthFileRefreshResults';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { AuthFilesToolbar } from '@/features/authFiles/components/AuthFilesToolbar';
import { BatchActionBar } from '@/features/authFiles/components/BatchActionBar';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';
import { VaultHeader } from '@/features/authFiles/components/VaultHeader';
import { VaultPulse } from '@/features/authFiles/components/VaultPulse';
import { invalidateAuthFileDerivedCaches } from '@/features/authFiles/cacheInvalidation';
import {
  buildWildcardSearch,
  collectMissingQuotaEntries,
  createAuthFileQuotaRankResolver,
  matchesAuthFileSearch,
  sortAuthFiles,
} from '@/features/authFiles/logic';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import {
  AUTH_FILES_SORT_FIELDS,
  type AuthFilesSort,
  type AuthFilesStatusFilterMode,
} from '@/features/preferences/schema';
import {
  useAccountGroupsStore,
  useAuthStore,
  useNotificationStore,
  usePanelPreferencesStore,
  useQuotaStore,
  useThemeStore,
} from '@/stores';
import styles from './AuthFilesPage.module.scss';

const SKELETON_CARD_COUNT = 6;
/** 首屏卡片级联入场总预算，与 useRevealGroup 同一 360ms 语汇。 */
const CARD_ENTRANCE_BUDGET_MS = 360;

const DEFAULT_SORT: AuthFilesSort = { field: 'default', direction: 'asc' };
const CUSTOM_SORT: AuthFilesSort = { field: 'custom', direction: 'asc' };

export function AuthFilesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const navigate = useNavigate();

  const authPrefs = usePanelPreferencesStore((state) => state.prefs.authFiles);
  const compactMode = usePanelPreferencesStore((state) => state.prefs.display.compact);
  const maskEmail = usePanelPreferencesStore((state) => state.prefs.display.maskEmail);
  const updatePrefs = usePanelPreferencesStore((state) => state.update);
  const filter = authPrefs.providerFilter;
  const statusFilterMode = authPrefs.statusFilter;
  const sort = authPrefs.sort;
  const groupFilter = authPrefs.groupFilter;
  const pageSize = compactMode ? authPrefs.compactPageSize : authPrefs.regularPageSize;
  const setFilter = useCallback(
    (providerFilter: string) => updatePrefs({ authFiles: { providerFilter } }),
    [updatePrefs]
  );
  const setStatusFilterMode = useCallback(
    (statusFilter: AuthFilesStatusFilterMode) => updatePrefs({ authFiles: { statusFilter } }),
    [updatePrefs]
  );
  const setGroupFilter = useCallback(
    (nextGroupFilter: string) => updatePrefs({ authFiles: { groupFilter: nextGroupFilter } }),
    [updatePrefs]
  );
  const setSort = useCallback(
    (nextSort: AuthFilesSort) => updatePrefs({ authFiles: { sort: nextSort } }),
    [updatePrefs]
  );

  // Search text and page number are per-visit state; they are never persisted or synced.
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeInput, setPageSizeInput] = useState(String(pageSize));
  const [viewMode, setViewMode] = useState<'diagram' | 'list'>('list');
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);

  const groups = useAccountGroupsStore((state) => state.groups);
  const groupsSupported = useAccountGroupsStore((state) => state.supported);
  const loadGroups = useAccountGroupsStore((state) => state.load);
  const saveGroups = useAccountGroupsStore((state) => state.save);
  const groupsEnabled = groupsSupported === true;
  // Only an explicit 404 hides custom ordering; unknown keeps the persisted choice.
  const customOrderEnabled = groupsSupported !== false;

  const {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
    invalidateModels,
  } = useAuthFilesModels();

  const invalidateDerivedCaches = useCallback(
    (names?: string[]) => invalidateAuthFileDerivedCaches(invalidateModels, names),
    [invalidateModels]
  );

  const {
    files,
    selectedFiles,
    selectionCount,
    loading,
    refreshing,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    manualRefreshing,
    refreshingAllCredentials,
    refreshResults,
    closeRefreshResults,
    handleRefreshAllCredentials,
    cooldownResetting,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleManualRefresh,
    handleCooldownReset,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
    batchAssignGroup,
    applyOrderWrites,
    clearGroupsLocally,
  } = useAuthFilesData({ onFilesMutated: invalidateDerivedCaches });

  const statusBarCache = useAuthFilesStatusBarCache(files);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode, files });

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls: connectionStatus !== 'connected' || refreshingAllCredentials,
    loadFiles,
    onFilesMutated: invalidateDerivedCaches,
  });

  const disableControls = connectionStatus !== 'connected' || refreshingAllCredentials;
  const normalizedFilter = normalizeProviderKey(String(filter));
  const quotaFilterType: QuotaProviderType | null = QUOTA_PROVIDER_TYPES.has(
    normalizedFilter as QuotaProviderType
  )
    ? (normalizedFilter as QuotaProviderType)
    : null;
  const activeQuotaFilter: AuthFileQuotaFilter =
    normalizedFilter === 'all' ? 'all' : (quotaFilterType ?? normalizedFilter) || null;
  const problemOnly = statusFilterMode === 'problem';
  const disabledOnly = statusFilterMode === 'disabled';
  const enabledOnly = statusFilterMode === 'enabled';

  useEffect(() => {
    setPageSizeInput(String(pageSize));
  }, [pageSize]);

  const setCurrentModePageSize = useCallback(
    (next: number) => {
      updatePrefs({
        authFiles: compactMode ? { compactPageSize: next } : { regularPageSize: next },
      });
    },
    [compactMode, updatePrefs]
  );

  const commitPageSizeInput = useCallback(
    (rawValue: string) => {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        setPageSizeInput(String(pageSize));
        return;
      }

      const value = Number(trimmed);
      if (!Number.isFinite(value)) {
        setPageSizeInput(String(pageSize));
        return;
      }

      const next = clampCardPageSize(value);
      setCurrentModePageSize(next);
      setPageSizeInput(String(next));
      setPage(1);
    },
    [pageSize, setCurrentModePageSize]
  );

  const handlePageSizeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const rawValue = event.currentTarget.value;
      setPageSizeInput(rawValue);

      const trimmed = rawValue.trim();
      if (!trimmed) return;

      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) return;

      const rounded = Math.round(parsed);
      // 超出 [MIN, MAX] 时不提交（clamp 后不等于原值即越界）
      if (clampCardPageSize(rounded) !== rounded) return;

      setCurrentModePageSize(rounded);
      setPage(1);
    },
    [setCurrentModePageSize]
  );

  const handleSortChange = useCallback(
    (next: AuthFilesSort) => {
      setSort(next);
      setPage(1);
    },
    [setSort]
  );

  const handleStatusFilterModeChange = useCallback(
    (nextMode: AuthFilesStatusFilterMode) => {
      setStatusFilterMode(nextMode);
      setPage(1);
    },
    [setStatusFilterMode]
  );

  /* ---------- 数据加载：首载前台（骨架屏），此后一律后台（不清空网格） ---------- */

  const initialLoadDoneRef = useRef(false);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([
      loadFiles({ background: true }),
      loadExcluded(),
      loadModelAlias(),
      loadGroups(),
    ]);
  }, [loadFiles, loadExcluded, loadModelAlias, loadGroups]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (!isCurrentLayer) return;
    void loadFiles(initialLoadDoneRef.current ? { background: true } : undefined);
    initialLoadDoneRef.current = true;
    loadExcluded();
    loadModelAlias();
    void loadGroups();
  }, [isCurrentLayer, loadFiles, loadExcluded, loadModelAlias, loadGroups]);

  // A persisted group filter that no longer exists falls back to "all".
  useEffect(() => {
    if (!groupsEnabled) return;
    const normalized = normalizeGroupFilter(groupFilter, groups);
    if (normalized !== groupFilter) setGroupFilter(normalized);
  }, [groupFilter, groups, groupsEnabled, setGroupFilter]);

  const activeGroupFilter = groupsEnabled
    ? normalizeGroupFilter(groupFilter, groups)
    : GROUP_FILTER_ALL;

  useInterval(
    () => {
      void loadFiles({ background: true }).catch(() => {});
    },
    isCurrentLayer ? 240_000 : null
  );

  /* ---------- 过滤 / 排序 / 分页 memos ---------- */

  const existingTypes = useMemo(() => {
    const types = new Set<string>(['all']);
    files.forEach((file) => {
      const type = normalizeProviderKey(String(file.type ?? file.provider ?? ''));
      if (type) types.add(type);
    });
    return Array.from(types);
  }, [files]);

  const filesMatchingStatusFilters = useMemo(
    () =>
      files.filter((file) => {
        if (enabledOnly && file.disabled === true) return false;
        if (disabledOnly && file.disabled !== true) return false;
        if (problemOnly && !isProblemAuthFile(file)) return false;
        return true;
      }),
    [disabledOnly, enabledOnly, files, problemOnly]
  );

  const statusFilterOptions = useMemo(
    () =>
      [
        { value: 'all', label: t('auth_files.problem_filter_all') },
        { value: 'enabled', label: t('auth_files.problem_filter_enabled') },
        { value: 'disabled', label: t('auth_files.problem_filter_disabled') },
        { value: 'problem', label: t('auth_files.problem_filter_problem') },
      ] satisfies Array<{ value: AuthFilesStatusFilterMode; label: string }>,
    [t]
  );

  const sortFieldList = useMemo(
    () => AUTH_FILES_SORT_FIELDS.filter((field) => field !== 'custom' || customOrderEnabled),
    [customOrderEnabled]
  );
  const sortFields = useSortFieldOptions(sortFieldList);
  const effectiveSort: AuthFilesSort =
    sort.field === 'custom' && !customOrderEnabled ? DEFAULT_SORT : sort;

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: filesMatchingStatusFilters.length };
    filesMatchingStatusFilters.forEach((file) => {
      const type = normalizeProviderKey(String(file.type ?? file.provider ?? ''));
      if (!type) return;
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [filesMatchingStatusFilters]);

  const groupCounts = useMemo(
    () => countFilesByGroup(filesMatchingStatusFilters, groups),
    [filesMatchingStatusFilters, groups]
  );
  const groupNameById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups]
  );

  const normalizedSearch = search.trim();
  const wildcardSearch = useMemo(() => buildWildcardSearch(normalizedSearch), [normalizedSearch]);

  const filtered = useMemo(
    () =>
      filterFilesByGroup(filesMatchingStatusFilters, activeGroupFilter, groups).filter((item) => {
        const type = normalizeProviderKey(String(item.type ?? item.provider ?? ''));
        const matchType = normalizedFilter === 'all' || type === normalizedFilter;
        const groupName = groupsEnabled ? groupNameById.get(item.ui?.group ?? '') : undefined;
        return (
          matchType && matchesAuthFileSearch(item, normalizedSearch, wildcardSearch, groupName)
        );
      }),
    [
      activeGroupFilter,
      filesMatchingStatusFilters,
      groupNameById,
      groups,
      groupsEnabled,
      normalizedFilter,
      normalizedSearch,
      wildcardSearch,
    ]
  );

  /* ---------- 额度排序：键只在数据变化时重算，不随时钟走动 ---------- */

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const metaQuota = useQuotaStore((state) => state.metaQuota);
  const pluginQuota = useQuotaStore((state) => state.pluginQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);
  const quotaSortActive = getQuotaRankPlan(effectiveSort.field) !== null;
  const quotaByType = useMemo(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        devin: devinQuota,
        kimi: kimiQuota,
        meta: metaQuota,
        plugin: pluginQuota,
        xai: xaiQuota,
      }) as unknown as Record<QuotaCardProviderType, Record<string, QuotaCardState>>,
    [
      antigravityQuota,
      claudeQuota,
      codexQuota,
      devinQuota,
      kimiQuota,
      metaQuota,
      pluginQuota,
      xaiQuota,
    ]
  );
  // Re-read only when quota data changes, so a ticking clock never reorders cards.
  const quotaSortNowMs = useQuotaSortNow(quotaSortActive, quotaByType);
  const quotaRankResolver = useMemo(
    () => createAuthFileQuotaRankResolver((type, key) => quotaByType[type]?.[key], quotaSortNowMs),
    [quotaByType, quotaSortNowMs]
  );

  const sorted = useMemo(
    () => sortAuthFiles(filtered, effectiveSort, quotaRankResolver),
    [effectiveSort, filtered, quotaRankResolver]
  );

  const missingQuotaEntries = useMemo(
    () => collectMissingQuotaEntries(filtered, effectiveSort, quotaRankResolver),
    [effectiveSort, filtered, quotaRankResolver]
  );
  const { batchLoading: quotaBatchLoading, loadQuota } = useQuotaBatchLoader();

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = useMemo(() => sorted.slice(start, start + pageSize), [pageSize, sorted, start]);
  const selectablePageItems = useMemo(
    () => pageItems.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [pageItems]
  );
  const selectableFilteredItems = useMemo(
    () => sorted.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [sorted]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const selectedHasStatusUpdating = useMemo(
    () =>
      files.some(
        (file) =>
          selectedFiles.has(file.name) && statusUpdating[getAuthFileRefreshKey(file)] === true
      ),
    [files, selectedFiles, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  /* ---------- 分组 / 自定义顺序 ---------- */

  const toOrdered = (file: AuthFileItem): OrderedItem => ({
    name: file.name,
    order: file.ui?.order,
  });

  // Visible, writable files in display order; up/down move relative to these neighbours.
  const movableSorted = useMemo(
    () => sorted.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [sorted]
  );
  const movableIndexByName = useMemo(
    () => new Map(movableSorted.map((file, index) => [file.name, index])),
    [movableSorted]
  );

  const handleMoveFile = useCallback(
    (file: AuthFileItem, action: AuthFileMoveAction) => {
      let writes;
      if (action === 'up' || action === 'down') {
        const index = movableIndexByName.get(file.name);
        if (index === undefined) return;
        writes = planMove(movableSorted.map(toOrdered), index, index + (action === 'up' ? -1 : 1));
      } else {
        // Top/bottom are global: rank against every writable file, not just the visible ones.
        const all = sortAuthFiles(
          files.filter((item) => !isRuntimeOnlyAuthFile(item)),
          CUSTOM_SORT
        ).map(toOrdered);
        writes =
          action === 'top' ? planMoveToTop(all, [file.name]) : planMoveToBottom(all, [file.name]);
      }
      void applyOrderWrites(writes);
    },
    [applyOrderWrites, files, movableIndexByName, movableSorted]
  );

  const handleBatchMoveToTop = useCallback(async () => {
    if (selectedNames.length === 0) return;
    const all = sortAuthFiles(
      files.filter((item) => !isRuntimeOnlyAuthFile(item)),
      CUSTOM_SORT
    ).map(toOrdered);
    const writes = planMoveToTop(all, selectedNames);
    if (sort.field !== 'custom') {
      setSort(CUSTOM_SORT);
      setPage(1);
      showNotification(t('auth_files.order_switched_custom'), 'info');
    }
    const ok = await applyOrderWrites(writes);
    if (ok) deselectAll();
  }, [
    applyOrderWrites,
    deselectAll,
    files,
    selectedNames,
    setSort,
    showNotification,
    sort.field,
    t,
  ]);

  const handleAssignGroup = useCallback(
    (file: AuthFileItem, groupId: string) => {
      if ((file.ui?.group ?? '') === groupId) return;
      void batchAssignGroup([file.name], groupId);
    },
    [batchAssignGroup]
  );

  const handleSaveGroups = useCallback(
    async (next: Array<{ id: string; name: string; color?: string }>) => {
      const before = groups;
      const saved = await saveGroups(next);
      clearGroupsLocally(removedGroupIds(before, saved));
      showNotification(t('account_groups.save_success'), 'success');
    },
    [clearGroupsLocally, groups, saveGroups, showNotification, t]
  );

  const handleGroupFilterChange = useCallback(
    (value: string) => {
      setGroupFilter(value);
      setPage(1);
    },
    [setGroupFilter]
  );

  /* ---------- 头部遥测计数 ---------- */

  const activeCount = useMemo(() => files.filter((file) => file.disabled !== true).length, [files]);
  const problemCount = useMemo(() => files.filter(isProblemAuthFile).length, [files]);

  /* ---------- 首屏卡片一次性级联入场 ----------
   * 首批数据渲染后立即翻转 cardsAnimated；已挂载的卡片在挂载时捕获过
   * 自己的延迟（AuthFileCard 内 useState 初始化），不受后续 null 影响，
   * 而过滤/翻页/轮询新挂载的卡片拿到 null——不重播。 */

  const [cardsAnimated, setCardsAnimated] = useState(false);
  const enableCardEntrance = !cardsAnimated && isCurrentLayer && !loading && pageItems.length > 0;
  useEffect(() => {
    if (enableCardEntrance) {
      setCardsAnimated(true);
    }
  }, [enableCardEntrance]);
  const cardEntranceDelay = (index: number): number | null => {
    if (!enableCardEntrance) return null;
    if (pageItems.length <= 1) return 0;
    return Math.round((index / (pageItems.length - 1)) * CARD_ENTRANCE_BUDGET_MS);
  };

  /* ---------- 杂项 ---------- */

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const openExcludedEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-excluded${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const openModelAliasEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-model-alias${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const clearFilters = useCallback(() => {
    updatePrefs({
      authFiles: { providerFilter: 'all', groupFilter: GROUP_FILTER_ALL, statusFilter: 'all' },
    });
    setSearch('');
    setPage(1);
  }, [updatePrefs]);

  const deleteAllButtonLabel = (() => {
    if (enabledOnly || disabledOnly) {
      return t('auth_files.delete_filtered_result_button');
    }
    if (problemOnly) {
      return normalizedFilter === 'all'
        ? t('auth_files.delete_problem_button')
        : t('auth_files.delete_problem_button_with_type', {
            type: getTypeLabel(t, normalizedFilter),
          });
    }
    return normalizedFilter === 'all'
      ? t('auth_files.delete_all_button')
      : `${t('common.delete')} ${getTypeLabel(t, normalizedFilter)}`;
  })();

  const oauthSectionRef = useRevealOnScroll<HTMLDivElement>();

  const isFirstRunEmpty = !loading && files.length === 0 && !error;
  const isNoResults = !loading && files.length > 0 && pageItems.length === 0;

  const gridClasses = [
    styles.grid,
    compactMode ? styles.gridCompact : '',
    activeQuotaFilter ? styles.gridQuota : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.page}>
      <VaultHeader
        totalCount={files.length}
        activeCount={activeCount}
        problemCount={problemCount}
        loading={loading}
        refreshing={refreshing}
        uploading={uploading}
        disableControls={disableControls}
        onUpload={handleUploadClick}
        onRefresh={() => void handleHeaderRefresh()}
        refreshingCredentials={refreshingAllCredentials}
        credentialRefreshDisabled={Object.keys(manualRefreshing).length > 0}
        onRefreshCredentials={handleRefreshAllCredentials}
      />
      <AuthFileRefreshResults results={refreshResults} onClose={closeRefreshResults} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <VaultPulse files={files} statusBarCache={statusBarCache} />

      <section className={styles.workbench} aria-label={t('auth_files.title_section')}>
        <ProviderTabs
          types={existingTypes}
          counts={typeCounts}
          active={normalizedFilter}
          resolvedTheme={resolvedTheme}
          onChange={(type) => {
            setFilter(type);
            setPage(1);
          }}
        />

        {groupsEnabled && (
          <GroupChipRow
            groups={groups}
            counts={groupCounts}
            active={activeGroupFilter}
            disabled={disableControls}
            onChange={handleGroupFilterChange}
            onManage={() => setGroupManagerOpen(true)}
          />
        )}

        <AuthFilesToolbar
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          statusFilterMode={statusFilterMode}
          statusFilterOptions={statusFilterOptions}
          onStatusFilterChange={handleStatusFilterModeChange}
          sort={effectiveSort}
          sortFields={sortFields}
          onSortChange={handleSortChange}
          pageSizeInput={pageSizeInput}
          onPageSizeInputChange={handlePageSizeChange}
          onPageSizeCommit={commitPageSizeInput}
          deleteLabel={deleteAllButtonLabel}
          deleteDisabled={
            disableControls ||
            loading ||
            deletingAll ||
            files.length === 0 ||
            activeGroupFilter !== GROUP_FILTER_ALL
          }
          deleteTitle={
            activeGroupFilter !== GROUP_FILTER_ALL
              ? t('auth_files.delete_disabled_group_filter')
              : undefined
          }
          deleteLoading={deletingAll}
          onDelete={() =>
            handleDeleteAll({
              filter,
              problemOnly,
              disabledOnly,
              enabledOnly,
              onResetFilterToAll: () => setFilter('all'),
              onResetProblemOnly: () => setStatusFilterMode('all'),
              onResetDisabledOnly: () => setStatusFilterMode('all'),
              onResetEnabledOnly: () => setStatusFilterMode('all'),
            })
          }
        />

        {quotaSortActive && missingQuotaEntries.length > 0 && (
          <div className={styles.quotaHint} role="status">
            <span>{t('auth_files.quota_sort_missing', { count: missingQuotaEntries.length })}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadQuota(missingQuotaEntries)}
              loading={quotaBatchLoading}
              disabled={disableControls}
            >
              {t('auth_files.quota_sort_load')}
            </Button>
          </div>
        )}

        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className={gridClasses} aria-hidden="true">
            {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
              <Skeleton key={index} height={206} rounded={14} />
            ))}
          </div>
        ) : isFirstRunEmpty ? (
          <EmptyState
            title={t('auth_files.empty_title')}
            description={t('auth_files.empty_desc')}
            action={
              <div className={styles.emptyActions}>
                <Button
                  size="sm"
                  onClick={handleUploadClick}
                  disabled={disableControls || uploading}
                >
                  {t('auth_files.upload_button')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate('/oauth')}>
                  {t('auth_files.empty_oauth_link')}
                </Button>
              </div>
            }
          />
        ) : isNoResults ? (
          <EmptyState
            title={t('auth_files.search_empty_title')}
            description={t('auth_files.search_empty_desc')}
            action={
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                {t('auth_files.no_results_clear')}
              </Button>
            }
          />
        ) : (
          <div className={gridClasses}>
            {pageItems.map((file, index) => (
              <AuthFileCard
                key={getQuotaCacheKey(file)}
                file={file}
                compact={compactMode}
                maskEmail={maskEmail}
                selected={selectedFiles.has(file.name)}
                resolvedTheme={resolvedTheme}
                disableControls={disableControls}
                deleting={deleting}
                statusUpdating={statusUpdating}
                manualRefreshing={manualRefreshing}
                cooldownResetting={cooldownResetting}
                quotaFilterType={activeQuotaFilter}
                statusBarCache={statusBarCache}
                entranceDelayMs={cardEntranceDelay(index)}
                onShowModels={showModels}
                onDownload={handleDownload}
                onManualRefresh={handleManualRefresh}
                onCooldownReset={handleCooldownReset}
                onOpenPrefixProxyEditor={openPrefixProxyEditor}
                onDelete={handleDelete}
                onToggleStatus={handleStatusToggle}
                onToggleSelect={toggleSelect}
                groups={groupsEnabled ? groups : undefined}
                onAssignGroup={groupsEnabled ? handleAssignGroup : undefined}
                orderControls={
                  effectiveSort.field === 'custom' && !isRuntimeOnlyAuthFile(file)
                    ? {
                        isFirst: movableIndexByName.get(file.name) === 0,
                        isLast: movableIndexByName.get(file.name) === movableSorted.length - 1,
                        onMove: handleMoveFile,
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {!loading && sorted.length > pageSize && (
          <div className={styles.pagination}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              {t('auth_files.pagination_prev')}
            </Button>
            <div className={styles.pageInfo}>
              {t('auth_files.pagination_info', {
                current: currentPage,
                total: totalPages,
                count: sorted.length,
              })}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              {t('auth_files.pagination_next')}
            </Button>
          </div>
        )}
      </section>

      <div className={styles.configGrid} ref={oauthSectionRef}>
        <OAuthExcludedCard
          disableControls={disableControls}
          excludedError={excludedError}
          excluded={excluded}
          onRetry={loadExcluded}
          onAdd={() => openExcludedEditor()}
          onEdit={openExcludedEditor}
          onDelete={deleteExcluded}
        />

        <OAuthModelAliasCard
          disableControls={disableControls}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onRetry={loadModelAlias}
          onAdd={() => openModelAliasEditor()}
          onEditProvider={openModelAliasEditor}
          onDeleteProvider={deleteModelAlias}
          modelAliasError={modelAliasError}
          modelAlias={modelAlias}
          allProviderModels={allProviderModels}
          onUpdate={handleMappingUpdate}
          onDeleteLink={handleDeleteLink}
          onToggleFork={handleToggleFork}
          onRenameAlias={handleRenameAlias}
          onDeleteAlias={handleDeleteAlias}
        />
      </div>

      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        fileType={modelsFileType}
        loading={modelsLoading}
        error={modelsError}
        models={modelsList}
        excluded={excluded}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
      />

      <AuthFileDetailsSheet
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />

      <BatchActionBar
        selectionCount={selectionCount}
        selectablePageCount={selectablePageItems.length}
        selectableFilteredCount={selectableFilteredItems.length}
        disableControls={disableControls}
        batchStatusDisabled={batchStatusButtonsDisabled}
        onSelectPage={() => selectAllVisible(pageItems)}
        onSelectFiltered={() => selectAllVisible(sorted)}
        onInvertPage={() => invertVisibleSelection(pageItems)}
        onDeselectAll={deselectAll}
        onDownload={() => void batchDownload(selectedNames)}
        onEnable={() => batchSetStatus(selectedNames, true)}
        onDisable={() => batchSetStatus(selectedNames, false)}
        onDelete={() => batchDelete(selectedNames)}
        groups={groupsEnabled ? groups : undefined}
        onAssignGroup={
          groupsEnabled ? (groupId) => void batchAssignGroup(selectedNames, groupId) : undefined
        }
        onMoveToTop={customOrderEnabled ? () => void handleBatchMoveToTop() : undefined}
      />

      {groupsEnabled && (
        <GroupManager
          open={groupManagerOpen}
          groups={groups}
          onClose={() => setGroupManagerOpen(false)}
          onSave={handleSaveGroups}
        />
      )}
    </div>
  );
}
