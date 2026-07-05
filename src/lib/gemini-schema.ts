const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set(["$schema", "title", "$id", "definitions"]);

export function sanitizeGeminiResponseSchema<T>(schema: T): T {
  if (schema === null || typeof schema !== "object") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => sanitizeGeminiResponseSchema(item)) as T;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      continue;
    }

    result[key] = sanitizeGeminiResponseSchema(value);
  }

  return result as T;
}
