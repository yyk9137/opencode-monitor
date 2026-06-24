# 步骤 11：高级配置 + JSON 编辑器 + 已弃用字段

> **共享上下文**：参见 `_shared-context.md`

## 范围

实现剩余标量 Section、Raw JSON 编辑器、已弃用字段处理。

## 前置条件

步骤 10 完成。

## 实现要点

1. **标量 Section**（根据 schema 实际类型选择渲染方式，不全是标量）：
   - `compaction`：标量字段逐一渲染
   - `tool_output`：标量字段逐一渲染
   - `attachment`：`attachment.image` 的 4 个嵌套标量字段（`auto_resize` toggle + `max_width`/`max_height`/`max_base64_bytes` number inputs）
   - `server`：4 个标量输入（`port`, `hostname`, `mdns`, `mdnsDomain`）+ `TagInput` for `cors`（string[]）
   - `experimental`：4 个 boolean toggle（`disable_paste_summary`, `batch_tool`, `openTelemetry`, `continue_loop_on_deny`）+ `TagInput` for `primary_tools`（string[]）+ `mcp_timeout` number input + `policies` Raw JSON（Policy 对象数组）。**无 `options` 字段**
   - `snapshot`：**boolean** toggle（不是 object）
   - `share`：**enum select** `'manual' | 'auto' | 'disabled'`（不是 object）
   - `autoupdate`：**dropdown 三选项**：`true`（自动更新）/ `'notify'`（仅通知）/ `false`（禁用）
   - `command`：**Map 编辑器**（不是 string）。值是 `{template, description?, agent?, model?, variant?, subtask?}` 对象 — **用 Raw JSON 回退**（`JsonEditor` 绑定到 `command` 字段）。专用编辑器延后
   - `skills`：**两个 TagInput**（`paths` string[] + `urls` string[]），不是标量
   - `references`：**Raw JSON**（鉴别联合太复杂不手写表单）
   - `watcher`：**TagInput** for `ignore`（string[]），不是标量
   - `tools`：**Map 编辑器**（`Map<string, boolean>`，每个 tool 一个 toggle）或 Raw JSON
   - `enterprise`：标量字段（`url` string）

2. **LSP / Formatter**：`anyOf(boolean, object)` 三段开关
   - `Disabled` = `false`
   - `Custom` = `{}` 展开为 **Map 编辑器**（类似 provider/mcp 的行+折叠面板模式）。每行一个语言，点击展开子表单。子表单有类型切换：Disabled（`{disabled: true}`）或 Custom（`{command: string[], ...}`）
   - **"Default" 三态不可用**：通过 deep-merge PATCH 无法删除已有字段（`mergeDeep` 保留缺失字段）。如果字段当前有值，无法恢复到 "Default"（字段不存在）。只提供 Disabled/Custom 两个选项

3. **Permission**：JSON 编辑器 + AJV 验证（递归结构，不手写表单）
   - `permission` 是单个联合值（不是 Map）
   - 可以是 `"ask" | "allow" | "deny"` 或对象 `{ bash?: "allow" | { "rm": "deny", "*": "ask" }, ... }`
   - **UI 优化**：顶层用 radio 选择 "全部允许" / "全部询问" / "全部拒绝" / "自定义"，前三个选项直接设置字符串值，"自定义" 展开 JSON 编辑器

4. **Plugin**：可重复行，每行是一个 plugin 条目：
   - 可以是**裸字符串**（仅名称，无配置）或 `[name, config]` 元组（config 是 object）
   - UI 提供 "name only" / "name + config" 切换
   - 裸字符串时只显示名称输入框；元组时显示名称 + JSON 编辑器

5. **JsonEditor.vue**（**已在步骤 8 创建**，此步骤复用）：
   - 无语法高亮，用等宽字体
   - AJV 验证在 `@blur` 时运行
   - Tab 插入 2 空格
   - 错误显示在 textarea 下方
   - **`Ctrl+Enter` 保存快捷键 hazard**：如果用户聚焦在 JsonEditor textarea 内按 `Ctrl+Enter`，不会触发 `@blur`，draft 中的值还是旧解析结果。`saveConfig()` 应在步骤 1 前主动调用 `document.activeElement.blur()` 或 per-component `flushPendingEdits()`，确保未提交的文本同步到 draft。或同时在 `@input`（debounced 300ms）时同步。

6. **RawJsonAccordion.vue** — 显示未在前端覆盖的字段：
   - 注册表是抽屉 `setup()` 中的 `ref<Set<string>>`（JSON-pointer 模式），绑定到抽屉生命周期。**不是模块作用域** — 模块作用域的 `Set` 是进程全局单例，多个抽屉实例（如测试）会互相污染。在 `onUnmounted` 中 clear。
   - 对于 map 类型字段（如 `provider`），用通配符模式：`provider.*.options.baseURL` 表示 "任何 provider ID 的此路径已覆盖"
   - 递归遍历配置树，检查每个节点是否匹配已覆盖模式
   - **简化方案**：只显示顶层未覆盖的 key（不递归到嵌套对象），接受嵌套未覆盖字段不显示的限制
   - 复用 `SubagentDetail.vue:933-991` 的 `.tool-card__header` 折叠模式

7. **已弃用字段处理**（根据实际类型选择渲染方式）：
   - `mode`（`Map<string, AgentConfig>`）：用只读 `JsonEditor` 显示，section header 标记 "deprecated"
   - `reference`（`Map<string, anyOf[string, GitRef, LocalRef]>`）：用只读 `JsonEditor` 显示，section header 标记 "deprecated"
   - `layout`（`enum 'auto' | 'stretch'`）：disabled select，标记 "deprecated, ignored by server"（服务器始终使用 stretch 布局）
   - `autoshare`（`boolean`）：disabled toggle，标记 "deprecated"
   - **保留在 JSON 中**用于 round-trip（deep merge 会自动保留）
   - 类型用 `unknown`（不是 `never`）

8. **AJV 验证**：在所有阶段的 `saveConfig()` 中运行（不只是 P4）。验证 `merged` 配置，验证失败则阻止 PATCH。

## 交付物

- `src/components/settings/SettingsDrawer.vue`（修改 — 添加所有高级 section）
- `src/components/settings/RawJsonAccordion.vue`（新建）
- `src/components/settings/TriStateControl.vue`（新建 — Default/Disabled/Custom 三段开关）
- `src/components/settings/JsonEditor.vue`（已在步骤 8 创建，此步骤复用）

## 验收标准

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

## 审核重点

- `SectionCoveredPaths` 注册表的实现方式 — 是全局 Map 还是 per-section 声明
- `command` Map 编辑器用 `JsonEditor`（步骤 8 创建）做 Raw JSON 回退 — 无前向依赖。`RawJsonAccordion`（catch-all 未覆盖字段展示）是步骤 11 新建，与 `JsonEditor` 是不同组件，不要混淆
- `autoupdate` 的 `anyOf[boolean, 'notify']` — UI 如何表示（toggle + radio？dropdown？）
- LSP/Formatter 三段开关的 "Default" = 字段不存在 — 如何在 draft 中表示"不存在"（`undefined` vs `delete`）
- AJV 验证在 `@blur` 时运行 — 但 `saveConfig()` 中也运行 — 是否会双重验证
- 已弃用字段的 `unknown` 类型 — 在 JsonEditor 中如何渲染
- RawJsonAccordion 递归到嵌套对象 — 性能考虑（大配置树可能有很多未覆盖字段）
