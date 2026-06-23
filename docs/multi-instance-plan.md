# Multi-Instance Auto-Scan Plan

## Goal

Replace the manual URL input with automatic instance discovery. Scan for OpenCode instances, connect to all of them, and show sessions from all projects in one unified view.

## Current Architecture (single instance)

- `store.baseUrl` — single URL
- `useEventStream` — single SSE connection to one instance
- `useSessionBootstrap` — bootstraps from one instance
- `ConnectionConfig.vue` — manual URL input + connect button

## New Architecture (multi-instance)

### 1. Instance Scanner: `src/composables/useInstanceScanner.ts` (new)

```ts
interface DiscoveredInstance {
  url: string        // e.g. "http://localhost:4096"
  port: number
  healthy: boolean
  version?: string
  projectDir?: string  // from /project/current
}

export function useInstanceScanner() {
  const instances = ref<DiscoveredInstance[]>([])
  const scanning = ref(false)

  async function scan(): Promise<void> {
    scanning.value = true
    // Scan ports: 4096 first (default), then 4097-4120, then check process-listed ports
    const ports = [4096, ...range(4097, 4120)]
    const found: DiscoveredInstance[] = []
    // Parallel scan with limited concurrency
    await Promise.all(ports.map(async (port) => {
      try {
        const url = `http://localhost:${port}`
        const r = await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(500) })
        if (r.ok) {
          const body = await r.json()
          found.push({ url, port, healthy: true, version: body.version })
        }
      } catch { /* not an OpenCode instance */ }
    }))
    instances.value = found
    scanning.value = false
  }

  return { instances, scanning, scan }
}
```

### 2. Store: `src/stores/session.ts`

Add multi-instance tracking:
```ts
interface InstanceConnection {
  url: string
  port: number
  connected: boolean
}

// Replace single baseUrl with instance list
const instances = ref<InstanceConnection[]>([])

// SessionNode already has `directory` field — use it to group by project
// Add `instanceUrl: string` to SessionNode to know which instance a session came from
```

Keep `baseUrl` as a computed/getter that returns the first instance URL (backward compat for `useSessionMessages` and other code that uses `store.baseUrl`).

### 3. Event Stream: `src/composables/useEventStream.ts`

Support multiple SSE connections:
```ts
export function useEventStream() {
  const connections = new Map<string, EventSource>()  // url → EventSource

  function connectInstance(url: string): void {
    // Same logic as current connect(), but for a specific URL
    // store.addSession already works — just pass the instance URL to tag sessions
  }

  function connectAll(urls: string[]): void {
    // Close existing, open new for each URL
    disconnectAll()
    for (const url of urls) connectInstance(url)
  }

  function disconnectAll(): void {
    connections.forEach(es => es.close())
    connections.clear()
  }

  return { connected, reconnect: connectAll, disconnectAll }
}
```

### 4. Bootstrap: `src/composables/useSessionBootstrap.ts`

Bootstrap from all instances:
```ts
async function bootstrap(instanceUrls: string[]): Promise<void> {
  for (const url of instanceUrls) {
    const response = await fetch(`${url}/api/session`)
    // Add sessions with instanceUrl tag
    for (const sessionInfo of body.data) {
      store.addSession(sessionInfo, url)  // pass instance URL
    }
  }
}
```

### 5. UI: `src/components/ConnectionConfig.vue`

Replace URL input with scan button + instance list:

```
┌─────────────────────────────────────┐
│  [Scan for instances]               │  ← button, triggers scan
│                                     │
│  Discovered instances:              │
│  ● localhost:4096  opencode-monitor │  ● = connected, green dot
│  ● localhost:61401 the-world        │
│  ○ localhost:61423 another-project   │  ○ = not connected
│                                     │
│  [Monitor all]  [Monitor selected]  │  ← connect buttons
└─────────────────────────────────────┘
```

When scan completes, auto-connect to all found instances.

### 6. SessionTree

No changes needed — already groups by `directory`, which naturally separates projects.

## Backward Compatibility

- Keep `store.baseUrl` as a getter returning first instance URL
- `useSessionMessages.ts` uses `store.baseUrl` — still works (fetches from first instance)
- For child session fetches, use the session's `instanceUrl` instead of `store.baseUrl`

## Execution Order

1. Create `useInstanceScanner.ts`
2. Update `session.ts` store — add instances list, instanceUrl on SessionNode
3. Update `useEventStream.ts` — multi-connection support
4. Update `useSessionBootstrap.ts` — multi-instance bootstrap
5. Update `ConnectionConfig.vue` — scan button + instance list
6. Update `App.vue` — orchestrate scan → bootstrap → connect
7. Update `useSessionMessages.ts` — use session's instanceUrl for fetches
8. Build + test

## Risks

- Port scanning may be slow — use 500ms timeout per port, parallel with limited concurrency
- SSE connections to multiple instances — each is independent, no conflict
- Session ID collisions across instances — unlikely (IDs are globally unique), but add instanceUrl to disambiguate
- `store.baseUrl` backward compat — keep as getter
