// OpenCode API types — verified against OpenCode source code (2026-06-23)
// Source: packages/core/src/session/schema.ts, packages/core/src/v1/session.ts,
//         packages/server/src/groups/session.ts, packages/server/src/groups/event.ts
// See opencode-monitor-design.md §2 for verification table

// ─── Session (packages/core/src/session/schema.ts) ───────────────────────

export interface SessionTime {
  created: string  // ISO timestamp (DateTimeUtcFromMillis)
  updated: string  // ISO timestamp (DateTimeUtcFromMillis)
  archived?: number | string  // v2 returns epoch-ms number; some legacy paths may return ISO string
}

export interface SessionLocation {
  directory: string  // AbsolutePath — the session's cwd
  workspaceID?: string
}

export interface SessionModelRef {
  providerID: string
  modelID?: string  // V2 API field name
  id?: string       // Legacy API field name (same data, different key)
  variant?: string
}

export interface SessionV2Info {
  id: string
  parentID: string | null  // 大写 ID (session/schema.ts:25); null = top-level session
  // NOTE: API returns "" (empty string) for top-level sessions, not JSON null.
  // Treat falsy values (null, "", undefined) as top-level.
  projectID?: string
  title: string
  agent: string  // e.g. 'librarian' | 'fixer' | 'oracle' | 'main'
  model?: SessionModelRef
  location: SessionLocation
  subpath?: string
  time: SessionTime
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: {       // NOTE: NOT flat 'cached' — nested cache.{read,write}
      read: number
      write: number
    }
  }
  // NOTE: Session has NO 'status' field. BackgroundJob.Status exists but is
  // in-memory with no HTTP endpoint. State must be inferred client-side.
}

// /api/session response envelope
export interface SessionListResponse {
  data: SessionV2Info[]
  cursor?: {
    previous?: string
    next?: string
  }
}

// ─── Messages (packages/core/src/session/message.ts) ─────────────────────
// Message is a tagged union discriminated by `type`, NOT `role`+`parts`.
// Each variant has type: "user"|"assistant"|"synthetic"|"system"|"shell"|
//                        "agent-switched"|"model-switched"|"compaction"

export type MessageType = 'user' | 'assistant' | 'synthetic' | 'system' |
  'shell' | 'agent-switched' | 'model-switched' | 'compaction'

export type FinishReason = 'stop' | 'length' | 'tool-calls' | 'content-filter' | null

export interface MessageBase {
  id: string
  sessionID: string
  time?: {
    created: string
    completed?: string
  }
}

export interface UserMessage extends MessageBase {
  type: 'user'
  text: string
}

export interface AssistantMessage extends MessageBase {
  type: 'assistant'
  finish?: FinishReason
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export interface SyntheticMessage extends MessageBase {
  type: 'synthetic'
  text: string
}

export interface SystemMessage extends MessageBase {
  type: 'system'
  text: string
}

export interface ShellMessage extends MessageBase {
  type: 'shell'
  command: string
  output?: string
  exitCode?: number
}

export interface AgentSwitchedMessage extends MessageBase {
  type: 'agent-switched'
  agent: string
}

export interface ModelSwitchedMessage extends MessageBase {
  type: 'model-switched'
  model: SessionModelRef
}

export interface CompactionMessage extends MessageBase {
  type: 'compaction'
}

export type Message =
  | UserMessage
  | AssistantMessage
  | SyntheticMessage
  | SystemMessage
  | ShellMessage
  | AgentSwitchedMessage
  | ModelSwitchedMessage
  | CompactionMessage

// /api/session/:id/message response
export interface MessageListResponse {
  data: Message[]
  cursor?: {
    previous?: string
    next?: string
  }
}

// ─── Message Parts (packages/core/src/v1/session.ts — Part union) ────────
// Parts are separate entities with base: { id, sessionID, messageID }
// Part types: text | subtask | reasoning | file | tool | step-start |
//             step-finish | snapshot | patch | agent | retry | compaction

export type PartType = 'text' | 'subtask' | 'reasoning' | 'file' | 'tool' |
  'step-start' | 'step-finish' | 'snapshot' | 'patch' | 'agent' | 'retry' | 'compaction'

export interface PartBase {
  id: string
  sessionID: string
  messageID: string
}

export interface TextPart extends PartBase {
  type: 'text'
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: { start?: string; end?: string }
  metadata?: Record<string, unknown>
}

export interface ToolState {
  status: 'pending' | 'running' | 'completed' | 'error'
  input?: unknown
  output?: unknown
  error?: string
  metadata?: Record<string, unknown>
}

export interface ToolPart extends PartBase {
  type: 'tool'
  callID: string
  tool: string  // tool name (e.g. 'task', 'bash', 'read', 'edit')
  state: ToolState
  metadata?: Record<string, unknown>
}

export interface ReasoningPart extends PartBase {
  type: 'reasoning'
  text: string
  metadata?: Record<string, unknown>
  time?: { start?: string; end?: string }
}

export interface FilePart extends PartBase {
  type: 'file'
  uri: string
  mime: string
  name?: string
  description?: string
}

export interface SubtaskPart extends PartBase {
  type: 'subtask'
  sessionID: string
  state: 'running' | 'completed' | 'error'
  summary?: string
}

export interface StepStartPart extends PartBase { type: 'step-start' }
export interface StepFinishPart extends PartBase {
  type: 'step-finish'
  reason?: FinishReason  // 'stop' | 'length' | 'tool-calls' | 'content-filter' | null
}
export interface SnapshotPart extends PartBase { type: 'snapshot' }
export interface PatchPart extends PartBase { type: 'patch' }
export interface AgentPart extends PartBase { type: 'agent'; agent: string }
export interface RetryPart extends PartBase { type: 'retry' }
export interface CompactionPart extends PartBase { type: 'compaction' }

export type MessagePart =
  | TextPart | ToolPart | ReasoningPart | FilePart | SubtaskPart
  | StepStartPart | StepFinishPart | SnapshotPart | PatchPart
  | AgentPart | RetryPart | CompactionPart

// ─── SSE Events (packages/core/src/v1/session.ts, packages/server/src/groups/event.ts) ───
// HTTP SSE endpoint wraps events as { id, type, data }

export interface SSEEvent<T = unknown> {
  type: string
  data: T
}

export interface SessionCreatedEvent {
  sessionID: string
  info: SessionV2Info  // NOTE: field is 'info', NOT 'session'
}

export interface SessionUpdatedEvent {
  sessionID: string
  info: SessionV2Info  // NOTE: field is 'info' (full), NOT 'session' (partial)
}

export interface MessagePartUpdatedEvent {
  sessionID: string
  part: MessagePart    // part.id, part.messageID are INSIDE part, not top-level
  time: number         // NOTE: extra time field not in app types
}

export interface MessagePartDeltaEvent {
  sessionID: string
  messageID: string
  partID: string
  field: string        // e.g. "text" — which field the delta applies to
  delta: string        // text chunk
}

// ─── Prompt API (packages/server/src/groups/session.ts, packages/core/src/session/prompt.ts) ──

export interface FileAttachment {
  uri: string
  mime: string
  name?: string
  description?: string
  source?: unknown
}

export interface AgentAttachment {
  name: string
  source?: unknown
}

export interface PromptBody {
  prompt: {
    text: string
    files?: FileAttachment[]   // NOT string[]
    agents?: AgentAttachment[] // NOT string[]
  }
  id?: string          // must be SessionMessage.ID (branded, starts with "msg_")
  delivery?: 'steer' | 'queue'  // default: 'steer'
  resume?: boolean
}

// ─── Client-side SessionNode (design doc §5.2) ──────────────────────────

export type InferredState = 'running' | 'completed' | 'error' | 'unknown'

export interface SessionNode {
  id: string
  parentID: string | null
  directory: string
  title: string
  agent: string
  inferredState: InferredState
  lastEventTime: number       // client-maintained, updated on every SSE event
  lastEventType: string       // client-maintained, for stuck diagnosis display
  lastFinishReason: FinishReason  // Signal A for completion detection
  messages: MessagePart[]     // accumulated from SSE events, for detail panel
  children: SessionNode[]     // assembled by parentID
  raw: SessionV2Info          // original API data
  instanceUrl: string         // which OpenCode server this session came from
}

export interface StuckAlert {
  sessionID: string
  stuckDuration: number
  lastEventType: string
}

// ─── Undo/Redo types ───────────────────────────────────────────────────

export interface FileDiff {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  content?: string  // patch text, if available
  // OpenCode API also returns these fields (different names):
  file?: string     // same as path, from API
  patch?: string   // same as content, from API — unified diff text
}

export type RevertResult = { ok: true; session: SessionV2Info } | { ok: false; error: 'busy' | 'not-found' | 'bad-request' | 'network' }
export type ForkResult = { ok: true; session: SessionV2Info; instanceUrl: string } | { ok: false; error: string }
export type AbortResult = { ok: true } | { ok: false; error: string }
