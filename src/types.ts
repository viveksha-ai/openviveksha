/**
 * OpenViveksha core types — the module contract.
 *
 * Clean-room implementation of spec/nodes.schema.json. A node module is a
 * self-contained unit: manifest (editor/UI metadata), schema (config
 * validation), ports (typed inputs/outputs), execute (the work), and optional
 * persistence hooks. The executor (laws.md §1–§14) drives nodes through this
 * contract. No multi-tenancy: single-user, local runtime.
 */

// ─── Ports ────────────────────────────────────────────────────────────────────

/** Port value types in spec v0.1. */
export type PortType = "TXT" | "PROMPT" | "TOOLS" | "ANY";

/** Arbitrary output values, keyed by output port name. */
export type PortValues = Record<string, unknown>;

export interface PortDefinition {
  name: string;
  type: PortType;
  required: boolean;
  /** Multiple edges fan-in as an array (laws §3). */
  multiple?: boolean;
  label?: string;
}

export interface Ports {
  inputs: PortDefinition[];
  outputs: PortDefinition[];
}

// ─── Node data (config) ───────────────────────────────────────────────────────

/** JSON Schema validating a node's `data` (see nodes.schema.json). */
export interface DataSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

/** Fields marked secret are write-only: never read back, never traced (laws §12). */
export interface SecretField {
  name: string;
}

// ─── Node / edge rows ─────────────────────────────────────────────────────────

export interface CanvasNode {
  id: string;
  canvasId: string;
  type: string;
  position?: { x: number; y: number };
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasEdge {
  id: string;
  canvasId: string;
  sourceId: string;
  sourcePort?: string;
  targetId: string;
  targetPort?: string;
  createdAt: string;
}

export interface CanvasInfo {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Execution context (what `execute` receives) ─────────────────────────────

export interface ModuleLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface Cache {
  get(nodeId: string, inputSignature: string): PortValues | null;
  set(nodeId: string, inputSignature: string, outputs: PortValues): void;
  invalidate(nodeId: string): void;
}

export interface CanvasApi {
  getNode(nodeId: string): CanvasNode | null;
  getNeighbors(nodeId: string): { id: string; type: string; edgeId: string; port?: string }[];
  getEdges(canvasId: string): CanvasEdge[];
}

export interface HttpApi {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

export interface TraceContext {
  setTokens(tokensIn: number, tokensOut: number): void;
  addMeta(key: string, value: unknown): void;
}

/** Tool calls through the runtime's active MCP connections (mcp hub). */
export interface ToolsApi {
  call(toolName: string, args?: unknown): Promise<unknown>;
}

export interface ExecutionContext {
  nodeId: string;
  canvasId: string;
  sessionId: string;
  inputs: PortValues;
  data: Record<string, unknown>;
  logger: ModuleLogger;
  cache: Cache;
  canvasApi: CanvasApi;
  httpApi: HttpApi;
  trace?: TraceContext;
  /** Present when the runtime has MCP connections; used by the tools loop. */
  toolsApi?: ToolsApi;
}

// ─── Tracing (laws §13) ───────────────────────────────────────────────────────

export interface TraceObservation {
  nodeId: string;
  nodeType: string;
  input: PortValues;
  output: PortValues;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
  error?: string;
  meta?: Record<string, unknown>;
  timestamp: string;
}

export interface Trace {
  traceId: string;
  sessionId: string;
  canvasId: string;
  startNodeId: string;
  message: string;
  reply: string;
  totalDurationMs: number;
  observations: TraceObservation[];
  createdAt: string;
}

// ─── Node module (the contract) ───────────────────────────────────────────────

export interface NodeModule {
  type: string;
  label: string;
  category: string;
  summary: string;
  /** JSON Schema validating node `data`. */
  dataSchema: DataSchema;
  /** Field names that hold secrets (write-only). */
  secretFields?: string[];
  ports: Ports;
  execute(ctx: ExecutionContext): Promise<PortValues>;
}