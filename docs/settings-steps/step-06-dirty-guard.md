# 步骤 6：脏状态守卫 — 关闭确认对话框

> **共享上下文**：参见 `_shared-context.md`

## 范围

实现关闭抽屉时的未保存更改确认对话框。

## 前置条件

步骤 5 完成。

## 实现要点

1. **这是一个参数化确认对话框组件**（`<ConfirmDialog>`），被多个步骤复用：
   - 步骤 3 的实例切换触发
   - 步骤 6 的关闭抽屉触发
   - 步骤 5 的重启确认（横幅形式，非对话框）

2. **组件接口**：
   ```typescript
   interface ConfirmDialogProps {
     title: string                        // "未保存的更改" | "切换实例前保存更改？"
     bodyLines: string[]                  // 每行一个 <p>
     dirtyCount: number | null            // 脏字段数量（dirtyPaths.size，与步骤 2/4 一致）
     onCancel: () => void                 // pendingDismiss = null
     onDiscard: () => void                // forceDismiss()
     onSaveAndContinue: () => Promise<boolean>  // saveConfig + 后续操作。设置 pendingSave = true，finally 清除
     cancelLabel?: string                 // 默认: "取消"
     discardLabel?: string                // 默认: "放弃更改"
     saveLabel?: string                   // 默认: "保存并重启" | "保存并切换"
   }
   ```

3. **触发场景**：
   - 点击抽屉关闭按钮 ChevronRight → `requestDismiss({ kind: 'close' })`
   - 按 Escape → 同上
   - 切换实例（步骤 3）→ `requestDismiss({ kind: 'switch-instance', newUrl })`
   - **Tauri 窗口关闭**（OS 关闭按钮 / Alt+F4）→ `requestDismiss({ kind: 'window-close' })`。在 `App.vue` 注册 `appWindow.onCloseRequested(async (event) => { if (configStore.isDirty) { event.preventDefault(); configStore.requestDismiss({ kind: 'window-close' }) } })`。这是最高风险的退出路径，必须覆盖。
   - **`Ctrl+,` 切换**：共享上下文定义 `Ctrl+,` 为 toggle。如果有脏状态，`Ctrl+,` 关闭路径必须走 `requestDismiss({ kind: 'close' })`，不能直接 `panelOpen = false` 绕过守卫。定义 `Ctrl+,` 为 open-only（当抽屉关闭时打开），关闭时走 dismiss 流程。
   - 都设置 `pendingDismiss` 为非 null 值（`DismissReason` 联合类型）

4. **对话框设计**（独立组件 `ConfirmDialog.vue`，非内联）：
   - `role="alertdialog"` + `aria-modal="true"` + `aria-labelledby` + `aria-describedby`
   - **DOM 位置**：ConfirmDialog 作为 `.settings-drawer` 的直接子节点（与 `.drawer-body` 同级），不是 `.drawer-body` 的子节点。这确保 `:inert` 不会波及对话框自身。
   - **`:inert` 范围**：对话框打开时，`drawer-header`、`drawer-instance-bar`、`drawer-body`、`drawer-footer` 全部设置 `:inert="dialogOpen"`。如果只 inert `.drawer-body`，header/footer 的按钮仍可点击，会覆盖 `pendingDismiss` 或并发触发 `saveConfig()`。
   - 表面 `var(--bg-app)`（比抽屉的 `var(--bg-panel)` 深一层）
   - 边框 `var(--border)` + 内阴影 `0 1px 0 rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.4)`
   - 最小宽度 280px，最大宽度 480px
   - `< 900px` 时：`max-width: calc(100vw - 32px)`

5. **按钮布局**（按破坏性从左到右递增）：
   - **左侧**：`保存并重启`（filled，`var(--text-accent)`）— 建设性操作
   - **中间**：`取消`（ghost，`var(--text-muted)`）— 中性操作
   - **右侧**：`放弃更改`（outline，`var(--error)` 边框）— 破坏性操作

6. **交互规则**：
   - Escape 关闭对话框（等同于 "取消"）— **必须 `event.stopPropagation()`** 防止 Escape 冒泡到抽屉的 keydown listener 重新触发 `requestDismiss`。或抽屉的 Escape handler 检查 `pendingDismiss.value !== null` 并短路。
   - 点击对话框外部**不关闭**（全部 drawer 子节点 `:inert` 防止焦点逃逸）
   - 打开时焦点移到 "取消" 按钮（最安全的默认选项）
   - `inert`：对话框打开时 `drawer-header`/`drawer-instance-bar`/`drawer-body`/`drawer-footer` 不可交互

7. **"保存并重启" 失败路径**：
   - 点击 → 禁用按钮（`phase !== 'idle'` 时）+ 显示 Loader2
   - `saveConfig()` 返回 `true` → 关闭对话框 + 关闭抽屉
   - `saveConfig()` 返回 `false` → 对话框保持打开，内联显示错误（`var(--error)` 左侧线），重新启用按钮

8. **对话框/横幅堆叠处理**：
   - 点击 "保存并重启" → 对话框关闭，重启横幅接管
   - 用 `pendingCloseOnSuccess` 标记：save 成功后 `forceDismiss()`
   - 重启期间（`phase !== 'idle'`）抽屉 X 按钮禁用，横幅替代

9. **无脏状态时**：
   - `requestDismiss()` 直接调用 `forceDismiss()`，不显示对话框

10. **`pendingDismiss` 类型**：
     ```typescript
     type DismissReason =
       | { kind: 'close' }
       | { kind: 'switch-instance'; newUrl: string }
       | { kind: 'window-close' }  // Tauri 窗口关闭
     const pendingDismiss = ref<DismissReason | null>(null)
     ```
     > **`window-close` 的 discard 语义**：discard 时调用 `appWindow.destroy()` 真正关闭窗口。
     > **与步骤 1 一致**：步骤 1 store 契约中 `pendingDismiss` 也是 `ref<DismissReason | null>(null)`，`requestDismiss(reason: DismissReason)` 接受参数。

## 交付物

- `src/components/settings/ConfirmDialog.vue`（新建 — 参数化确认对话框）
- `src/components/settings/SettingsDrawer.vue`（修改 — 集成 ConfirmDialog）

## 验收标准

- [ ] 有未保存更改时点击 ChevronRight → 显示确认对话框
- [ ] 有未保存更改时按 Escape → 显示确认对话框
- [ ] 无未保存更改时点击 ChevronRight → 直接关闭
- [ ] 对话框有三个按钮：保存并重启 / 取消 / 放弃更改
- [ ] 按钮按破坏性从左到右递增排列
- [ ] "取消" → 对话框消失，返回编辑
- [ ] "放弃更改" → 抽屉关闭，draft 丢失
- [ ] "保存并重启" → 对话框关闭，重启横幅接管
- [ ] 保存失败 → 对话框保持打开，内联显示错误
- [ ] 点击对话框外部 → 不关闭
- [ ] Escape 在对话框中 → 等同于 "取消"
- [ ] 对话框打开时焦点在 "取消" 按钮
- [ ] 对话框打开时 drawer-body 不可交互（`inert`）
- [ ] 对话框有 `role="alertdialog"` + `aria-modal="true"`
- [ ] 连续 Escape 两次不会绕过脏状态守卫
- [ ] `phase !== 'idle'` 时 "保存并重启" 按钮禁用
- [ ] 对话框参数化：实例切换时显示不同的 copy

## 审核重点

- "保存并重启" 按钮在保存流程中是否应该 disabled（防止重复点击）
- "保存并重启" 失败后是否应该回到编辑模式还是关闭面板
- 对话框居中在抽屉区域内 — 如果抽屉很窄（< 900px 全宽），对话框是否应该全屏居中
- Escape 在对话框中关闭 — 但 Escape 也是打开对话框的触发键，是否有键盘事件冒泡问题
- "N 个未保存的更改" 的计数方式 — 是 diff 的叶子路径数量还是 Section 数量
- 对话框的 focus trap — 代码库中无 focus-trap 基础设施，如何确保 Tab 不离开对话框
