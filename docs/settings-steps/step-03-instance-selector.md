# 步骤 3：实例选择器 + 配置加载

> **共享上下文**：参见 `_shared-context.md`

## 范围

在抽屉顶部添加实例选择器，实现配置获取流程。

## 前置条件

步骤 2 完成。

## 实现要点

1. **实例选择器**位于抽屉标题栏下方：
   - **使用自定义下拉**（复用 `PromptInput.vue` 的 `.selector` + `.selector-menu` 模式），不是原生 `<select>` — 需要在每行渲染端口 + 状态点 + 项目目录名
   - 数据源：`useSessionStore().instances`

2. **默认实例选择**（`activeTabId` → 实例 URL 映射是间接的）：
   ```typescript
   function resolveInitialInstance() {
     const sessNode = store.activeTabId ? store.sessions.get(store.activeTabId) : undefined
     const fromActiveTab = sessNode
       ? store.instances.find(i => i.url === sessNode.instanceUrl)
       : undefined
     return fromActiveTab
       ?? store.instances[0]   // fallback: 第一个已发现的实例
       ?? null                  // null = "无实例"
   }
   ```
   > **注意**：`useInstanceScanner` 总是设置 `connected: false`（表示 SSE 未订阅），`connected: true` 仅在 `useEventStream` 的 `onopen` 时设置。`connected` 不等同于 "HTTP 可达"。设置面板只需要 HTTP 可达性，不需要 SSE。如果需要判断实例是否可达，探测 `GET /global/health`，而不是依赖 `connected`。

3. **打开抽屉时**：
   - 设置 `configStore.targetUrl = resolvedInstance?.url ?? null`
   - 如果实例为 null 且 `store.instances` 为空，**先自动调用 `useInstanceScanner().scan()`**（如果未在扫描中）。扫描后仍为空，fallback 到 `http://localhost:4096` 并探测 `/global/health`（与 `session.ts:43` 的 `baseUrl` 逻辑一致）
   - 如果实例可达但 `connected === false`（SSE 未订阅）→ 不显示警告，因为设置面板只需要 HTTP 可达性
   - 如果实例不可达（`/global/health` 失败）→ 显示警告 "实例不可达，保存可能失败"
   - 调用 `configStore.fetchConfig()`

4. **切换实例时**（必须先 guard 再清理再加载）：
   ```typescript
   async function switchToInstance(newUrl: string) {
     if (configStore.phase !== 'idle') return  // guard: 防止 saving/restarting 期间切换
     if (configStore.isDirty) {
       configStore.requestDismiss({ kind: 'switch-instance', newUrl })
       return
     }
     configStore.setTargetUrl(newUrl)
     configStore.original.value = null  // 清理旧实例数据
     configStore.draft.value = null
     await configStore.fetchConfig()
   }
   ```
   - **`phase` guard** 防止在 saving/restarting/timeout 期间切换实例（不仅限于 `loading`）
   - 选择器在 `phase !== 'idle'` 时全部禁用
   - 如果 `configStore.isDirty` → 触发 `requestDismiss` 流程（**步骤 6** 的未保存更改确认对话框）
   > **注意**：`original.value = null; draft.value = null` 必须用 `.value` 赋值。考虑将清理逻辑移入 `fetchConfig` 内部（phase guard 之后），使清理与 fetch 原子化

4. **实例断开时**：
   - 如果选中实例的 `connected === false`，在实例选择器触发按钮内显示断开状态点
   - 保存流程中，断开是预期信号（步骤 5）

5. **加载态**（区分三种状态）：
   - `phase === 'loading'` 时禁用选择器触发按钮，显示 Loader2 + "正在从 {port} 获取配置..."
   - 加载失败：`<XCircle>` + "无法连接到 {port}" + [重试] 按钮
   - 无实例：显示 "未连接 OpenCode 实例。点击 [重新扫描] 或确认 OpenCode 正在运行（默认端口 4096）。"（与 `ConnectionConfig.vue:193` 一致）

6. **重扫按钮**：选择器旁添加小图标按钮（复用 `ConnectionConfig.vue` 的 `.rescan-btn` 模式），点击触发 `useInstanceScanner().scan()` 并刷新列表

## 交付物

- `src/components/settings/InstanceSelector.vue`（新建 — 提取为独立组件，保持 SettingsDrawer.vue 可维护）
- `src/components/settings/SettingsDrawer.vue`（修改 — 集成 InstanceSelector）

## 验收标准

- [ ] 有多个实例时，实例选择器显示所有已连接实例
- [ ] 选择不同实例 → 加载该实例的配置
- [ ] 切换实例时有脏状态 → 显示确认对话框
- [ ] 加载中显示加载指示器
- [ ] 加载失败显示错误信息（inline，非 toast）
- [ ] 实例断开时选择器有视觉指示

## 审核重点

- `activeTabId` → 实例 URL 的映射是间接的（`sessions.get(activeTabId).instanceUrl`），不是直接的
- 切换实例时必须先 `original = null; draft = null` 再 `fetchConfig()`，防止跨实例数据污染
- 自定义下拉复用 `PromptInput.vue` 的 `.selector` 模式，不是原生 `<select>`
- 加载失败显示在内容区（替换加载 spinner），不是在选择器旁
- 对话框 copy 需要参数化（步骤 6 构建组件时传入不同的 title/body/confirmLabel）
- `.drawer-content` 需要 `flex: 1; display: flex; flex-direction: column; min-height: 0` 以支持空/加载状态
