# OpenCode Monitor — 独立 Subagent 监控窗口设计方案

> 状态：设计阶段
> 日期：2026-06-23
> 背景：Zed 扩展 API 不支持自定义 UI；ACP 协议无 subagent 概念；OpenCode HTTP API 已具备全部所需数据通道

## 1. 背景与动机

当前问题：
- OpenCode orchestrator 派生 subagent（librarian、fixer、oracle 等）后，**父 session 无法主动感知 subagent 运行状态**
- Subagent 卡死（LLM 循环、工具挂起）时，OpenCode 和 OMO slim 均无 watchdog 检测，父 session 永久阻塞在 `background.wait()`
- Zed 扩展 API（WASM 沙箱）**不允许绘制自定义 UI 面板**，ACP 协议无 subagent 生命周期事件
- Issue [#11576](https://github.com/sst/opencode/issues/11576)（OpenCode）自动关闭，PR [#12563](https://github.com/sst/opencode/pull/12563) 未合并，subagent filter 仍在 `dev` 分支

解决方案：构建独立监控窗口，直接通过 OpenCode HTTP API 旁路读取 session 数据。

## 2. 验证结论摘要

| 假设 | 验证 | 来源 |
|------|------|------|
| ACP/HTTP 共用同一 session 服务 | ✅ | `packages/server/src/groups/session.ts` |
| ACP 创建的 session 对 HTTP API 可见 | ✅ | `/api/session` 无来源过滤，返回所有 session |
| subagent 是 child Session（非 BackgroundJob） | ✅ | `packages/opencode/src/tool/task.ts:~118` 调 `sessions.create({parentID, ...})` |
| Session 有 `parentID` 字段（大写 ID） | ✅ | `packages/core/src/session/schema.ts:25` |
| subagent 可经 `/api/session` 可见 | ✅ | task tool 创建的 child Session 含 `parentID`，`/api/session` 全量返回 |
| 实时事件推送（SSE） | ✅ | `GET /api/event` — `text/event-stream`，广播全局 EventV2 |
| 事件 type 字面值 `session.created` / `session.updated` / `message.part.updated` | ✅ | `packages/core/src/v1/session.ts:576/583/615` |
| HTTP API 发 prompt，ACP 端（Zed）自动同步 | ✅ | ACP 事件订阅走全局 EventV2 流 |
| Prompt body schema `{parts, messageId, delivery}` | ❌ 错误 | 实际为 `{prompt:{text,files?,agents?}, id?, delivery?: "steer"\|"queue", resume?}` |
| Session 有 `status: running\|completed\|error\|cancelled` | ❌ 错误 | 该枚举是 `BackgroundJob.Status`（`background-job.ts:7`）；Session.Info 无 status 字段 |
| BackgroundJob 经 HTTP 可达 | ❌ 不可达 | `packages/server/src/` 无 background 路由，进程内 in-memory |
| 专用 "subagent 完成" 事件 | ❌ 不存在 | 完成时 task tool 往父 session 注入 synthetic user message |
| Session 级"卡死"检测 | ❌ 未实现 | `packages/core/src/session/runner/llm.ts` TODO |
| HTTP 终止 session 端点 | ❌ 未暴露 | `SessionExecution.interrupt()` 存在（`session/execution.ts:10`）但无 HTTP 路由 |
| Zed 扩展 API 支持自定义面板 | ❌ | WASM 沙箱，零 GPUI 访问 |

## 3. 架构

### 3.1 系统拓扑

```
┌─────────────────────────────────────┐
│  Zed Editor (ACP client)            │
│  - 正常对话，Ctrl+Shift+M 启动监控  │
│  - 自动接收 sessionUpdate 通知      │◄──┐
└─────────────────────────────────────┘   │
                                         │ 全局 EventV2 流
┌─────────────────────────────────────┐   │
│  OpenCode Server (localhost)         │   │
│  GET /api/event (SSE) ──────────────┼───┘
│  GET /api/session                   │
│  GET /api/session/:id/message       │
│  POST /api/session/:id/prompt       │
│  SQLite: sessions + messages        │
└─────────────────────────────────────┘
         ▲ SSE EventSource
         │ fetch API calls
┌────────┴────────────────────────────┐
│  opencode-monitor (Tauri v2 app)    │
│                                     │
│  ┌───────────┐ ┌──────────────────┐ │
│  │ Sessions  │ │ Detail pane      │ │
│  │ tree      │ │ (subagent msgs)  │ │
│  │           │ │                  │ │
│  │ ⚠ STUCK   │ │ [TERMINATE] btn │ │
│  └───────────┘ └──────────────────┘ │
│  ┌─────────────────────────────────┐│
│  │ Input: send prompt to session   ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

### 3.2 技术栈

| 层 | 选择 | 理由 |
|---|---|---|
| **窗口框架** | **Tauri v2** | ~10MB（vs Electron ~100MB）；Rust 后端在此场景几乎空闲，前端 JS 直接调 OpenCode HTTP API |
| **前端框架** | **Vue 3 + Vite + Pinia** | 与 The-World 项目同栈，零学习成本 |
| **数据层** | 前端 `EventSource` + `fetch` | SSE 订阅 `/api/event`，fetch 调 REST API，无需中间后端 |
| **样式** | Zed One Dark 主题色 + IBM Plex Sans/Lilex 字体 + Lucide 图标 | 全部 OFL/ISC 开源，视觉融入 Zed 环境 |
| **构建** | `pnpm create tauri-app` → Vue 3 模板 | 一条命令初始化 |

### 3.3 数据流

```
1. app 启动
   ├─ EventSource('http://localhost:{port}/api/event')
   │   └─ 收到 server.connected → 开始接收事件
   │
   ├─ fetch('/api/session') → 构建 session 树
   │   └─ 按 location.directory 分组，parentID 关联 subagent（子 session）
   │
   └─ 进入主循环：SSE 事件驱动状态更新（客户端推断状态）
       ├─ session.created → 添加到树，inferredState='running'
       ├─ message.part.updated → 更新 subagent 消息流 + lastEventTime
       ├─ session.updated → 更新 lastEventTime
       └─ 完成判定：无专用事件，靠双信号推断
           (a) 子 session 出现终止性 assistant message（stop_reason 非 null）
           (b) 父 session 出现 synthetic user message `<task id="..." state="completed|error">`
           两者任一触发 → inferredState = 'completed' / 'error'

2. 用户操作
   ├─ 点击 subagent → 展示详情（消息流）
   ├─ 发送 prompt → POST /api/session/:id/prompt  body: {prompt:{text}, id?, delivery?}
   └─ 点击 TERMINATE → POST /api/session/:id/interrupt (Phase 2 fork)
```

## 4. UI 设计（Zed One Dark 美化）

### 4.1 整体布局

```
┌─────────────────────────────────────────────────────────┐
│ ● ● ●  OpenCode Monitor          [─] [□] [×]          │  ← 自定义标题栏 32px
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│ SESSIONS     │  Session: main (Zed)                     │  ← 面板宽 240px
│              │  Status: ● active    Last event: 2s ago  │
│ ▼ the-world  │                                          │
│   ▼ main     │  ┌ Subagent: librarian ──────────────┐  │
│   │  ses_1.. │  │  Status: ✓ completed               │  │
│   │  ses_2.. │  │  Duration: 45s                     │  │
│   ▼ subs     │  │  [View messages ▾]                 │  │
│     ├ libr.. │  │  > Searching OpenCode source...    │  │
│     │ ✓ done │  │  > Found: SSE endpoint exists      │  │
│     ├ orac.. │  │  > Completed: 3 files analyzed      │  │
│     │ ⚠ STCK │  └────────────────────────────────────┘  │
│     └ fix..  │                                          │
│       ● run  │  ┌ Subagent: oracle ────────────────┐   │
│              │  │  Status: ⚠ STUCK — no event 5m12s │   │
│              │  │  Last event: tool.call webfetch    │   │
│              │  │  [ TERMINATE ]  [View messages]    │   │
│              │  └────────────────────────────────────┘  │
│              │                                          │
│              │  ┌ Subagent: fixer ──────────────────┐   │
│              │  │  Status: ● running                 │   │
│              │  │  Last event: message.part.updated  │   │
│              │  │  Duration: 12s                     │   │
│              │  │  [View messages ▾]                 │   │
│              │  └────────────────────────────────────┘   │
├──────────────┴──────────────────────────────────────────┤
│ Send to: [main session ▼]                               │  ← 底部输入栏
│ [__________________________________________________] [➤]│
└─────────────────────────────────────────────────────────┘
```

### 4.2 设计 Token（来自 Zed One Dark 主题）

#### 颜色

```css
:root {
  /* 背景层级 */
  --bg-app:        #3b414d;  /* 应用主背景 */
  --bg-editor:     #282c33;  /* 编辑器/内容区 */
  --bg-panel:      #2f343e;  /* 侧边面板 */
  --bg-elevated:   #2f343e;  /* 浮层/弹窗 */
  --bg-element:    #2e343e;  /* 输入框/控件 */
  --bg-hover:      #363c46;  /* hover 态 */
  --bg-active:     #454a56;  /* active/pressed 态 */
  --bg-selected:   #454a56;  /* selected 态 */

  /* 文字 */
  --text-primary:    #dce0e5;
  --text-muted:      #a9afbc;
  --text-placeholder:#878a98;
  --text-accent:     #74ade8;

  /* 边框 */
  --border:          #464b57;
  --border-variant:  #363c46;
  --border-focused:  #47679e;

  /* 语义色 */
  --success:   #a1c181;  /* ✓ completed */
  --error:     #d07277;  /* ✗ error / 需要终止 */
  --warning:   #dec184;  /* ⚠ stuck */
  --info:      #74ade8;  /* ● running */
  --hint:      #788ca6;

  /* VCS 色（用于 subagent 状态标记） */
  --vc-added:    #27a657;
  --vc-modified: #d3b020;
  --vc-deleted:  #e06c76;
}
```

#### 字体

```css
:root {
  --font-ui:   'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Lilex', 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;

  --font-size-ui:   14px;
  --font-size-code:  13px;
  --font-size-small: 12px;
  --line-height:     1.3;
}
```

- **IBM Plex Sans**：OFL 1.1，用于 UI 文字
- **Lilex**：OFL 1.1，用于代码/消息流（Zed 内部用它替代已弃用的 "Zed Plex Mono"）

#### 间距（Default 密度）

```css
:root {
  --space-2:  2px;
  --space-4:  4px;
  --space-6:  6px;
  --space-8:  8px;
  --space-12: 12px;
  --space-16: 16px;
  --space-24: 24px;
}
```

#### 圆角

```css
:root {
  --radius-xs: 2px;   /* checkbox, 小 toggle */
  --radius-sm: 4px;   /* 按钮, 列表项, 输入框 */
  --radius-md: 6px;   /* 卡片, 代码块 */
  --radius-lg: 8px;   /* 浮层, modal */
}
```

#### 动画

```css
:root {
  --ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
  --duration-fast:   150ms;  /* 标准过渡 */
  --duration-slow:   300ms;  /* 面板展开 */
}
```

#### 布局尺寸

```css
:root {
  --titlebar-height: 32px;
  --sidebar-width:   240px;
  --border-width:    1px;
}
```

#### 图标

使用 [Lucide](https://lucide.dev/) 图标（ISC License，Zed 同款）：
- `chevron-down` / `chevron-right`：展开/折叠
- `circle` / `check-circle` / `alert-triangle` / `x-circle`：状态指示
- `send`：发送按钮
- `square`：终止按钮（Zed 用这个表示 stop）
- `refresh-cw`：刷新
- `terminal`：subagent 类型图标

### 4.3 自定义标题栏（Windows）

```css
.titlebar {
  height: 32px;
  background: var(--bg-app);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  -webkit-app-region: drag;   /* Tauri 窗口拖拽 */
}

.titlebar-button {
  -webkit-app-region: no-drag;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-out-quint);
}

.titlebar-button:hover {
  background: var(--bg-hover);
}

.titlebar-button.close:hover {
  background: var(--error);
}
```

Tauri 配置：`decorations: false` + 自定义标题栏 webview 实现。

## 5. 核心功能

### 5.1 实时事件流（Phase 1）

OpenCode 的 SSE 事件流存在两种消息粒度事件，监控窗口必须同时订阅：

| 事件 type | 触发时机 | 用途 |
|---|---|---|
| `message.part.delta` | LLM 流式生成的每个文本/推理 chunk | 实时渲染 subagent 输出文本、更新 `lastEventTime` |
| `message.part.updated` | 消息 part 状态转换（tool pending→running→completed，文本 part 完成） | 工具执行状态追踪、完成判定（Signal A）、更新 `lastEventTime` |
| `session.created` | 新 session 创建 | 添加到 session 树 |
| `session.updated` | session 元数据变更 | 更新 `lastEventTime` |

**关键语义**：`message.part.updated` 不会在流式文本生成期间触发——只在 part 完成时才触发。如果只订阅 `updated`，在 LLM 长时间流式输出时 `lastEventTime` 不会更新，可能误触发卡死检测。`message.part.delta` 在流式期间高频触发，能填补这一空白。

**工具执行期间的行为**：工具 part 创建（pending）和启动（running）时会触发 `message.part.updated`，之后工具执行期间**无任何事件**，直到工具完成/失败再次触发 `message.part.updated`。因此长时间运行的工具（bash、webfetch）执行期间事件流会静默——这是正常行为，不是卡死。

```typescript
// composables/useEventStream.ts
export function useEventStream(baseUrl: string) {
  const store = useSessionStore()

  const source = new EventSource(`${baseUrl}/api/event`)

  source.onmessage = (event) => {
    const data = JSON.parse(event.data)
    switch (data.type) {
      case 'session.created':
        store.addSession(data.data)
        break
      case 'session.updated':
        store.updateSession(data.data)
        break
      case 'message.part.updated':
        store.updateMessagePart(data.data)  // 工具状态转换、文本完成
        store.refreshLastEventTime(data.data.sessionID)
        store.trackAssistantStopReason(data.data)  // 维护 lastAssistantStopReason（Signal A）
        break
      case 'message.part.delta':
        store.appendMessageDelta(data.data) // 流式文本 chunk
        store.refreshLastEventTime(data.data.sessionID)
        break
      // ... 其他事件类型
    }
  }
}
```

### 5.2 Session 树构建

```typescript
// stores/session.ts
interface SessionNode {
  id: string
  parentID: string | null     // 来自 SessionV2.Info.parentID (session/schema.ts:25)，大写 ID
  directory: string           // session.location.directory (AbsolutePath)，即该 session 的工作目录
  title: string               // SessionV2.Info.title
  agent: string               // SessionV2.Info.agent（如 'librarian' / 'fixer' / 'oracle'）
  // ⚠ Session.Info 没有 status 字段；'running'|'completed'|'error'|'cancelled'
  //   是 BackgroundJob.Status 的枚举，但 BackgroundJob 无 HTTP 端点不可达。
  //   监控窗口只能靠 SSE 事件流在客户端推断状态（见 §5.7）：
  inferredState: 'running' | 'completed' | 'error' | 'unknown'
  lastEventTime: number       // 客户端自维护，每条 SSE 事件更新
  lastEventType: string       // 客户端自维护，用于 stuck 诊断展示
  lastAssistantStopReason: string | null  // 最后一条 assistant message 的 stop_reason（Signal A 用）
  messages: MessagePart[]     // 从 message.part.updated / message.part.delta 事件累积，供详情面板渲染 + 完成判定
  children: SessionNode[]     // 按 parentID 反向组装
}

// 按 location.directory 分组（SessionV2.Info.location.directory 为 cwd）
// 顶层 = parentID 为空的 session
// 子层 = parentID 指向父 session 的 subagent session
// 注意：fetch '/api/session' 返回 { location: Location.Info, data: SessionV2.Info[] }，
//   location.envelope 包含 project 信息，data 数组内每个 session 自带 location.directory
//   客户端 filter+group 即可，无需额外 project 请求
```

### 5.3 Subagent 卡死检测（Phase 1）

OpenCode 不做 session 级卡死检测（`runner/llm.ts` 明确标注 TODO），监控窗口自行实现 watchdog。

**关键约束**：`Session.Info` 没有 `status` 字段，`/api/session` 返回的 session 对象不携带运行状态。`BackgroundJob.Status`（`running|completed|error|cancelled`）确实存在，但 BackgroundJob 是进程内 in-memory 注册表，**没有任何 HTTP 端点可访问**（`packages/server/src/` 无 background 路由）。因此监控窗口**不能依赖服务端状态字段**，只能从 SSE 事件流客户端推断：

- `inferredState === 'running'`：从 `session.created` 开始即为 running，直到收到完成信号
- `inferredState === 'completed'`：见 §5.7 完成判定
- `inferredState === 'unknown'`：拉取 `/api/session` 时已存在的 session（启动前创建），无 created 事件锚点，状态需根据其最后消息的 `stop_reason` 等字段回填

**事件更新频率**（影响 `lastEventTime` 精度）：
- LLM 流式生成期间：`message.part.delta` 高频触发 → `lastEventTime` 持续更新
- 工具执行期间：`message.part.updated` 仅在工具启动（running）和完成（失败）时触发，中间**完全静默** → `lastEventTime` 不更新
- 长时间运行的工具（如 bash 30s 命令）会在执行期间产生事件间隙，这是正常行为
- 因此卡死阈值应大于工具最大执行时间（bash 2min, webfetch 30s）

```typescript
// composables/useStuckDetection.ts
const STUCK_THRESHOLD_MS = 5 * 60 * 1000  // 5 分钟无事件
const CHECK_INTERVAL_MS = 10_000           // 每 10 秒检查一次

function checkStuck(sessions: SessionNode[]): StuckAlert[] {
  const now = Date.now()
  return sessions
    // 不能用 s.status === 'running' 过滤（Session 无 status 字段）。
    // 用客户端推断的 inferredState：仅对 running / unknown 的 session 检查。
    .filter(s => s.inferredState === 'running' || s.inferredState === 'unknown')
    .filter(s => now - s.lastEventTime > STUCK_THRESHOLD_MS)
    .map(s => ({
      sessionId: s.id,
      stuckDuration: now - s.lastEventTime,
      lastEventType: s.lastEventType,  // 来自 SSE 事件的最后类型
    }))
}
```

卡死阈值可配置：
- 默认 5 分钟
- 工具级超时参考：bash 2min，webfetch 30s，SSE chunk 间隔可配置
- 用户可调整（30s ~ 30min）

**误报缓解**：`inferredState === 'unknown'` 的 session（启动前已存在）若仅靠"超过阈值无事件"判定可能误报——这类 session 实际上已完成但事件流从未为其发送过 created。缓解：启动时对每个未知状态的 session 调一次 `GET /api/session/:id/message`，检查最后一条消息的 `stop_reason`，若非 null 则直接标记 `inferredState = 'completed'`。

### 5.4 发送消息（Phase 1）

```typescript
// composables/usePromptSender.ts
async function sendPrompt(sessionId: string, text: string) {
  // 1. 检查目标 session 是否有 in-flight streaming
  const session = sessionStore.getSession(sessionId)
  if (session.hasActiveStreaming) {
    throw new Error('Session is currently processing a prompt')
  }

  // 2. 生成 UUID message ID 避免碰撞
  const messageId = crypto.randomUUID()

  // 3. 发送 prompt
  //    实际 schema（验证源：packages/server/src/groups/session.ts 的 prompt handler）：
  //    body = { prompt: { text, files?, agents? }, id?, delivery?, resume? }
  //    - prompt.text: 文本内容（不是 parts 数组）
  //    - id: 消息 ID（字段名是 'id'，不是 'messageId'）
  //    - delivery: "steer" | "queue"（默认 "steer"）
  //      * "steer" = 注入到当前 in-flight prompt（steering）
  //      * "queue" = 排队等待当前 prompt 结束后处理
  //    - resume: 可选 boolean
  await fetch(`${baseUrl}/api/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: { text },          // 不是 parts: [{type:'text', text}]
      id: messageId,             // 字段名 'id'，不是 'messageId'
      delivery: 'queue',         // 排队模式，避免与 in-flight prompt 冲突
    }),
  })

  // 4. SSE 事件流会自动推送结果（Zed 端也会收到）
}
```

### 5.5 主动终止 Subagent（Phase 2 — 需 fork OpenCode）

OpenCode 内部有 `SessionExecution.interrupt()` 但无 HTTP 端点。Phase 2 fork 添加：

```typescript
// OpenCode fork: packages/server/src/handlers/session.ts 新增
handlers.handle("session.interrupt", ({ path }) =>
  Effect.gen(function* () {
    const execution = yield* SessionExecution
    yield* execution.interrupt(path.sessionID)
    return { interrupted: true }
  }),
)

// 监控窗口调用
async function terminateSession(sessionId: string) {
  await fetch(`${baseUrl}/api/session/${sessionId}/interrupt`, {
    method: 'POST',
  })
  // BackgroundJob 状态 → "cancelled"
  // 前台 task：父 session 收到 "Task cancelled" tool error
  // 后台 task：父 session 无通知（需监控窗口自行提示）
}
```

### 5.6 ACP 端同步（自动发生）

监控窗口发的 prompt 产生的事件通过全局 EventV2 流广播。ACP 端（Zed）的 `connection.sessionUpdate()` 订阅了同一个事件流，因此：
- 监控窗口发 prompt → OpenCode 处理 → 事件广播 → Zed agent panel 自动刷新
- 无需额外代码，这是 OpenCode 架构的固有行为

### 5.7 Subagent 完成判定（Phase 1）

**关键事实**：OpenCode **不发出专用的 "subagent 完成" 事件**。task tool 在子 session 跑完后，向**父 session** 注入一条 synthetic user message，形如 `<task id="..." state="completed|error">...</task>`（`packages/opencode/src/tool/task.ts:60`）。监控窗口不能依赖单一事件判定子 session 结束。

采用**双信号推断**（任一触发即判定完成）：

```typescript
// 客户端状态机（在 message.part.updated / session.updated 事件处理里推进）
function inferCompletion(child: SessionNode, parent: SessionNode): void {
  // 信号 A：子 session 的最后一条 assistant message 出现 stop_reason
  //   - stop_reason = 'stop' | 'length' | 'tool_use' | 'content_filter' 等
  //   - stop_reason 非 null 且非 'tool_use'（tool_use 表示等工具结果，未完成）
  //   → inferredState = 'completed' 或 'error'（按 stop_reason 区分）
  //   ⚠ lastAssistantStopReason 在 message.part.updated 事件处理时维护：
  //     当 part.role === 'assistant' 且 stop_reason 非 null 时更新
  if (child.lastAssistantStopReason
      && child.lastAssistantStopReason !== 'tool_use') {
    child.inferredState =
      child.lastAssistantStopReason === 'stop' ? 'completed' : 'error'
  }

  // 信号 B：父 session 的 user messages 中出现 synthetic <task state="..."> 内容
  //   - 扫描父 session 所有 user messages（不仅 lastMessage），
  //     匹配 <task id="${child.id}" state="completed|error|cancelled">
  //   - 不用 lastMessage，因为多个子 session 可能先后注入 synthetic message，
  //     只看 lastMessage 会漏掉较早的子 session 完成事件
  //   - 触发则按 state 字段同步子 session 的 inferredState
  const taskPattern = new RegExp(`<task[^>]*id="${child.id}"[^>]*state="(\\w+)"`)
  for (const msg of parent.messages.filter(m => m.role === 'user')) {
    const m = msg.text?.match(taskPattern)
    if (m) {
      child.inferredState = (
        { completed: 'completed', error: 'error', cancelled: 'unknown' }
      )[m[1]] ?? child.inferredState
      break  // 最新匹配为准
    }
  }
}
```

**信号 A 与 B 的时序关系**：信号 A 通常先到（子 session 的最后一条 assistant 消息），信号 B 后到（task tool 把子 session 结果回灌到父 session）。两者一致时确认；不一致时以信号 B 为准（它是 task tool 的最终状态）。

**启动补全**：监控窗口启动时拉取 `/api/session` 已存在的 session 没有 `created` 事件，无法靠事件流锚定。处理：对每个 `inferredState === 'unknown'` 的 session，调一次 `GET /api/session/:id/message` 取最后一条消息，若其 `role === 'assistant'` 且 `stop_reason` 非 null 非 `tool_use`，直接回填 `inferredState`。这同时降低 §5.3 卡死检测的误报率。

**BackgroundJob.Status 的角色澄清**：`'running'|'completed'|'error'|'cancelled'` 这一枚举确实存在于 `BackgroundJob.Status`（`packages/core/src/background-job.ts:7`），但它是 OpenCode 进程内的状态，监控窗口经 HTTP 完全不可达。本文档复用这套枚举值作为 `inferredState` 的取值，仅为概念对齐——实际值由客户端从 SSE 事件流推断，不来自服务端字段。

## 6. Zed 集成

### 6.1 Task 配置（启动器）

**`~/.config/zed/tasks.json`**（Windows 版本）：

```json
[
  {
    "label": "Launch OpenCode Monitor",
    "command": "powershell",
    "args": [
      "-Command",
      "Start-Process -FilePath 'C:\\path\\to\\opencode-monitor.exe' -ArgumentList '--cwd', \"$env:ZED_WORKTREE_ROOT\""
    ],
    "cwd": "$ZED_WORKTREE_ROOT",
    "use_new_terminal": false,
    "allow_concurrent_runs": true,
    "reveal": "never",
    "hide": "always"
  }
]
```

### 6.2 快捷键绑定

**`~/.config/zed/keymap.json`**：

```json
[
  {
    "context": "Workspace",
    "bindings": {
      "ctrl-shift-m": ["task::Spawn", { "task_name": "Launch OpenCode Monitor" }]
    }
  }
]
```

效果：
- **Ctrl+Shift+M** → 监控窗口弹出
- **Ctrl+Shift+P → "task: spawn" → "Launch OpenCode Monitor"** → 命令面板入口
- 自动传递 `$ZED_WORKTREE_ROOT`，监控窗口用它匹配 OpenCode session 的 cwd

## 7. 分期实施

### Phase 1（纯 HTTP API，不 fork 任何东西）

| 功能 | 复杂度 | 预估工时 |
|---|---|---|
| Tauri v2 项目初始化 + Vue 3 模板 | 低 | 0.5 天 |
| SSE 事件流订阅 + Pinia store（含 message.part.delta 流式文本处理） | 中 | 1.5 天 |
| Session 树构建（location.directory 分组 + parentID，含启动时 message 拉取回填） | 中 | 1 天 |
| Subagent 详情面板（消息流渲染，含实时流式文本 + 工具执行状态） | 中高 | 1.5 天 |
| 客户端状态推断（双信号完成判定，见 §5.7） | 中 | 1 天 |
| 卡死检测（watchdog + 阈值配置） | 中 | 0.5 天 |
| 发送消息到任意 session（正确 schema） | 低 | 0.5 天 |
| Zed One Dark 主题样式 | 中 | 1 天 |
| 自定义标题栏（Windows） | 低 | 0.5 天 |
| Zed task 配置 + 快捷键 | 低 | 0.25 天 |
| 连接配置（端口发现，默认 4096 + 手动输入 fallback） | 低 | 0.5 天 |
| **总计** | | **~9.5 天** |

Phase 1 交付物：
- 可运行的 Tauri 窗口应用
- 连接 OpenCode（默认 localhost:4096，支持手动端口配置）
- 实时显示所有 session + subagent 树（按 location.directory + parentID 关联）
- Subagent 消息流查看（实时流式文本 + 工具执行状态）
- 客户端推断的完成状态（双信号：stop_reason + synthetic task message）
- 卡死告警（红色高亮 + 持续时间，阈值可配置）
- 从监控窗口发 prompt（正确 schema：`{prompt:{text}, id, delivery:'queue'}`）
- Zed 一键启动（Ctrl+Shift+M）

### Phase 2（fork OpenCode，添加 HTTP 终止端点）

| 功能 | 复杂度 | 预估工时 |
|---|---|---|
| Fork OpenCode，添加 `POST /api/session/:id/interrupt` | 低 | 0.5 天 |
| 向上游提 PR（等待合并后可消除 fork） | — | — |
| 监控窗口 TERMINATE 按钮 | 低 | 0.5 天 |
| 终止后父 session 状态同步显示 | 中 | 0.5 天 |
| **总计** | | **~1.5 天** |

Phase 2 交付物：
- Fork 版 OpenCode（10 行核心改动）
- TERMINATE 按钮可杀卡死 subagent
- 向上游提 PR，合并后回归无 fork 状态

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| OpenCode HTTP API 端口动态分配 | 监控窗口不知连哪 | 默认端口 4096（`packages/opencode/src/server/server.ts:114-117`），stdout 输出；优先尝试 `localhost:4096`，失败则提示用户输入端口 |
| CORS 跨域限制 | Tauri webview 拦截 fetch | 已验证：OpenCode 显式允许 Tauri origin（`tauri://localhost`, `http/https://tauri.localhost`），见 `packages/server/src/cors.ts:7-15` |
| SSE 连接断开 | 丢失事件 | EventSource 自动重连 + 启动时 `GET /api/session/:id/message` 全量补全最后状态 |
| Session 无 `status` 字段，状态靠推断 | 误报/漏报 subagent 完成 | 双信号判定（子 session 最后 assistant message stop_reason + 父 session synthetic `<task state>`）；启动时回填 inferredState |
| 启动前已存在的 session 无 created 事件 | inferredState 默认 'unknown'，可能误判 stuck | 启动时拉 `/api/session/:id/message` 检查 stop_reason 回填 |
| 工具执行期间事件流静默 | `lastEventTime` 不更新，可能误判 stuck | 卡死阈值 > 工具最大执行时间（bash 2min）；UI 显示"工具运行中"状态（基于 `message.part.updated` 的 tool running 状态） |
| LLM 长流式输出期间 `message.part.updated` 不触发 | `lastEventTime` 仅在 part 完成时更新 | 同时订阅 `message.part.delta`（流式 chunk），两者均更新 `lastEventTime` |
| 并发 prompt 导致 session 状态错乱 | 用户体验 | 发前检查 in-flight 状态，`delivery: 'queue'` 模式 |
| OpenCode 版本升级改变 HTTP API | 兼容性 | Pinia store 层做适配，API 变更影响范围小 |
| OpenCode 版本升级改变事件 type 字面值 | SSE 解析失败 | 事件 type 字面值（`session.created` 等）属于 EventV2 的 wire 契约，变更概率低；store 层加 unknown 事件 fallback |
| Fork OpenCode 维护成本 | 长期负担 | 仅 Phase 2 需要，改动极小（10 行），上游 PR 合并后消除 |

## 9. 可选扩展

- **多项目支持**：监控窗口同时连接多个 OpenCode 实例（不同 cwd）
- **历史回放**：持久化 subagent 消息流到本地 SQLite，支持事后回看
- **告警通知**：卡死时系统托盘通知（Tauri 支持原生通知）
- **性能指标**：subagent 平均耗时、工具调用频率统计
- **主题切换**：支持 Zed One Light 等亮色主题（token 已有暗/亮两套）

## 10. 参考来源

| 内容 | URL / 源路径 |
|---|---|
| OpenCode CORS 允许 Tauri origin | `packages/server/src/cors.ts:7-15` — 显式允许 `tauri://localhost`, `http/https://tauri.localhost` |
| OpenCode 默认端口 | `packages/opencode/src/server/server.ts:114-117` — 默认 4096，fallback 随机端口 |
| message.part.delta 事件定义 | `packages/opencode/src/session/message-v2.ts:55-63` — 流式文本 chunk |
| message.part.updated vs delta 语义区分 | `packages/opencode/src/cli/cmd/run/session-data.ts:763-770` |
| OpenCode SSE 事件端点 | `packages/server/src/handlers/event.ts` — `GET /api/event` |
| OpenCode Session HTTP API | `packages/server/src/groups/session.ts` — 响应 envelope: `{location: Location.Info, data: SessionV2.Info[]}` |
| task tool 创建 child Session | `packages/opencode/src/tool/task.ts:~118` — `sessions.create({parentID, ...})` |
| SessionV2.Info schema（含 parentID 字段） | `packages/core/src/session/schema.ts:24-46` |
| Location.Ref（session.location.directory 来源） | `packages/core/src/location.ts:8-10` — `{directory: AbsolutePath, workspaceID?}` |
| BackgroundJob 状态枚举（进程内，HTTP 不可达） | `packages/core/src/background-job.ts:7` — `Status = running\|completed\|error\|cancelled` |
| EventV2 事件 type 字面值 | `packages/core/src/v1/session.ts:576/583/615` — `session.created` / `session.updated` / `message.part.updated` |
| Session runner TODO（卡死检测） | `packages/core/src/session/runner/llm.ts` — unchecked items |
| task tool 完成时注入父 session 的 synthetic message | `packages/opencode/src/tool/task.ts:60` — `<task id="..." state="...">` |
| Session interrupt（内部 API） | `packages/core/src/session/execution.ts:10` — `interrupt()` |
| Issue #11576（subagent ACP 支持） | https://github.com/sst/opencode/issues/11576 — auto-closed |
| PR #12563（未合并） | https://github.com/sst/opencode/pull/12563 — closed without merge |
| Zed One Dark 主题 JSON | `assets/themes/one/one.json` |
| Zed 字体映射 | `crates/gpui/src/text_system.rs` — IBM Plex Sans / Lilex |
| Zed 间距系统 | `crates/ui/src/styles/spacing.rs` |
| Zed 动画系统 | `crates/ui/src/styles/animation.rs` |
| Zed 标题栏常量 | `crates/ui/src/utils/constants.rs` — Windows: 32px |
| Lucide 图标 | https://lucide.dev/ — ISC License |
| IBM Plex Sans | https://fonts.google.com/specimen/IBM+Plex+Sans — OFL 1.1 |
| Lilex | https://github.com/mishamyrr/Lilex — OFL 1.1 |
