# 步骤 4：General + Models Section

> **共享上下文**：参见 `_shared-context.md`

## 范围

实现两个基础 Section 的表单渲染。

## 前置条件

步骤 3 完成。

## 实现要点

1. **ModelsSection**（内联在 SettingsDrawer.vue 中）：
   - `model` 下拉框：数据源 `GET /provider`，格式化为 `provider_id/model_id`
   - `small_model` 下拉框：同上
   - `default_agent` 下拉框：数据源 `GET /agent`（不是 `/provider`），**必须过滤为 `mode === 'primary' || mode === 'all'` 的 agent**（schema 要求 default_agent 必须是 primary agent，否则服务器静默回退到 `build`）。空列表时显示提示 "未设置，服务器将使用 build 作为默认 agent"
   - 下拉框只允许选择，不允许自由输入（但提供 "手动输入" 链接展开 Raw JSON 回退）
   - 空列表时显示警告

2. **GeneralSection**（内联）：
   - `username`：`<input type="text">`
   - `logLevel`：`<select>`，选项 `DEBUG` / `INFO` / `WARN` / `ERROR`（大写）。schema 无 `default` 关键字，但 OpenCode 运行时默认 `INFO`。字段未设置时显示 placeholder "(未设置，默认 INFO)"
   - `shell`：`<input type="text">`
   - `instructions`：文件 glob 标签输入（用 `TagInput.vue`）— 顶层 Config 字段（从步骤 10 移入）。标签下方添加 helper text "文件路径或 glob 模式（如 `./AGENTS.md` 或 `docs/**/*.md`）"
   - `share`：`<select>`，选项 `manual` / `auto` / `disabled`（枚举，不是 object）
   - `autoupdate`：dropdown 三选项：`true`（自动更新）/ `'notify'`（仅通知）/ `false`（禁用）

3. **表单标签规范**：
   - 每个 `<label>`：uppercase, 11px, weight 500, letter-spacing 0.06em, `var(--text-muted)`
   - label 与 input 间距 `var(--space-6)`
   - 表单行垂直堆叠，section 内边距 `var(--space-12)` + `var(--space-16)`

4. **输入框样式**（复用 `ConnectionConfig.vue` 的 `.manual-input` 模式）：
   - 背景 `var(--bg-element)`
   - 聚焦：背景切换 `var(--bg-editor)` + `box-shadow: 0 0 0 1px var(--border-focused)`
   - 字体：文本输入用 `var(--font-ui)`，路径/命令输入用 `var(--font-mono)`

5. **脏状态触发**：用户修改任何字段 → `draft` 更新 → `isDirty` 变 true → 侧栏导航对应 Section 显示脏状态圆点

6. **TagInput.vue**（唯一独立提取的组件，步骤 7 的 `enabled_providers` 也需要）：
   - `<input>` + 标签列表显示
   - Enter 添加，Backspace 删除最后一个
   - 每个标签有 `×` 删除按钮
    - 标签背景 `var(--bg-element)`, 文字 `var(--text-primary)`, 字体 `var(--font-mono)`（路径/glob 标签用等宽字体）
   - **重复防护**：静默忽略已存在的标签（不添加，可选闪烁已有标签）
   - **边界情况**：空字符串/纯空格不添加；trim 后添加；blur 不自动提交；paste 不自动分割

## 交付物

- `src/components/settings/SettingsDrawer.vue`（修改 — 添加 Models 和 General section 内容）
- `src/components/settings/TagInput.vue`（新建）

## 验收标准

- [ ] `model` 下拉框从 `/provider` 正确加载模型列表
- [ ] `small_model` 下拉框同上
- [ ] `default_agent` 下拉框仅显示 `mode === 'primary' || 'all'` 的 agent
- [ ] `logLevel` 下拉选项为大写 `DEBUG` / `INFO` / `WARN` / `ERROR`
- [ ] 修改任何字段 → 对应 Section 导航行显示琥珀色脏状态圆点
- [ ] 保存栏显示 "N 个未保存字段"
- [ ] Reset 按钮恢复 `draft = original`
- [ ] 所有标签使用 `var(--text-muted)` + uppercase 规范
- [ ] TagInput 可添加/删除标签

## 审核重点

- `model` 下拉框的 "手动输入" 回退是否会与 AJV 验证冲突（schema 允许任意字符串）
- `GET /agent` 端点是否真的存在（已在共享上下文验证，但实施时需再次确认）
- TagInput 的 Backspace 删除行为是否会在 input 为空时误删标签
- 表单标签规范 "uppercase" 是否适用于中文标签（如有）
- `logLevel` 大写枚举是否与生成类型完全一致
