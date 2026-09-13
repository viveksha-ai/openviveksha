/**
 * Secret handling + config defaults (critique #10, #16).
 *
 * - Secret fields marked in the node registry are write-only: reads omit
 *   them entirely; values may reference `${ENV_NAME}`, resolved when a run
 *   starts.
 * - `applyDefaults` fills `default` values from the type's dataSchema so the
 *   client always sees the effective config.
 */

import type { NodeRegistry } from "./registry.js";
import type { DataSchema } from "./types.js";

const ENV_REF = /^\$\{([A-Z][A-Z0-9_]*)\}$/;

export function resolveSecrets(
  data: Record<string, unknown>,
  secretFields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const field of secretFields) {
    const resolve = (v: unknown): unknown => {
      if (typeof v === "string") {
        const m = ENV_REF.exec(v.trim());
        if (m) {
          const val = process.env[m[1]!];
          if (val === undefined) {
            throw new Error(`secrets: environment variable ${m[1]} is not set (referenced as \${${m[1]}})`);
          }
          return val;
        }
        return v;
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const obj: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          obj[k] = resolve(val);
        }
        return obj;
      }
      return v;
    };
    if (field in out) out[field] = resolve(out[field]);
  }
  return out;
}

export function stripSecrets(
  data: Record<string, unknown>,
  secretFields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const field of secretFields) delete out[field];
  return out;
}

/** Apply dataSchema defaults (shallow — v0.1 schemas are flat objects). */
export function applyDefaults(
  dataSchema: { properties?: Record<string, unknown> } | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...data };
  const props = (dataSchema?.properties ?? {}) as Record<string, { default?: unknown }>;
  for (const [key, prop] of Object.entries(props)) {
    if (out[key] === undefined && prop && typeof prop === "object" && "default" in prop) {
      out[key] = (prop as { default?: unknown }).default;
    }
  }
  return out;
}

export function effectiveData(registry: NodeRegistry, type: string, data: Record<string, unknown>) {
  const mod = registry.getByType(type);
  if (!mod) throw new Error(`unknown node type "${type}"`);
  const out = applyDefaults(mod.dataSchema, data);
  validateData(type, mod.dataSchema, out);
  return out;
}

// ─── data validation (issue #3) ──────────────────────────────────────────────

const JSON_TYPES: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
};

/**
 * Validate node data against the node's flat v0.1 JSON Schema
 * (property types, enum, required). Throws a single error naming every
 * offending field, so create/update rejects bad payloads before they
 * reach execute() (issue #3).
 */
export function validateData(
  type: string,
  schema: DataSchema,
  data: Record<string, unknown>,
): void {
  const errors: string[] = [];
  for (const field of schema.required ?? []) {
    if (data[field] === undefined) errors.push(`"${field}" is required`);
  }
  const props = (schema.properties ?? {}) as Record<
    string,
    { type?: string; enum?: unknown[] }
  >;
  for (const [field, def] of Object.entries(props)) {
    if (data[field] === undefined) continue;
    const check = def.type ? JSON_TYPES[def.type] : undefined;
    if (check && !check(data[field])) {
      errors.push(`"${field}" must be ${def.type}`);
      continue;
    }
    if (Array.isArray(def.enum) && !def.enum.includes(data[field])) {
      errors.push(`"${field}" must be one of: ${def.enum.map(String).join(", ")}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`${type}: invalid data — ${errors.join("; ")}`);
  }
}