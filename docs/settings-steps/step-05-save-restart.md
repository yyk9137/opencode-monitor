# 步骤 5：保存与重启流程

> **共享上下文**：参见 `_shared-context.md`

## 范围

实现完整的 PATCH → 重启 → 检测 → 确认流程。

## 前置条件

步骤 4 完成。

## 实现要点

1. **`saveConfig()` 完整流程**（在 store 中，不在组件中）：
   ```
   phase = 'saving'
   ↓
   1. GET /config（获取新鲜树 freshTree）
      失败 → toast "无法获取最新配置", phase = 'idle', return false
   ↓
   2. 计算用户差异：userDiff = computeDiff(original, draft)
      （仅叶子路径，不是整个 draft 树）
   ↓
   3. 合并：merged = applyDiff(freshTree, userDiff)
      契约：mergeArrays = false（数组替换不拼接）
   ↓
   4. AJV 验证 merged — 如果验证失败，显示错误，phase = 'idle', return false
   ↓
   5. PATCH /config（merged）
      HTTP 失败 → toast "保存失败：{status}", phase = 'idle', return false
   ↓
   6. phase = 'restarting', restartStartTime = Date.now()
      启动超时计时器（见下文）
      分阶段检测（health 轮询优先，scan 仅在必要时触发）：
      (a) watch SSE connected 状态（同 URL）
      (b) 轮询 GET /global/health（每 2s，单次 HTTP 请求，轻量）
      (c) 如果 health 轮询 15 秒无响应（端口可能变更）→ 触发一次 useInstanceScanner().scan()
          scan() 成本高（25端口×800ms，受 scanning mutex 限制），仅作为降级手段
   ↓
   7. 任一检测成功 → 进入验证阶段
   ↓
   8. GET /config 确认写入
      失败 → toast "保存成功但确认失败，请手动验证", phase = 'idle', return true
      成功 → original = freshTree, phase = 'idle', return true
   ```

2. **端口变更检测**：
   - `useInstanceScanner().scan()` 返回的实例中，匹配 `projectDir` 的实例在任意 URL 上线即视为成功
   - `currentUrls` 来源：`useSessionStore().instances.map(i => i.url)`
   - 仅当 `newUrl !== oldUrl` 时调用 `connectAll`
   - **`connectAll` 调用必须传入完整 URL 列表**：`connectAll(store.instances.map(i => i.url))`，不能只传 `[newUrl]`。`useEventStream.connectAll` 只断开不在列表中的 URL 的连接，传入完整列表保留其他实例的 SSE 连接。
   - **SSE 重连自动同步会话**：`useEventStream.ts` 的 `reconcileInstance(url)` 在 `es.onopen` 时自动调用，会 GET /api/session 导入断连期间创建的新会话，标记 stale 会话为 error，backfill inferredState。无需额外同步逻辑。
   - **重要**：`useEventStream()` 不是单例 — 每次调用创建新的 `connections` Map。不能从 store 直接调用。
   - **解决方案**：用信号/回调模式 — store 设置 `pendingConnectNewUrl: ref<string | null>(null)`（**需在步骤 1 store 契约中声明此字段**），App.vue watch 并调用自己的 `connectAll`。或重构 `useEventStream` 为模块级状态（推荐）。

3. **超时设计**（修正后）：
   - **单一 90 秒计时器**，从 PATCH 完成时开始
   - 每次任一检测路有状态变化（SSE 连接状态变化、health 轮询返回变化）时**重置计时器**
   - 即"90 秒无进展超时"而非"90 秒总超时"
   - **绝对上限**：5 分钟（防止抖动实例无限重置计时器）
   - 超时后 `phase = 'timeout'`，保留 `original` 快照
   - **超时后检测继续**：如果实例在超时后恢复（91s-5min），检测回调触发 step 8 确认 GET → 成功后 `phase = 'idle'`，显示 "重启完成（延迟 Xs）" 横幅变体
   - **5 分钟绝对超时** → 所有检测停止（health 轮询、SSE watch、scan），横幅切换到超时状态

4. **检测回调 phase 守卫**：
   ```typescript
   // 每个检测回调开头：
   if (phase.value !== 'restarting' && phase.value !== 'timeout') return
   // 任一检测成功后：
   phase.value = 'idle'  // 防止其他回调重复触发 step 8
   // 清除所有计时器和轮询
   ```

4. **已断开边界情况**：
   - PATCH 时如果 SSE 已经 `connected === false`，跳过 disconnect 等待
   - 直接进入 health 轮询 + scan 检测

5. **health 轮询超时**：
   - 每次 health 轮询必须有 `Promise.race` 超时（1.5s），防止 Tauri fetch 半开 TCP 连接无限挂起
   - **注意**：`targetUrl` 轮询是 best-effort 同端口快速路径。端口变更场景下 `targetUrl` 仍指向旧端口，`targetUrl` 轮询会持续失败直到 15s fallback 触发 `scan()`。`scan()` 成功后应更新 `targetUrl` 为发现的新 URL。
   ```typescript
   const healthPromise = fetch(`${targetUrl}/global/health`)
   const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 1500))
   const response = await Promise.race([healthPromise, timeoutPromise])
   if (!response?.ok) continue  // 超时或失败，下一轮继续
   ```
   > **注意**：不能用 `AbortSignal.timeout()` — Tauri 的 fetch 不完全支持。

6. **客户端发送完整树**：
   - `merged` 包含所有路径（fresh 的未修改路径 + 用户的已修改路径）
   - 客户端 merge 确保发送的 payload 包含所有 fresh 路径（防止客户端 stale-tree 覆盖）
   - 服务端 `mergeDeep(existing, merged)` 进一步保留任何在客户端 GET 之后写入磁盘的并发更改（`config.ts:628`）。**两层防护互补**：客户端 merge 保护 payload 不 stale，服务端 merge 保护并发磁盘写入。
   - 服务端 merge 不是 no-op — 它是并发写入的真实安全网

5. **重启横幅**（在抽屉标题栏下方，非 toast）：

   | 状态 | 横幅表面 | 左侧线 | 图标 | 文本 |
   |------|----------|--------|------|------|
   | confirming | `var(--bg-elevated)` | 默认 | `Loader2` 旋转 | "保存将重启 OpenCode。运行中的会话会重连。[取消] [保存]" |
   | restarting | `var(--bg-elevated)` | `var(--text-accent)` | `Loader2` + 实时计时 | "重启中 4.2s…"（动画计数器） |
   | 完成 | 同上 | `var(--success)` | `CheckCircle2` | "已保存 · OpenCode 已重启 · 12.1s" + [×] |
   | 超时 | 同上 | `var(--error)` | `XCircle` | "重启超时（90 秒无进展）。[重试] [恢复]" |

6. **实时计时器**：用 `SubagentDetail.vue` 的 `relativeAge` 模式（lines 625-640），每 100ms 更新

7. **超时后的操作**：
   - "重试检测"：不重新 PATCH，只重启 health 轮询 + scan + SSE watch（检测阶段）
   - "重新保存"：重新从 `saveConfig()` 步骤 1 开始（re-GET + merge + PATCH，会触发另一次重启）
   - "恢复"：`draft = structuredClone(original)`，`phase = 'idle'`（注意：服务器已保存 `merged`，`original` 是保存前快照）

8. **打开面板时重启进行中**：
   - 如果 `phase === 'restarting'` 或 `'timeout'` 时打开面板，显示只读模式
   - Save 按钮 disabled，显示横幅当前状态
   - `forceDismiss()` 在非 idle 阶段不清理 `draft`（用 `hidePanel()` 只设置 `panelOpen = false`，保留 `draft` 用于只读显示）
   - 重启完成后恢复正常

## 交付物

- `src/stores/config.ts`（修改 — 实现 `saveConfig()` 完整流程）
- `src/components/settings/RestartOverlay.vue`（新建 — 在 step-02 的 `.drawer-restart-banner` div 内挂载的子组件）

## 验收标准

- [ ] 点击 "保存并重启" → 横幅显示 confirming 状态
- [ ] 确认后 → GET → merge → PATCH → 横幅切换到 restarting 状态
- [ ] 横幅显示实时计时器（"重启中 4.2s…"）
- [ ] SSE 重连成功 → 横幅切换到完成状态（绿色左侧线）
- [ ] 实例在不同端口重启 → scan 检测到 → 视为成功 → `targetUrl` 更新
- [ ] 90 秒无进展 → 横幅切换到超时状态（红色左侧线）
- [ ] 5 分钟绝对超时 → 即使有进度信号也切换到超时状态
- [ ] 超时后实例恢复 → 横幅自动切换到完成状态（"延迟 Xs"）
- [ ] 超时后点击 "重试检测" → 只重启检测，不重新 PATCH
- [ ] 超时后点击 "重新保存" → 重新执行完整保存流程
- [ ] 超时后点击 "恢复" → draft 恢复到最后保存版本
- [ ] PATCH 时 SSE 已断开 → 不挂起，直接进入检测阶段
- [ ] 关闭面板再打开 → 如果重启进行中，显示只读模式 + 横幅（draft 不被清理）
- [ ] `fetchConfig` 在 `phase !== 'idle'` 时被调用 → 立即返回
- [ ] PATCH 失败（HTTP 非 200）→ toast 错误信息，phase 回到 idle
- [ ] SSE 重连成功后，health 轮询停止
- [ ] health 轮询单次请求超时（1.5s）→ 不影响下一轮轮询
- [ ] 端口变更后 → 其他实例的 SSE 连接不受影响
- [ ] AJV 验证失败 → 显示验证错误信息，phase 回到 idle，不执行 PATCH
- [ ] 确认 GET 失败 → toast 提示，phase 回到 idle，return true

## 审核重点

- `useEventStream()` 不是单例 — 不能从 store 直接调用 `connectAll()`。用信号/回调模式或重构为模块级状态。
- `currentUrls` 来源：`useSessionStore().instances.map(i => i.url)`，仅当 `newUrl !== oldUrl` 时调用 connectAll
- health 轮询必须有 `Promise.race` 超时（1.5s），不能用 `AbortSignal.timeout()`
- 检测回调必须有 phase 守卫，防止双重触发 step 8
- `forceDismiss()` 在非 idle 阶段不清理 `draft` — 用 `hidePanel()` 只关闭面板
- 服务端 merge 是 no-op（客户端发送完整树）— 客户端 merge 是唯一保护
- 超时后检测继续 — 实例恢复时自动转换到完成状态
- "重试" 不应重新 PATCH（会触发另一次重启）— 只重启检测
- `pendingSave` 需要在 store 中（不是组件本地），防止 `fetchConfig` 在确认对话框打开时运行
- `restartStartTime` 在 PATCH 完成时设置（不是用户点击保存时）— 计时器测量重启时间，不是保存准备时间
