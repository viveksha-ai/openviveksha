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
  return applyDefaults(mod.dataSchema, data);
}