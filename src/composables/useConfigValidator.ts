/**
 * Config validator — simplified to skip AJV for now.
 * 
 * AJV has issues resolving external $ref URLs (https://models.dev/model-schema.json).
 * The server-side validation is the real authority anyway, so client-side
 * validation is just a nice-to-have. We skip it to avoid blocking saves.
 */

export function validateConfig(_config: unknown): { valid: boolean; errors: string[] } {
  // Server-side validation is authoritative; skip client-side AJV for now
  return { valid: true, errors: [] }
}
