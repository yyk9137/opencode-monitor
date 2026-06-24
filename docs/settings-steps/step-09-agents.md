# 步骤 9：Agents Section

> **共享上下文**：参见 `_shared-context.md`

## 范围

实现 `agent` map 的详细配置。

## 前置条件

步骤 8 完成。

## 实现要点

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
    | `hidden` | boolean | toggle（**仅 `mode === 'subagent'` 时生效**，其他模式 disable + hint "仅 subagent 模式生效"） |
   | `variant` | string | text input（可选） |
   | `temperature` | number | number input |
   | `top_p` | number | number input |
    | `permission` | `PermissionConfig`（联合类型） | JSON 编辑器（**步骤 9 用 `JsonEditor`（步骤 8 已创建）作为 interim**，步骤 11 替换为 radio + JSON 混合 Permission UI） |
   | `options` | object | JSON 编辑器（agent 特有选项） |
   | `tools` | object（**已弃用**，用 `permission` 替代） | 不渲染，round-trip 保留 |
   | `maxSteps` | integer（**已弃用**，用 `steps` 替代） | 不渲染，round-trip 保留 |

2. **添加/删除 agent**：底部 "+ 添加 Agent" 按钮，输入 agent 名称
   - **添加**：deep-merge 可以添加新 map key（发送包含新 key 的 PATCH）
   - **删除限制**：deep-merge **无法删除**已有 map key（`mergeDeep` 保留缺失字段）。删除 agent 时 draft 本地删除了 key，但保存重启后该 agent 会从磁盘重新出现。**解决方案**：用 soft-delete — 设置 `{ disable: true, hidden: true }` 而非删除 map key。UI 中标记为 "已禁用"。在验收标准中明确：删除 = soft-delete（disable + hidden），不是物理删除。
   - **默认值**：新 agent 预设 `mode: 'subagent'`, 空 `prompt`, 不设 `model`（继承顶层）
   - **名称冲突**：警告内置 agent 名（`build`, `plan`, `general`, `explore`, `title`, `summary`, `compaction`）— 添加同名 agent 会覆盖内置

3. **color 选择器**：不用浏览器默认 `<input type="color">`。用文本输入 + 6-8 预设色板 swatches。agent 行旁显示当前颜色 chip（复用 `.agent-chip` 模式 `SubagentDetail.vue:763-767`）

## 交付物

- `src/components/settings/SettingsDrawer.vue`（修改 — 添加 Agents section）

## 验收标准

- [ ] agent map 中每个 agent 正确渲染为配置面板
- [ ] 可添加 agent；删除通过 soft-delete（disable + hidden）实现，不物理删除 map key
- [ ] `mode` 下拉选项为 `'subagent' | 'primary' | 'all'`（不是 auto/manual）
- [ ] `disable` 字段正确映射（不是 `disabled`）
- [ ] `color` 支持 hex 和主题枚举名
- [ ] `prompt` 用等宽字体
- [ ] model 下拉框复用步骤 4 的数据源
- [ ] 修改任何字段 → 脏状态触发

## 审核重点

- `color` 字段的 `anyOf[^#hex, enum[...]]` — 文本输入如何区分 hex 和枚举名（用预设色板 swatches + 文本输入）
- `temperature` 和 `top_p` 的取值范围 — schema 对两者无范围约束（仅 `type: number`）。前端应自行加 0–2 / 0–1 的 UX 范围校验作为护栏，但这不是 schema 要求
- 删除/重命名 agent 时，如果该 agent 是 `default_agent`，显示警告 "此 agent 是默认 agent，删除后服务器将回退到 build"，并提供同时更新 `default_agent` 的选项
- 添加 agent 时输入名称 — 需要验证名称唯一性和格式
- 删除 agent 是否需要确认（与步骤 6 的脏状态守卫不同 — 这是删除操作）
- `SubagentDetail.vue:763-767` 的 `.agent-chip` 引用是否准确
- `variant` 字段已确认存在（schema 验证通过）
- `permission` 字段是 `PermissionConfig` 联合类型 — 复用步骤 11 的 Permission UI
- `options` 字段是 agent 特有选项 — 用 JSON 编辑器
- `tools` 和 `maxSteps` 已弃用 — 不渲染，round-trip 保留
