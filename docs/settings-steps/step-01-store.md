# 步骤 1：Store 基础 + 状态机

> **共享上下文**：参见 `_shared-context.md`

## 范围

创建 `src/stores/config.ts`，包含完整的状态管理和重启状态机。

## 前置条件

步骤 0 完成。

## 实现要点

1. **状态字段**（全部在 store 中，不在组件中）：
   ```typescript
   const useConfigStore = defineStore('config', () => {
     // 配置数据
     const original = shallowRef<ConfigV1Info | null>(null)
     const draft = ref<ConfigV1Info | null>(null)

     // 操作状态 — 用单一 phase 枚举互斥，不用多个 boolean
     const phase = ref<'idle' | 'loading' | 'saving' | 'restarting' | 'timeout'>('idle')
     // 注意：confirming 状态由组件本地 pendingSave ref 处理（见步骤 5），
     // 不是 store phase。saveConfig() 只在确认后才调用，所以 phase 守卫足够。

     // UI 状态
     const activeSection = ref<string>('models')
     const panelOpen = ref(false)

     // 实例目标
     const targetUrl = ref<string | null>(null)

     // 重启状态
     const restartStartTime = ref(0)
     let timeoutId: ReturnType<typeof setTimeout> | null = null
     let absoluteTimeoutId: ReturnType<typeof setTimeout> | null = null

      // 脏状态确认 — 联合类型，与步骤 6 的 DismissReason 一致
      type DismissReason =
        | { kind: 'close' }
        | { kind: 'switch-instance'; newUrl: string }
        | { kind: 'window-close' }  // Tauri 窗口关闭（步骤 6）
      const pendingDismiss = ref<DismissReason | null>(null)
      // 保存确认（防止 fetchConfig 在确认对话框打开时运行）
      const pendingSave = ref(false)
   })
   ```

2. **互斥守卫**：每个 action 开头检查 `phase`：
   - `fetchConfig`: `if (phase.value !== 'idle') return`（**同时检查 `pendingSave.value`**：`if (pendingSave.value) return`，防止确认对话框打开时重新加载）
   - `saveConfig`: `if (phase.value !== 'idle') return`

3. **`fetchConfig()`**：`GET /config`，设置 `original.value = draft.value = 响应`。**必须用 `.value` 赋值**（在 setup store 中 `original`/`draft` 是 Ref 对象，直接 `original = ...` 会重新绑定局部闭包变量而非更新 ref，导致无响应式更新）。返回 `Promise<boolean>` 表示成功/失败。失败时设置 `phase = 'idle'` + `lastError`。

4. **`saveConfig()`**：完整保存流程（见步骤 5 的详细设计）。**步骤 1 中提供 stub**：`async function saveConfig(): Promise<boolean> { return false }`，步骤 5 实现完整逻辑。验收标准 12（返回 boolean）在步骤 5 完成后验证。

5. **`setTargetUrl(url: string | null)`**：设置 `targetUrl.value = url`。在面板打开时（步骤 3）从实例选择器调用，实例切换时调用。`targetUrl` 是 `fetchConfig`/`saveConfig` 的目标地址，**不作为参数传递**（共享上下文要求）。

6. **`requestDismiss(reason: DismissReason)`**：设置 `pendingDismiss.value = reason`（组件监听并显示确认对话框）。reason 包含 kind 判别字段，用于对话框 copy 参数化。
7. **`cancelDismiss()`**：`pendingDismiss.value = null`（用户在确认对话框中点击"取消"）
8. **`forceDismiss()`**：`if (phase.value !== 'idle') return false`（**必须有 phase 守卫**，防止在保存/重启期间破坏 draft）。守卫通过后：`panelOpen.value = false`，`draft.value = null`，`pendingDismiss.value = null`。**注意**：save-and-close 路径不能依赖 `forceDismiss`（保存后 phase 为 `saving`/`restarting`，`forceDismiss` 会返回 false）。save-and-close 通过 `hidePanel()` + `pendingCloseOnSuccess` 标记实现，重启完成后由检测回调清理。
9. **`hidePanel()`**：`panelOpen.value = false`（**不清理 draft** — 用于重启期间关闭面板，保留 draft 用于只读显示）

11. **`isDirty`**：`computed(() => !deepEqual(original.value, draft.value))`
   > **`deepEqual` 实现**：用 `@fastify/deepmerge` 的 `deepmerge` 配合 diff 路径机制（共享上下文的 `computeDiff`），`isDirty = computeDiff(original.value, draft.value).length > 0`。这避免引入额外的 `lodash.isequal` 依赖，且与保存流程的 diff 逻辑复用。
   > **性能注意**：`draft` 是深度响应式（`ref`），任何嵌套字段修改都会触发 `isDirty` 重算。对于大型配置树（50-150KB），每次按键都做 `deepEqual` 可能导致输入延迟。优化方案：(a) 用 dirty-path tracker（`Set<string>` 记录用户触碰的路径，`isDirty = dirtyPaths.size > 0`），或 (b) debounce `deepEqual`（300ms），或 (c) 仅在保存时做一次 deep-equal 作为安全网。推荐 (a)。

12. **不暴露 `canReset`**（与 `isDirty` 冗余）

13. **错误状态**：phase 枚举不包含 `'error'` 状态。`fetchConfig`/`saveConfig` 失败时回到 `phase = 'idle'` + 设置 `lastError: ref<{ at: number; phase: Phase; message: string } | null>(null)`。UI 根据 `lastError` 显示内联错误。

10. **`resetToSaved()`**：`if (!original.value) return`（**null 守卫**），然后 `draft.value = structuredClone(original.value)`（**必须用 `.value` 赋值**，`structuredClone` 的参数也必须是 `.value`）

## 交付物

- `src/stores/config.ts`

## 验收标准

- [ ] Store 可被 Vue DevTools 检查，所有状态字段可见
- [ ] `fetchConfig()` 在 `phase === 'saving'` 时被调用 → 立即返回，不执行
- [ ] `saveConfig()` 在 `phase === 'loading'` 时被调用 → 立即返回，不执行
- [ ] `targetUrl` 在 store 中，不作为参数传递
- [ ] `requestDismiss()` 设置 `pendingDismiss`，不直接关闭面板
- [ ] `cancelDismiss()` 清除 `pendingDismiss`
- [ ] `forceDismiss()` 在 `phase !== 'idle'` 时返回 false，不执行
- [ ] `forceDismiss()` 在 `phase === 'idle'` 时清除 `draft` 并关闭面板
- [ ] `isDirty` 正确反映 `original` vs `draft` 的差异
- [ ] `resetToSaved()` 在 `original` 为 null 时是 no-op
- [ ] `resetToSaved()` 在 `original` 有值时恢复 `draft`
- [ ] `timeoutId` 在 store 作用域中，组件卸载不销毁它
- [ ] `saveConfig()` 返回 boolean（成功/失败），不返回 void

## 审核重点

- `phase` 枚举是否覆盖所有状态转换（idle→loading→idle, idle→saving→restarting→idle, idle→saving→timeout→idle）。失败路径：fetchConfig/saveConfig 抛出时 `phase = 'idle'` + `lastError` 设置
- `timeoutId` 在 store 作用域中是否真的不会被组件卸载销毁（Pinia setup store 的闭包行为）
- `structuredClone` 在 Tauri WebView2 中可用（Chromium ≥98 支持）。如不可用，`JSON.parse(JSON.stringify(...))` 是安全 fallback（ConfigV1.Info 是 JSON 可序列化的）
- `deepEqual` 用 `computeDiff` 复用（不引入新依赖）
- `pendingDismiss` 状态机：`DismissReason | null`，取消→null，放弃→forceDismiss，保存→saveConfig+pendingCloseOnSuccess
