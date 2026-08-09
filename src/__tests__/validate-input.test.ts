import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

const load = () => import(rootUrl("src/lib/validate-input.ts"));

describe("validateInput — schemas it cannot meaningfully validate", () => {
  it("accepts anything when the offer declares no schema", async () => {
    const { validateInput } = await load();

    assert.deepEqual(validateInput(null, { anything: true }), { valid: true });
    assert.deepEqual(validateInput(undefined, "not even an object"), { valid: true });
    assert.deepEqual(validateInput("", {}), { valid: true });
  });

  it("accepts anything when the schema is prose or invalid JSON", async () => {
    const { validateInput } = await load();

    assert.deepEqual(validateInput("send us a query string", {}), { valid: true });
  });

  it("accepts anything when the schema is a free-form example, not a JSON Schema", async () => {
    const { validateInput } = await load();

    const example = JSON.stringify({ query: "x402 adoption", limit: 5 });
    assert.deepEqual(validateInput(example, {}), { valid: true });
  });

  it("only validates object bodies", async () => {
    const { validateInput } = await load();

    const schema = JSON.stringify({ type: "string" });
    assert.deepEqual(validateInput(schema, 42), { valid: true });
  });
});

describe("validateInput — required fields", () => {
  const schema = JSON.stringify({
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "number" } },
    required: ["query"],
  });

  it("passes when every required field is present", async () => {
    const { validateInput } = await load();

    assert.deepEqual(validateInput(schema, { query: "hello", limit: 3 }), { valid: true });
  });

  it("rejects a missing or null required field", async () => {
    const { validateInput } = await load();

    assert.deepEqual(validateInput(schema, {}), {
      valid: false,
      error: "missing required field: query",
    });
    assert.deepEqual(validateInput(schema, { query: null }), {
      valid: false,
      error: "missing required field: query",
    });
  });

  it("rejects a non-object body when required fields are declared", async () => {
    const { validateInput } = await load();

    assert.deepEqual(validateInput(schema, "hello"), {
      valid: false,
      error: "request body must be a JSON object",
    });
    assert.deepEqual(validateInput(schema, [{ query: "hello" }]), {
      valid: false,
      error: "request body must be a JSON object",
    });
  });

  it("accepts a non-object body when nothing is required", async () => {
    const { validateInput } = await load();

    const noRequired = JSON.stringify({ type: "object", properties: { q: { type: "string" } } });
    assert.deepEqual(validateInput(noRequired, "hello"), { valid: true });
  });
});

describe("validateInput — property types", () => {
  function schemaFor(type: string) {
    return JSON.stringify({ type: "object", properties: { field: { type } } });
  }

  it("accepts values matching each supported JSON Schema type", async () => {
    const { validateInput } = await load();

    assert.deepEqual(validateInput(schemaFor("string"), { field: "s" }), { valid: true });
    assert.deepEqual(validateInput(schemaFor("number"), { field: 1.5 }), { valid: true });
    assert.deepEqual(validateInput(schemaFor("integer"), { field: 2 }), { valid: true });
    assert.deepEqual(validateInput(schemaFor("boolean"), { field: false }), { valid: true });
    assert.deepEqual(validateInput(schemaFor("array"), { field: [] }), { valid: true });
    assert.deepEqual(validateInput(schemaFor("object"), { field: {} }), { valid: true });
    assert.deepEqual(validateInput(schemaFor("null"), { field: null }), { valid: true });
  });

  it("rejects mismatched types with the offending field name", async () => {
    const { validateInput } = await load();

    assert.deepEqual(validateInput(schemaFor("string"), { field: 1 }), {
      valid: false,
      error: "field 'field' must be of type string",
    });
    assert.deepEqual(validateInput(schemaFor("object"), { field: [] }), {
      valid: false,
      error: "field 'field' must be of type object",
    });
    assert.deepEqual(validateInput(schemaFor("boolean"), { field: "true" }), {
      valid: false,
      error: "field 'field' must be of type boolean",
    });
  });

  it("ignores unknown types and properties absent from the schema", async () => {
    const { validateInput } = await load();

    assert.deepEqual(validateInput(schemaFor("anything-else"), { field: 1 }), { valid: true });
    assert.deepEqual(validateInput(schemaFor("string"), { extra: 1 }), { valid: true });
  });
});
