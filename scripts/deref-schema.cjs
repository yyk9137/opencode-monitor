const fs = require('fs')
let s = fs.readFileSync('docs/opencode-config.schema.json', 'utf8')

// 1. Replace external $ref to models.dev with string type
s = s.replaceAll(
  '"$ref": "https://models.dev/model-schema.json#/$defs/Model"',
  '"type": "string"'
)

// 2. Fix URL-encoded $refs: %24defs -> $defs
s = s.replaceAll('#/%24defs/', '#/$defs/')

fs.writeFileSync('docs/opencode-config.schema.deref.json', s)
console.log('Deref done:', s.length, 'bytes')
console.log('Remaining models.dev refs:', (s.match(/models\.dev/g) || []).length)
console.log('Remaining %24defs:', (s.match(/%24defs/g) || []).length)
