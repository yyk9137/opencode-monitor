# OpenCode Monitor 设置面板 — 实施计划

> **版本 v2.0** — 2026-06-24
> 修订基于三专家独立审核（架构/风险、UI/UX 集成、API 事实核查）。
> 关键修正：API 方法 PATCH 而非 POST、服务器 deep merge 而非替换、UI 范式从模态改为抽屉、Schema 类型全面修正。

---

## 1. 背景与已修正的 API 事实

### 1.1 OpenCode 配置 API 接口（已核查）

| 端点 | 方法 | 行为 |
|------|------|------|
| `/config` | **GET** | 返回已解析的完整 `ConfigV1.Info` JSON（合并 8 个来源：remote → global → custom env → project → .opencode → inline env → managed → MDM） |
| `/config` | **PATCH** | 接收 config 体，与磁盘上现有 `config.json` 做 **deep merge**（`mergeDeep(writable(existing), writable(incoming))`），写入后调用 `markInstanceForDisposal`；supervisor 重新拉起进程 → 等效重启 |
| `/instance/dispose` | **POST** | 显式销毁当前实例（返回 `boolean`） |
| `/global/dispose` | **POST** | 销毁所有实例 |
| `/global/health` | **GET** | 返回 `{ healthy: boolean, version: string }` — 用于重启检测 |
| `/provider` | **GET** | 返回 `{ all: Provider[], default: {...}, connected: string[] }`（受 `enabled_providers`/`disabled_providers` 过滤） |
| `/provider/auth` | **GET** | 返回 `{ [providerID]: ProviderAuthMethod[] }`（无 `:id` 参数） |
| `/auth/:id` | **PUT** | 设置指定 provider 的认证凭据（body 匹配 provider schema） |

> **重要：无 `/api` 前缀。** 端点直接挂在根路径下（如 `GET /config` 而非 `GET /api/config`）。
> **注意**：现有代码库有混合前缀惯例（`useEventStream.ts` 用 `/api/event`，`session.ts` 用 `/api/session`）。实施时首次调用即验证 `/config` 是否正确，如果 404 则尝试 `/api/config`。

### 1.2 关键约束（已修正）

- **PATCH 做 deep merge，不做全量替换** — 服务器执行 `mergeDeep(existing, incoming)`，传入字段缺失的路径会保留磁盘已有值，不会被删除。这是对 v1.0 文档"POST 会静默删除字段"假设的关键修正。
- **`additionalProperties: false`** 仍然存在 — 但控制的是 schema 验证，不是 merge 行为。传入的未知字段会在 AJV 验证阶段被拒绝或剥离，但不会删除磁盘上已有的字段。
- **API 密钥可通过 HTTP API 设置** — `PUT /auth/:id` 存在。v1.0 文档声称"不可通过 HTTP API 设置"是错误的。
- **无 PATCH 热重载** — 每次 PATCH 仍然触发进程销毁 + supervisor 重启（~3-15s 中断）。
- **TOCTOU 窗口** — GET 最新配置与 PATCH 之间仍有时间窗口，其他写入者（第二个 TUI 实例、外部编辑）可能在窗口内修改配置。re-GET 模式缩小但不消除此窗口。
- **Tauri 权限** — 仅 `http:default`（localhost/127.0.0.1）、`core:default`、`core:window:*`、`opener:default`。无需新增能力。

### 1.3 已有的 SSE 自动重连

`useEventStream.ts` 已实现：
- 指数退避重连（1s → 30s 上限，序列：1s, 2s, 4s, 8s, 16s, 30s, 30s...）
- 重连成功时自动执行 `reconcileInstance()`（重新 GET `/session`）
- 但只重连已知 URL — 如果实例在不同端口重启，SSE 重连永远成功不了

**重启检测策略**（修正后）：SSE 重连 + `GET /global/health` 轮询 + `useInstanceScanner().scan()` 三管齐下。后者能发现新端口上的实例。

### 1.4 Monitor 当前状态

| 系统 | 说明 |
|------|------|
| 路由 | **无** — App.vue 单页直接挂载所有组件 |
| 模态/对话框 | **零** — 代码库中无 modal/dialog/overlay/focus-trap |
| 状态管理 | Pinia，`session.ts` 使用 `shallowRef` 模式 |
| 现有设置 UI | `ConnectionConfig.vue`（~740 LOC）— 内联侧栏组件，非模态 |
| HTTP 客户端 | `@tauri-apps/plugin-http` 的 `fetch`（仅 localhost/127.0.0.1） |
| 实例发现 | `useInstanceScanner.ts` — 端口扫描发现 OpenCode 实例 |
| 主题 | `src/assets/theme.css` — Zed ayu dark 色板，所有组件用 CSS 变量 |

---

## 2. 架构决策

### 决策 1：布局 — 右侧抽屉（非模态弹窗）

**选择**：右侧抽屉（drawer），从 `main-pane` 右边缘滑入。

**理由**：
- 代码库中零模态基础设施，从零构建 focus-trap/backdrop/escape 成本高
- Monitor 的核心价值是持续可观测性 — 模态会遮挡正在运行的会话
- 抽屉与现有 `titlebar + sidebar + main-pane` 布局协调
- 主内容面板在抽屉左侧仍可阅读（抽屉宽 420-520px）

### 决策 2：状态管理 — `src/stores/config.ts`

**选择**：新建 Pinia store，遵循 `session.ts` 的 `shallowRef` 模式。

**关键修正**：所有重启状态（`targetUrl`、`restartStartTime`、`timeoutId`）必须在 store 中，**不在组件中**。否则用户关闭面板时计时器被销毁，状态卡死。

### 决策 3：从不自动保存

每次 PATCH 触发完整实例重启（~3-15s 中断），自动保存会带来不可预测的中断。

### 决策 4：保存前 re-GET + deep merge

在每次 PATCH 之前，先 GET `/config` 拿到最新配置树，将用户的编辑差异（仅用户修改过的叶子路径）合并到新鲜树上，再 PATCH 合并结果。

**为什么客户端 merge 仍然必要（尽管服务端也做 mergeDeep）**：
- 服务端 `mergeDeep` 的数组行为未文档化 — 如果服务端拼接数组而非替换，发送 `enabled_providers: ["openai"]` 会与现有 `["anthropic"]` 拼接为 `["anthropic", "openai"]`，而非替换
- 客户端 merge 确保发送的是**完整合并后的树**（所有数组字段完整），不依赖服务端数组语义
- 客户端 merge 让用户意图完全由客户端控制，服务端 merge 仅作为安全网

**深度合并契约**（必须显式声明）：
- `userDiff` = `draft` 与 `original` 不同的**叶子路径集合**，不是完整的 draft 树
- 用户未触碰的路径无条件继承 fresh 值，即使 `original` 在该路径有不同值
- 不变量测试：`merge(fresh, diff(original, draft))` 应用到等于 `original` 的 fresh 树必须产生 `draft`
- **数组策略**：客户端 `mergeArrays: false`（替换），发送完整数组到服务端。即使服务端拼接数组，完整数组拼接自身也是幂等的

### 决策 5：不要通用 schema 渲染器

手工编码配置分区，每分区有专属 Vue 组件。通用渲染器（JSONForms）对复杂类型支持差。每分区提供 Raw JSON 回退。

### 决策 6：从 live schema 自动生成类型

不手写 TypeScript 接口。从 `https://opencode.ai/config.json` 用工具生成 `src/types/opencode-config.ts`。手写类型在 v1.0 中有 7 处关键错误。

---

## 3. 分步实施计划

每一步是独立的可交付单元，有明确的验收标准。步骤按依赖顺序排列。

---

### 步骤 0：类型生成 + 依赖安装

**范围**：从 live JSON Schema 生成 TypeScript 类型，安装验证依赖。

**前置条件**：无。

**实现要点**：

1. 获取 schema：`curl https://opencode.ai/config.json -o docs/opencode-config.schema.json`
2. 用 `json-schema-to-typescript` 生成类型：
   ```
   npx json-schema-to-typescript docs/opencode-config.schema.json \
     --output src/types/opencode-config.ts \
     --no-additionalProperties
   ```
3. 手动审查生成结果，确保以下关键类型正确（对照 schema 而非凭记忆）：
   - `MCPConfig` 是鉴别联合：`McpLocalConfig | McpRemoteConfig | { enabled: boolean }`
     - `McpLocalConfig.environment`（不是 `env`），`command` 是完整 argv 数组（不是 string），有 `cwd`，无 `args`
     - `McpRemoteConfig` 有 `url`, `headers`, `oauth`, `enabled`, `timeout`
   - `AgentConfig.disable`（不是 `disabled`），`mode: 'subagent' | 'primary' | 'all'`
   - `permission` 是单个 `PermissionConfig` 联合类型（不是 `Record<string, ...>`）
   - `command` 是 `Map<string, {template, description?, agent?, model?, variant?, subtask?}>`（不是 string）
   - `share` 是枚举 `'manual' | 'auto' | 'disabled'`（不是 object）
   - `autoupdate` 是 `anyOf[boolean, 'notify']`（不是 object）
   - `snapshot` 是 `boolean`（不是 object）
   - `logLevel` 是大写 `'DEBUG' | 'INFO' | 'WARN' | 'ERROR'`
   - `ProviderOptions` 有 `apiKey`, `baseURL`, `enterpriseUrl`, `setCacheKey`, `timeout`, `headerTimeout`, `chunkTimeout`（无 `maxRetries`，无 `headers`）
   - `ProviderConfig` 还有 `api`, `env`（string[]）, `npm`, `models`（map）
   - `plugin` 是 `Array<[string, Record<string, unknown>]>`（第二元素不是 string）
   - 已弃用字段（`mode`, `reference`, `layout`, `autoshare`）用 `unknown` 类型（不是 `never`），保留 round-trip 能力
4. 安装依赖：`pnpm add ajv`（无需 `ajv-formats`，schema 用 `pattern` 而非 `format`）
5. 安装合并工具：`pnpm add @fastify/deepmerge`

**交付物**：
- `docs/opencode-config.schema.json` — 冻结的 schema 副本
- `src/types/opencode-config.ts` — 自动生成的类型
- `package.json` 新增 `ajv`、`@fastify/deepmerge`

**验收标准**：
- [ ] `src/types/opencode-config.ts` 可被 `tsc --noEmit` 编译通过
- [ ] `McpLocalConfig` 有 `environment` 字段，无 `env` 字段，无 `args` 字段
- [ ] `AgentConfig` 有 `disable` 字段（不是 `disabled`），`mode` 枚举值为 `'subagent' | 'primary' | 'all'`
- [ ] `permission` 类型是联合类型，不是 `Record<string, ...>`
- [ ] `logLevel` 枚举值全大写
- [ ] `share` 是字符串枚举，不是对象
- [ ] `snapshot` 是 `boolean`，不是对象
- [ ] 已弃用字段类型为 `unknown`，不是 `never`
- [ ] `ajv` 可成功加载 schema 并验证一个合法 config JSON

---

### 步骤 1：Store 基础 + 状态机

**范围**：创建 `src/stores/config.ts`，包含完整的状态管理和重启状态机。

**前置条件**：步骤 0 完成。

**实现要点**：

1. **状态字段**（全部在 store 中，不在组件中）：
   ```typescript
   const useConfigStore = defineStore('config', () => {
     // 配置数据
     const original = shallowRef<ConfigV1Info | null>(null)
     const draft = ref<ConfigV1Info | null>(null)

     // 操作状态 — 用单一 phase 枚举互斥，不用多个 boolean
     const phase = ref<'idle' | 'loading' | 'saving' | 'restarting' | 'timeout'>('idle')

     // UI 状态
     const activeSection = ref<string>('models')
     const panelOpen = ref(false)

     // 实例目标
     const targetUrl = ref<string | null>(null)

     // 重启状态
     const restartStartTime = ref(0)
     let timeoutId: ReturnType<typeof setTimeout> | null = null

     // 脏状态确认
     const pendingDismiss = ref(false)
   })
   ```

2. **互斥守卫**：每个 action 开头检查 `phase`：
   - `fetchConfig`: `if (phase.value !== 'idle') return`
   - `saveConfig`: `if (phase.value !== 'idle') return`

3. **`fetchConfig()`**：GET `/config`，设置 `original` = `draft` = 响应

4. **`saveConfig()`**：完整保存流程（见步骤 5 的详细设计）

5. **`resetToSaved()`**：`draft = structuredClone(original)`

6. **`requestDismiss()`**：设置 `pendingDismiss = true`（组件监听并显示确认对话框）
7. **`forceDismiss()`**：`panelOpen = false`，`draft = null`，`pendingDismiss = false`

8. **`isDirty`**：`computed(() => !deepEqual(original.value, draft.value))`

9. **不暴露 `canReset`**（与 `isDirty` 冗余）

**交付物**：
- `src/stores/config.ts`

**验收标准**：
- [ ] Store 可被 Vue DevTools 检查，所有状态字段可见
- [ ] `fetchConfig()` 在 `phase === 'saving'` 时被调用 → 立即返回，不执行
- [ ] `saveConfig()` 在 `phase === 'loading'` 时被调用 → 立即返回，不执行
- [ ] `targetUrl` 在 store 中，不作为参数传递
- [ ] `requestDismiss()` 设置 `pendingDismiss`，不直接关闭面板
- [ ] `forceDismiss()` 清除 `draft` 并关闭面板
- [ ] `isDirty` 正确反映 `original` vs `draft` 的差异
- [ ] `timeoutId` 在 store 作用域中，组件卸载不销毁它

---

### 步骤 2：抽屉壳 + 主题变量 + 标题栏入口

**范围**：创建抽屉外壳组件，添加 CSS 变量，修改 App.vue 添加齿轮按钮。

**前置条件**：步骤 1 完成。

**实现要点**：

1. **App.vue 修改**：
   - 在 `titlebar-left` 和 `titlebar-buttons` 之间插入 `<div class="titlebar-actions">`
   - 齿轮图标用 Lucide `Settings`，14px，`--no-drag`
   - 点击调用 `useConfigStore().panelOpen = true`

2. **SettingsDrawer.vue 结构**（一个大文件，像 ConnectionConfig.vue）：
   ```
   <div class="settings-drawer" v-if="store.panelOpen">
     <div class="drawer-header">         <!-- 标题 + 关闭按钮 -->
     <div class="drawer-instance-bar">   <!-- 实例选择器（步骤 3） -->
     <div class="drawer-restart-banner"> <!-- 重启横幅（步骤 5） -->
     <div class="drawer-body">
       <nav class="drawer-nav">          <!-- 侧栏导航 -->
       <div class="drawer-content">     <!-- Section 内容 -->
     </div>
     <div class="drawer-footer">         <!-- 保存栏 -->
   </div>
   ```

3. **抽屉动画**：`transform: translateX(100%)` → `translateX(0)`，`transition: transform var(--duration-slow) var(--ease-out-quint)`

4. **CSS 变量映射表**（必须全部用变量，不用裸 hex）：

   | 元素 | Token | 值 |
   |------|-------|-----|
   | 抽屉表面 | `var(--bg-panel)` | `#1f2127` |
   | 抽屉标题栏 | `var(--bg-app)` | `#0d1016` |
   | Section 内容区 | `var(--bg-editor)` | `#0d1016` |
   | 侧栏导航行 hover | `var(--bg-hover)` | `#2d2f34` |
   | 侧栏导航选中 | `var(--bg-selected)` + `inset 2px 0 var(--text-accent)` 左侧指示线 | `#313337` |
   | 表单标签 | uppercase, 11px, weight 500, letter-spacing 0.06em, `var(--text-muted)` | |
   | 输入框背景 | `var(--bg-element)` | `#2d2f34` |
   | 输入框聚焦 | `var(--bg-editor)` + `box-shadow: 0 0 0 1px var(--border-focused)` | |
   | 保存按钮 | `var(--text-accent)` 背景, `var(--bg-editor)` 文字 | |
   | 破坏性操作 | `var(--error)` | `#d95757` |
   | 代码块 | `var(--code-block-bg)` | `#0d1016` |
   | 字体 | 标签用 `var(--font-ui)`，代码/JSON 用 `var(--font-mono)` | |

5. **侧栏导航模式**（复用 SessionTree.vue 的 `.session-button` + `::before` 指示线）：
   - 分组标题：chevron + 名称（`.group-header` 模式）
   - 导航行：`role="tab"`, `tabindex="0"`, ArrowUp/Down 导航
   - 选中态：`::before` 2px 宽 `var(--text-accent)` 左侧指示线
   - 脏状态圆点：灰色 `var(--text-placeholder)` = 干净，琥珀脉冲 `var(--warning)` = 脏

6. **关闭按钮**：右上角 `×`，hover `var(--bg-hover)` + `var(--text-primary)`（不用 error 红色 — 关闭抽屉不是破坏性操作）

7. **保存栏**：sticky 在抽屉底部，左侧脏状态指示（"3 个未保存字段" 或 "已是最新"），右侧 `[恢复到最近保存]` ghost 按钮 + `[保存并重启]` accent 按钮。复用 `PromptInput.vue` 的 `.prompt-footer` 布局模式。

**交付物**：
- `src/components/settings/SettingsDrawer.vue`
- `src/App.vue`（修改 — 添加齿轮按钮 + `<SettingsDrawer />`）

**验收标准**：
- [ ] 标题栏显示齿轮图标，位于 `titlebar-context` 和窗口控制按钮之间
- [ ] 点击齿轮 → 抽屉从右侧滑入（有动画）
- [ ] 抽屉宽度 420-520px，不遮挡左侧 sidebar
- [ ] 关闭按钮 `×` 点击后抽屉滑出
- [ ] 所有颜色使用 CSS 变量，无裸 hex
- [ ] 侧栏导航行的选中态有左侧 accent 指示线
- [ ] 保存栏 sticky 在底部，显示脏状态指示
- [ ] Escape 键关闭抽屉（此时无脏状态，步骤 4 处理脏状态）
- [ ] 窗口宽度 < 900px 时抽屉全宽

---

### 步骤 3：实例选择器 + 配置加载

**范围**：在抽屉顶部添加实例选择器，实现配置获取流程。

**前置条件**：步骤 2 完成。

**实现要点**：

1. **实例选择器**位于抽屉标题栏下方：
   - 复用 `ConnectionConfig.vue` 的 `.instance-row` 模式（端口 + 状态点 + 项目目录名）
   - 紧凑版：单行 `<select>` 或自定义下拉
   - 数据源：`useSessionStore().instances`

2. **打开抽屉时**：
   - 如果有多个实例，默认选中当前活跃实例（`store.activeTabId` 对应的实例）
   - 设置 `configStore.targetUrl = selectedInstance.url`
   - 调用 `configStore.fetchConfig()`

3. **切换实例时**：
   - 如果 `configStore.isDirty` → 触发 `requestDismiss` 流程（步骤 4 的确认对话框）
   - 确认后切换 `targetUrl`，重新 `fetchConfig()`

4. **实例断开时**：
   - 如果选中实例的 `connected === false`，在实例选择器旁显示断开指示
   - 保存流程中，断开是预期信号（步骤 5）

5. **加载态**：
   - `phase === 'loading'` 时显示骨架/空状态
   - 复用 `SubagentDetail.vue` 的 `.empty-state` 模式（`Loader2` 旋转 + "正在获取 OpenCode 配置..."）

**交付物**：
- `src/components/settings/SettingsDrawer.vue`（修改 — 添加实例选择器）

**验收标准**：
- [ ] 有多个实例时，实例选择器显示所有已连接实例
- [ ] 选择不同实例 → 加载该实例的配置
- [ ] 切换实例时有脏状态 → 显示确认对话框
- [ ] 加载中显示加载指示器
- [ ] 加载失败显示错误信息（inline，非 toast）
- [ ] 实例断开时选择器有视觉指示

---

### 步骤 4：General + Models Section

**范围**：实现两个基础 Section 的表单渲染。

**前置条件**：步骤 3 完成。

**实现要点**：

1. **ModelsSection**（内联在 SettingsDrawer.vue 中）：
   - `model` 下拉框：数据源 `GET /provider`，格式化为 `provider_id/model_id`
   - `small_model` 下拉框：同上
    - `default_agent` 下拉框：数据源 `GET /agent`（不是 `/provider`）
   - 下拉框只允许选择，不允许自由输入（但提供 "手动输入" 链接展开 Raw JSON 回退）
   - 空列表时显示警告

2. **GeneralSection**（内联）：
   - `username`：`<input type="text">`
   - `logLevel`：`<select>`，选项 `DEBUG` / `INFO` / `WARN` / `ERROR`（大写）
   - `shell`：`<input type="text">`

3. **表单标签规范**：
   - 每个 `<label>`：uppercase, 11px, weight 500, letter-spacing 0.06em, `var(--text-muted)`
   - label 与 input 间距 `var(--space-6)`
   - 表单行垂直堆叠，section 内边距 `var(--space-12)` + `var(--space-16)`

4. **输入框样式**（复用 `ConnectionConfig.vue` 的 `.manual-input` 模式）：
   - 背景 `var(--bg-element)`
   - 聚焦：背景切换 `var(--bg-editor)` + `box-shadow: 0 0 0 1px var(--border-focused)`
   - 字体：文本输入用 `var(--font-ui)`，路径/命令输入用 `var(--font-mono)`

5. **脏状态触发**：用户修改任何字段 → `draft` 更新 → `isDirty` 变 true → 侧栏导航对应 Section 显示脏状态圆点

6. **TagInput.vue**（唯一独立提取的组件，步骤 5 的 `enabled_providers` 也需要）：
   - `<input>` + 标签列表显示
   - Enter 添加，Backspace 删除最后一个
   - 每个标签有 `×` 删除按钮
   - 标签背景 `var(--bg-element)`, 文字 `var(--text-primary)`

**交付物**：
- `src/components/settings/SettingsDrawer.vue`（修改 — 添加 Models 和 General section 内容）
- `src/components/settings/TagInput.vue`（新建）

**验收标准**：
- [ ] `model` 下拉框从 `/provider` 正确加载模型列表
- [ ] `small_model` 下拉框同上
- [ ] `default_agent` 下拉框显示 agent 列表
- [ ] `logLevel` 下拉选项为大写 `DEBUG` / `INFO` / `WARN` / `ERROR`
- [ ] 修改任何字段 → 对应 Section 导航行显示琥珀色脏状态圆点
- [ ] 保存栏显示 "N 个未保存字段"
- [ ] Reset 按钮恢复 `draft = original`
- [ ] 所有标签使用 `var(--text-muted)` + uppercase 规范
- [ ] TagInput 可添加/删除标签

---

### 步骤 5：保存与重启流程

**范围**：实现完整的 PATCH → 重启 → 检测 → 确认流程。

**前置条件**：步骤 4 完成。

**实现要点**：

1. **`saveConfig()` 完整流程**（在 store 中，不在组件中）：
   ```
   phase = 'saving'
   ↓
   1. GET /config（获取新鲜树 freshTree）
      失败 → toast "无法获取最新配置", phase = 'idle', return false
   ↓
   2. 计算用户差异：userDiff = computeDiff(original, draft)
      （仅叶子路径，不是整个 draft 树）
   ↓
   3. 合并：merged = applyDiff(freshTree, userDiff)
      契约：mergeArrays = false（数组替换不拼接）
   ↓
   4. AJV 验证 merged — 如果验证失败，显示错误，phase = 'idle', return false
   ↓
   5. PATCH /config（merged）
      HTTP 失败 → toast "保存失败：{status}", phase = 'idle', return false
   ↓
    6. phase = 'restarting', restartStartTime = Date.now()
       启动超时计时器（见下文）
       分阶段检测（health 轮询优先，scan 仅在必要时触发）：
       (a) watch SSE connected 状态（同 URL）
       (b) 轮询 GET /global/health（每 2s，单次 HTTP 请求，轻量）
       (c) 如果 health 轮询 15 秒无响应（端口可能变更）→ 触发一次 useInstanceScanner().scan()
           scan() 成本高（25端口×800ms，受 scanning mutex 限制），仅作为降级手段
    ↓
    7. 任一检测成功 → 进入验证阶段
   ↓
   8. GET /config 确认写入
      失败 → toast "保存成功但确认失败，请手动验证", phase = 'idle', return true
      成功 → original = freshTree, phase = 'idle', return true
   ```

2. **端口变更检测**：
   - `useInstanceScanner().scan()` 返回的实例中，匹配 `projectDir` 的实例在任意 URL 上线即视为成功
    - 如果新 URL ≠ `targetUrl`，更新 `targetUrl`，触发 `useEventStream().connectAll([...currentUrls.filter(u => u !== oldUrl), newUrl])`（**不能只传 `[newUrl]`，否则会断开其他实例**）

3. **超时设计**（修正后）：
   - **单一 90 秒计时器**，从 PATCH 完成时开始
   - 每次任一检测路有状态变化（SSE 连接状态变化、health 轮询返回变化）时**重置计时器**
    - 即"90 秒无进展超时"而非"90 秒总超时"
    - **绝对上限**：5 分钟（防止抖动实例无限重置计时器）
   - 超时后 `phase = 'timeout'`，保留 `original` 快照

4. **已断开边界情况**：
   - PATCH 时如果 SSE 已经 `connected === false`，跳过 disconnect 等待
   - 直接进入 health 轮询 + scan 检测

5. **重启横幅**（在抽屉标题栏下方，非 toast）：

   | 状态 | 横幅表面 | 左侧线 | 图标 | 文本 |
   |------|----------|--------|------|------|
   | confirming | `var(--bg-elevated)` | 默认 | `Loader2` 旋转 | "保存将重启 OpenCode。运行中的会话会重连。[取消] [保存]" |
   | restarting | `var(--bg-elevated)` | `var(--text-accent)` | `Loader2` + 实时计时 | "重启中 4.2s…"（动画计数器） |
   | 完成 | 同上 | `var(--success)` | `CheckCircle2` | "已保存 · OpenCode 已重启 · 12.1s" + [×] |
   | 超时 | 同上 | `var(--error)` | `XCircle` | "重启超时（90 秒无进展）。[重试] [恢复]" |

6. **实时计时器**：用 `SubagentDetail.vue` 的 `relativeAge` 模式（lines 625-640），每 100ms 更新

7. **超时后的操作**：
   - "重试"：重新从 `saveConfig()` 步骤 1 开始（保留当前 `draft`）
   - "恢复"：`draft = structuredClone(original)`，`phase = 'idle'`

8. **打开面板时重启进行中**：
   - 如果 `phase === 'restarting'` 或 `'timeout'` 时打开面板，显示只读模式
   - Save 按钮 disabled，显示横幅当前状态
   - 重启完成后恢复正常

**交付物**：
- `src/stores/config.ts`（修改 — 实现 `saveConfig()` 完整流程）
- `src/components/settings/RestartOverlay.vue`（新建 — 内联横幅组件）

**验收标准**：
- [ ] 点击 "保存并重启" → 横幅显示 confirming 状态
- [ ] 确认后 → GET → merge → PATCH → 横幅切换到 restarting 状态
- [ ] 横幅显示实时计时器（"重启中 4.2s…"）
- [ ] SSE 重连成功 → 横幅切换到完成状态（绿色左侧线）
- [ ] 实例在不同端口重启 → scan 检测到 → 视为成功 → `targetUrl` 更新
- [ ] 90 秒无进展 → 横幅切换到超时状态（红色左侧线）
- [ ] 超时后点击 "重试" → 重新执行保存流程
- [ ] 超时后点击 "恢复" → draft 恢复到最后保存版本
- [ ] PATCH 时 SSE 已断开 → 不挂起，直接进入检测阶段
- [ ] 关闭面板再打开 → 如果重启进行中，显示只读模式 + 横幅
- [ ] `fetchConfig` 在 `phase !== 'idle'` 时被调用 → 立即返回
- [ ] PATCH 失败（HTTP 非 200）→ toast 错误信息，phase 回到 idle

---

### 步骤 6：脏状态守卫 — 关闭确认对话框

**范围**：实现关闭抽屉时的未保存更改确认对话框。

**前置条件**：步骤 5 完成。

**实现要点**：

1. **这是代码库中第二个确认对话框**（第一个是步骤 5 的重启确认横幅），需要从零设计。

2. **触发场景**：
   - 点击抽屉关闭按钮 `×`
   - 按 Escape
   - 切换实例（步骤 3）
   - 都调用 `store.requestDismiss()` → 设置 `pendingDismiss = true`

3. **对话框设计**（内联在 SettingsDrawer.vue 中，非全屏）：
   - 居中在抽屉区域内（不是全窗口）
   - 表面 `var(--bg-app)`（比抽屉的 `var(--bg-panel)` 深一层）
   - 边框 `var(--border)` + 内阴影 `0 1px 0 rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.4)`
   - 标题：12px uppercase letterspaced `var(--text-muted)` — "未保存的更改"
   - 正文：`var(--text-primary)` 14px — "有 N 个未保存的更改。关闭后将丢失。"
   - 按钮右对齐，三选一：
     - "取消"（ghost，`var(--text-muted)`）→ `pendingDismiss = false`，返回编辑
     - "放弃"（outline，`var(--bg-element)`）→ `forceDismiss()`
      - "保存并重启"（filled，`var(--text-accent)`）→ `saveConfig()` + 成功后 `forceDismiss()`

4. **交互规则**：
   - Escape 关闭对话框（等同于 "取消"）
   - 点击对话框外部**不关闭**（与 PromptInput 的下拉菜单不同 — 丢失更改的代价不对称）

5. **无脏状态时**：
   - `requestDismiss()` 直接调用 `forceDismiss()`，不显示对话框

**交付物**：
- `src/components/settings/SettingsDrawer.vue`（修改 — 添加确认对话框）

**验收标准**：
- [ ] 有未保存更改时点击 `×` → 显示确认对话框
- [ ] 有未保存更改时按 Escape → 显示确认对话框
- [ ] 无未保存更改时点击 `×` → 直接关闭
- [ ] 对话框有三个按钮：取消 / 放弃 / 保存并重启
- [ ] "取消" → 对话框消失，返回编辑
- [ ] "放弃" → 抽屉关闭，draft 丢失
- [ ] "保存并重启" → 执行保存流程，成功后关闭
- [ ] 点击对话框外部 → 不关闭
- [ ] Escape 在对话框中 → 等同于 "取消"
- [ ] 对话框表面用 `var(--bg-app)`，比抽屉深一层

---

### 步骤 7：Providers Section — 开关 + 认证状态

**范围**：实现 `enabled_providers` / `disabled_providers` 的 toggle 列表和认证状态显示。

**前置条件**：步骤 6 完成。

**实现要点**：

1. **数据源**：`GET /provider` 返回 `{ all: Provider[], default: {...}, connected: string[] }`

2. **渲染**：
   - 每个 provider 一行：名称 + 模型数量 + toggle 开关 + 认证状态点
   - 认证状态：`connected` 数组中包含 → 绿色点 `var(--success)`；否则 → 灰色点 `var(--text-placeholder)`
   - toggle 开关：在 `enabled_providers` 中 → 开；在 `disabled_providers` 中 → 关；都不在 → 默认（使用 provider 的 enabled 状态）

3. **认证详情**：`GET /provider/auth` 返回每个 provider 的认证方法列表

4. **API Key 设置**（v1.0 错误地认为不可设置）：
    - 如果 provider 需要 API key 且未认证，显示 "设置 API Key" 按钮
    - 点击后展开一个 `<input type="password">` + "保存" 按钮（API key 不应明文显示）
   - 调用 `PUT /auth/:id`（body 匹配 provider schema）
   - 成功后刷新认证状态

5. **认证状态点**用 `.status-pill` 模式（复用 `ConnectionConfig.vue:286-321`）

**交付物**：
- `src/components/settings/SettingsDrawer.vue`（修改 — 添加 Providers section 内容）

**验收标准**：
- [ ] provider 列表从 `/provider` 正确加载
- [ ] 每个 provider 显示名称 + 模型数量 + toggle + 认证状态
- [ ] toggle 切换 → `enabled_providers` / `disabled_providers` 更新 → 脏状态触发
- [ ] 认证状态点颜色正确（绿色=已认证，灰色=未认证）
- [ ] "设置 API Key" 按钮展开输入框
- [ ] `PUT /auth/:id` 成功后认证状态刷新
- [ ] `GET /provider/auth` 数据正确显示

---

### 步骤 8：Provider 详细配置

**范围**：实现 `provider` map 的详细配置（每 provider 一个配置面板）。

**前置条件**：步骤 7 完成。

**实现要点**：

1. **每行一个 provider**，点击展开配置面板（复用 `SubagentDetail.vue` 的 `.tool-card` 折叠模式）

2. **配置面板三标签**（用 `SubagentDetail.vue:734-759` 的 tab 模式）：
   - **Basic**：`options.baseURL`, `options.timeout`
   - **Advanced**：`options.enterpriseUrl`, `options.setCacheKey`, `options.headerTimeout`, `options.chunkTimeout`, `whitelist`, `blacklist`, `id`, `name`
   - **Raw JSON**：完整 provider 配置的 JSON 编辑器

3. **`options.apiKey`**：显示但不允许编辑（提示 "通过环境变量或 PUT /auth/:id 设置"）

4. **`whitelist` / `blacklist`**：用 `TagInput.vue`

5. **`options.timeout`**：`number | false` — 输入框 + "禁用" checkbox

6. **只读模型列表**：从 `/provider` 获取，显示为 chip 列表

7. **provider 的 `models` map**：复杂结构，P2 阶段用 Raw JSON 回退

**交付物**：
- `src/components/settings/SettingsDrawer.vue`（修改 — 添加 provider 配置面板）

**验收标准**：
- [ ] provider 列表每行可点击展开配置面板
- [ ] Basic / Advanced / Raw JSON 三标签切换正常
- [ ] Basic 标签显示 `baseURL` 和 `timeout`
- [ ] Advanced 标签显示所有 `options` 字段
- [ ] `options.apiKey` 只读 + 提示信息
- [ ] `whitelist` / `blacklist` 用 TagInput 渲染
- [ ] `timeout` 支持 `number | false`（输入框 + 禁用 checkbox）
- [ ] 只读模型列表从 `/provider` 获取
- [ ] Raw JSON 标签显示完整 provider JSON
- [ ] 修改任何字段 → 脏状态触发

---

### 步骤 9：Agents Section

**范围**：实现 `agent` map 的详细配置。

**前置条件**：步骤 8 完成。

**实现要点**：

1. **字段映射**（对照 schema，修正 v1.0 错误）：

   | Schema 字段 | 类型 | 渲染方式 |
   |-------------|------|----------|
   | `model` | string | 下拉框（同步骤 4 的 model 选择器） |
   | `prompt` | string | textarea（等宽字体 `var(--font-mono)`） |
   | `mode` | `'subagent' \| 'primary' \| 'all'` | select（不是 `'auto' \| 'manual'`） |
   | `steps` | number | number input |
   | `disable` | boolean | toggle（**不是 `disabled`**） |
   | `color` | `anyOf[^#hex, enum[primary\|secondary\|accent\|success\|warning\|error\|info]]` | 文本输入 + 预设色板 |
   | `description` | string | text input |
   | `hidden` | boolean | toggle |
   | `variant` | string | text input（可选） |
   | `temperature` | number | number input |
   | `top_p` | number | number input |

2. **添加/删除 agent**：底部 "+ 添加 Agent" 按钮，输入 agent 名称

3. **color 选择器**：不用浏览器默认 `<input type="color">`。用文本输入 + 6-8 预设色板 swatches。agent 行旁显示当前颜色 chip（复用 `.agent-chip` 模式 `SubagentDetail.vue:763-767`）

**交付物**：
- `src/components/settings/SettingsDrawer.vue`（修改 — 添加 Agents section）

**验收标准**：
- [ ] agent map 中每个 agent 正确渲染为配置面板
- [ ] 可添加/删除 agent
- [ ] `mode` 下拉选项为 `'subagent' | 'primary' | 'all'`（不是 auto/manual）
- [ ] `disable` 字段正确映射（不是 `disabled`）
- [ ] `color` 支持 hex 和主题枚举名
- [ ] `prompt` 用等宽字体
- [ ] model 下拉框复用步骤 4 的数据源
- [ ] 修改任何字段 → 脏状态触发

---

### 步骤 10：MCP Section

**范围**：实现 `mcp` map 的详细配置。

**前置条件**：步骤 9 完成。

**实现要点**：

1. **MCPConfig 是鉴别联合**（修正 v1.0 的统一接口错误）：

   ```typescript
   type MCPConfig =
     | McpLocalConfig    // { command: string[], environment?: Record<string,string>, cwd?: string, enabled?: boolean, timeout?: number }
     | McpRemoteConfig   // { url: string, headers?: Record<string,string>, oauth?: ..., enabled?: boolean, timeout?: number }
     | { enabled: boolean }  // 内置 MCP 的启用/禁用
   ```

2. **`McpLocalConfig` 关键修正**：
   - `environment`（**不是 `env`**）
   - `command` 是完整 argv 数组（包括二进制和参数），**没有单独的 `args` 字段**
   - 有 `cwd` 字段
   - 例：`command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"]`

3. **类型切换**：local / remote / built-in toggle
   - **切换时必须清除前一分支的字段**，否则 deep merge 会保留脏数据：
     - local → remote：删除 `command`, `environment`, `cwd`；保留 `enabled`, `timeout`
     - remote → local：删除 `url`, `headers`；保留 `enabled`, `timeout`
     - 任意 → built-in：删除所有非 `enabled` 字段
   - 实现：toggle 的 `@change` handler 中，`delete draft.mcp[name].command` 等，再设置新类型字段

4. **Local 表单**：
   - `command` 数组编辑器（每行一个元素，可增删）
   - `environment` key-value 编辑器（复用 KeyValueEditor 或内联）
   - `cwd` 文本输入
   - `enabled` toggle
   - `timeout` number input

5. **Remote 表单**：
   - `url` 文本输入（URL 格式验证）
   - `headers` key-value 编辑器
   - `enabled` toggle
   - `timeout` number input

6. **验证**：
   - local: `command` 数组非空，至少 1 个元素
   - remote: `url` 必须是有效 `https?://` URL

7. **`instructions`** 字段：文件 glob 标签输入（用 `TagInput.vue`）

**交付物**：
- `src/components/settings/SettingsDrawer.vue`（修改 — 添加 MCP section）
- `src/components/settings/KeyValueEditor.vue`（新建 — `Record<string, string>` 通用编辑器，environment/headers 共用）

**验收标准**：
- [ ] MCP 列表每行可展开配置面板
- [ ] 可添加/删除 MCP server
- [ ] 类型切换（local/remote）改变子表单
- [ ] Local 表单用 `environment`（不是 `env`）
- [ ] Local 表单的 `command` 是数组编辑器（不是 string + args 分开）
- [ ] Local 表单有 `cwd` 字段
- [ ] Local 表单无 `args` 字段
- [ ] Remote 表单有 `url`, `headers`, `enabled`, `timeout`
- [ ] local `command` 数组非空验证
- [ ] remote `url` 格式验证
- [ ] `instructions` 标签输入正常工作
- [ ] KeyValueEditor 增删 key-value 对正确
- [ ] 修改任何字段 → 脏状态触发

---

### 步骤 11：高级配置 + JSON 编辑器 + 已弃用字段

**范围**：实现剩余标量 Section、Raw JSON 编辑器、已弃用字段处理。

**前置条件**：步骤 10 完成。

**实现要点**：

1. **标量 Section**（内联渲染，不每个建独立文件）：
   - `compaction`：标量字段逐一渲染
   - `tool_output`：标量字段逐一渲染
   - `attachment`：标量字段 + options blob
   - `server`：标量字段逐一渲染
   - `experimental`：标量字段 + policies/options JSON
   - `snapshot`：**boolean** toggle（不是 object）
   - `share`：**enum select** `'manual' | 'auto' | 'disabled'`（不是 object）
   - `autoupdate`：**toggle + 'notify' 选项** `anyOf[boolean, 'notify']`
    - `command`：**Map 编辑器**（不是 string）。值是 `{template, description?, agent?, model?, variant?, subtask?}` 对象 — **不能复用 KeyValueEditor**（后者仅支持 `Record<string, string>`），用 Raw JSON 回退或专用编辑器
   - `skills`, `references`, `watcher`, `enterprise`, `tools`：标量字段

2. **LSP / Formatter**：`anyOf(boolean, object)` 三段开关
   - `Default` = 字段不存在（使用 OpenCode 内置）
   - `Disabled` = `false`
   - `Custom` = `{}` 展开子表单

3. **Permission**：JSON 编辑器 + AJV 验证（递归结构，不手写表单）
   - `permission` 是单个联合值（不是 Map）
   - 可以是 `"ask" | "allow" | "deny"` 或对象 `{ bash?: "allow" | { "rm": "deny", "*": "ask" }, ... }`
   - **UI 优化**：顶层用 radio 选择 "全部允许" / "全部询问" / "全部拒绝" / "自定义"，前三个选项直接设置字符串值，"自定义" 展开 JSON 编辑器

4. **Plugin**：可重复行 `[name, config]`（第二元素是 object，不是 string）

5. **JsonEditor.vue**（简单 textarea，无语法高亮）：
   - `<textarea>` + `var(--font-mono)`, `font-size: var(--font-size-code)` (13px)
   - `line-height: var(--md-line-height)` (1.75)
   - 背景 `var(--code-block-bg)` (`#0d1016`)
   - 边框 `var(--border)`, 聚焦 `var(--border-focused)`
   - AJV 验证在 `@blur` 时运行
   - 错误显示在下方，`var(--error)` 色 + `var(--font-mono)`
   - Tab 插入 2 空格（`@keydown.tab.prevent`）
   - **无语法高亮**（项目刻意避免，避免延迟）

6. **RawJsonAccordion.vue** — 显示未在前端覆盖的字段：
   - 每个 Section 声明自己覆盖的 JSON 路径（`SectionCoveredPaths` 注册表）
   - 手风琴计算 `Object.keys(config).filter(k => !covered.has(k))` 递归到嵌套对象
   - 防止与表单字段重复
   - 复用 `SubagentDetail.vue:933-991` 的 `.tool-card__header` 折叠模式

7. **已弃用字段处理**：
   - `mode`, `reference`, `layout`, `autoshare` — 在专门的 "已弃用" Section 中显示
   - 用删除线文本 + `AlertTriangle` 图标 + "将在未来版本移除" 提示
   - **保留在 JSON 中**用于 round-trip（deep merge 会自动保留）
   - 类型用 `unknown`（不是 `never`）

8. **AJV 验证**：在所有阶段的 `saveConfig()` 中运行（不只是 P4）。验证 `merged` 配置，验证失败则阻止 PATCH。

**交付物**：
- `src/components/settings/SettingsDrawer.vue`（修改 — 添加所有高级 section）
- `src/components/settings/JsonEditor.vue`（新建）
- `src/components/settings/RawJsonAccordion.vue`（新建）
- `src/components/settings/TriStateControl.vue`（新建 — Default/Disabled/Custom 三段开关）

**验收标准**：
- [ ] `snapshot` 渲染为 boolean toggle（不是 object 字段）
- [ ] `share` 渲染为 enum select（`manual` / `auto` / `disabled`）
- [ ] `autoupdate` 支持 boolean 和 `'notify'` 两种值
- [ ] `command` 渲染为 Map 编辑器（不是 string 输入框）
- [ ] LSP / Formatter 三段开关正确切换
- [ ] Permission 用 JSON 编辑器 + AJV 验证
- [ ] Plugin 行的第二元素是 object（不是 string）
- [ ] JsonEditor 无语法高亮，用等宽字体
- [ ] JsonEditor Tab 键插入 2 空格
- [ ] AJV 验证错误显示在 textarea 下方
- [ ] RawJsonAccordion 显示未被表单覆盖的字段
- [ ] RawJsonAccordion 不与表单字段重复
- [ ] 已弃用字段在 "已弃用" Section 中显示，带删除线 + 警告图标
- [ ] 已弃用字段在保存时保留（deep merge 不删除）
- [ ] AJV 验证在 `saveConfig()` 中运行（所有阶段）

---

## 4. 主题变量映射表

所有设置面板 UI 必须使用以下 CSS 变量，禁止裸 hex：

| 元素 | Token | 值 |
|------|-------|-----|
| 抽屉表面 | `var(--bg-panel)` | `#1f2127` |
| 抽屉标题栏 | `var(--bg-app)` | `#0d1016` |
| Section 内容区 | `var(--bg-editor)` | `#0d1016` |
| 侧栏导航行 hover | `var(--bg-hover)` | `#2d2f34` |
| 侧栏导航选中 | `var(--bg-selected)` | `#313337` |
| 侧栏选中指示线 | `var(--text-accent)` | `#e6b450` |
| 表单标签 | `var(--text-muted)` | `#8a8986` |
| 输入框背景 | `var(--bg-element)` | `#2d2f34` |
| 输入框聚焦背景 | `var(--bg-editor)` | `#0d1016` |
| 输入框聚焦边框 | `var(--border-focused)` | `#e6b450` |
| 保存按钮背景 | `var(--text-accent)` | `#e6b450` |
| 保存按钮文字 | `var(--bg-editor)` | `#0d1016` |
| 破坏性操作 | `var(--error)` | `#d95757` |
| 成功指示 | `var(--success)` | `#70bf56` |
| 警告/脏状态 | `var(--warning)` | `#ffb454` |
| 代码块背景 | `var(--code-block-bg)` | `#0d1016` |
| 代码块边框 | `var(--code-block-border)` | `#2d2f34` |
| 边框 | `var(--border)` | `#2d2f34` |
| 字体 UI | `var(--font-ui)` | IBM Plex Sans |
| 字体代码 | `var(--font-mono)` | Lilex |
| 字体大小 UI | `var(--font-size-ui)` | 14px |
| 字体大小代码 | `var(--font-size-code)` | 13px |
| 字体大小小 | `var(--font-size-small)` | 12px |

**表单标签规范**：uppercase, 11px, weight 500, letter-spacing 0.06em, `var(--text-muted)`

**侧栏导航选中态**：`::before` 2px 宽 `var(--text-accent)` 左侧指示线（复用 `SessionTree.vue:349-374` 的 `.session-button::before` 模式）

**脏状态圆点**：灰色 `var(--text-placeholder)` = 干净，琥珀脉冲 `var(--warning)` = 脏，蓝色 `var(--info)` = 保存中

---

## 5. Deep Merge 实现策略

```typescript
import { deepmerge } from '@fastify/deepmerge'

interface DiffPath {
  path: string[]        // e.g. ['provider', 'openai', 'options', 'baseURL']
  oldValue: unknown     // original 中的值
  newValue: unknown     // draft 中的值
}

// 契约：仅收集 draft 与 original 不同的叶子路径
// 不返回整个 draft 树
function computeDiff(original: object, draft: object): DiffPath[] {
  // 递归遍历，收集所有值不同的 leaf 路径
  // 数组视为 leaf（整体比较，不逐元素 diff）
}

// 契约：仅覆盖 userDiff 中的路径，其余继承 fresh
function applyDiff(fresh: object, diffs: DiffPath[]): object {
  const userChanges = buildNestedObject(diffs)
  return deepmerge(fresh, userChanges, {
    mergeArrays: false  // 数组替换，不拼接
  })
}
```

**不变量测试**：
```
merge(fresh, diff(original, draft))
  where fresh === original
  must produce draft
```

**数组策略**：所有数组字段都是整体替换（`mergeArrays: false`）。这对 `enabled_providers`, `disabled_providers`, `instructions`, `command` (MCP argv), `plugin` 都是正确的 — 用户编辑后应该完全替换，不拼接旧值。

---

## 6. 风险防护措施

### 风险 A：用户禁用了唯一有认证的 Provider

**缓解**：降级为警告（不是硬阻止）。用户可能正在设置中。显示 "无已认证的启用 Provider，确定保存？" + "保存" / "取消"。

### 风险 B：无效 model 字符串

**缓解**：`model` / `small_model` 优先用下拉框。但如果用户的模型不在列表中，提供 "手动输入" 链接展开文本输入。schema 允许任意字符串。

### 风险 C：畸形 MCP/LSP 配置导致启动失败

**缓解**：客户端验证（`command` 非空、`url` 格式正确），错误标记红色边框 + 消息，禁止提交有验证错误的表单。

### 风险 D：PATCH 覆盖并发编辑（TOCTOU）

**场景**：GET 最新配置与 PATCH 之间，其他写入者修改了配置。

**缓解**：
1. re-GET + deep merge（仅覆盖用户修改的叶子路径）
2. 文档中明确承认 TOCTOU 窗口存在
3. PATCH 前可做第二次 GET，如果与第一次不同则重新 merge（缩小窗口到毫秒级）
4. 长期向上游提议 ETag/version 支持

> **修正说明**：v1.0 文档认为 PATCH 会全量替换并静默删除字段。实际上服务器做 `mergeDeep(existing, incoming)`，缺失字段保留磁盘值。但 TOCTOU 窗口仍然存在。

### 风险 E：实例重启后不恢复

**场景**：PATCH 后进程退出但 supervisor 未启动新实例，或新实例在不同端口启动。

**缓解**：
- 90 秒无进展超时（不是 30 秒总超时 — SSE 退避序列 1+2+4+8+16=31s 已超 30s）
- 三路检测：SSE 重连 + `GET /global/health` 轮询 + `useInstanceScanner().scan()`
- 端口变更检测：scan 发现匹配 `projectDir` 的新 URL → 视为成功
- 超时后保留 `original`，提供 "重试" 和 "恢复"

### 风险 F：未保存更改时关闭面板

**缓解**：`requestDismiss()` → 确认对话框（步骤 6 详细设计）。三选一：取消 / 放弃 / 保存并重启。

### 风险 G：fetchConfig ↔ saveConfig 竞态

**缓解**：单一 `phase` 枚举互斥。`phase !== 'idle'` 时所有操作被拒绝。

### 风险 H：重启期间打开面板

**缓解**：`phase === 'restarting'` 或 `'timeout'` 时打开面板 → 只读模式，Save 按钮 disabled，显示横幅当前状态。

---

## 7. 完整文件清单（按步骤分组）

| 步骤 | 新建文件 | 修改文件 |
|------|----------|----------|
| 0 | `docs/opencode-config.schema.json`, `src/types/opencode-config.ts` | `package.json` |
| 1 | `src/stores/config.ts` | — |
| 2 | `src/components/settings/SettingsDrawer.vue` | `src/App.vue` |
| 3 | — | `SettingsDrawer.vue` |
| 4 | `src/components/settings/TagInput.vue` | `SettingsDrawer.vue` |
| 5 | `src/components/settings/RestartOverlay.vue` | `src/stores/config.ts`, `SettingsDrawer.vue` |
| 6 | — | `SettingsDrawer.vue` |
| 7 | — | `SettingsDrawer.vue` |
| 8 | — | `SettingsDrawer.vue` |
| 9 | — | `SettingsDrawer.vue` |
| 10 | `src/components/settings/KeyValueEditor.vue` | `SettingsDrawer.vue` |
| 11 | `src/components/settings/JsonEditor.vue`, `src/components/settings/RawJsonAccordion.vue`, `src/components/settings/TriStateControl.vue` | `SettingsDrawer.vue` |

**总计**：新建 9 个文件，修改 3 个文件（`App.vue`, `package.json`, `SettingsDrawer.vue` 逐步迭代）。

> **与 v1.0 对比**：v1.0 计划 44 个新建文件。修订版降至 9 个，通过将 Section 内容内联到 `SettingsDrawer.vue`（像 `ConnectionConfig.vue` 那样一个大文件带 scoped styles）。

---

## 8. 响应式断点

| 窗口宽度 | 抽屉行为 |
|----------|----------|
| ≥ 1280px | 抽屉 420-520px，主内容面板仍可阅读 |
| 900-1279px | 抽屉成为焦点，主内容面板折叠到抽屉后方 |
| < 900px | 抽屉全宽，左侧栏折叠为图标条 |
| < 700px | 抽屉占满窗口，侧栏隐藏 |

抽屉宽度用 CSS：`width: min(520px, 100vw)`，在 `< 900px` 时 `width: 100vw`。

---

## 9. 键盘快捷键

| 快捷键 | 行为 |
|--------|------|
| `Ctrl+,` | 切换设置抽屉（打开时再按关闭，有脏状态时走确认对话框） |
| `Escape` | 关闭抽屉（有脏状态时走确认对话框） |
| `Ctrl+Enter` | 从任意输入字段触发保存 |
| ArrowUp/Down | 在侧栏导航中移动 |
| ArrowRight/Space | 选中侧栏导航项 |

> 这些是代码库中第一批键盘快捷键。实现放在 `SettingsDrawer.vue` 的 `@keydown` 监听器中，gate 在 `panelOpen` 上。

---

*文档版本：v2.0 — 2026-06-24*
*修订基于：三专家独立审核（@oracle 架构/风险、@designer UI/UX 集成、@librarian API 事实核查）*
*编写依据：OpenCode Config Schema（https://opencode.ai/config.json）、OpenCode Server API 源码（anomalyco/opencode）、Monitor 现有架构（useEventStream.ts / session.ts / theme.css / App.vue）*
