# Monitor Fixes — 2026-06-27

Four issues to fix, verified against OpenCode source (anomalyco/opencode @ 6861fedd).

## Verified facts driving the design

1. **SSE `session.status` payload shape** (`packages/schema/src/session-status-event.ts`):
   `{ sessionID, status: { type: "idle" | "busy" | "retry", ... } }` — `status` is an
   **object** with `.type`, not a string. The monitor's current handler reads it as a
   string → broken. `session.idle` (deprecated, still emitted) carries just
   `{ sessionID }`. No `session.complete`/`session.finish` event exists.
2. **Archive API** (`packages/app/src/pages/home-session-archive.ts`):
   `PATCH /session/{id}` with body `{ time: { archived: <epoch_ms> } }`. `GET /session`
   accepts `?archived=true` to include archived sessions (default excludes them; the
   OpenCode app also filters `!s.time?.archived` client-side).
3. **Tokens/cost** already on `SessionV2Info` (`tokens.{input,output,reasoning,cache.{read,write}}`
   + `cost`). `session.updated` carries the full `info`, so values refresh live. No
   separate endpoint needed.
4. **Connection status**: `setInstanceConnected(url, true)` only fires on `es.onopen`.
   If `onopen` doesn't fire (or fires after a delay) while `onmessage` is already
   delivering events, the top pill stays "Disconnected" even with live session data
   below — matches the reported symptom.

---

## Fix 1 — Long-session rendering lag

**Root cause:** `displayParts` walks + dedups ALL parts on every change; `visibleParts`
renders every part as a `MarkdownContent` node. Switching to a long session fetches the
full message history (`fetchParts` → `GET /session/:id/message`) and renders all of it.
The subagent **children list** (`bodyMode === 'children'`) already derives from
`store.tree` (parentID-based), NOT from `visibleParts` — so truncating parts is safe and
the historical subagent list stays correct.

**Changes:**

- `useSessionMessages.ts`: after `fetchParts`, cap the returned array to the last
  `BACKFILL_PART_LIMIT = 80` parts (bounds memory + dedup cost; child-state inference
  for `<task>` tags already ran at bootstrap, so we don't need older parts at render
  time).
- `SubagentDetail.vue`:
  - New `RECENT_PART_LIMIT = 20` constant and a per-tab `showAllParts` ref (reset on
    tab switch).
  - `visibleParts` returns `displayParts.slice(-RECENT_PART_LIMIT)` unless
    `showAllParts` is true.
  - When truncated, render a top banner "↑ N older messages hidden — show all" that
    sets `showAllParts = true`.
  - Keep the existing markdown cache + 150ms debounce (already optimal).

## Fix 2 — Connection display + running-session detection

**Changes:**

- `useEventStream.ts`:
  - Mark instance connected on the **first `onmessage`** too (once), not just
    `onopen`. Add a per-connection `markedConnected` flag to avoid store spam.
  - Fix `session.status` handler: read `status.type` from the object
    (`d.status?.type === 'idle'` → completed; `'busy'`/`'retry'` → running).
    Keep `session.idle` handler (deprecated but still emitted — correct).
  - `reconcileInstance`: in addition to backfilling `unknown` sessions, re-verify
    `running` sessions on the instance whose `lastEventTime` is older than 30s by
    fetching their messages and re-inferring state (catches completions that happened
    during the disconnect window). Skip actively-streaming sessions
    (`lastEventTime` < 30s ago) to avoid redundant fetches.
- `useStuckDetection.ts`: unchanged in logic; benefits from Fix 2's faster
  reconcile. (Optional: lower default check interval from 10s → already fine.)
- `ConnectionConfig.vue`: no change needed — `statusState` already aggregates
  `store.instances.some(i => i.connected)`; once Fix 2 sets `connected=true` on
  first message, the pill flips to Connected correctly.

## Fix 3 — Archive (mirror Zed thread/session archival)

**Changes:**

- `types/index.ts`: `SessionTime.archived?: number | string` (v2 API returns epoch-ms
  number; the existing `string` typing was wrong).
- `store/session.ts`:
  - New `archiveSession(id)` action: `PATCH /session/{id}` body
    `{ time: { archived: Date.now() } }`; on success, update the node's
    `raw.time.archived` and re-derive tree.
  - New `unarchiveSession(id)` action: `PATCH /session/{id}` body
    `{ time: { archived: null } }` (verify null clears it at runtime; fallback: `0`).
  - `SessionNode` gets an `archived: boolean` computed field (or derive from
    `raw.time.archived` in selectors).
  - `tree` computed: split top-level sessions into active vs archived; archived ones
    go into a separate group surfaced via a new `archivedTree` computed.
- `useSessionBootstrap.ts`: in addition to the default fetch, also fetch
  `/session?archived=true&limit=500` per instance and add those sessions (tagged
  archived). Merge by id.
- `useSessionActions.ts`: expose `archive`/`unarchive` with toast + in-flight guard.
- `SessionTree.vue`:
  - Below the active groups, render a collapsible "Archived" group (collapsed by
    default) listing archived top-level sessions with a faded style.
  - Add a per-row context action (small icon button on hover) to archive/unarchive.
    Also add an archive button in `SubagentDetail.vue` header (but that file is owned
    by Lane A — Lane A will add the header archive button reading a store action Lane
    B exposes; coordination via the shared store API).

## Fix 4 — Token consumption + cache display

**Changes:**

- `SubagentDetail.vue` header (Lane A): add a compact token summary next to the
  duration — `in / out / cache·R / cache·W` (short-form, e.g. `12.4k / 3.1k / 48k / 2k`)
  plus cost (`$0.042`). Source: `activeView.session.raw.tokens` + `raw.cost`. Format
  with a `formatTokens(n)` helper (k/M suffix).
- `SessionTree.vue` row (Lane B): optional tiny token count chip on hover/selected —
  compact total (`Σ 15.5k tok`) from `session.raw.tokens`. Keep subtle to avoid
  clutter.

---

## Execution plan (2 parallel fixer lanes)

| Lane | Owner | Files | Fixes |
|------|-------|-------|-------|
| A | fixer-a | `SubagentDetail.vue`, `useSessionMessages.ts` | Fix 1 + Fix 4 (header tokens) + archive button in detail header |
| B | fixer-b | `useEventStream.ts`, `useStuckDetection.ts`, `useInstanceScanner.ts`, `ConnectionConfig.vue`, `useSessionActions.ts`, `useSessionBootstrap.ts`, `store/session.ts`, `types/index.ts`, `SessionTree.vue` | Fix 2 + Fix 3 + Fix 4 (sidebar tokens) |

Lanes A and B touch disjoint files (Lane A only reads the store/types that Lane B
writes). After both complete: build (`pnpm tauri build` is heavy — run `pnpm build`
vue-tsc+vite first for fast type-check, then full tauri build), commit, verify live.

## Verification

- `pnpm build` (vue-tsc --noEmit) must pass.
- Manual: open a long session (>50 parts) → confirm only last 20 render + "show all"
  banner; confirm subagent children list still complete.
- Manual: start OpenCode, confirm top pill flips to Connected once events flow
  (without waiting for a fresh rescan).
- Manual: archive a session in Zed → confirm it appears in Monitor's Archived group;
  archive from Monitor → confirm it disappears from Zed's active list.
- Manual: confirm token counts update during a streaming session.
