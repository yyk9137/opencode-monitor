# 步骤 2：抽屉壳 + 主题变量 + 标题栏入口

> **共享上下文**：参见 `_shared-context.md`

## 范围

创建抽屉外壳组件，添加 CSS 变量，修改 App.vue 添加齿轮按钮。

## 前置条件

步骤 1 完成。

## 实现要点

1. **App.vue 修改**：
   - 在 `titlebar-left` 和 `titlebar-buttons` 之间插入 `<div class="titlebar-actions">`
   - 齿轮图标用 Lucide `Settings`，14px，`--no-drag`
   - 点击调用 `useConfigStore().panelOpen = true`

   > **重要**：抽屉使用 `v-show`（不是 `v-if`）— 避免每次打开重新挂载 14+ 个表单 section。关闭时用 `:inert` 属性防止焦点进入。
   >
   ```vue
   <div class="settings-drawer" v-show="store.panelOpen"
        :inert="!store.panelOpen" :aria-hidden="!store.panelOpen">
   ```

2. **SettingsDrawer.vue 结构**（一个大文件，像 ConnectionConfig.vue）：
   ```
   <div class="settings-drawer" v-show="store.panelOpen">
     <div class="drawer-header">         <!-- 标题 "Settings" + 关闭按钮 ChevronRight -->
     <div class="drawer-instance-bar">   <!-- 实例选择器（步骤 3） -->
     <div class="drawer-restart-banner"> <!-- 重启横幅（步骤 5） -->
     <div class="drawer-body">
       <nav class="drawer-nav">          <!-- 侧栏导航 -->
       <div class="drawer-content">     <!-- Section 内容 -->
     </div>
     <div class="drawer-footer">         <!-- 保存栏 -->
   </div>
   ```

   > **位置**：`<SettingsDrawer />` 放在 `.app-container` 末尾（`.app-body` 的兄弟节点），**不在** `.app-body` 或 `.main-pane` 内部。z-index: 50（高于 `.bootstrap-error` 的 20，低于 `ToastHost` 的 9999）。

3. **抽屉动画**：`transform: translateX(100%)` → `translateX(0)`，`transition: transform var(--duration-slow) var(--ease-out-quint)`。由于使用 `v-show`，首次挂载时动画也会播放。

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

6. **关闭按钮**：用 Lucide `ChevronRight`（方向性图标，暗示"收回到右侧"），hover `var(--bg-hover)` + `var(--text-muted)`。添加 `title="关闭设置 (Esc)"` tooltip。

7. **焦点管理**：
   - **打开时**：焦点移到抽屉容器（`tabindex="-1"`），或第一个侧栏导航行
   - **关闭时**：焦点返回齿轮按钮（齿轮按钮添加 `ref="gearBtn"`，关闭时调用 `gearBtn.value?.focus()`）
   - **`:inert` on main-pane**：**必须在 App.vue 中显式添加** `<main class="main-pane" :inert="store.panelOpen">`。由于 `SettingsDrawer.vue` 是 `.app-body` 的兄弟节点（不是父节点），无法从抽屉组件内部使 `.main-pane` 不可交互。考虑是否同时使 `.sidebar` 不可交互。

8. **保存栏**：sticky 在抽屉底部，左侧脏状态指示（"3 个未保存字段" 或 "已是最新"），右侧 `[恢复到最近保存]` ghost 按钮 + `[保存并重启]` accent 按钮。
   > **注意**：保存栏继承 `.prompt-footer` 的排版样式（mono, 10px, letter-spacing 0.03em）用于左侧状态文本，**但布局是自己的**（`justify-between` 左右分离），不是 `.prompt-footer` 的简单垂直堆叠。按钮布局参考 `.prompt-row` 的 flex 模式。

## 交付物

- `src/components/settings/SettingsDrawer.vue`
- `src/App.vue`（修改 — 添加齿轮按钮 + `<SettingsDrawer />`）

## 验收标准

- [ ] 标题栏显示齿轮图标，位于 `titlebar-context` 和窗口控制按钮之间
- [ ] 点击齿轮 → 抽屉从右侧滑入（有动画）
- [ ] 抽屉宽度 420-520px，不遮挡左侧 sidebar
- [ ] 关闭按钮 ChevronRight 点击后抽屉滑出
- [ ] 所有颜色使用 CSS 变量，无裸 hex
- [ ] 侧栏导航行的选中态有左侧 accent 指示线
- [ ] 保存栏 sticky 在底部，显示脏状态指示
- [ ] Escape 键关闭抽屉（此时无脏状态，步骤 4 处理脏状态）
- [ ] 窗口宽度 < 900px 时抽屉全宽（媒体查询覆盖）
- [ ] 打开抽屉时焦点移到抽屉，关闭时焦点返回齿轮按钮
- [ ] 抽屉打开时 main-pane 不可交互（`:inert`）
- [ ] 点击抽屉外部不关闭抽屉
- [ ] z-index 正确（50），不被 bootstrap-error 遮挡，不遮挡 toast

## 审核重点

- 抽屉使用 `position: absolute; top: var(--titlebar-height); right: 0; bottom: 0`，锚定在 `.app-container`（不是 viewport）。宽度用 `min(520px, 100%)`（不是 `100vw`）。
- z-index: 50 — 高于 `.bootstrap-error` (20)，低于 `ToastHost` (9999)
- `< 900px` 时宽度 `100%`（媒体查询覆盖），不是 `min(520px, 100vw)` 的自动行为
- `v-show` + `:inert` 而非 `v-if` — 避免重新挂载表单
- 齿轮按钮用现有的 `.titlebar-button` class（与窗口控制按钮一致的 hover 行为）
- 关闭按钮用 `ChevronRight`（方向性）而非 `×`（与窗口关闭混淆）
- `.titlebar-actions` 用 `margin-left: auto` 推向右侧
- 抽屉 header 添加 `border-bottom: 1px solid var(--border-variant)`（匹配 titlebar）
- 抽屉圆角：`border-radius: var(--radius-sm) 0 0 var(--radius-sm)`（仅左上/左下）
