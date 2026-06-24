# 步骤 7：Providers Section — 开关 + 认证状态

> **共享上下文**：参见 `_shared-context.md`

## 范围

实现 `enabled_providers` / `disabled_providers` 的 toggle 列表和认证状态显示。

## 前置条件

步骤 6 完成。

## 实现要点

1. **数据源**：`GET /provider` 返回 `{ all: Provider[], default: {...}, connected: string[] }`

2. **渲染**：
   - 每个 provider 一行：名称 + 模型数量 + toggle 开关 + 认证状态点
   - 认证状态：`connected` 数组中包含 → 绿色点 `var(--success)`（表示"已配置凭据"，**不是**"凭据已验证"）；否则 → 灰色点 `var(--text-placeholder)`
   - **toggle 简化为二态**（去掉"默认"状态 — OpenCode 默认启用所有 provider，除非显式禁用）：
     - ON：provider 在 `enabled_providers` 中（或两个数组都不在）
     - OFF：provider 在 `disabled_providers` 中
   - toggle ON → 添加到 `enabled_providers`，从 `disabled_providers` 移除
   - toggle OFF → 添加到 `disabled_providers`，从 `enabled_providers` 移除
   - 如果 provider 同时在两个数组中（无效状态），`disabled_providers` 优先 → 显示 OFF
   - **已禁用的 provider 会从 `GET /provider` 响应中消失**：handler 过滤掉 `disabled_providers` 中的 provider。toggle OFF → 保存 → 重启后，该 provider 行消失，用户无法 toggle 回 ON。**解决方案**：UI 必须合并 `GET /provider` 的 `all` 数组与 `config.disabled_providers` 中的 ID，为禁用的 provider 显示 ID-only 行（无名称/模型数）+ OFF toggle。

3. **认证详情**：`GET /provider/auth` 返回每个 provider 的认证方法列表

4. **API Key 设置**：
   - 如果 provider 需要 API key 且未认证，显示 "设置 API Key" 按钮
   - 点击后展开一个 `<input type="password">` + "保存" 按钮（API key 不应明文显示）
   - 调用 `PUT /auth/:id`（body 匹配 `Auth.Info` 联合类型：`{ type: "api", key: string, metadata?: Record<string,string> }` 用于 API key，**不是 provider schema**）
   - 成功后刷新认证状态
   - **OAuth providers**：`GET /provider/auth` 返回的 `Method.type === 'oauth'` 的 provider（如 GitHub Copilot, Google Vertex, GitLab Duo）不能通过 `PUT /auth/:id` 设置。OAuth 流程是 `POST /provider/:id/oauth/authorize` → 浏览器重定向 → `POST /provider/:id/oauth/callback`。**本步骤仅实现 API key 路径，OAuth 流程延后**。范围声明：仅处理 `method.type === 'api'` 的 provider。

5. **认证状态点**用 `.status-pill` 模式（复用 `ConnectionConfig.vue:286-321`）

## 交付物

- `src/components/settings/SettingsDrawer.vue`（修改 — 添加 Providers section 内容）

## 验收标准

- [ ] provider 列表从 `/provider` 正确加载
- [ ] 每个 provider 显示名称 + 模型数量 + toggle + 认证状态
- [ ] toggle 切换 → `enabled_providers` / `disabled_providers` 更新 → 脏状态触发
- [ ] 认证状态点颜色正确（绿色=已认证，灰色=未认证）
- [ ] "设置 API Key" 按钮展开输入框
- [ ] `PUT /auth/:id` 成功后认证状态刷新
- [ ] `GET /provider/auth` 数据正确显示

## 审核重点

- `connected` 数组的语义 — 是"已认证"还是"已连接"（可能在运行中但未认证）
- toggle 开关的三态逻辑（enabled / disabled / 默认）是否清晰 — 用户可能不理解"默认"状态
- `PUT /auth/:id` 的 body 格式 — 是 `Auth.Info` 联合类型（`{ type: "api", key: string, metadata?: {...} }`），不是 provider schema
- `PUT /auth/:id` 写入 `auth.json` 但不重新初始化 provider — `connected` 数组不会立即反映新 key。验证是否需要 `PATCH /config` 重启才能激活，或 `PUT /auth/:id` 本身触发 provider re-init
- OAuth providers（`method.type === 'oauth'`）需要 `POST /provider/:id/oauth/authorize` 流程，本步骤不实现
- `enabled_providers` 和 `disabled_providers` 同时包含同一 provider 时的优先级
- 认证状态点用 `.status-pill` — 但 `ConnectionConfig.vue:286-321` 的引用是否准确
