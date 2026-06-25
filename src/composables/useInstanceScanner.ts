import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { fetch } from '@tauri-apps/plugin-http'
import { useSessionStore, type InstanceConnection } from '@/stores/session'

// Module-shared singleton: scanning is global application state, not per-component.
const scanning = ref(false)

const HEALTH_TIMEOUT_MS = 800
const PROJECT_TIMEOUT_MS = 1000

interface HealthResponse {
  version?: string
  [key: string]: unknown
}

interface ProjectResponse {
  data?: { directory?: string }
  directory?: string
  [key: string]: unknown
}

interface DiscoveredInstance {
  url: string
  port: number
  version?: string
  projectDir?: string
}

async function probe(url: string, timeoutMs: number): Promise<HealthResponse | null> {
  try {
    // Tauri's fetch doesn't fully support AbortSignal.timeout — use Promise.race
    const fetchPromise = fetch(`${url}/global/health`)
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    const response = await Promise.race([fetchPromise, timeoutPromise])
    if (!response || !response.ok) return null
    return (await response.json()) as HealthResponse
  } catch {
    return null
  }
}

async function probeProjectDir(url: string, timeoutMs: number): Promise<string | undefined> {
  try {
    const fetchPromise = fetch(`${url}/project/current`)
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    const response = await Promise.race([fetchPromise, timeoutPromise])
    if (!response || !response.ok) return undefined
    const body = (await response.json()) as ProjectResponse
    return body.data?.directory ?? body.directory ?? undefined
  } catch {
    return undefined
  }
}

export interface UseInstanceScannerReturn {
  scanning: typeof scanning
  scan: () => Promise<InstanceConnection[]>
}

export function useInstanceScanner(): UseInstanceScannerReturn {
  const store = useSessionStore()

  async function scan(): Promise<InstanceConnection[]> {
    if (scanning.value) return store.instances
    scanning.value = true
    try {
      // Step 1: Use Tauri command to discover OpenCode process ports via OS process list
      let portsToScan: number[] = []
      try {
        const discoveredPorts = await invoke<number[]>('discover_opencode_ports')
        portsToScan = discoveredPorts
      } catch {
        // Fallback: scan default range
        portsToScan = Array.from({ length: 25 }, (_, i) => 4096 + i)
      }

      // Always include default range as fallback
      for (let p = 4096; p <= 4120; p++) {
        if (!portsToScan.includes(p)) portsToScan.push(p)
      }

      // Step 2: Probe each port for OpenCode health endpoint
      const probes = await Promise.all(
        portsToScan.map(async (port): Promise<DiscoveredInstance | null> => {
          const url = `http://127.0.0.1:${port}`
          const health = await probe(url, HEALTH_TIMEOUT_MS)
          if (!health) return null
          const projectDir = await probeProjectDir(url, PROJECT_TIMEOUT_MS)
          return {
            url,
            port,
            version: typeof health.version === 'string' ? health.version : undefined,
            projectDir,
          }
        }),
      )

      const found: InstanceConnection[] = probes
        .filter((p): p is DiscoveredInstance => p !== null)
        .map((p) => ({
          url: p.url,
          port: p.port,
          version: p.version,
          projectDir: p.projectDir,
          connected: false,
        }))
        .sort((a, b) => a.port - b.port)

      // Preserve manually-added instances that weren't found in the scan
      const foundUrls = new Set(found.map((f) => f.url))
      const manual = store.instances.filter((i) => !foundUrls.has(i.url))
      store.setInstances([...found, ...manual])
      return found
    } finally {
      scanning.value = false
    }
  }

  return { scanning, scan }
}
