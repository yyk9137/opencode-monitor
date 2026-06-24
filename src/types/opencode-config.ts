/**
 * OpenCode configuration types — manually written from https://opencode.ai/config.json
 * (JSON Schema 2020-12, auto-generated tools failed on $defs URL encoding)
 *
 * Invariants verified against schema + OpenCode V1 source:
 * - model/small_model/AgentConfig.model are string (external $ref to models.dev resolved to string)
 * - AgentConfig and ProviderConfig.options use StructWithRest → allow extra keys via index signature
 * - Deprecated fields use `unknown` (not `never`) to preserve round-trip
 * - MCPConfig is discriminated union: McpLocalConfig | McpRemoteConfig | { enabled: boolean }
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

export interface ServerConfig {
  port?: number
  hostname?: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: string[]
}

export interface ConfigV2ReferenceGit {
  repository: string
  branch?: string
  description?: string
  hidden?: boolean
}

export interface ConfigV2ReferenceLocal {
  path: string
  description?: string
  hidden?: boolean
}

export type ConfigV2Reference = ConfigV2ReferenceGit | ConfigV2ReferenceLocal

export type PermissionActionConfig = "ask" | "allow" | "deny"

export interface PermissionObjectConfig {
  [k: string]: PermissionActionConfig
}

export type PermissionRuleConfig = PermissionActionConfig | PermissionObjectConfig

export type PermissionConfigObject = Partial<{
  read: PermissionRuleConfig
  edit: PermissionRuleConfig
  glob: PermissionRuleConfig
  grep: PermissionRuleConfig
  list: PermissionRuleConfig
  bash: PermissionRuleConfig
  task: PermissionRuleConfig
  external_directory: PermissionRuleConfig
  todowrite: PermissionActionConfig
  question: PermissionActionConfig
  webfetch: PermissionActionConfig
  websearch: PermissionActionConfig
  lsp: PermissionRuleConfig
  doom_loop: PermissionActionConfig
  skill: PermissionRuleConfig
}> & { [k: string]: PermissionRuleConfig }

export type PermissionConfig = PermissionActionConfig | PermissionConfigObject

export type AgentColor = string // Hex (#RRGGBB) or theme enum name

export interface AgentConfig {
  model?: string
  variant?: string
  temperature?: number
  top_p?: number
  prompt?: string
  /** @deprecated Use 'permission' field instead */
  tools?: Record<string, boolean>
  disable?: boolean
  description?: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  options?: Record<string, unknown>
  color?: AgentColor
  steps?: number
  /** @deprecated Use 'steps' field instead */
  maxSteps?: number
  permission?: PermissionConfig
  [k: string]: unknown
}

export interface ProviderModelCost {
  input: number
  output: number
  cache_read?: number
  cache_write?: number
  context_over_200k?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
  }
}

export interface ProviderModelLimit {
  context: number
  output: number
  input?: number
}

export interface ProviderModelModalities {
  input?: Array<"text" | "audio" | "image" | "video" | "pdf">
  output?: Array<"text" | "audio" | "image" | "video" | "pdf">
}

export interface ProviderModelVariant {
  disabled?: boolean
}

export interface ProviderModel {
  id?: string
  name?: string
  family?: string
  release_date?: string
  attachment?: boolean
  reasoning?: boolean
  temperature?: boolean
  tool_call?: boolean
  interleaved?: boolean | { field: "reasoning" | "reasoning_content" | "reasoning_details" }
  cost?: ProviderModelCost
  limit?: ProviderModelLimit
  modalities?: ProviderModelModalities
  experimental?: boolean
  status?: "alpha" | "beta" | "deprecated" | "active"
  provider?: { npm?: string; api?: string }
  options?: Record<string, unknown>
  headers?: Record<string, string>
  variants?: Record<string, ProviderModelVariant>
  [k: string]: unknown
}

export interface ProviderOptions {
  apiKey?: string
  baseURL?: string
  enterpriseUrl?: string
  setCacheKey?: boolean
  timeout?: number | false
  headerTimeout?: number | false
  chunkTimeout?: number
  [k: string]: unknown
}

export interface ProviderConfig {
  api?: string
  name?: string
  env?: string[]
  id?: string
  npm?: string
  whitelist?: string[]
  blacklist?: string[]
  options?: ProviderOptions
  models?: Record<string, ProviderModel>
  [k: string]: unknown
}

export interface McpLocalConfig {
  type: "local"
  command: string[]
  cwd?: string
  environment?: Record<string, string>
  enabled?: boolean
  timeout?: number
}

export interface McpOAuthConfig {
  clientId?: string
  clientSecret?: string
  scope?: string
  callbackPort?: number
  redirectUri?: string
}

export interface McpRemoteConfig {
  type: "remote"
  url: string
  enabled?: boolean
  headers?: Record<string, string>
  oauth?: McpOAuthConfig | false
  timeout?: number
}

export interface McpBuiltInConfig {
  enabled: boolean
}

export type MCPConfig = McpLocalConfig | McpRemoteConfig | McpBuiltInConfig

export type LayoutConfig = "auto" | "stretch"

export interface ImageAttachmentConfig {
  auto_resize?: boolean
  max_width?: number
  max_height?: number
  max_base64_bytes?: number
}

export interface AttachmentConfig {
  image?: ImageAttachmentConfig
}

export type PolicyEffect = "allow" | "deny"

export interface ConfigV2ExperimentalPolicy {
  action: "provider.use"
  effect: PolicyEffect
  resource: string
}

export interface CommandConfig {
  template: string
  description?: string
  agent?: string
  model?: string
  variant?: string
  subtask?: boolean
}

export interface SkillsConfig {
  paths?: string[]
  urls?: string[]
}

export interface WatcherConfig {
  ignore?: string[]
}

export interface EnterpriseConfig {
  url?: string
}

export interface ToolOutputConfig {
  max_lines?: number
  max_bytes?: number
}

export interface CompactionConfig {
  auto?: boolean
  prune?: boolean
  tail_turns?: number
  preserve_recent_tokens?: number
  reserved?: number
}

export interface ExperimentalConfig {
  disable_paste_summary?: boolean
  batch_tool?: boolean
  openTelemetry?: boolean
  continue_loop_on_deny?: boolean
  primary_tools?: string[]
  mcp_timeout?: number
  policies?: ConfigV2ExperimentalPolicy[]
}

export interface LspCustomEntry {
  command: string[]
  extensions?: string[]
  disabled?: boolean
  env?: Record<string, string>
  initialization?: Record<string, unknown>
}

export type LspEntry = { disabled: true } | LspCustomEntry

export interface FormatterCustomEntry {
  disabled?: boolean
  command: string[]
  environment?: Record<string, string>
  extensions?: string[]
}

/**
 * Full OpenCode config (ConfigV1.Info from GET /config).
 * Top-level additionalProperties: false.
 * Deprecated fields typed as `unknown` for round-trip preservation.
 */
export interface OpenCodeConfig {
  $schema?: string
  shell?: string
  logLevel?: LogLevel
  server?: ServerConfig
  command?: Record<string, CommandConfig>
  skills?: SkillsConfig
  references?: Record<string, string | ConfigV2ReferenceGit | ConfigV2ReferenceLocal>
  /** @deprecated Use 'references' instead */
  reference?: Record<string, string | ConfigV2ReferenceGit | ConfigV2ReferenceLocal>
  watcher?: WatcherConfig
  snapshot?: boolean
  plugin?: Array<string | [string, Record<string, unknown>]>
  share?: "manual" | "auto" | "disabled"
  /** @deprecated Use 'share' instead */
  autoshare?: boolean
  autoupdate?: boolean | "notify"
  disabled_providers?: string[]
  enabled_providers?: string[]
  model?: string
  small_model?: string
  default_agent?: string
  username?: string
  /** @deprecated Use 'agent' instead */
  mode?: Record<string, AgentConfig>
  agent?: Record<string, AgentConfig>
  provider?: Record<string, ProviderConfig>
  mcp?: Record<string, MCPConfig>
  formatter?: boolean | Record<string, FormatterCustomEntry>
  lsp?: boolean | Record<string, LspEntry>
  instructions?: string[]
  /** @deprecated Always uses stretch layout */
  layout?: LayoutConfig
  permission?: PermissionConfig
  tools?: Record<string, boolean>
  attachment?: AttachmentConfig
  enterprise?: EnterpriseConfig
  tool_output?: ToolOutputConfig
  compaction?: CompactionConfig
  experimental?: ExperimentalConfig
}
