# Undo/Redo Implementation Plan (v2 — post review)

## Goal

Add undo/redo/abort/diff capabilities to the OpenCode Monitor app. The monitor can trigger OpenCode's built-in undo APIs to revert changes, abort sessions, and view diffs.

## Constraints

- No emoji in UI text. Use lucide-vue-next icons for all button visuals.
- Use Ayu Night theme variables (`--vc-*` for diff colors). No hardcoded colors.
- Buttons must be subtle and not clutter the message stream.

## API Endpoints (verified against live OpenAPI spec at localhost:4096/doc)

| Method | Path | Body | Returns | Description |
|--------|------|------|---------|-------------|
| POST | `/session/:id/revert` | `{ messageID: string, partID?: string }` | `Session` (updated) | Revert a message and its effects |
| POST | `/session/:id/unrevert` | none | `Session` (updated) | Restore all reverted messages |
| POST | `/session/:id/abort` | none | `boolean` | Abort a running session |
| POST | `/session/:id/fork` | `{ messageID?: string }` | `Session` (new) | Fork session at a message |
| GET | `/session/:id/diff?messageID=` | none | `FileDiff[]` | Get file changes from a message |

### Error cases
- 409 `SessionBusyError` on revert if session is running — must abort first
- 404 `NotFoundError` if session/message doesn't exist
- 400 `BadRequest` if messageID is missing or malformed

## Prerequisites (before any implementation)

### Step 0: Smoke-test all 5 endpoints

Before writing any UI code, curl-test each endpoint against a live session and record the actual response bodies. This verifies:
- Whether legacy prefix (`/session/:id/revert`) or V2 prefix (`/api/session/:id/revert`) is correct
- Actual response shapes (wrapped in `{ data: ... }` or raw)
- Diff schema (`FileDiff` type must match reality)

### Step 0a: Build toast system

No reusable toast exists. Build a minimal `useToast()` composable:
- `ref` array of `{ id, message, type, ttl }` 
- `<ToastHost>` component mounted in `App.vue`
- Position: fixed bottom-right, Ayu Night styling
- Left border color by tone (success/error/info), matching existing `.stuck-banner` pattern

## Key Design Decisions (from review)

1. **Parts already have `messageID`** — `PartBase` at `types/index.ts:155-159` includes `messageID: string`. No annotation mechanism needed. Both live SSE parts and backfilled legacy parts carry it.

2. **Unified `bodyMode`** — Single `ref<'stream' | 'children' | 'diff'>` instead of separate `showChildList` and `diffPanel.visible` booleans. Prevents state bugs when switching between panels.

3. **Inline confirmation for revert** — Not a modal. Two-button state replaces the revert button: "Revert?" + cancel. Click anywhere else or Esc cancels.

4. **Ghost state for reverted messages** — Reverted messages stay in the stream with `<strike>` + "Reverted" tag, not removed. This gives clear feedback without confusing disappearance.

5. **Disable revert when running** — `canRevert` checks `inferredState !== 'running'`. Title explains: "Cannot revert while session is running — abort first."

6. **Post-revert state reconciliation** — After revert/unrevert/abort, re-fetch parts via `fetchParts()` and replace `messages`. SSE has no "message removed" event, so re-fetch is the only reliable way.

7. **Typed error returns** — Store actions return discriminated unions, not booleans. Composable maps each error type to the right UX.

## Implementation

### 1. Types: `src/types/index.ts`

```ts
export interface FileDiff {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  content?: string  // patch text, if available
}
```

Note: `status` values and field names must be verified against actual API response in Step 0.

### 2. Store: `src/stores/session.ts`

Add actions. **URL resolution rule:** every action resolves the target instance URL from `sessions.get(sessionId)?.instanceUrl ?? baseUrl.value`. Do NOT use `store.baseUrl` directly — it may point to a different instance in multi-instance mode.

```ts
// Returns discriminated result
type RevertResult = { ok: true; session: SessionV2Info } | { ok: false; error: 'busy' | 'not-found' | 'bad-request' | 'network' }
type ForkResult = { ok: true; session: SessionV2Info; instanceUrl: string } | { ok: false; error: string }

async function revertMessage(sessionId: string, messageID: string, partID?: string): Promise<RevertResult>
async function unrevertSession(sessionId: string): Promise<RevertResult>
async function abortSession(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }>
async function forkSession(sessionId: string, messageID?: string): Promise<ForkResult>
async function getSessionDiff(sessionId: string, messageID?: string): Promise<FileDiff[]>
```

- URL resolved from `sessions.get(sessionId)?.instanceUrl ?? baseUrl.value` in every action
- `abortSession` calls `backfillState(sessionId, 'error', 'aborted')` for immediate UI feedback
- After `revertMessage` success: set `inferredState` to `'completed'` (not `'unknown'`), then re-fetch parts
- After `unrevertSession` success: same re-fetch
- `forkSession` returns `instanceUrl` alongside the new session so the composable can `addSession(session, instanceUrl)` directly
- `lastRevertError` stays in the composable, NOT the store (prevents cross-tab leakage)
- Multi-instance SSE events are auto-tagged by `handleEvent(event, url)`; no special undo handling required
- If the owning instance's SSE is disconnected, only the `fetchParts()` re-fetch will reconcile state

### 3. Composable: `src/composables/useSessionActions.ts` (new file)

```ts
export function useSessionActions() {
  const store = useSessionStore()
  const inFlight = reactive<Record<string, boolean>>({})  // keyed by `${sessionId}:revert:${messageID}`
  const lastError = ref<string | null>(null)

  async function revert(sessionId: string, messageID: string): Promise<void>
  async function unrevert(sessionId: string): Promise<void>
  async function abortSession(sessionId: string): Promise<void>  // NOT "abort" — avoids shadowing globals
  async function fork(sessionId: string, messageID?: string): Promise<void>
  async function viewDiff(sessionId: string, messageID?: string): Promise<void>

  return { revert, unrevert, abortSession, fork, viewDiff, inFlight, lastError }
}
```

- `revert`: sets `inFlight[key] = true`, calls `store.revertMessage()`, on success shows toast "Reverted message" with undo action, on 'busy' error shows toast "Session is running — abort first", clears `inFlight`
- `abortSession`: calls `store.abortSession()`, shows toast on success/failure
- `viewDiff`: calls `store.getSessionDiff()`, stores result in `bodyMode = 'diff'` state
- `fork`: calls `store.forkSession()`, on success calls `store.openTab(newSessionId)` (relying on existing fetch-fallback at `session.ts:228-245`)

### 4. Component: `src/components/SubagentDetail.vue`

#### 4a. Unified body mode

Replace `showChildList` with:
```ts
type BodyMode = 'stream' | 'children' | 'diff'
const bodyMode = ref<BodyMode>('stream')
const diffFiles = ref<FileDiff[]>([])
```

Template:
```html
<div v-if="bodyMode === 'stream'" class="tab-body message-stream">...</div>
<div v-else-if="bodyMode === 'children'" class="tab-body child-list-pane">...</div>
<div v-else class="tab-body diff-pane" role="region" aria-label="File changes">...</div>
```

#### 4b. Header actions — right cluster with separator

```html
<div class="header-row">
  <span class="agent-chip">...</span>
  <span class="session-id">...</span>
  <span class="status-dot" />
  <span class="duration"><Clock :size="11" /> ...</span>
  <div class="header-actions">
    <button v-if="canUnrevert" class="header-action-btn" title="Restore reverted messages" aria-label="Restore reverted messages">
      <Redo2 :size="11" />
    </button>
    <button v-if="isRunning" class="header-action-btn header-action-btn--danger" title="Abort session" aria-label="Abort session" :disabled="isAborting" :aria-busy="isAborting">
      <Loader2 v-if="isAborting" :size="11" class="spin" />
      <StopCircle v-else :size="11" />
    </button>
  </div>
</div>
```

Icon: `StopCircle` (not `Square` — clearer "stop" meaning).
Layout: `margin-left: auto` on `.header-actions`, thin `border-left` separator.
Duration: remove its `margin-left: auto`, let it sit naturally in the left cluster.

#### 4c. Part action buttons — anchored to `.part` (the `<li>`)

```html
<li class="part" :data-type="part.type">
  <span class="part-marker" />
  <div class="part-body">
    <!-- existing text/tool/reasoning rendering -->
  </div>
  <!-- Action bar for user text parts -->
  <div v-if="canRevert(part)" class="part-actions" role="group" aria-label="Message actions">
    <button class="part-action-btn" title="View file changes" aria-label="View file changes" @click="handleViewDiff(part.messageID)">
      <FileDiff :size="11" />
    </button>
    <button
      v-if="confirmingRevert !== part.id"
      class="part-action-btn part-action-btn--warning"
      title="Revert this message"
      aria-label="Revert this message"
      :disabled="inFlight[`${sessionId}:revert:${part.messageID}`]"
      :aria-busy="inFlight[`${sessionId}:revert:${part.messageID}`]"
      @click="askRevert(part)"
    >
      <Loader2 v-if="inFlight[`${sessionId}:revert:${part.messageID}`]" :size="11" class="spin" />
      <Undo2 v-else :size="11" />
    </button>
    <!-- Inline confirmation state -->
    <template v-else>
      <span class="visually-hidden" aria-live="polite">Confirm revert of this message</span>
      <button class="part-action-btn part-action-btn--danger" aria-label="Confirm revert" @click="doRevert(part.messageID)">
        Revert?
      </button>
      <button class="part-action-btn" aria-label="Cancel revert" @click="confirmingRevert = null">
        <X :size="11" />
      </button>
    </template>
    <button class="part-action-btn part-action-btn--menu" title="More actions" aria-haspopup="true" @click="toggleKebab(part.id)">
      <MoreHorizontal :size="11" />
    </button>
    <!-- Kebab popover: contains Fork -->
    <div v-if="kebabOpen === part.id" class="kebab-popover">
      <button class="kebab-item" @click="handleFork(part.messageID)">
        <GitBranch :size="11" /> Fork session here
      </button>
    </div>
  </div>
</li>
```

CSS: anchor to `.part` (the `<li>`), not a wrapper:
```css
.part { position: relative; }
.part-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-1px);
  transition:
    opacity var(--duration-fast) var(--ease-out-quint),
    transform var(--duration-fast) var(--ease-out-quint);
}
.part:hover .part-actions,
.part:focus-within .part-actions {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
```

Button style (match `.tab-close` — no border at rest):
```css
.part-action-btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    color var(--duration-fast) var(--ease-out-quint),
    border-color var(--duration-fast) var(--ease-out-quint);
}
.part-action-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-variant);
}
.part-action-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--border-focused);
}
.part-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.part-action-btn--warning { color: rgba(255, 180, 84, 0.65); }
.part-action-btn--warning:hover { color: var(--warning); border-color: rgba(255, 180, 84, 0.45); }
.part-action-btn--danger:hover { color: var(--error); }
```

#### 4d. `canRevert` logic

```ts
function canRevert(part: MessagePart): boolean {
  if (!activeView.value) return false
  if (activeView.value.session.inferredState === 'running') return false
  return part.type === 'text' && !(part as TextPart).synthetic
}
```

Title when disabled: "Cannot revert while session is running — abort first."

#### 4e. Ghost state for reverted messages

After successful revert, mark the messageID as reverted in a local ref:
```ts
const revertedMessageIds = ref<Set<string>>(new Set())
```

Template:
```html
<li class="part" :data-type="part.type" :data-reverted="revertedMessageIds.has(part.messageID) ? 'true' : undefined">
  <span class="part-marker" />
  <div class="part-body">
    <pre v-if="revertedMessageIds.has(part.messageID)" class="text-part text-part--reverted">
      <span class="reverted-tag"><Undo2 :size="9" /> Reverted</span>
      {{ (part as TextPart).text || '' }}
    </pre>
    <pre v-else class="text-part">...</pre>
  </div>
</li>
```

CSS:
```css
.text-part--reverted {
  text-decoration: line-through;
  color: var(--text-placeholder);
  opacity: 0.6;
}
.reverted-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  font-size: 10px;
  color: var(--warning);
  font-family: var(--font-mono);
  margin-right: var(--space-8);
}
```

#### 4f. Diff panel (third body mode)

```html
<div v-else class="tab-body diff-pane" role="region" aria-label="File changes">
  <header class="diff-header">
    <button class="back-to-messages" @click="bodyMode = 'stream'" autofocus>
      <ArrowLeft :size="11" /><span>Back to messages</span>
    </button>
    <span class="diff-meta">{{ diffFiles.length }} files changed</span>
  </header>
  <ul class="diff-list">
    <li v-for="file in diffFiles" :key="file.path" class="diff-row">
      <span class="diff-status" :data-status="file.status" />
      <span class="diff-path">{{ file.path }}</span>
      <span class="diff-stats">
        <span class="diff-additions">+{{ file.additions }}</span>
        <span class="diff-deletions">-{{ file.deletions }}</span>
      </span>
    </li>
  </ul>
</div>
```

Diff status colors use existing `--vc-*` variables from `theme.css`:
```css
.diff-status[data-status='added']    { background: var(--vc-added); }
.diff-status[data-status='modified'] { background: var(--vc-modified); }
.diff-status[data-status='deleted']  { background: var(--vc-deleted); }
.diff-status[data-status='renamed']  { background: var(--info); }
```

Animation: reuse existing `@keyframes child-list-slide`.

### 5. Icon imports

```ts
import { StopCircle, Undo2, Redo2, GitBranch, FileDiff, MoreHorizontal, ArrowLeft, X } from 'lucide-vue-next'
```

### 6. Accessibility

- All buttons: `aria-label` matching `title`
- In-flight buttons: `:disabled` + `:aria-busy`
- Inline confirmation: `aria-live="polite"` on screen-reader announcement
- Focus-visible ring on all interactive elements
- Diff panel: `role="region"`, `aria-label="File changes"`, auto-focus back button

## Execution Order

0. Smoke-test all 5 endpoints against live session, record response shapes
0a. Build `useToast()` composable + `<ToastHost>` component
1. Add `FileDiff` type (verified against actual API response)
2. Add store actions (`revertMessage`, `unrevertSession`, `abortSession`, `forkSession`, `getSessionDiff`)
3. Create `useSessionActions.ts` composable
4. Add `bodyMode` ref + `revertedMessageIds` ref to SubagentDetail
5. Add header actions (abort + unrevert)
6. Add part actions (diff + revert with inline confirm + kebab/fork)
7. Add diff panel (third body mode)
8. Add ghost state CSS for reverted messages
9. Wire up post-revert re-fetch (`fetchParts()` after successful revert)

## Verification

- `pnpm build` passes
- Smoke-test: `curl -X POST http://localhost:4096/session/:id/revert -d '{"messageID":"msg_xxx"}'` returns 200
- Manual: select completed session, hover user message, click revert, confirm, verify ghost state appears
- Manual: select running session, verify revert button is disabled with explanation title
- Manual: click abort, verify spinner appears, session stops
- Manual: click "View file changes", verify diff panel slides in with correct file list
- Manual: click fork, verify new session opens as tab
