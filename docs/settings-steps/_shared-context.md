# 设置面板 — 共享上下文

> 本文件包含所有步骤共用的背景信息。每个步骤文档引用此文件。

## API 接口（已核查）

| 端点 | 方法 | 行为 |
|------|------|------|
| `/config` | **GET** | 返回已解析的完整 `ConfigV1.Info` JSON（合并 8 个来源） |
| `/config` | **PATCH** | 与磁盘上现有 config.json 做 **deep merge**（`mergeDeep(existing, incoming)`），写入后调用 `markInstanceForDisposal`；supervisor 重新拉起 → 等效重启 |
| `/instance/dispose` | **POST** | 显式销毁当前实例 |
| `/global/dispose` | **POST** | 销毁所有实例 |
| `/global/health` | **GET** | 返回 `{ healthy: boolean, version: string }` — 用于重启检测 |
| `/provider` | **GET** | 返回 `{ all: Provider[], default: {...}, connected: string[] }` |
| `/provider/auth` | **GET** | 返回 `{ [providerID]: ProviderAuthMethod[] }` |
| `/auth/:id` | **PUT** | 设置指定 provider 的认证凭据 |
| `/agent` | **GET** | 返回 agent 列表 |

> **无 `/api` 前缀。** 现有代码库有混合前缀惯例（`useEventStream.ts` 用 `/api/event`，`session.ts` 用 `/api/session`）。实施时首次调用即验证。

## 关键约束

- **PATCH 做 deep merge** — 传入字段缺失的路径会保留磁盘已有值，不会被删除
- **`additionalProperties: false`** 控制 schema 验证，不是 merge 行为
- **API 密钥可通过 HTTP API 设置** — `PUT /auth/:id` 存在
- **无 PATCH 热重载** — 每次 PATCH 仍然触发进程销毁 + supervisor 重启（~3-15s 中断）
- **TOCTOU 窗口** — GET 与 PATCH 之间有写入竞态
- **Tauri 权限** — 仅 `http:default`（localhost/127.0.0.1）、`core:default`、`core:window:*`、`opener:default`

## Monitor 当前状态

| 系统 | 说明 |
|------|------|
| 路由 | **无** — App.vue 单页直接挂载所有组件 |
| 模态/对话框 | **零** — 代码库中无 modal/dialog/overlay/focus-trap |
| 状态管理 | Pinia，`session.ts` 使用 `shallowRef` 模式 |
| 现有设置 UI | `ConnectionConfig.vue`（~740 LOC）— 内联侧栏组件，非模态 |
| HTTP 客户端 | `@tauri-apps/plugin-http` 的 `fetch`（仅 localhost/127.0.0.1） |
| 实例发现 | `useInstanceScanner.ts` — 端口扫描发现 OpenCode 实例 |
| 主题 | `src/assets/theme.css` — Zed ayu dark 色板，所有组件用 CSS 变量 |

## 架构决策摘要

1. **布局**：右侧抽屉（drawer），非模态弹窗
2. **状态管理**：Pinia store，所有重启状态在 store 中（不在组件中）
3. **从不自动保存**：每次 PATCH 触发完整重启
4. **保存前 re-GET + deep merge**：客户端 merge 确保数组语义正确
5. **不要通用 schema 渲染器**：手工编码分区
6. **从 live schema 自动生成类型**：不手写 TS 接口

## 主题变量映射表

| 元素 | Token | 值 |
|------|-------|-----|
| 抽屉表面 | `var(--bg-panel)` | `#1f2127` |
| 抽屉标题栏 | `var(--bg-app)` | `#0d1016` |
| Section 内容区 | `var(--bg-editor)` | `#0d1016` |
| 侧栏导航行 hover | `var(--bg-hover)` | `#2d2f34` |
| 侧栏导航选中 | `var(--bg-selected)` + `inset 2px 0 var(--text-accent)` | `#313337` |
| 表单标签 | uppercase, 11px, weight 500, letter-spacing 0.06em, `var(--text-muted)` | |
| 输入框背景 | `var(--bg-element)` | `#2d2f34` |
| 输入框聚焦 | `var(--bg-editor)` + `box-shadow: 0 0 0 1px var(--border-focused)` | |
| 保存按钮 | `var(--text-accent)` 背景, `var(--bg-editor)` 文字 | |
| 破坏性操作 | `var(--error)` | `#d95757` |
| 代码块 | `var(--code-block-bg)` | `#0d1016` |
| 字体 | 标签用 `var(--font-ui)`，代码/JSON 用 `var(--font-mono)` | |

**脏状态圆点**：灰色 `var(--text-placeholder)` = 干净，琥珀脉冲 `var(--warning)` = 脏，蓝色 `var(--info)` = 保存中

## Deep Merge 策略

```typescript
interface DiffPath { path: string[]; oldValue: unknown; newValue: unknown }
function computeDiff(original: object, draft: object): DiffPath[]
function applyDiff(fresh: object, diffs: DiffPath[]): object
// mergeArrays: false（数组替换，不拼接）
```

**不变量**：`merge(fresh, diff(original, draft))` where `fresh === original` must produce `draft`

## 响应式断点

| 窗口宽度 | 抽屉行为 |
|----------|----------|
| ≥ 1280px | 抽屉 420-520px，主内容仍可阅读 |
| 900-1279px | 抽屉成为焦点，主内容折叠 |
| < 900px | 抽屉全宽，侧栏折叠为图标条 |
| < 700px | 抽屉占满窗口，侧栏隐藏 |

## 键盘快捷键

| 快捷键 | 行为 |
|--------|------|
| `Ctrl+,` | 切换设置抽屉 |
| `Escape` | 关闭抽屉（有脏状态时走确认对话框） |
| `Ctrl+Enter` | 从任意输入字段触发保存 |
| ArrowUp/Down | 侧栏导航移动 |
| ArrowRight/Space | 选中侧栏导航项 |

## 风险防护

| 风险 | 缓解 |
|------|------|
| A: 禁用唯一认证 Provider | 降级为警告 |
| B: 无效 model 字符串 | 下拉框 + 手动输入回退 |
| C: 畸形 MCP/LSP 配置 | 客户端验证 + 红色边框 |
| D: TOCTOU 覆盖并发编辑 | re-GET + deep merge |
| E: 重启后不恢复 | 90s 无进展超时 + 5min 绝对上限 + 三路检测 |
| F: 未保存关闭面板 | 确认对话框（取消/放弃/保存并重启） |
| G: fetchConfig↔saveConfig 竞态 | 单一 phase 枚举互斥 |
| H: 重启期间打开面板 | 只读模式 + 横幅 |
