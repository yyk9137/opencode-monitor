# 步骤 10：MCP Section

> **共享上下文**：参见 `_shared-context.md`

## 范围

实现 `mcp` map 的详细配置。

## 前置条件

步骤 9 完成。

## 实现要点

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
   - **built-in 检测**：`entry.type === undefined` → built-in（内置 MCP，用户不可创建）。渲染为只读 enable/disable toggle，不显示类型切换器。**"添加新 server" 流程中不提供 built-in 选项**（用户无法创建内置 MCP，只能启用/禁用已有的）。
   - **切换时必须清除前一分支的字段并设置 `type` 字段**，否则 deep merge 会保留脏数据：
     - local → remote：删除 `command`, `environment`, `cwd`；设置 `type = "remote"`；添加 `url = ""`
     - remote → local：删除 `url`, `headers`, `oauth`；设置 `type = "local"`；添加 `command = []`
     - built-in → local/remote：删除 `enabled`，设置 `type` 和对应字段
   - 实现：toggle 的 `@change` handler 中，`delete draft.mcp[name].command` 等，再设置新类型字段

4. **Local 表单**：
   - `command` 数组编辑器（每行一个元素，可增删）
   - `environment` key-value 编辑器（复用 KeyValueEditor 或内联）。**值可能包含敏感信息**（如 `GITHUB_TOKEN`），KeyValueEditor 应有 secret 模式（掩码 + show/hide toggle），或自动掩码已知敏感 key（`*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASSWORD`）
   - `cwd` 文本输入
   - `enabled` toggle
   - `timeout` number input

5. **Remote 表单**：
   - `url` 文本输入（URL 格式验证，`https?://`）
   - `headers` key-value 编辑器
   - `oauth` 子表单（`McpOAuthConfig | false`）：
     - `clientId` 文本输入
     - `clientSecret` 文本输入（`type="password"`）
     - `scope` 文本输入
     - `callbackPort` number input（1-65535）
     - `redirectUri` 文本输入
     - "禁用 OAuth 自动检测" toggle → 设置 `oauth: false`
   - `enabled` toggle
   - `timeout` number input（**必须是正整数 > 0**，`min="1"`）

6. **验证**：
   - local: `command` 数组非空，至少 1 个元素
   - remote: `url` 必须是有效 `https?://` URL
   - `timeout` 必须是正整数 > 0（`exclusiveMinimum: 0`）
   - built-in: 只有 `enabled` 字段（`additionalProperties: false`）

7. **MCP server 状态反馈**：
   - **pre-save test connection 不可用**：API 无 `/mcp/:id/test` 端点
   - **post-restart 状态**：步骤 5 重启检测成功后，轮询 `GET /mcp` 一次（轻量单次 HTTP），返回 `{ [serverName]: McpStatus }`。状态枚举：`connected` / `failed` / `needs_auth` / `disabled`。每行渲染状态徽章：✓ connected / ✗ failed / ⚠ needs_auth。failed 时显示失败上下文。
   - **POST /mcp 动态添加**（可选）：`POST /mcp`（body `{ name, config }`）可动态添加 server 不需重启。如果需要 test-before-persist 功能，可 POST 草稿 config → 轮询 GET /mcp → 显示结果。动态添加的 server 是临时的，需显式移除。如不实现，文档明确 pre-save testing API-unsupported。

8. **`instructions` 字段**：**不属于 MCP section** — 它是顶层 Config 字段。移到步骤 4 的 General section 或步骤 11 的 Advanced section 渲染。

## 交付物

- `src/components/settings/SettingsDrawer.vue`（修改 — 添加 MCP section）
- `src/components/settings/KeyValueEditor.vue`（新建 — `Record<string, string>` 通用编辑器，environment/headers 共用）

## 验收标准

- [ ] MCP 列表每行可展开配置面板
- [ ] 可添加 MCP server；删除受 deep-merge 限制（同步骤 9 的 soft-delete 模式）
- [ ] 重启后 MCP server 状态可见（GET /mcp 轮询）
- [ ] 类型切换（local/remote/built-in）改变子表单
- [ ] 类型切换时正确设置 `type` 字段（`"local"` / `"remote"`）
- [ ] Local 表单用 `environment`（不是 `env`）
- [ ] Local 表单的 `command` 是数组编辑器（不是 string + args 分开）
- [ ] Local 表单有 `cwd` 字段
- [ ] Local 表单无 `args` 字段
- [ ] Remote 表单有 `url`, `headers`, `oauth`, `enabled`, `timeout`
- [ ] Remote 表单的 `oauth` 子表单包含 `clientId`, `clientSecret`, `scope`, `callbackPort`, `redirectUri`
- [ ] Built-in 类型只显示 `enabled` toggle（无其他字段）
- [ ] local `command` 数组非空验证
- [ ] remote `url` 格式验证
- [ ] `timeout` 必须是正整数 > 0
- [ ] KeyValueEditor 增删 key-value 对正确
- [ ] 修改任何字段 → 脏状态触发

## 审核重点

- 类型切换清除字段 — `delete draft.mcp[name].command` 是否会触发 Vue 响应式更新
- `McpRemoteConfig` 的 `oauth` 字段结构未定义 — 实施时需要对照 schema
- built-in 类型检测 = `entry.type === undefined` → built-in（只读 enable/disable），添加新 server 流程不提供 built-in 选项
- `command` 数组编辑器的 UI — 每行一个元素是否足够直观（vs 单行空格分隔）
- KeyValueEditor 是否需要支持重复 key（不应该）
- `instructions` 字段属于顶层配置还是 MCP 配置 — 需要确认 schema 位置
