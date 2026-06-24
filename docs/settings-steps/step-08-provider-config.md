# 步骤 8：Provider 详细配置

> **共享上下文**：参见 `_shared-context.md`

## 范围

实现 `provider` map 的详细配置（每 provider 一个配置面板）。

## 前置条件

步骤 7 完成。

## 实现要点

1. **每行一个 provider**，点击展开配置面板（复用 `SubagentDetail.vue` 的 `.tool-card` 折叠模式）

2. **配置面板三标签**（**从零定义内容标签模式**，代码库中无现有内容标签可复用）：
   ```html
   <div class="config-tabs">
     <div class="tab-headers" role="tablist">
       <button role="tab" :aria-selected="activeTab === 'basic'" @click="activeTab = 'basic'">Basic</button>
       <button role="tab" :aria-selected="activeTab === 'advanced'" @click="activeTab = 'advanced'">Advanced</button>
       <button role="tab" :aria-selected="activeTab = 'raw'" @click="activeTab = 'raw'">Raw JSON</button>
     </div>
     <div v-show="activeTab === 'basic'" role="tabpanel">...</div>
     <div v-show="activeTab === 'advanced'" role="tabpanel">...</div>
     <div v-show="activeTab === 'raw'" role="tabpanel">...</div>
   </div>
   ```
   > **注意**：不要引用 `SubagentDetail.vue:734-759` — 那是浏览器会话标签（导航模式），不是内容标签。

   - **Basic**：`options.baseURL`（soft validate `^https?://`）, `options.timeout`（`number | false`，checkbox 控制 `false`）
   - **Advanced**：`options.enterpriseUrl`, `options.setCacheKey`（boolean，checkbox/toggle）, `options.headerTimeout`（`number | false`）, `options.chunkTimeout`（**仅 number，无 `false`**）, `api`（string）, `env`（string[]，用 TagInput）, `npm`（string）, `whitelist`（TagInput）, `blacklist`（TagInput）, `id`, `name`
   - **Raw JSON**：使用 `JsonEditor.vue`（**在步骤 8 创建，不是步骤 11**）

3. **`options.apiKey` 显示**：
   - **字段语义**：`options.apiKey` 存储的是**环境变量名**（如 `ANTHROPIC_API_KEY`），不是实际密钥值。实际密钥存储在 `~/.config/opencode/auth.json`。
   - 如果有值：显示为环境变量名（明文，标注 "Env var name"）
   - 如果值不匹配 `^[A-Z_][A-Z0-9_]*$`（用户可能误粘了实际密钥）：显示掩码 `sk-****1234` + 警告 "看起来是实际密钥，建议使用环境变量名"
   - 如果无值：根据 `/provider/auth` 状态显示 "通过 PUT /auth/:id 或环境变量设置" 或 "未配置"

4. **`whitelist` / `blacklist`**：用 `TagInput.vue`

5. **`options.timeout` / `options.headerTimeout`**：`number | false` — 输入框 + "禁用" checkbox
   - checkbox 选中 → 值 = `false`（布尔值，不是 `0` 或 `null`）
   - checkbox 取消 → 值 = 输入框中的数字（必须 > 0）

6. **`options.chunkTimeout`**：**仅 number**（无 `false` 选项）— 不需要 checkbox

7. **只读模型列表**：从 `/provider` 获取，过滤当前 provider：`providerResponse.all.find(p => p.id === currentProviderId).models`

8. **provider 的 `models` map**：复杂结构，用 Raw JSON 回退（不手写表单）。展开时显示 `JsonEditor` 绑定到 `provider.<id>.models`。

9. **`JsonEditor.vue`**（**在此步骤创建**，步骤 11 复用）：
   - `<textarea>` + `var(--font-mono)`, `font-size: var(--font-size-code)` (13px)
   - 背景 `var(--code-block-bg)` (`#0d1016`)
   - 边框 `var(--border)`, 聚焦 `var(--border-focused)`
   - AJV 验证在 `@blur` 时运行
   - 错误显示在下方，`var(--error)` 色
   - Tab 插入 2 空格
   - **无语法高亮**

## 交付物

- `src/components/settings/SettingsDrawer.vue`（修改 — 添加 provider 配置面板）
- `src/components/settings/JsonEditor.vue`（新建 — 此步骤创建，步骤 11 复用）

## 验收标准

- [ ] provider 列表每行可点击展开配置面板
- [ ] Basic / Advanced / Raw JSON 三标签切换正常（从零定义的内容标签模式）
- [ ] Basic 标签显示 `baseURL`（soft validate URL 格式）和 `timeout`
- [ ] Advanced 标签显示 `options` 字段 + `api`, `env`, `npm`, `whitelist`, `blacklist`, `id`, `name`
- [ ] `options.apiKey` 掩码显示（`sk-****1234`），不明文显示
- [ ] `whitelist` / `blacklist` / `env` 用 TagInput 渲染
- [ ] `timeout` / `headerTimeout` 支持 `number | false`（checkbox 控制 `false`）
- [ ] `chunkTimeout` 仅支持 number（无 checkbox）
- [ ] 只读模型列表从 `/provider` 获取，过滤当前 provider
- [ ] `models` map 用 Raw JSON 编辑器（非手写表单）
- [ ] Raw JSON 标签显示完整 provider JSON
- [ ] JsonEditor 无语法高亮，Tab 插入 2 空格
- [ ] 修改任何字段 → 脏状态触发
- [ ] 在 Basic 修改字段 → 切换到 Raw JSON → JSON 显示更新后的值
- [ ] provider 无 `options` 字段 → Basic/Advanced 显示空输入框，不报错

## 审核重点

- `options.timeout` 的 `number | false` 类型 — checkbox 切换时如何表示 false（用 `0`？`null`？`false`？）
- `SubagentDetail.vue:734-759` 的 tab 模式引用是否准确
- `JsonEditor`（per-field 原始编辑器）在步骤 8 创建，步骤 11 复用 — 无前向依赖问题
- `RawJsonAccordion`（catch-all 未覆盖字段展示）是步骤 11 新建组件，与 `JsonEditor` 是不同组件 — 不要混淆
- provider 配置面板展开/折叠的状态是否应该持久化
- `enterpriseUrl` 等 Advanced 字段是否真的需要前端渲染 — 可能用户从不使用
