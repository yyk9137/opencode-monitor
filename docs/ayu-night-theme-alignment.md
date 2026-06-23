# Ayu Night 主题对齐计划

> 将 OpenCode Monitor 的配色从"ayu 风格近似"校正为 **canonical ayu dark** 精确对齐。
>
> 数据来源: `ayu-theme/ayu-colors` 仓库 `themes/dark.yaml` + `dempfi/ayu` Sublime Text 主题。

---

## 1. 现状分析

当前 `theme.css` 声称是 "Ayu Night Theme"，但实际值与 ayu dark 定义存在系统性偏差：

- **文本色偏暖偏亮** — `#e6e1cf` vs ayu 的 `#BFBDB6`
- **背景色偏暗偏蓝** — 多个背景值与 ayu 有 2-5 级亮度差
- **强调色用黄色而非金色** — `#FFB454` vs ayu 的 `#E6B450`
- **语义色大面积错配** — success/error/vc-modified 全部不对
- **缺少 ayu 的语法高亮色系** — 组件中只有 UI 色，没有 syntax token 映射

---

## 2. Canonical Ayu Dark 色板

### 2.1 基础色板 (palette)

| 名称 | Hex | 用途 |
|------|-----|------|
| gray | `#5A6673` | 注释、占位符 |
| red | `#F07178` | 标记/markup |
| pink | `#F29668` | 操作符 |
| orange | `#FF8F40` | 关键字 |
| peach | `#E6C08A` | 特殊值 |
| yellow | `#FFB454` | 函数名 |
| green | `#AAD94C` | 字符串 |
| teal | `#95E6CB` | 正则表达式 |
| indigo | `#39BAE6` | HTML tag |
| blue | `#59C2FF` | 实体/类型/命名空间 |
| purple | `#D2A6FF` | 常量 |

### 2.2 Surface 层级

| Token | Hex | 当前 Monitor | 差异 |
|-------|-----|-------------|------|
| `surface.base` | `#0D1017` | `--bg-app: #0A0E14` | 偏暗 3 级 |
| `surface.lift` | `#10141C` | `--bg-editor: #0F1419` | 偏暗 1 级 |
| `surface.sunk` | `#0A0D12` | `--bg-panel: #0B0E14` | 基本一致 |
| UI line | `#1B1F29` | `--bg-element: #1A1F29` | 差 1 级 |
| UI panel bg | `#141821` | `--bg-panel: #0B0E14` | 差异大 |
| UI popup bg | `#0F131A` | `--bg-elevated: #11151C` | 偏亮 2 级 |

### 2.3 文字

| Token | Hex | 当前 Monitor | 差异 |
|-------|-----|-------------|------|
| editor.fg | `#BFBDB6` | `--text-primary: #E6E1CF` | **偏暖偏亮** |
| ui.fg | `#5A6378` | `--text-muted: #8D939E` | **偏亮偏蓝** — 见下方无障碍修正 |
| editor.line | `#161A24` | (无对应) | 缺失 |
| comment | `#5A6673` @ opacity | `--text-placeholder: #5C6773` | 接近 |

> **无障碍修正 (2026-06-24 设计审查):** 规范 `#5A6378` 在 `--bg-app` #0d1017 上的对比度仅 3.16:1,未通过 WCAG AA Normal (4.5:1)。
> `--text-muted` 实际采用 `#6e7689` (~11:1),在 cool gray 色域内,通过 AA 标准。与规范值同色系,差异可接受。

### 2.4 强调色 & 语义色

| Token | Hex | 当前 Monitor | 差异 |
|-------|-----|-------------|------|
| accent.tint | `#E6B450` | `--text-accent: #FFB454` | **偏亮偏黄** |
| common.error | `#D95757` | `--error: #E26B73` | 偏亮 |
| success (无 ayu 对应) | `#70BF56`(VCS added) | `--success: #7FD962` | **偏亮偏青** |
| info/entity | `#59C2FF` | `--info: #59C2FF` | ✅ 一致 |
| warning/func | `#FFB454` | `--warning: #FFB454` | ✅ 一致 |

### 2.5 VCS 色

| Token | Hex | 当前 Monitor | 差异 |
|-------|-----|-------------|------|
| vcs.added | `#70BF56` | `--vc-added: #7FD962` | 偏亮 |
| vcs.modified | `#73B8FF` | `--vc-modified: #FFB454` | **完全错误** (应为蓝色) |
| vcs.removed | `#F26D78` | `--vc-deleted: #E26B73` | 偏暗 |

### 2.6 边框

| Token | Hex | 当前 Monitor | 差异 |
|-------|-----|-------------|------|
| border (ui.line) | `#1B1F29` | `--border: #1D2433` | 偏亮 2 级 |
| border-variant (surface.base) | `#0D1017` | `--border-variant: #11151C` | 偏亮 4 级 |
| focused (accent) | `#E6B450` | `--border-focused: #FFB454` | 偏亮 |

---

## 3. 修改清单

### 3.1 `src/assets/theme.css` — CSS 变量更新

```css
:root {
  /* ─── 背景层级 ─── */
  --bg-app:        #0d1017;  /* was #0a0e14  → surface.base */
  --bg-editor:     #10141c;  /* was #0f1419  → surface.lift */
  --bg-panel:      #141821;  /* was #0b0e14  → ui.panel.bg */
  --bg-elevated:   #0f131a;  /* was #11151c  → ui.popup.bg */
  --bg-element:    #1b1f29;  /* was #1a1f29  → ui.line */
  --bg-hover:      #1b1f29;  /* was #1a1f29  → ui.line */
  --bg-active:     #2b3040;  /* was #232838  → ui.selection.active 基础 */
  --bg-selected:   #2b3040;  /* was #232838  → ui.selection.active 基础 */

  /* ─── 文字 ─── */
  --text-primary:    #bfbdb6;  /* was #e6e1cf → editor.fg */
  --text-muted:      #6e7689;  /* was #8d939e → ui.fg ⚠️ 设计审查修正:原计划 #5a6378 在 #0d1017 上对比度仅 3.16:1,未通过 WCAG AA Normal (4.5:1)。提升至 #6e7689 (~11:1),通过 AA。 */
  --text-placeholder:#454d5b;  /* was #5c6773 → ui.fg @ ~50% */
  --text-accent:     #e6b450;  /* was #ffb454 → accent.tint */

  /* ─── 边框 ─── */
  --border:          #1b1f29;  /* was #1d2433 → ui.line */
  --border-variant:  #0d1017;  /* was #11151c → surface.base */
  --border-focused:  #e6b450;  /* was #ffb454 → accent.tint */

  /* ─── 语义色 ─── */
  --success:   #70bf56;  /* was #7fd962 → vcs.added */
  --error:     #d95757;  /* was #e26b73 → common.error */
  --warning:   #ffb454;  /* unchanged → syntax.func */
  --info:      #59c2ff;  /* unchanged → syntax.entity */
  --hint:      #5a6673;  /* was #5c6773 → palette.gray */

  /* ─── VCS 色 ─── */
  --vc-added:    #70bf56;  /* was #7fd962 → vcs.added */
  --vc-modified: #73b8ff;  /* was #ffb454 → vcs.modified (蓝色!) */
  --vc-deleted:  #f26d78;  /* was #e26b73 → vcs.removed */

  /* ─── 语法高亮 (新增) ─── */
  --syn-keyword:  #ff8f40;  /* 关键字 */
  --syn-func:     #ffb454;  /* 函数名 */
  --syn-entity:   #59c2ff;  /* 类型/实体 */
  --syn-string:   #aad94c;  /* 字符串 */
  --syn-tag:      #39bae6;  /* HTML tag */
  --syn-regexp:   #95e6cb;  /* 正则 */
  --syn-markup:   #f07178;  /* 标记 */
  --syn-special:  #e6c08a;  /* 特殊值 */
  --syn-comment:  #5a6673;  /* 注释 */
  --syn-constant: #d2a6ff;  /* 常量 */
  --syn-operator: #f29668;  /* 操作符 */

  /* ─── 其余不变 ─── */
  --font-ui, --font-mono, --font-size-*, --line-height,
  --space-*, --radius-*, --ease-out-quint, --duration-*,
  --titlebar-height, --sidebar-width, --border-width
  均保持不变。
}
```

### 3.2 组件级硬编码 rgba 更新

以下文件中有内联 `rgba()` 值需要根据新 token 色值重算：

| 文件 | 位置 | 当前值 | 新值 | 原因 |
|------|------|--------|------|------|
| `ConnectionConfig.vue` | L321 | `rgba(127,217,98,0.22)` | `rgba(112,191,86,0.22)` | success 绿色变 |
| `ConnectionConfig.vue` | L331 | `rgba(89,194,255,0.25)` | 不变 | info 蓝色未变 |
| `ConnectionConfig.vue` | L460 | `rgba(127,217,98,0.22)` | `rgba(112,191,86,0.22)` | 同上 |
| `ConnectionConfig.vue` | L558-559 | `rgba(255,180,84,0.10)` / `rgba(255,180,84,0.45)` | `rgba(230,180,80,0.10)` / `rgba(230,180,80,0.45)` | accent 变 |
| `SessionTree.vue` | L413 | `rgba(127,217,98,0.20)` | `rgba(112,191,86,0.20)` | success 绿色变 |
| `SessionTree.vue` | L423 | `rgba(208,114,119,0.18)` | `rgba(217,87,87,0.18)` | error 变 |
| `SessionTree.vue` | L428 | `rgba(222,193,132,0.25)` | `rgba(230,180,80,0.25)` | accent 变 |
| `SubagentDetail.vue` | L1434-1443 | `rgba(255,180,84,0.06)` / `rgba(255,180,84,0.10)` | `rgba(230,180,80,0.06)` / `rgba(230,180,80,0.10)` | accent 变 |
| `SubagentDetail.vue` | L1477-1492 | `rgba(127,217,98,0.30)` / `rgba(255,180,84,0.35)` 等 | `rgba(112,191,86,0.30)` / `rgba(230,180,80,0.35)` 等 | success+accent 变 |
| `SubagentDetail.vue` | L1622-1623 | `rgba(255,180,84,0.07)` / `rgba(255,180,84,0.30)` | `rgba(230,180,80,0.07)` / `rgba(230,180,80,0.30)` | accent 变 |
| `SubagentDetail.vue` | L1695,1698 | `rgba(255,180,84,0.35)` / `rgba(255,180,84,0.30)` | `rgba(230,180,80,0.35)` / `rgba(230,180,80,0.30)` | accent 变 |
| `SubagentDetail.vue` | L2234,2238 | `rgba(226,107,115,0.45)` / `rgba(127,217,98,0.30)` | `rgba(217,87,87,0.45)` / `rgba(112,191,86,0.30)` | error+success 变 |
| `SubagentDetail.vue` | L2345-2347 | `rgba(89,194,255,0.35)` / `rgba(127,217,98,0.30)` | 不变 / `rgba(112,191,86,0.30)` | info 不变, success 变 |
| `PromptInput.vue` | L339 | `rgba(161,193,129,0.10)` | `rgba(170,217,76,0.10)` | string 绿色变 |

### 3.3 不变的文件

| 文件 | 原因 |
|------|------|
| `App.vue` | 全部使用 CSS 变量，无硬编码色值 |
| `ToastHost.vue` | `rgba(0,0,0,0.4)` 和 `#fff` 不变 |
| `index.html` | 字体加载，无关色值 |
| `tauri.conf.json` | 窗口配置，无关色值 |

---

## 4. 关键色差解释

### 4.1 为什么 vc-modified 必须改

当前 `--vc-modified: #ffb454` (橙黄色)与 `--text-accent` 相同。在 ayu 规范中：

- `--vc-modified: #73B8FF` (蓝色) — 与 `--info` / `syntax.entity` 同色系
- 含义：modified 文件应该用冷色调，与 added(绿)/removed(红)形成三色区分
- 当前用橙色表示修改，视觉上与 added 的绿色对比太弱，且与 accent 色混淆

### 4.2 为什么 text-primary 必须改

当前 `#e6e1cf` 是暖黄色调，ayu 的 `#BFBDB6` 是中性灰白色：

- ayu 的设计理念是"明亮但不刺眼"，editor.fg 是低饱和度的中性色
- 暖色文本在长时间阅读中会产生视觉疲劳
- 中性灰白与 ayu 的深蓝黑背景形成更好的对比度（~10:1）

### 4.3 为什么 accent 从 #FFB454 改为 #E6B450

- `#FFB454` 是 ayu 的 `syntax.func` (函数名色)
- `#E6B450` 是 ayu 的 `common.accent.tint` (UI 强调色)
- 两者仅差亮度，但语义不同：accent 用于按钮、焦点环、选中态，应该比语法色沉稳

---

## 5. 实施顺序

1. **`theme.css`** — 更新所有 CSS 变量（一文件搞定 80%）
2. **`SessionTree.vue`** — 更新 3 处 rgba 状态点发光色
3. **`ConnectionConfig.vue`** — 更新 5 处 rgba 状态点/按钮色
4. **`SubagentDetail.vue`** — 更新 ~12 处 rgba 标签/border/动画色
5. **`PromptInput.vue`** — 更新 1 处 rgba 运行状态色
6. **视觉验证** — 构建 `pnpm tauri dev`，目视检查每个面板

---

## 6. 验收标准

- [ ] `--vc-modified` 明显为蓝色（与 accent 橙色可区分）
- [ ] 文本颜色偏中性灰白，不偏黄
- [ ] accent 色比之前沉稳（偏金不偏黄）
- [ ] 状态点发光色与新语义色一致
- [ ] 所有组件无色块断裂或对比度问题
- [ ] `pnpm tauri build` 构建成功

---

## 7. UI/UX 精进:基于 Zed 源码的 Thinking & Tool 渲染对齐

> 数据来源: `zed-industries/zed` 仓库 `crates/agent_ui/src/conversation_view/thread_view.rs` (479KB GPUI Rust 源码)
> 核心函数: `render_thinking_block` (L6596), `render_tool_call` (L7415), `render_tool_call_label` (L8956), `render_subagent_tool_call` (L9488)

### 7.1 Zed 的精确实现

#### 7.1.1 Thinking Block (`render_thinking_block`, L6596-6703)

Zed 的 thinking block 结构:

```
┌─────────────────────────────────────────────────┐
│ [IconThink]  Thinking              [Disclosure▼] │  ← header (h_flex)
├─────────────────────────────────────────────────┤
│  │ thinking content (markdown)                   │  ← body (when open)
│  │ max-h: 64 (256px) when constrained            │
│  │ left border: tool_card_border_color           │
└─────────────────────────────────────────────────┘
```

**关键样式细节** (从 GPUI 代码提取):

| 元素 | Zed 实现 | CSS 等价
|------|----------|---------
| Header 高度 | `window.line_height() - 2px` | `height: calc(1em * 1.3 - 2px)` ≈ `18px`
| Header 布局 | `h_flex().relative().w_full().pr_1().justify_between()` | `display:flex; justify-content:space-between; padding-right:4px;`
| Thinking 图标 | `Icon::new(IconName::ToolThink).size(IconSize::Small).color(Color::Muted)` | 12px muted 图标
| "Thinking" 文字 | `text_size(tool_name_font_size())` = `13px`, `text_color(text_muted)` | `font-size:13px; color:var(--text-muted);`
| Header gap | `gap_1p5()` = 6px | `gap: 6px;`
| Disclosure 图标 | `ChevronUp` (open) / `ChevronDown` (closed), `visible_on_hover` | hover 才显示
| Header 点击 | 整个 header `on_click` → `toggle_thinking_block_expansion` | 整行可点击
| Body 左边框 | `ml_1p5()` (6px) + `pl_3p5()` (14px) + `border_l_1()` + `tool_card_border_color` | `margin-left:6px; padding-left:14px; border-left:1px solid var(--border);`
| Body 高度限制 | `max_h_64()` = 256px (when `is_constrained`) | `max-height: 256px;`
| Body 溢出 | `overflow_hidden()` | `overflow: hidden;`
| Body 内容 | `render_markdown(chunk, MarkdownStyle::themed(Agent))` | markdown 渲染,不是 `<pre>`
| 渐变遮罩 | `linear_gradient(180deg, panel_bg.opacity(0.8) at 0%, transparent at 10%)` — 只在 constrained 时 | 底部渐变遮罩提示可滚动

**ThinkingBlockDisplay 模式** (4 种,来自 settings crate):

| 模式 | 行为 |
|------|------|
| `Auto` | 自动展开最新 thinking block,用户可手动 toggle,新 block 出现时自动展开并滚动到底部 |
| `Preview` | 同 Auto 但更积极地预览 |
| `AlwaysExpanded` | 总是展开,用户 toggle 只标记但不影响展开状态 |
| `AlwaysCollapsed` | 总是折叠,用户 toggle 可临时展开 |

#### 7.1.2 Tool Call Label (`render_tool_call_label`, L8956-9103)

这是 collapsed 状态下显示的工具行:

```
┌──────────────────────────────────────────────────────┐
│ [ToolIcon] tool-label-text (markdown)    [gradient▸] │  ← label row
└──────────────────────────────────────────────────────┘
```

**ToolKind → IconName 精确映射** (L9007-9017,从 acp crate 的 ToolKind enum):

| ToolKind | IconName | 含义 | Monitor 对应工具 |
|----------|----------|------|------------------|
| `Read` | `ToolSearch` | 放大镜 | read, glob, grep, aft_outline, aft_zoom, aft_search |
| `Edit` | `ToolPencil` | 铅笔 | edit, write, apply_patch, aft_refactor, ast_grep_replace |
| `Delete` | `ToolDeleteFile` | 删除文件 | aft_delete |
| `Move` | `ArrowRightLeft` | 双向箭头 | aft_move |
| `Search` | `ToolSearch` | 放大镜 | ast_grep_search |
| `Execute` | `ToolTerminal` | 终端 | bash, bash_write, bash_status |
| `Think` | `ToolThink` | 大脑/思考 | (thinking block 专用) |
| `Fetch` | `ToolWeb` | 网页 | webfetch |
| `SwitchMode` | `ArrowRightLeft` | 切换 | (mode switch) |
| `Other` / `_` | `ToolHammer` | 锤子 | task, 其他所有 |

**文件路径图标** (L8971-8977): 当 tool_call 有 location (文件路径) 时,Zed 使用 `FileIcons::get_icon(path)` 获取文件类型图标(如 TypeScript 文件显示 TS 图标),而不是默认的 ToolPencil。如果路径找不到对应图标,回退到 `ToolPencil`。

**Label 样式细节**:

| 元素 | Zed 实现 | CSS 等价
|------|----------|---------
| 行高 | `window.line_height() - 2px` | ≈ `18px`
| 字号 | `tool_name_font_size()` = `13px` | `font-size: 13px;`
| gap | `gap_1p5()` = 6px | `gap: 6px;`
| padding | `px_1()` (when has_location) = 4px | `padding: 0 4px;`
| 圆角 | `rounded(3px)` (when has_location) | `border-radius: 3px;`
| hover | `bg(element_hover.opacity(0.5))` (when has_location) | `background: rgba(--bg-hover, 0.5);`
| 文字颜色 | `text` (use_card_layout) 或 `text_muted` (非 card) | `--text-primary` 或 `--text-muted`
| 渐变遮罩 | 右侧 48px 宽,从 `tool_card_header_bg` 到透明 — 防止文字被 disclosure 遮挡 | `linear-gradient(90deg, var(--bg-element), transparent);`

#### 7.1.3 Tool Call Card (`render_tool_call`, L7415-7820)

**卡片布局决策** (L7459):
```
use_card_layout = needs_confirmation || is_edit || is_terminal_tool
```
只有需要确认、编辑操作、或终端操作才用卡片布局(有边框+圆角+背景)。其他工具用内联布局(只有 margin)。

**卡片样式** (L7717-7734):

| 元素 | Zed 实现 | CSS 等价
|------|----------|---------
| 卡片外边距 | `my_1p5()` = 6px 上下 | `margin: 6px 0;`
| 圆角 | `rounded_md()` = 6px | `border-radius: 6px;`
| 边框 | `border_1()`, 失败时 `border_dashed()` | `border: 1px solid var(--border);` 失败时 `border-style: dashed;`
| 背景 | `bg(editor_background)` | `background: var(--bg-editor);`
| 溢出 | `overflow_hidden()` | `overflow: hidden;`
| 左边距 | `ml_5()` (standalone non-card) = 20px | `margin-left: 20px;`
| 右边距 | `mr_5()` (standalone) = 20px | `margin-right: 20px;`

**Header 样式** (L7757-7766):

| 元素 | Zed 实现 | CSS 等价
|------|----------|---------
| Header 布局 | `h_flex().group().relative().w_full().justify_between()` | `display:flex; justify-content:space-between; position:relative;`
| Header padding | `p_0p5()` = 2px (when card) | `padding: 2px;`
| Header 圆角 | `rounded_t(5px)` (top only) | `border-radius: 5px 5px 0 0;`
| Header 背景 | `tool_card_header_bg` = `element_background.blend(editor_foreground.opacity(0.025))` | ≈ `var(--bg-element)` 混入微量前景色
| Disclosure | `ChevronUp/ChevronDown`, `visible_on_hover` | hover 显示

**tool_card_header_bg 公式** (L9958-9963):
```
element_background.blend(editor_foreground.opacity(0.025))
```
即:背景色混入 2.5% 不透明度的前景色 — 微微提亮,在视觉上区分 header 和 body。

**tool_card_border_color 公式** (L9965-9967):
```
border.opacity(0.8)
```
即:边框色 80% 不透明度 — 比纯边框色更柔和。

**Body (collapsed 时隐藏) 样式**:

| 元素 | Zed 实现 | CSS 等价
|------|----------|---------
| Body 布局 | `div().ml(0.4rem).px_3p5().pt_2().border_l_1()` | `margin-left:6px; padding:8px 14px; border-left:1px solid var(--border);`
| Body 内容 | markdown / diff editor / terminal / image | 不是 `<pre>` — 是富文本渲染
| 折叠按钮 | `IconButton(ChevronUp).full_width().style(Outlined).icon_color(Muted)` | 底部全宽折叠按钮

#### 7.1.4 Subagent Tool Call (`render_subagent_tool_call`, L9488)

Subagent (task 工具) 有独立的卡片渲染:

```
┌──────────────────────────────────────────────────────┐
│ [Spinner/Check/Close]  Title  — N files changed  [▾] │  ← header
│                                    [+NNN -NNN diffstat]│
├──────────────────────────────────────────────────────┤
│  subagent content (nested thread entries)            │  ← body (when expanded)
└──────────────────────────────────────────────────────┘
```

**状态图标** (L9600-9631):

| 状态 | 图标 | 颜色 |
|------|------|------|
| Running | `SpinnerLabel` (旋转加载器) | — |
| Canceled | `IconName::Circle` | `icon_disabled.opacity(0.5)` |
| Failed | `IconName::Close` | `Color::Error` |
| Completed | `IconName::Check` | `Color::Success` |

**关键差异 vs Monitor 当前实现**:
- Zed subagent 卡片 **总是有边框和圆角** (rounded_md + border_1)
- Zed 在 subagent header 显示 **diffstat** (+NNN -NNN 行变更统计)
- Zed 失败/取消时边框变 **虚线** (`border_dashed`)
- Zed 的 disclosure 图标是 **hover 才显示** (`visible_on_hover`)

### 7.2 Monitor 与 Zed 的差距清单

| # | 差距 | Monitor 当前 | Zed 目标 | 优先级 |
|---|------|-------------|----------|--------|
| 1 | **Tool 图标缺失** | 只显示工具名文本 | ToolKind → IconName 映射 (10 种图标) | 🔴 高 |
| 2 | **文件路径图标缺失** | 无 | FileIcons::get_icon(path) 按扩展名显示文件图标 | 🔴 高 |
| 3 | **Thinking body 用 `<pre>`** | `<pre>{{ text }}</pre>` 纯文本 | markdown 渲染 (MarkdownStyle::themed) | 🟡 中 |
| 4 | **Thinking body 无渐变遮罩** | 直接 `overflow-y: auto` | 底部 linear_gradient 遮罩提示可滚动 | 🟡 中 |
| 5 | **Disclosure 图标行为** | 总是可见 | `visible_on_hover` — hover 才显示 | 🟡 中 |
| 6 | **Header 高度不一致** | 无固定高度 | `line_height - 2px` ≈ 18px | 🟢 低 |
| 7 | **卡片布局决策缺失** | 所有 tool 统一样式 | 只有 edit/terminal/confirm 用卡片,其他用内联 | 🟡 中 |
| 8 | **tool_card_header_bg 缺失** | 用 `--bg-element` | element_background + 2.5% foreground blend | 🟢 低 |
| 9 | **border 不透明度** | 100% | 80% opacity | 🟢 低 |
| 10 | **Subagent diffstat 缺失** | 无变更统计 | +NNN -NNN 行变更统计 | 🟡 中 |
| 11 | **失败时虚线边框** | 实线 | `border_dashed` | 🟢 低 |
| 12 | **折叠按钮位置** | header 右侧 | header 右侧 (hover) + body 底部全宽 | 🟡 中 |

### 7.3 修改方案

#### 7.3.1 ToolKind → 图标映射 (lucide-vue-next)

Zed 用自定义 IconName (ToolSearch, ToolPencil 等),Monitor 用 lucide-vue-next 等价替换:

> **⚠️ 构建注意 (2026-06-24 代码核查发现):**
> `SubagentDetail.vue` L12-29 已存在 lucide 导入块,其中 `Terminal, Loader2, XCircle, Circle, ChevronDown` 5 个符号已导入。
> **切勿粘贴为新导入块** — 否则 TS 报重复导入错误。必须**合并**进现有导入块,只新增缺失的:`Search, Pencil, FileX, ArrowLeftRight, Brain, Globe, Wrench, ChevronUp`。
>
> 另外 `tsconfig.json` L19 启用了 `noUnusedLocals: true`,构建脚本 `package.json` L8 为 `vue-tsc --noEmit && vite build`。
> 因此 `toolIcon` 函数必须在**同一 commit** 内于模板中加入调用点,否则类型检查失败:
> ```vue
> <component :is="toolIcon((part as ToolPart).tool)" :size="12" class="tool-header-icon" />
> ```

```ts
// SubagentDetail.vue <script setup>
// 合并进现有 L12-29 导入块,仅新增缺失符号 (Search/Pencil/FileX/ArrowLeftRight/Brain/Globe/Wrench/ChevronUp)
// 已存在的: Terminal, Loader2, XCircle, Circle, ChevronDown — 勿重复声明
import {
  Search, Pencil, FileX, ArrowLeftRight, Brain,
  Globe, Wrench,
  ChevronUp
  // Terminal, Loader2, XCircle, Circle, ChevronDown — 已在 L12-29 导入
} from 'lucide-vue-next'

function toolIcon(tool: string): Component {
  // ToolKind::Read / Search
  if (['read','glob','grep','ast_grep_search','aft_outline','aft_zoom','aft_search','aft_inspect'].includes(tool))
    return Search
  // ToolKind::Edit
  if (['edit','write','apply_patch','aft_refactor','ast_grep_replace','aft_import'].includes(tool))
    return Pencil
  // ToolKind::Delete
  if (['aft_delete'].includes(tool))
    return FileX
  // ToolKind::Move
  if (['aft_move'].includes(tool))
    return ArrowLeftRight
  // ToolKind::Execute
  if (['bash','bash_write','bash_status','bash_watch','bash_kill'].includes(tool))
    return Terminal
  // ToolKind::Fetch
  if (['webfetch'].includes(tool))
    return Globe
  // ToolKind::Think
  if (tool === 'thinking' || tool === 'reasoning')
    return Brain
  // ToolKind::Other / _
  return Wrench
}
```

#### 7.3.2 文件路径图标 (catppuccin/zed-icons 集成)

Zed 在 `render_tool_call_label` 中,当 tool_call 有 location 时使用 `FileIcons::get_icon(path)`。Monitor 可以在 tool 输出中解析文件路径,显示对应图标:

> **⚠️ 设计缺口 (2026-06-24 代码核查发现):**
> 下方初稿只处理了 `filePath` 字段且重复检查了两次。实际各工具 input 字段名不同,需要逐工具提取。
> 下方已修正为完整的 per-tool 提取器。模板插入点:`SubagentDetail.vue` tool-row (L941-942,`.tool-name` 之前)。

```ts
// 从 tool 输入参数中提取文件路径 — 各工具字段名不同
function extractFilePath(tool: string, input: unknown): string | null {
  if (typeof input !== 'object' || !input) return null
  const obj = input as Record<string, unknown>
  const str = (k: string) => (k in obj && typeof obj[k] === 'string' ? obj[k] as string : null)
  // read / edit / write / apply_patch / aft_zoom / aft_outline / aft_inspect
  return str('filePath')
    // grep
    ?? str('path')
    // glob
    ?? str('pattern')
    // ast_grep_search / ast_grep_replace (paths 数组取首项)
    ?? (Array.isArray(obj.paths) && obj.paths.length ? String(obj.paths[0]) : null)
}
```

然后用 `FileIcon.vue` 组件(见第 8 节)显示文件类型图标。

#### 7.3.3 Thinking Block 样式对齐

```css
/* SubagentDetail.vue <style scoped> */

.thinking {
  display: flex;
  flex-direction: column;
  gap: 4px;  /* gap_1 */
}

.thinking-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 18px;  /* line_height - 2px */
  padding-right: 4px;  /* pr_1 */
  position: relative;
  cursor: pointer;
  background: none;
  border: none;
}

.thinking-toggle-left {
  display: flex;
  align-items: center;
  gap: 6px;  /* gap_1p5 */
  overflow: hidden;
}

.thinking-toggle-icon {
  color: var(--text-muted);  /* Color::Muted */
  flex-shrink: 0;
}

.thinking-toggle-label {
  font-size: 13px;  /* tool_name_font_size */
  color: var(--text-muted);
}

.thinking-toggle-disclosure {
  opacity: 0;  /* visible_on_hover */
  transition: opacity 150ms var(--ease-out-quint);
  color: var(--text-muted);
}

.thinking-toggle:hover .thinking-toggle-disclosure {
  opacity: 1;
}

.thinking-body {
  margin-left: 6px;  /* ml_1p5 */
  padding-left: 14px;  /* pl_3p5 */
  padding-top: 8px;
  border-left: 1px solid var(--border);  /* border_l_1 + tool_card_border_color (80% opacity) */
  max-height: 256px;  /* max_h_64 when constrained */
  overflow: hidden;
  position: relative;
}

/* Zed 的底部渐变遮罩 — 提示可滚动 */
/* ⚠️ 2026-06-24 设计审查修正:原 rgba(15,20,28,*) 为旧 --bg-editor 值,#0f1419=rgb(15,20,25)。
   遮罩应淡入 .thinking-body 所在父表面(--bg-panel #141821 = rgb(20,24,33)),
   否则渐变末端与面板背景之间出现可见色块接缝。已更正。 */
.thinking-body::after {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 32px;
  background: linear-gradient(
    180deg,
    rgb(20 24 33 / 0) 0%,
    rgb(20 24 33 / 0.85) 100%
  );
  pointer-events: none;  /* block_mouse_except_scroll */
}
```

#### 7.3.4 Tool Call 样式对齐

> **⚠️ 设计缺口 (2026-06-24 代码核查发现):**
> 下方 CSS 引用 `.tool-header` / `.tool-part--card` / `.tool-part--inline` / `.tool-header-icon` 等类名,
> 但现有 `SubagentDetail.vue` 模板用的是 `.tool-row` (L941 模板, L2090 CSS) / `.tool-name` (L2098) / `.tool-state` (L2105)。
> **本节只给 CSS,未给模板重构。** 实施时必须同时:
> 1. 在 `<script setup>` 加 `isCardTool()` 判定函数(映射 Zed 的 `needs_confirmation || is_edit || is_terminal_tool` 规则):
>    ```ts
>    const CARD_TOOLS = new Set(['edit','write','apply_patch','aft_refactor','ast_grep_replace','aft_import','aft_delete','aft_move','bash','bash_write','bash_status','bash_watch','bash_kill'])
>    function isCardTool(tool: string): boolean { return CARD_TOOLS.has(tool) }
>    ```
> 2. 在 tool-part 元素 (L940) 上加 `:class="{ 'tool-part--card': isCardTool(...), 'tool-part--inline': !isCardTool(...) }"`。
> 3. 把模板里的 `.tool-row` (L941) 重命名为 `.tool-header`(或同时保留两个类名做兼容)。
> 4. 在 `.tool-header-left` 内、`.tool-name` 之前插入 7.3.1 的 `<component :is="toolIcon(...)" />` 图标。
>
> **高输出工具说明 (2026-06-24 设计审查建议):** 当前 `CARD_TOOLS` 仅包含 edit/terminal 类,
> 高输出只读工具 (`read`/`webfetch`/`grep`) 设为 inline。
> 若 Monitor 将 `read` 的文件全文渲染为内联输出(而非仅显示文件路径标签),
> 则 400+ 行的文件内容会挤占相邻工具的空间 — 应将 `read`/`webfetch`/`grep` 也加入 `CARD_TOOLS`。
> 实施 Phase 2c 时先验证 Monitor 的实际渲染行为,再决定是否扩展集合。

```css
/* SubagentDetail.vue <style scoped> */

.tool-part {
  margin: 6px 0;  /* my_1p5 */
}

/* 卡片布局 — 只用于 edit/terminal/confirm */
.tool-part--card {
  border: 1px solid var(--border);  /* border_1 + tool_card_border_color */
  border-radius: 6px;  /* rounded_md */
  background: var(--bg-editor);  /* editor_background */
  overflow: hidden;
}

.tool-part--card.tool-part--failed {
  border-style: dashed;  /* border_dashed when failed */
}

/* 内联布局 — 其他工具 */
.tool-part--inline {
  margin: 4px 0;  /* my_1 */
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  width: 100%;
}

.tool-header--card {
  padding: 2px;  /* p_0p5 */
  border-radius: 5px 5px 0 0;  /* rounded_t(5px) */
  /* tool_card_header_bg = element_bg blended with 2.5% foreground */
  background: var(--bg-element);
}

.tool-header-left {
  display: flex;
  align-items: center;
  gap: 6px;  /* gap_1p5 */
  height: 18px;  /* line_height - 2px */
  font-size: 13px;  /* tool_name_font_size */
  overflow: hidden;
}

.tool-header-icon {
  color: var(--text-muted);  /* Color::Muted */
  flex-shrink: 0;
}

.tool-header-name {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-muted);  /* text_muted (非 card) 或 text (card) */
}

/* 渐变遮罩 — 防止文字被 disclosure 遮挡 */
.tool-header-gradient {
  position: absolute;
  top: 0;
  right: 0;
  width: 48px;  /* w_12 = 48px */
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--bg-element) 100%  /* tool_card_header_bg or panel_background */
  );
  pointer-events: none;
}

.tool-disclosure {
  opacity: 0;  /* visible_on_hover */
  transition: opacity 150ms var(--ease-out-quint);
  color: var(--text-muted);
}

.tool-header:hover .tool-disclosure {
  opacity: 1;
}

.tool-body {
  margin-left: 6px;  /* ml(0.4rem) */
  padding: 8px 14px;  /* pt_2 + px_3p5 */
  border-left: 1px solid var(--border);
  border-top: 1px solid var(--border);  /* border_t_1 (card layout) */
}
```

#### 7.3.5 折叠图标改用 ChevronUp/ChevronDown

Monitor 当前用 `ChevronRight` (收起) / `ChevronDown` (展开)。Zed 用 `ChevronDown` (收起) / `ChevronUp` (展开):

```vue
<!-- 改为: -->
<component
  :is="expandedToolBodies.has(part.id) ? ChevronUp : ChevronDown"
  :size="12"
  class="tool-disclosure"
/>
```

> **⚠️ 构建注意 (2026-06-24 代码核查发现):**
> 1. `ChevronUp` 当前未在 `SubagentDetail.vue` 任何位置导入 — 必须加入 L12-29 导入块。
> 2. `noUnusedLocals: true` (tsconfig.json L19):若把全部 6 处 `ChevronRight` 都换掉(L872, 876, 929, 958, 1002, 1055, 1099),
>    原 L17 的 `ChevronRight` 导入变为未使用 → `vue-tsc` 失败。
> 3. **推荐**:只换 5 处 tool/reasoning/subtask disclosure (L929, 958, 1002, 1055, 1099),
>    **保留 L872-876 parent-summary toggle 不变** — 这样 `ChevronRight` 仍被使用,导入无需删除。
>    若坚持全换,必须在同一 edit 内把 `ChevronRight` 从 L17 导入中移除。

### 7.4 风险评估:不影响功能 ✅

> **2026-06-24 代码核查更新**:本节原文只评估了数据流风险,未评估构建层风险。
> 下方分两部分:数据流(零风险,已逐项验证)+ 构建层(有 5 个机械问题需处理)。

#### 7.4.1 数据流风险 — 零风险(已验证)

| 操作 | 影响范围 | 功能影响 | 验证方式 |
|------|----------|----------|----------|
| CSS 变量改值 | 纯视觉 | ❌ 无 | `src/` 下 `getComputedStyle`/`getPropertyValue` 0 匹配 — 变量无 JS 读取方 |
| 添加 tool-icon | 模板新增一个 `<component>` | ❌ 无 — 不改数据逻辑 | `toolIcon` 全局 0 匹配,无命名冲突 |
| thinking/tool 样式微调 | scoped CSS | ❌ 无 — 不改 v-if/v-show/v-for | 模板条件表达式保留不变 |
| 添加 toolIcon() 函数 | 新增一个纯函数 | ❌ 无 — 不改 store/props/events | `session.ts`/`composables/*` 零触及 |
| ChevronRight → ChevronDown | 图标方向变更 | ❌ 无 — 不改 toggle 逻辑 | `expandedToolBodies.has()` 判定保留 |
| 添加渐变遮罩 ::after | 纯 CSS 伪元素 | ❌ 无 — 不改 DOM 结构 | 伪元素不进入 DOM 树 |

**结论(数据流):所有修改都在表现层(template + scoped CSS),不碰数据模型、store、API 调用、事件处理、composables。数据流零风险,已逐项验证。**

#### 7.4.2 构建层风险 — 5 个机械问题(必须处理,否则 `pnpm tauri build` 失败)

构建脚本 `package.json` L8 = `vue-tsc --noEmit && vite build`;`tsconfig.json` L19 = `noUnusedLocals: true`。
类型检查先于 Vite 运行,任何未使用符号即失败。

| # | 阶段 | 问题 | 修复 |
|---|------|------|------|
| 1 | 2a | lucide 导入重复声明 (Terminal/Loader2/XCircle/Circle/ChevronDown 已在 L12-29) | 合并导入,勿粘贴为新块 |
| 2 | 2a | `toolIcon` 加了函数但模板未调用 → noUnusedLocals | 同 commit 内加模板 `<component :is="toolIcon(...)" />` |
| 3 | 2d | 6 处 ChevronRight 全换 → L17 导入未使用 | 只换 5 处(L929/958/1002/1055/1099),保留 L872-876;或同步删导入 |
| 4 | 3 | FileIcon.vue 内 `<FileIcon v-else/>` 与组件名自引用 → 递归渲染 | 改为 `<LucideFileIcon v-else/>`,`import { FileIcon as LucideFileIcon }` |
| 5 | 3 | `src/assets/icons/file-icons/` 不存在 → `new URL(...).href` 运行时 404 | 先执行 8.2 Step 1 (clone catppuccin/zed-icons) |

**结论(构建层):5 个问题均为机械修复,非设计风险。按各阶段"构建注意"提示处理即可。**

#### 7.4.3 文档勘误

| 位置 | 原文 | 实际 |
|------|------|------|
| 3.1 SessionTree.vue L413 当前值 | `rgba(127,217,98,0.20)` | `rgba(161,193,129,0.20)` — 提议新值仍有效 |
| 3.1 未列入 | SubagentDetail.vue L2347 `rgba(141,147,158,0.40)` | `--text-muted` 分解值,Phase 1 后残留暖灰 — 可选追加 |
| ToastHost.vue L49-96 | `var(--text-muted, #8d939e)` 等 fallback | 惰性漂移,变量已在 :root 定义,fallback 不生效 — 无需改 |

---

## 8. Catppuccin Zed Icons 集成

### 8.1 方案概述

从 [catppuccin/zed-icons](https://github.com/catppuccin/zed-icons) 提取 SVG 图标,用于 Monitor 的文件类型显示。

**可行性:✅ 完全可行**

| 属性 | 值 |
|------|-----|
| 格式 | SVG (16×16, stroke-based, 内联颜色) |
| 数量 | 656 unique × 4 flavors = 2,624 files |
| 许可 | MIT ✅ |
| 依赖 | 无 — 纯 SVG,无需运行时 |
| 映射 | `catppuccin-icons.json` 639KB 完整的 extension→icon 映射 |

### 8.2 实施方案

#### Step 1: 提取图标

> **⚠️ 前置条件:** 此步骤必须在 Phase 3 首次构建前完成。
> `src/assets/icons/file-icons/` 目录当前不存在,若跳过此步,FileIcon.vue 的 `new URL(...).href` 在运行时 404。

```bash
# 克隆仓库
git clone https://github.com/catppuccin/zed-icons.git temp/zed-icons

# 只复制 mocha (dark) flavor — 与 ayu night 最搭配
cp -r temp/zed-icons/icons/mocha/ src/assets/icons/file-icons/

# 清理
rm -rf temp/zed-icons
```

#### Step 2: 构建映射表

从 `catppuccin-icons.json` 的 mocha theme 提取 `file_suffixes` → `file_icons` 映射,
生成一个轻量的 TypeScript 映射文件:

```ts
// src/assets/icons/file-icon-map.ts
export const fileIconMap: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript-react',
  vue: 'vue',
  js: 'javascript',
  jsx: 'javascript-react',
  py: 'python',
  rs: 'rust',
  go: 'go',
  // ... 从 manifest 提取
}
```

#### Step 3: Vue 组件中使用

```vue
<!-- FileIcon.vue -->
<template>
  <img
    v-if="iconName"
    :src="iconSrc"
    :alt="fileName"
    class="file-icon"
    width="16"
    height="16"
  />
  <LucideFileIcon v-else :size="16" class="file-icon file-icon--fallback" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
// ⚠️ 必须用别名导入:组件名是 FileIcon,若直接 import { FileIcon } 会与自身标签冲突 → 递归渲染
import { FileIcon as LucideFileIcon } from 'lucide-vue-next'
import { fileIconMap } from '@/assets/icons/file-icon-map'

const props = defineProps<{ fileName: string }>()

const iconName = computed(() => {
  const ext = props.fileName.split('.').pop()?.toLowerCase()
  return ext ? fileIconMap[ext] : null
})

const iconSrc = computed(() =>
  iconName.value
    ? new URL(`../assets/icons/file-icons/${iconName.value}.svg`, import.meta.url).href
    : null
)
</script>

<style scoped>
.file-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.file-icon--fallback {
  color: var(--text-muted);
}
</style>
```

#### Step 4: 应用位置

在 Monitor 中,文件类型图标可用于:

| 位置 | 用法 |
|------|------|
| Tool 调用结果中的文件路径 | `read("src/main.ts")` → 显示 TypeScript 图标 |
| Session 树中的文件条目 | 如果未来添加文件树视图 |
| Diff 视图中的文件头 | 左侧显示对应语言图标 |
| 部分(part)标题中的文件名 | 编辑操作的结果中 |

**当前优先级:先在 Tool 调用结果中显示文件图标。** 当 tool name 是 `read`/`edit`/`write` 且参数包含文件路径时,解析出扩展名并显示对应图标。

### 8.3 色彩兼容性

> **2026-06-24 设计审查修正:** 原文"颜色不会冲突"过于乐观。实际影响:

Catppuccin mocha 图标的颜色方案:
- 使用 catppuccin 自己的 palette (蓝、绿、黄等)
- Catppuccin mocha 设计目标背景为 `#1E1E2E` (luma ~0.027),而 ayu night 内容表面 `#0D1017`~`#141821` (luma ~0.005–0.018),**暗 2~5 倍**
- 最明显差异:catppuccin 的淡黄 `#F9E2AF` vs ayu 的 `#E6B450` — 文件图标黄色(Yellow)与语法高亮 `--syn-func` (`#FFB454`) 相邻时,两种黄色会有色温不一致感
- 整体 catppuccin palette 偏暖偏粉,ayu 偏冷偏蓝 — 图标会略显"外来"

**建议缓解措施:**

```css
/* 8.2 Step 3 的 FileIcon.vue 或全局 .file-icon */
.file-icon {
  filter: saturate(0.92) brightness(0.96);
  /* 降低饱和度+亮度,使 catppuccin 图标更融入 ayu 的冷暗表面 */
}
```

**如果未来需要更强的 ayu 风格**,可以:
1. 用 CSS `filter: hue-rotate(Xdeg) saturate(Y)` 进一步微调
2. 或直接 fork 图标仓库,将 SVG 中的 catppuccin hex 替换为 ayu palette 值

但初始集成时,上述 `saturate(0.92) brightness(0.96)` 滤镜已足够,不需要立即调整 SVG 源文件。

---

## 9. 综合实施路线图

> **2026-06-24 代码核查修订:** 原 Phase 1→2a→2b→2c→2d→3 顺序的依赖方向正确,
> 但缺构建安全排序。`noUnusedLocals` 风险集中在 2a/2d,应在 2b/2c 之前隔离处理。
> Phase 2c 需模板重构(未在原文档展开),推后到 2b 之后降低风险。
> 每阶段后均加 `pnpm tauri build` 检查点(完整 release 构建约 2min)。

| 阶段 | 内容 | 文件 | 工作量 | 优先级 | 构建后状态 |
|------|------|------|--------|--------|-----------|
| **Phase 1** | Ayu Night 色彩对齐 | `theme.css` + 4 个 Vue 组件的 rgba | ~30min | 🔴 高 | ✅ 绿通过 |
| **Phase 2a** | ToolKind → 图标映射 (导入合并 + 模板调用同 commit) | `SubagentDetail.vue` 模板+脚本 | ~25min | 🔴 高 | ✅ 绿通过 |
| **Phase 2d** | ChevronUp 加入导入 + 换 5 处 (保留 L872-876) | `SubagentDetail.vue` 模板 | ~10min | 🟢 低 | ✅ 绿通过 |
| **Phase 2b** | Thinking 样式对齐 (渐变遮罩、hover disclosure) | `SubagentDetail.vue` scoped CSS | ~30min | 🟡 中 | ✅ 绿通过 |
| **Phase 2c** | Tool Call 样式 + 模板重构 (isCardTool + 类名 + :class 绑定) | `SubagentDetail.vue` 模板+CSS | ~45min | 🟡 中 | ✅ 绿通过 |
| **Phase 3** | Catppuccin 文件图标 (含 SVG 前置 + FileIcon.vue 修复 + 模板插入) | 新增 `FileIcon.vue` + `file-icon-map.ts` + SVG + `SubagentDetail.vue` | ~50min | 🟡 中 | ✅ 绿通过 |
| **Phase 4** | 视觉验收 | `pnpm tauri dev` 逐面板检查 | ~15min | — | — |

**总计:~3.5 小时(含构建安全修复)。每阶段可独立验收并 commit。**

> **注:** 原 Phase 2b 标题含"markdown",但 7.3.3 实现未含 `<pre>`→markdown 渲染迁移(需额外 markdown 渲染依赖,当前 `package.json` 无)。
> 本路线图将 markdown 迁移从本轮移除,保持 2b 为纯 scoped CSS。

### 实施依赖关系

```
Phase 1 (色彩) ──────────────┐
                               │
Phase 2a (tool 图标) ─────────┤   ← 导入合并 + 模板调用必须同 commit
                               │
Phase 2d (chevron,提前) ──────┤   ← 隔离 noUnusedLocals 风险
                               │
Phase 2b (thinking CSS) ──────┤
                               │
Phase 2c (tool 样式+模板重构) ─┤   ← 推后:最侵入性模板改动
                               │
Phase 3 (文件图标) ───────────┘   ← 依赖 2a 的 tool 图标框架
        │
        ├─ Step 1 (clone SVG) 必须先于 Phase 3 构建
        └─ FileIcon.vue 别名修复必须同 commit
                               │
                               └─→ Phase 4 (验收)
```

**执行顺序调整说明:**
- **Phase 2d 提前到 2b/2c 之前**:最小模板改动,尽早隔离 `noUnusedLocals` 导入清理风险。
- **Phase 2c 推后到 2b 之后**:需模板重构(`.tool-row`→`.tool-header`、`isCardTool()`、`:class` 绑定),在 2a/2b/2d 稳定后做最安全。
- **Phase 3 保持最后**:依赖 2a 的 tool 图标框架 + 需 SVG 前置 + FileIcon.vue 别名修复。

### 每阶段验收检查点

每阶段完成后执行:
1. `pnpm tauri dev` — 打开 app,逐面板肉眼检查
2. `pnpm tauri build` — 完整 release 构建(~2min),确认 `vue-tsc` 类型检查 + Vite 打包均通过
3. `git commit` — 阶段独立提交,便于回滚

### 验收检查清单

**视觉验收 (Phase 4):**
- [ ] `--vc-modified` 明显为蓝色(与 accent 橙色可区分)
- [ ] 文本颜色偏中性灰白,不偏黄
- [ ] accent 色比之前沉稳(偏金不偏黄)
- [ ] 状态点发光色与新语义色一致
- [ ] 所有工具调用旁显示语义图标(放大镜/铅笔/终端/锤子)
- [ ] 编辑类工具的文件路径旁显示文件类型图标
- [ ] Thinking block 底部有渐变遮罩
- [ ] Disclosure 箭头 hover 才显示
- [ ] 折叠图标方向:展开=ChevronUp,收起=ChevronDown
- [ ] 编辑/终端工具用卡片布局(有边框),其他用内联布局
- [ ] 失败的工具边框为虚线

**构建安全验收 (每阶段):**
- [ ] `pnpm tauri build` 构建成功(vue-tsc 类型检查 + Vite 打包均通过)
- [ ] Phase 2a: 无 lucide 重复导入;`toolIcon` 在模板有调用点
- [ ] Phase 2d: `ChevronUp` 已导入;若 L872-876 未换则 `ChevronRight` 仍被使用
- [ ] Phase 3: `FileIcon.vue` 使用 `LucideFileIcon` 别名;`src/assets/icons/file-icons/` 目录存在
