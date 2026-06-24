# 步骤 0：类型生成 + 依赖安装

> **共享上下文**：参见 `_shared-context.md`

## 范围

从 live JSON Schema 生成 TypeScript 类型，安装验证依赖。

## 前置条件

无。

## 实现要点

1. 获取 schema：`curl https://opencode.ai/config.json -o docs/opencode-config.schema.json`
2. 预下载外部 schema：`curl https://models.dev/model-schema.json -o docs/models.schema.json`（schema 中 `model`/`small_model`/`AgentConfig.model` 字段引用此外部 `$ref`）
3. 用 `json-schema-to-typescript` 生成类型：
   ```
   npx json-schema-to-typescript docs/opencode-config.schema.json \
     --output src/types/opencode-config.ts \
     --no-additionalProperties
   ```
   > **注意**：`--no-additionalProperties` 控制的是 schema 中**未显式声明** `additionalProperties` 的对象的默认行为，不是剥离已有的声明。此 flag 对 `AgentConfig` 和 `ProviderConfig.options` 尤为重要 — 这两个类型使用 V1 的 `Schema.StructWithRest`（允许任意额外键），schema 中未显式设置 `additionalProperties: false`。没有此 flag，生成类型会错误地丢失 `[k: string]: unknown` 索引签名，破坏 round-trip。
4. 手动修复 `plugin` 类型：`json-schema-to-typescript` 不支持 2020-12 的 `prefixItems`，生成的 `plugin` 类型会是泛型数组。需要手动修正为 `Array<string | [string, Record<string, unknown>]>`
5. 验证 2020-12 `$defs` 支持：如果工具无法解析 `$defs`，切换到 `openapi-typescript` 或手动编写类型
6. 手动审查生成结果，确保以下关键类型正确（对照 schema 而非凭记忆）：
   - `MCPConfig` 是鉴别联合：`McpLocalConfig | McpRemoteConfig | { enabled: boolean }`
     - `McpLocalConfig.environment`（不是 `env`），`command` 是完整 argv 数组（不是 string），有 `cwd`，无 `args`
     - `McpRemoteConfig` 有 `url`, `headers`, `oauth`, `enabled`, `timeout`
   - `AgentConfig.disable`（不是 `disabled`），`mode: 'subagent' | 'primary' | 'all'`
   - `permission` 是单个 `PermissionConfig` 联合类型（不是 `Record<string, ...>`）
   - `command` 是 `Map<string, {template, description?, agent?, model?, variant?, subtask?}>`（不是 string）
   - `share` 是枚举 `'manual' | 'auto' | 'disabled'`（不是 object）
   - `autoupdate` 是 `anyOf[boolean, 'notify']`（不是 object）
   - `snapshot` 是 `boolean`（不是 object）
   - `logLevel` 是大写 `'DEBUG' | 'INFO' | 'WARN' | 'ERROR'`
   - `ProviderOptions` 有 `apiKey`, `baseURL`, `enterpriseUrl`, `setCacheKey`, `timeout`, `headerTimeout`, `chunkTimeout`（无 `maxRetries`，无 `headers`）
   - `ProviderConfig` 还有 `api`, `env`（string[]）, `npm`, `models`（map）
   - `plugin` 是 `Array<string | [string, Record<string, unknown>]>`（联合类型：裸字符串或 [name, config] 元组）
   - 顶层已弃用字段（`mode`, `reference`, `layout`, `autoshare`）用 `unknown` 类型（不是 `never`），保留 round-trip 能力
   - `AgentConfig` 级别已弃用字段（`tools` → 用 `permission` 替代, `maxSteps` → 用 `steps` 替代）同样用 `unknown` 类型
4. 安装依赖：`pnpm add ajv`（无需 `ajv-formats`，schema 用 `pattern` 而非 `format`）
   > **关键**：必须使用 `import Ajv2020 from "ajv/dist/2020"` — 默认 `import Ajv from "ajv"` 只支持 draft-07，但 OpenCode schema 是 2020-12。用默认 import 会导致验证静默失败或拒绝合法配置。
5. 安装合并工具：`pnpm add @fastify/deepmerge`

## 交付物

- `docs/opencode-config.schema.json` — 冻结的 schema 副本
- `src/types/opencode-config.ts` — 自动生成的类型
- `package.json` 新增 `ajv`、`@fastify/deepmerge`

## 验收标准

- [ ] `src/types/opencode-config.ts` 可被 `tsc --noEmit` 编译通过
- [ ] `McpLocalConfig` 有 `environment` 字段，无 `env` 字段，无 `args` 字段
- [ ] `AgentConfig` 有 `disable` 字段（不是 `disabled`），`mode` 枚举值为 `'subagent' | 'primary' | 'all'`
- [ ] `permission` 类型是联合类型，不是 `Record<string, ...>`
- [ ] `logLevel` 枚举值全大写
- [ ] `share` 是字符串枚举，不是对象
- [ ] `snapshot` 是 `boolean`，不是对象
- [ ] 已弃用字段类型为 `unknown`，不是 `never`
- [ ] `plugin` 类型是 `Array<string | [string, Record<string, unknown>]>`（手动修复后）
- [ ] AJV 使用 2020-12 模式（`import Ajv2020 from "ajv/dist/2020"`）
- [ ] 外部 `$ref` 到 `models.dev` 已处理（预下载或接受 `any`）
- [ ] `ajv` 可成功加载 schema 并验证一个合法 config JSON

## 审核重点

- Schema 字段名是否与 https://opencode.ai/config.json 完全一致
- 鉴别联合类型的生成是否正确（MCPConfig 的三个分支）
- `json-schema-to-typescript` 的 `--no-additionalProperties` flag 是否会导致信息丢失
- 已弃用字段的 `unknown` 类型是否真的保留 round-trip 能力
