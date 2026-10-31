# 面板显示偏好：数据结构、接口与同步策略

> 本文是前后端实现所依据的契约（英文原文），实现位于 `src/features/preferences/`、`src/stores/usePanelPreferencesStore.ts` 与后端 `internal/api/handlers/management/panel_preferences.go`。

**关联范围**：管理接口只有一把共享的管理密钥，无法区分管理员个人，因此偏好按「CPA 后端实例」存储，所有使用同一管理密钥的管理员共享；不是按用户同步。


## Scope (must be stated honestly in UI copy and docs)
The management API authenticates with ONE shared management key; it cannot tell administrators apart.
Preferences are therefore scoped **per CPA backend instance** ("shared by everyone who manages this server"),
NOT per user. Never claim per-user sync. localStorage keeps a per-browser cache.

Preferences are purely presentational: never read by scheduling, credential selection, account groups
(`ui.group` / `ui.order` metadata) or config. They live in their own file, not in config.yaml, so frequent
writes never trigger a config reload, git commit or auth re-synthesis.

## Document (schema version 1)
```jsonc
{
  "version": 1,
  "authFiles": {
    "sort": { "field": "default", "direction": "asc" },
    "providerFilter": "all",          // provider key or "all"
    "statusFilter": "all",            // all | enabled | disabled | problem
    "groupFilter": "all",             // all | ungrouped | <group id>
    "regularPageSize": 9,
    "compactPageSize": 12
  },
  "quota": {
    "sort": { "field": "default", "direction": "asc" },
    "tab": "all",
    "groupFilter": "all"
  },
  "display": {
    "compact": false,                 // shared by auth-files and quota pages
    "maskEmail": false                // shared by auth-files and quota pages
  }
}
```
- authFiles.sort.field: default | az | priority | fiveHour | weekly | weeklyReset | custom
- quota.sort.field:     default | soonest | fiveHour | weekly | weeklyReset
- direction: asc | desc. Ignored for `default`, `custom`, `soonest`.
  Semantics: az asc=A→Z; priority desc=high first (legacy default); fiveHour/weekly asc=least remaining first;
  weeklyReset asc=sooner reset first.
- Ephemeral, never persisted/synced: search text, page number, selection.
- Normalization is tolerant: unknown keys dropped, invalid values replaced by defaults, missing sections filled.

## Backend storage & API (v8 only)
- File: `<dir of config file>/.cpa-panel-preferences` (JSON content, no `.json` suffix so an auth-dir
  scanner never mistakes it for a credential). Atomic write (temp file + rename), 0600.
  Max body 64 KiB. The document is stored opaquely except: must be a JSON object containing integer `version` >= 1.
- `GET /v8/management/panel-preferences`
  -> 200 `{"preferences": <object>|null, "revision": "<string>", "updated_at": "<RFC3339>"|null}`
  `revision` = "0" when no file exists; otherwise a monotonically increasing integer as string, persisted in the file
  envelope: `{"revision": N, "updated_at": "...", "preferences": {...}}`.
- `PUT /v8/management/panel-preferences` body `{"preferences": {...}, "base_revision": "<string>"}`
  - base_revision missing/empty -> 400. base_revision != current -> 409
    `{"error":"revision conflict","preferences":<current>,"revision":"<current>","updated_at":...}`.
  - success -> 200 same shape as GET with new revision.
  - invalid body / not an object / missing or bad version / too large -> 400 (413 acceptable for size).
- Writes serialized by a mutex. No config save, no reload, no store/persist hooks.
- Old backends return 404 on GET -> frontend runs in local-only mode.

## Client sync & conflict strategy
1. Read order on load: defaults <- legacy localStorage/sessionStorage keys (one-time migration:
   `authFilesPage.uiState`, `authFilesPage.compactMode`, `quotaPage.uiState`) <- `cpamc.panelPreferences.v1`
   localStorage cache <- server document (server wins when it exists).
2. After connecting: GET. If server has a document: apply it (re-applying any local keys still dirty/unsynced on top).
   If server has none (revision "0"): upload the local document. If 404: local-only mode.
3. Every change: apply + write localStorage immediately, mark changed leaf paths dirty, debounce ~800 ms, PUT with
   base_revision. On 200: store revision, clear dirty. On 409: take server doc from the response, re-apply the
   dirty leaf paths on top (field-level last-writer-wins), retry once; if it conflicts again, keep local and retry on next change.
   Network errors keep dirty paths for the next attempt; never block the UI.
4. Re-fetch on window focus/visibility when idle (no dirty paths) so other devices' changes appear without reload.
