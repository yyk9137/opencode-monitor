import Ajv2020 from 'ajv/dist/2020'
import schema from '../../docs/opencode-config.schema.json'

// Fix %24defs URL encoding in $ref + replace external $refs
let _ajv: Ajv2020 | null = null

function getSchema() {
  const str = JSON.stringify(schema)
  const fixed = str.split('#/%24defs/').join('#/$defs/')
  const deref = fixed.split('"$ref": "https://models.dev/model-schema.json#/$defs/Model"').join('"type": "string"')
  return JSON.parse(deref)
}

function getAjv(): Ajv2020 {
  if (!_ajv) {
    const ajv = new (Ajv2020 as any)({ strict: false, allowComments: true, allowTrailingCommas: true })
    ajv.compile(getSchema())
    _ajv = ajv
  }
  return _ajv!
}

/** Validate an OpenCode config object against the JSON Schema. Returns errors if invalid. */
export function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
  const ajv = getAjv()
  const validate = (ajv.getSchema('#/$defs/Config') ?? ajv.compile(getSchema())) as ((data: unknown) => boolean) & { errors?: unknown[] }
  const valid = validate(config)
  if (valid) return { valid: true, errors: [] }
  const errs = (validate.errors ?? []) as Array<{ instancePath?: string; message?: string }>
  const errors = errs.map(e => `${e.instancePath || ''}: ${e.message ?? 'invalid'}`)
  return { valid: false, errors }
}
