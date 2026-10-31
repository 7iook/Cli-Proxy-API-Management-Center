# 账号分组、自定义排序与排序优化：现状评估与实施计划

> 范围：仅优化管理面板中账号（认证文件 / 凭证）的组织、展示与查询体验。
> 不涉及请求调度、账号轮换、负载均衡与 API Key 权限。

> **实施更新（已落地，取代下文第二节中「分组注册表存 localStorage」的设计）**
> - 每个账号只属于一个分组。
> - 分组定义（含空分组）与分组顺序由后端持有：`config.yaml` 新增 v8 根节 `account-groups`（`id`/`name`/`color`，列表顺序即显示顺序），随现有配置持久化同步到 file/PG/git/对象存储。
> - 接口（仅 v8）：`GET/PUT /v8/management/account-groups`（整表替换，删除分组时自动清除成员的 `ui.group`）、`POST /v8/management/account-groups/assign`（批量分配/移出）。
> - 账号归属与手动顺序存于凭证 metadata `ui.group`（分组 id，改名不影响归属）与 `ui.order`（经现有 `PATCH /credentials/fields` 写入，`null` 删除），列表白名单回传 `ui`。
> - 额度页本期同步支持分组筛选与 5h/周剩余排序。
> - 旧后端（`GET account-groups` 返回 404）自动隐藏分组与自定义顺序入口。

## 一、现状评估

### 1. 前端（管理面板，`src/features/authFiles`）

| 能力 | 现状 | 位置 |
| --- | --- | --- |
| 列表 | 卡片网格 + 前端分页（常规 9 / 紧凑 12，可调 3–30） | `AuthFilesPage.tsx` |
| 筛选 | 提供商 Tab（`ProviderTabs`）、状态分段（全部/启用/停用/问题）、通配搜索（name/type/provider/email/projectId/status_message） | `AuthFilesToolbar.tsx`、`logic.ts` |
| 排序 | `default`（provider + 文件名）、`az`（卡片主行，即 email）、`priority`（priority 降序） | `logic.ts#sortAuthFiles` |
| 页面状态持久化 | localStorage `authFilesPage.uiState`（filter/status/search/page/pageSize/sortMode） | `uiState.ts` |
| 批量操作 | 底部 `BatchActionBar`：选本页/选全部筛选结果/反选/下载/启用/停用/删除；逐个请求 + `Promise.allSettled` + 乐观更新 | `BatchActionBar.tsx`、`useAuthFilesData.ts` |
| 额度数据 | `useQuotaStore`（zustand，仅内存），按提供商分 8 张表，键为 `getQuotaCacheKey(file)`；默认点击加载 | `stores/useQuotaStore.ts` |
| 额度规范化 | 各提供商窗口都带 `resetAtMs` 与 `periodHours`；`resetSchedule.ts`（最早恢复时刻）与 `quotaTimelineModel.ts`（时间轴 lane）已按提供商结构化读取 | `features/quota/*` |
| 额度页排序 | 仅 `default` / `soonest`（最早恢复）；缺数据的条目沉底且保持原序 | `features/quota/logic.ts#sortQuotaEntries` |

结论：筛选/排序/持久化/批量的骨架齐全，新增功能可以直接挂在现有 memo 管线（`filesMatchingStatusFilters → filtered → sorted → pageItems`）和现有组件上，无需新框架。

### 2. 后端（CLIProxyAPI，`internal/api/handlers/management`）

- `GET /v8/management/credentials`：返回字段为白名单（`buildAuthFileEntryLocked`），自定义 metadata 不会回传，目前只回传 `note`、`priority`、`weight` 等。
- `PATCH /v8/management/credentials/fields`：可以写任意 metadata 路径，支持 `a.b` 嵌套，写入后走 `authManager.Modify`、持久化和 `postAuthPersistHook`，能正确同步到 file、Postgres、git、对象存储等各种存储后端。config 来源凭证和插件虚拟凭证会被拒绝（404/409）。
- 重新 OAuth 登录：`MergeExistingAuthMetadata` 会保留同一文件中所有非 token 的 metadata 键，因此写入 metadata 的分组和排序信息在 token 刷新和重新登录后都能保留。
- `config.yaml`（v8）：`KnownFields(true)`，遇到未知 section 直接报错，不适合存放面板私有数据。
- **重要的雷区**：
  - fork 已合入 `credential-group` / `credential_group`（`conductor_selection.go#authInCredentialGroups`）。这个字段参与**调度和 API Key 权限**，展示用的分组**绝对不能**复用它。
  - `priority` 同样参与调度，「自定义排序」**不能**借用 priority 实现。
- 被动额度：`quota.signals`（claude/codex/devin 响应头）已随列表下发；fork 分支 `feat/passive-quota-snapshot` 进一步为 Claude 增加了 `quota_snapshot`。

### 3. 现有实现与可复用性调研

| 来源 | 内容 | 结论 |
| --- | --- | --- |
| 上游面板 PR #149（已合并） | 认证文件 priority 展示、排序与备注 | 已在现有代码中（`sortAuthFiles` 的 priority 模式和 note 字段），可沿用其「metadata 字段 + PATCH fields」模式 |
| 上游面板 PR #267（seakee/CPA-Manager，已关闭） | 额度页搜索 + 按 plan 排序 | 夹带 76 个无关提交，代码基于旧的 `components/quota`，不建议 cherry-pick，只借鉴从 `id_token.plan_type` 读取 plan 的思路 |
| 上游面板 PR #310（MarvekG，已关闭） | 额度页按 name/email/label 过滤 | 已被现有 `filterEntriesBySearch` 覆盖，无需引入 |
| 上游面板 PR #212（已合并） | AI 提供商列表的筛选、排序与布局 | 交互语汇可参考，代码与认证文件页无关 |
| 上游面板 issue #214（已关闭，not planned） | 认证文件「锁定标签」，防止批量删除误删 | 需求相近，可作为后续分组能力的延伸（分组级「保护」），本期不做 |
| 上游后端 issue #5284 / #5654 → Discussion #5679，PR #5200 / #5660 / #6569 | 账号分组用于 **API Key 路由/权限** | 属于调度范畴，与本期「仅展示」的定位相反；本 fork 已有 credential-group，需要刻意避开 |
| 本 fork 面板 `feat/quota-cache` | 把最近一次额度持久化到浏览器并显示缓存时间 | **强相关**：按额度排序依赖「刷新页面后仍有额度数据」，建议先合入或一并合入 |
| 本 fork 面板 `feat/passive-quota-snapshot` + 后端同名分支 | 列表加载时直接用后端被动快照渲染 Claude 额度 | **强相关**：降低按额度排序时「无数据」的比例，建议作为排序功能的数据前置 |

结论：没有任何现成的「展示用分组」或「拖拽/手动排序」实现可以直接 cherry-pick，需要新开发。数据层可复用 `PATCH fields`、metadata 合并、额度 store/cache/被动快照；UI 层可复用 Toolbar 的 Select/Segmented、ProviderTabs 样式、BatchActionBar 和卡片菜单。

## 二、存储策略选型

| 方案 | 跨设备 | 存储后端兼容 | 后端改动 | 重新登录保留 | 缺点 |
| --- | --- | --- | --- | --- | --- |
| A. 纯 localStorage | ✗ | — | 无 | 视键而定 | 换浏览器即丢失，不满足「持久」预期 |
| **B. 凭证 metadata（推荐）** | ✓ | ✓（随凭证同步 PG/git/对象存储） | 列表白名单回传 1 个字段 | ✓（`MergeExistingAuthMetadata`） | 批量操作需要 N 次 PATCH；空分组无处存放 |
| C. 新增面板状态端点 + 独立 JSON 文件 | ✓ | ✗（需单独接入各 store） | 新端点 + 存储适配 | 需要维护 name 映射 | 改动面大，凭证改名或删除后会残留孤儿数据 |
| D. 写入 config.yaml | ✓ | ✓ | 需要扩展 v8 schema | — | 污染运行时配置，与「最小后端」原则冲突 |

**推荐 B**，具体设计如下：

- 统一使用一个根键 `ui`（对象），只放展示数据，不参与任何调度：
  ```json
  { "ui": { "group": "Pro 组", "group_color": "#7C3AED", "order": 1024 } }
  ```
- 写入：复用 `PATCH /credentials/fields`，路径为 `ui.group`、`ui.group_color`、`ui.order`；值为 `null` 表示删除。**前端不需要新的写接口。**
- 读取（唯一的后端改动）：在 `buildAuthFileEntryLocked` 中按白名单回传 `entry["ui"]`，只包含上面 3 个子键，并做类型和长度校验（group ≤ 64 字符、color 必须是 `#RRGGBB`、order 必须是有限数值）。v8 和 v0 共用这一个函数，不需要修改 `/v0/management` 路由。
- 分组「注册表」不单独存储：分组即「所有成员 `ui.group` 的去重集合」，颜色取成员中出现次数最多的 `group_color`，没有颜色时按名称哈希到固定色板。
  - 空分组（刚创建、还没有成员）只存在于 localStorage 的草稿中，分配第一个成员后自然落到服务端。
  - 分组之间的显示顺序存 localStorage（属于个人偏好，丢失也无害）。
- 账号标识：以后端 `name`（文件名，`PATCH fields` 也按它定位）为主键，与现有 note/priority 完全一致。
  - 已知局限：Codex 文件名包含 plan，plan 变化会生成新文件，新文件不继承分组（note/priority 现在也有同样的问题）。可以作为后续增强：前端检测到「同 provider + 同 email 的旧文件已删除」时提示一键继承。
- 不能写 metadata 的凭证（config 来源 API Key、插件虚拟凭证、runtime-only）：卡片上不显示分组入口，批量操作时跳过并提示「N 个凭证不支持分组」。本期不做 localStorage 兜底，避免出现两套真相源。
- 升级兼容：
  - 老后端不回传 `ui` 时，前端检测「写入成功但读不到」，隐藏分组和自定义排序入口，并提示升级 CPA。
  - 老面板会忽略未知字段；`ui` 会被 metadata 合并逻辑原样保留，不影响下载和导入。
- 写入副作用：每次 PATCH 都会触发持久化和 watcher。需要确认不会再次出现上游 issue #4567（更新无关凭证导致 Codex WebSocket 断开）类问题；后端测试中应补一条「修改 `ui.*` 不改变调度属性」的断言。

## 三、功能设计

### 1. 账号分组

- 入口（不新增页面）：
  - 卡片上新增分组徽章，点击后弹出菜单：移到某分组 / 新建分组 / 移出分组。
  - `BatchActionBar` 新增「分组 ▾」按钮：移到…… / 新建分组并移入 / 移出分组。
  - 分组管理放在筛选条中分组 chip 的右键或「⋯」菜单里：重命名、改色、删除。
- 视觉标识：卡片左侧 3px 色条 + 主行旁边的小徽章（颜色 + 名称）；紧凑模式只保留色条。
- 操作语义：
  - 重命名、改色 = 对该组全部成员批量 PATCH；
  - 删除分组 = 对成员批量置 `ui.group = null`（账号本身不删除，明确提示）；
  - 批量请求沿用 `batchSetStatus` 的「乐观更新 + allSettled + 部分失败回滚并提示」模式。

### 2. 按分组筛选

- 在 `ProviderTabs` 下方增加一行分组 chip：`全部 · 未分组 · 组A(12) · 组B(5) …`，单选，与提供商、状态、搜索做**交集**。计数复用 `typeCounts` 的算法。
- 搜索支持匹配分组名，例如输入 `pro`。
- 选中分组 + 「全部」提供商时，卡片照常展示额度（现有 `activeQuotaFilter='all'`），即可查看该组的状态和额度。
- 新增「加载本组额度」按钮，复用 `useQuotaBatchLoader`，只加载当前筛选结果。
- 当前分组写入 `uiState.groupFilter`，刷新后保留；分组被删除时自动回退为「全部」。
- 一处小优化：`handleDeleteAll`（删除筛选结果）的文案和作用域需要包含分组条件，防止误删。

### 3. 自定义排序（手动排序 + 置顶）

- 新增排序模式 `custom`（自定义顺序）。有 `ui.order` 的按升序排在前面，没有的按 `default` 规则排在后面。
- 操作：
  - 卡片菜单：置顶 / 上移 / 下移 / 置底；
  - 批量操作栏：将选中项置顶，保持选中项之间的相对顺序。
  - 在非 custom 模式下点「置顶」，自动切换到 custom 模式并提示。
  - 拖拽（HTML5 原生，不引入依赖）只在 custom 模式 + 单页内启用；跨页移动通过菜单完成，避免分页下拖拽的歧义。
- 排名算法（稀疏间隔）：置顶 = `min - 1024`，置底 = `max + 1024`，插入 = 相邻两项的中点。只有间隔小于 1e-6 时才对该范围重排并批量写回。**常规情况下移动一张卡片只需要 1 次 PATCH。**
- 排序在全局（跨分组）共用一套 `order`；在分组视图内调整的结果就是该组成员的相对顺序，不需要按组维护多套数据。

### 4. 增强排序（按额度剩余）

新增 4 个排序模式：`5h 剩余 ↑ / ↓`、`周剩余 ↑ / ↓`。现有 3 个模式保留。

- 新建纯函数 `features/quota/quotaSortKey.ts`，签名为 `(provider, quota, kind: 'fiveHour' | 'weekly', nowMs) => { remaining, resetAtMs, source } | null`。
  - 与 `resetSchedule.ts` 一样，按提供商结构化读取，并配套单元测试。
- 窗口识别按 `periodHours` 判断，不依赖文本标签：5h 取 `4 ≤ h ≤ 6`，周取 `144 ≤ h ≤ 192`。Codex 优先取 id 为 `five-hour` / `weekly` 的账号级窗口；Claude 优先取 `seven_day`，避免模型级窗口（如 Fable）带偏结果（参考上游 issue #502）。没有账号级窗口时，取同周期窗口中剩余最少的那个（即瓶颈）。
- 单位统一为「剩余百分比 0–100」：
  - Antigravity：`remainingFraction × 100`；
  - Kimi：`(limit - used) / limit`；
  - Claude / Codex / Meta / xAI：`100 - used`。
- 重置事件：`resetAtMs ≤ now` 视为已重置，剩余按 100% 计并标注「已重置（估算）」，与 `feat/passive-quota-snapshot` 的处理口径一致。时钟走动不触发重排，只在数据变化时重排，避免卡片自己跳动。
- 缺数据分三层，**无论升序还是降序都固定沉底**，层内保持 `default` 顺序（复用 `sortQuotaEntries` 的稳定排序写法）：
  1. 有值；
  2. 支持但未加载或加载失败；
  3. 不适用（例如 xAI、Devin 没有 5h 窗口，或提供商不支持额度）。
- 数据来源优先级：本会话手动刷新 > 被动快照 / 浏览器缓存中较新的一方（复用两个 fork 分支）。
- 列表顶部显示一行提示：「N 个账号暂无额度数据 · [加载]」，点击后只加载当前筛选结果。

### 5. UX 收敛

- 工具栏不增加新控件：分组 chip 行替代分组下拉；排序仍用原有 Select（选项从 3 个增加到 8 个，用分隔线分为「基础 / 额度 / 自定义」三组）。
- 所有新增状态（groupFilter、新的 sortMode）都进入 `uiState`。`isAuthFilesSortMode` 白名单扩展后，旧版本保存的值仍然合法。
- 额度页（`QuotaPage`）第二期再复用相同的 `quotaSortKey` 和分组 chip，本期只做认证文件页，控制改动面。

## 四、实施计划

| 阶段 | 内容 | 仓库 | 预估 |
| --- | --- | --- | --- |
| P0 数据前置 | 合并或评审 `feat/quota-cache`、`feat/passive-quota-snapshot`（前后端） | 两者 | 0.5d |
| P1 后端最小支持 | `buildAuthFileEntryLocked` 白名单回传 `ui`（含校验）；测试覆盖：PATCH `ui.*` 后可读回、重新登录后保留、`credential_group` 和 priority 不受影响、非法值被过滤 | CLIProxyAPI | 0.5d |
| P2 类型与数据层 | `AuthFileItem.ui` 规范化（`services/api/authFiles.ts`）；`authFilesApi.patchFields` 封装 `setGroup` / `setOrder`；`useAuthFilesData` 新增 `batchSetGroup` / `moveOrder`（乐观更新 + 回滚） | 面板 | 1d |
| P3 分组 UI | 卡片色条和徽章、分组菜单、BatchActionBar「分组」、分组 chip 筛选（全部 / 未分组 / 各组）、重命名 / 改色 / 删除、搜索匹配组名、uiState 持久化、i18n（zh-CN / zh-TW / en / ru / ko / vi / tr） | 面板 | 2d |
| P4 自定义排序 | `custom` 模式、稀疏排名工具（纯函数 + 测试）、菜单移动、批量置顶、单页拖拽 | 面板 | 1.5d |
| P5 额度排序 | `quotaSortKey.ts` + 单元测试（8 个提供商 × 缺数据 / 已重置 / 多窗口）、4 个排序模式、缺数据提示与「加载」 | 面板 | 1.5d |
| P6 验收 | `bun run verify`；后端 `gofmt` + `go test ./internal/api/handlers/management/...` + 编译检查；手动回归：刷新后顺序和分组保持、旧后端降级、批量部分失败 | 两者 | 0.5d |

### 验收要点

- 刷新页面、换浏览器后，分组、颜色和自定义顺序保持一致。
- 对分组或排序做任何操作，都不改变 `priority`、`credential_group`、`disabled` 以及调度结果。
- 额度排序在升序和降序下，无数据或不适用的账号都在末尾，且顺序稳定。窗口重置后不再按旧值排序。
- 连接旧后端时，分组和自定义排序入口自动隐藏，其他功能不受影响。

## 五、待确认事项

1. 一个账号只属于一个分组（本方案），还是需要多标签？多标签可以把 `ui.group` 改成 `ui.tags[]`，筛选改为多选，复杂度会明显上升。
2. 分组顺序和空分组只存本地，是否可以接受？如果需要跨设备同步，再在 P1 中增加方案 C 的轻量端点。
3. 额度页是否需要在本期同步支持分组筛选和额度排序？
