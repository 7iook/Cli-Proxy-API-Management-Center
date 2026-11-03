import { useCallback, useMemo, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useNotificationStore } from '@/stores';
import type {
  PrefixProxyEditorField,
  PrefixProxyEditorFieldValue,
  PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import {
  supportsAuthFileSiwc,
  supportsAuthFileUsingApi,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/constants';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import { AuthFileExcludedModelsField } from './AuthFileExcludedModelsField';
import { AuthFilePolicyFields } from './AuthFilePolicyFields';
import { credentialPolicyError, readCredentialPolicy } from '../credentialPolicy';
import { AuthFileSubscriptionBadge } from './AuthFileSubscriptionBadge';
import {
  computeSubscriptionPeriod,
  isClaudeAuthFile,
  parseSubscriptionDateFromNote,
  subscriptionDraftToInput,
} from '../subscription';
import styles from './AuthFileDetailsSheet.module.scss';

/** API 边界归一化补写的派生字段——INFO 视图里只展示后端原始形状，避免重复噪音。 */
const DERIVED_INFO_KEYS = [
  'successCount',
  'failureCount',
  'recentRequests',
  'runtimeOnly',
  'authIndex',
  'statusMessage',
  'modified',
  // 'email' 不在此列：后端原始键名与 camelCase 同形，删掉会藏起真实数据。
  'projectId',
];

export type AuthFileDetailsSheetProps = {
  disableControls: boolean;
  editor: PrefixProxyEditorState | null;
  updatedText: string;
  dirty: boolean;
  onClose: () => void;
  onCopyText: (text: string) => void | Promise<void>;
  onSave: () => void;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
};

/**
 * 凭证详情/编辑抽屉：替代旧的居中 Modal，与提供商工作台的 Sheet 模式一致。
 * 脏状态下关闭（Escape/遮罩/×/取消）先走确认对话框。
 */
export function AuthFileDetailsSheet(props: AuthFileDetailsSheetProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { disableControls, editor, updatedText, dirty, onClose, onCopyText, onSave, onChange } =
    props;
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showSubscription = Boolean(editor && isClaudeAuthFile({ type: editor.providerKey }));
  const subscriptionPreview = useMemo(
    () =>
      editor && showSubscription
        ? computeSubscriptionPeriod(subscriptionDraftToInput(editor.subscription))
        : null,
    [editor, showSubscription]
  );
  const subscriptionInvalid = Boolean(editor?.subscriptionTouched && editor.subscriptionError);

  const handleSubscriptionFromNote = useCallback(() => {
    if (!editor) return;
    const sources = [editor.note, typeof editor.json?.note === 'string' ? editor.json.note : ''];
    const date = sources.map(parseSubscriptionDateFromNote).find(Boolean);
    if (!date) {
      showNotification(t('auth_files.subscription_from_note_none'), 'warning');
      return;
    }
    onChange('subscriptionStart', date);
    showNotification(t('auth_files.subscription_from_note_done', { date }), 'success');
  }, [editor, onChange, showNotification, t]);

  const confirmClose = useCallback((): boolean | Promise<boolean> => {
    if (!dirty || editor?.saving === true) return true;
    return new Promise<boolean>((resolve) => {
      showConfirmation({
        title: t('providersPage.unsavedChanges.title'),
        message: t('providersPage.unsavedChanges.message'),
        variant: 'danger',
        confirmText: t('providersPage.unsavedChanges.discard'),
        cancelText: t('providersPage.unsavedChanges.keepEditing'),
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [dirty, editor?.saving, showConfirmation, t]);

  const handleCancelClick = useCallback(() => {
    void Promise.resolve(confirmClose()).then((ok) => {
      if (ok) onClose();
    });
  }, [confirmClose, onClose]);

  const handleSettingsLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (editor?.saving) return;

      void Promise.resolve(confirmClose()).then((ok) => {
        if (ok) void navigate('/config?field=routingStrategy');
      });
    },
    [confirmClose, editor?.saving, navigate]
  );

  const formatJsonText = (text: string) => {
    if (!text) return '';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };
  const previewText = formatJsonText(updatedText);
  const invalidContentPreview = editor?.invalidContentPreview ?? '';
  const fileInfoText = editor?.fileInfoText ?? '';
  const displayInfoText = useMemo(() => {
    if (!fileInfoText) return '';
    try {
      const parsed = JSON.parse(fileInfoText) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        DERIVED_INFO_KEYS.forEach((key) => {
          delete record[key];
        });
        return JSON.stringify(record, null, 2);
      }
    } catch {
      /* 非 JSON 原样展示 */
    }
    return fileInfoText;
  }, [fileInfoText]);

  return (
    <Sheet
      open={Boolean(editor)}
      onClose={onClose}
      confirmClose={confirmClose}
      size="md"
      closeDisabled={editor?.saving === true}
      eyebrow={t('auth_files.prefix_proxy_button')}
      title={editor?.fileName ?? ''}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={handleCancelClick}
            disabled={editor?.saving === true}
          >
            {dirty ? t('common.cancel') : t('common.close')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!updatedText) return;
              void onCopyText(updatedText);
            }}
            disabled={editor?.saving === true || !updatedText}
          >
            {t('common.copy')}
          </Button>
          <Button
            onClick={onSave}
            loading={editor?.saving === true}
            disabled={
              disableControls ||
              editor?.saving === true ||
              !dirty ||
              !editor?.json ||
              Boolean(editor?.headersTouched && editor.headersError) ||
              Boolean(editor?.weightError) ||
              subscriptionInvalid ||
              Boolean(credentialPolicyError(editor?.policy))
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {editor && (
        <div className={styles.editor}>
          {editor.loading ? (
            <div className={styles.loading}>
              <LoadingSpinner size={14} />
              <span>{t('auth_files.prefix_proxy_loading')}</span>
            </div>
          ) : (
            <>
              {editor.error && <div className={styles.error}>{editor.error}</div>}
              <div className={styles.jsonWrapper}>
                <label className={styles.label}>{t('auth_files.prefix_proxy_info_label')}</label>
                <textarea className={styles.textarea} rows={8} readOnly value={displayInfoText} />
              </div>
              <div className={styles.jsonWrapper}>
                <label className={styles.label}>
                  {editor.json
                    ? t('auth_files.prefix_proxy_source_label')
                    : t('auth_files.prefix_proxy_invalid_content_label')}
                </label>
                {editor.json ? (
                  <textarea className={styles.textarea} rows={10} readOnly value={previewText} />
                ) : (
                  <pre className={styles.invalidPreview}>{invalidContentPreview}</pre>
                )}
              </div>
              {editor.json && (
                <div className={styles.fields}>
                  <Input
                    label={t('auth_files.prefix_label')}
                    value={editor.prefix}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('prefix', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.proxy_url_label')}
                    value={editor.proxyUrl}
                    placeholder={t('auth_files.proxy_url_placeholder')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('proxyUrl', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.priority_label')}
                    value={editor.priority}
                    placeholder={t('auth_files.priority_placeholder')}
                    hint={t('auth_files.priority_hint')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('priority', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.weight_label')}
                    type="number"
                    step="1"
                    max={MAX_CREDENTIAL_WEIGHT}
                    value={editor.weight}
                    placeholder="1"
                    hint={
                      <Trans
                        i18nKey="auth_files.weight_hint"
                        components={{
                          settingsLink: (
                            <Link
                              className={styles.settingsLink}
                              to="/config?field=routingStrategy"
                              onClick={handleSettingsLinkClick}
                            />
                          ),
                        }}
                      />
                    }
                    error={editor.weightError ?? undefined}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('weight', e.target.value)}
                  />
                  <div className="form-group">
                    <label>{t('auth_files.disable_cooling_label')}</label>
                    <ToggleSwitch
                      checked={editor.disableCooling}
                      onChange={(value) => onChange('disableCooling', value)}
                      disabled={disableControls || editor.saving || !editor.json}
                      ariaLabel={t('auth_files.disable_cooling_label')}
                    />
                    <div className="hint">{t('auth_files.disable_cooling_hint')}</div>
                  </div>
                  {supportsAuthFileWebsockets(editor.providerKey) && (
                    <div className="form-group">
                      <label>{t('auth_files.websockets_label')}</label>
                      <ToggleSwitch
                        checked={editor.websockets}
                        onChange={(value) => onChange('websockets', value)}
                        disabled={disableControls || editor.saving || !editor.json}
                        ariaLabel={t('auth_files.websockets_label')}
                      />
                      <div className="hint">{t('auth_files.websockets_hint')}</div>
                    </div>
                  )}
                  {supportsAuthFileSiwc(editor.providerKey) && (
                    <div className="form-group">
                      <label>{t('auth_files.use_siwc_label')}</label>
                      <ToggleSwitch
                        checked={editor.useSiwc}
                        onChange={(value) => onChange('useSiwc', value)}
                        disabled={disableControls || editor.saving || !editor.json}
                        ariaLabel={t('auth_files.use_siwc_label')}
                      />
                      <div className="hint">{t('auth_files.use_siwc_hint')}</div>
                    </div>
                  )}
                  {supportsAuthFileUsingApi(editor.providerKey) && (
                    <div className="form-group">
                      <label>{t('auth_files.using_api_label')}</label>
                      <ToggleSwitch
                        checked={editor.usingApi}
                        onChange={(value) => onChange('usingApi', value)}
                        disabled={disableControls || editor.saving || !editor.json}
                        ariaLabel={t('auth_files.using_api_label')}
                      />
                      <div className="hint">{t('auth_files.using_api_hint')}</div>
                    </div>
                  )}
                  <AuthFileExcludedModelsField
                    fileName={editor.fileName}
                    value={editor.excludedModelsText}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(value) => onChange('excludedModelsText', value)}
                  />
                  <div className="form-group">
                    <label>{t('auth_files.headers_label')}</label>
                    <textarea
                      className={`input ${editor.headersError ? styles.textareaInvalid : ''}`}
                      value={editor.headersText}
                      placeholder={t('auth_files.headers_placeholder')}
                      rows={4}
                      aria-invalid={Boolean(editor.headersError)}
                      disabled={disableControls || editor.saving || !editor.json}
                      onChange={(e) => onChange('headersText', e.target.value)}
                    />
                    {editor.headersError && <div className="error-box">{editor.headersError}</div>}
                    <div className="hint">{t('auth_files.headers_hint')}</div>
                  </div>
                  <AuthFilePolicyFields
                    draft={editor.policy ?? readCredentialPolicy(editor.json)}
                    disabled={disableControls || editor.saving}
                    onChange={onChange}
                  />
                  <Input
                    label={t('auth_files.note_label')}
                    value={editor.note}
                    placeholder={t('auth_files.note_placeholder')}
                    hint={t('auth_files.note_hint')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('note', e.target.value)}
                  />
                  {showSubscription && subscriptionPreview && (
                    <section
                      className={styles.subscription}
                      aria-label={t('auth_files.subscription_section')}
                    >
                      <div className={styles.subscriptionHead}>
                        <span className={styles.label}>{t('auth_files.subscription_section')}</span>
                        <AuthFileSubscriptionBadge period={subscriptionPreview} />
                      </div>
                      <div className={styles.subscriptionGrid}>
                        <Input
                          type="date"
                          label={t('auth_files.subscription_start_label')}
                          value={editor.subscription.start}
                          disabled={disableControls || editor.saving}
                          onChange={(e) => onChange('subscriptionStart', e.target.value)}
                        />
                        <Input
                          type="time"
                          step={60}
                          label={t('auth_files.subscription_start_time_label')}
                          value={editor.subscription.startTime}
                          hint={t('auth_files.subscription_time_hint')}
                          disabled={disableControls || editor.saving || !editor.subscription.start}
                          onChange={(e) => onChange('subscriptionStartTime', e.target.value)}
                        />
                        <Input
                          type="date"
                          label={t('auth_files.subscription_end_label')}
                          value={editor.subscription.end}
                          min={editor.subscription.start || undefined}
                          disabled={disableControls || editor.saving}
                          onChange={(e) => onChange('subscriptionEnd', e.target.value)}
                        />
                        <Input
                          type="time"
                          step={60}
                          label={t('auth_files.subscription_end_time_label')}
                          value={editor.subscription.endTime}
                          hint={t('auth_files.subscription_time_hint')}
                          disabled={disableControls || editor.saving || !editor.subscription.end}
                          onChange={(e) => onChange('subscriptionEndTime', e.target.value)}
                        />
                        <div className="form-group">
                          <label>{t('auth_files.subscription_cycle_label')}</label>
                          <Select
                            value={editor.subscription.cycle}
                            options={[
                              {
                                value: 'monthly',
                                label: t('auth_files.subscription_cycle_monthly'),
                              },
                              {
                                value: 'annual',
                                label: t('auth_files.subscription_cycle_annual'),
                              },
                            ]}
                            onChange={(value) => onChange('subscriptionCycle', value)}
                            disabled={disableControls || editor.saving}
                            ariaLabel={t('auth_files.subscription_cycle_label')}
                            fullWidth
                          />
                        </div>
                        <div className="form-group">
                          <label>{t('auth_files.subscription_auto_renew_label')}</label>
                          <ToggleSwitch
                            checked={editor.subscription.autoRenew}
                            onChange={(value) => onChange('subscriptionAutoRenew', value)}
                            disabled={disableControls || editor.saving}
                            ariaLabel={t('auth_files.subscription_auto_renew_label')}
                          />
                        </div>
                      </div>
                      {subscriptionInvalid && (
                        <div className="error-box">{editor.subscriptionError}</div>
                      )}
                      <div className={styles.subscriptionActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleSubscriptionFromNote}
                          disabled={disableControls || editor.saving}
                        >
                          {t('auth_files.subscription_from_note')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onChange('subscriptionClear', true)}
                          disabled={
                            disableControls ||
                            editor.saving ||
                            (!editor.subscription.start &&
                              !editor.subscription.end &&
                              !editor.subscription.startTime &&
                              !editor.subscription.endTime)
                          }
                        >
                          {t('auth_files.subscription_clear')}
                        </Button>
                      </div>
                      <div className="hint">{t('auth_files.subscription_hint')}</div>
                    </section>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
