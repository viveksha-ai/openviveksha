/**
 * Node registry — the runtime's table of known node types.
 *
 * Built-in modules self-register; third-party modules register through the
 * same contract (licensing: each module carries its own license, see RFC-049).
 */

import type { DataSchema, NodeModule, Ports } from "./types.js";

export interface NodeTypeInfo {
  type: string;
  label: string;
  category: string;
  summary: string;
  dataSchema: DataSchema;
  ports: Ports;
}

export class NodeRegistry {
  private modules = new Map<string, NodeModule>();

  register(module: NodeModule): void {
    if (this.modules.has(module.type)) {
      throw new Error(`registry: node type "${module.type}" already registered`);
    }
    this.modules.set(module.type, module);
  }

  getByType(type: string): NodeModule | undefined {
    return this.modules.get(type);
  }

  has(type: string): boolean {
    return this.modules.has(type);
  }

  /** Everything an AI client needs to author nodes: schema + ports, no secrets. */
  listTypes(): NodeTypeInfo[] {
    return [...this.modules.values()].map((m) => ({
      type: m.type,
      label: m.label,
      category: m.category,
      summary: m.summary,
      dataSchema: m.dataSchema,
      ports: m.ports,
    }));
  }

  getTypeInfo(type: string): NodeTypeInfo | undefined {
    const m = this.modules.get(type);
    if (!m) return undefined;
    return {
      type: m.type,
      label: m.label,
      category: m.category,
      summary: m.summary,
      dataSchema: m.dataSchema,
      ports: m.ports,
    };
  }
}