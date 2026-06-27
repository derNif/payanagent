// Lightweight JSON-Schema validation (no deps) for a buyer's input against an
// offer's declared input schema. Only validates when the offer carries a *real*
// JSON Schema (an object with `type`/`properties`); free-form examples or prose
// are skipped (we can't validate those). Used to reject bad input BEFORE
// settlement so buyers never pay-then-fail on their own mistake.

type Json = Record<string, unknown>;

function isRealSchema(s: unknown): s is Json {
  return (
    !!s &&
    typeof s === "object" &&
    ((s as Json).type !== undefined || (s as Json).properties !== undefined)
  );
}

function typeOk(value: unknown, type: unknown): boolean {
  if (typeof type !== "string") return true;
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return !!value && typeof value === "object" && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

export function validateInput(
  rawSchema: string | null | undefined,
  body: unknown,
): { valid: boolean; error?: string } {
  if (!rawSchema) return { valid: true };

  let schema: unknown;
  try {
    schema = JSON.parse(rawSchema);
  } catch {
    return { valid: true }; // prose / non-JSON schema — can't validate
  }
  if (!isRealSchema(schema)) return { valid: true }; // example object, not a schema

  const s = schema as Json;
  if (s.type && s.type !== "object") return { valid: true }; // only validate object bodies

  const required = Array.isArray(s.required) ? (s.required as string[]) : [];
  const isObj = !!body && typeof body === "object" && !Array.isArray(body);

  if (!isObj) {
    if (required.length) {
      return { valid: false, error: "request body must be a JSON object" };
    }
    return { valid: true };
  }

  const obj = body as Json;
  for (const key of required) {
    if (obj[key] === undefined || obj[key] === null) {
      return { valid: false, error: `missing required field: ${key}` };
    }
  }

  const props =
    s.properties && typeof s.properties === "object" ? (s.properties as Json) : {};
  for (const [key, val] of Object.entries(obj)) {
    const propSchema = props[key] as Json | undefined;
    if (propSchema && propSchema.type && !typeOk(val, propSchema.type)) {
      return { valid: false, error: `field '${key}' must be of type ${propSchema.type}` };
    }
  }

  return { valid: true };
}
