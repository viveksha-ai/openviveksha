/**
 * SQLite storage — canvases, nodes, edges, conversation history.
 *
 * Single-user, local: no tenants, no orgs. Node configs are stored as JSON
 * blobs; secret fields are stripped on read-back by the API layer (laws §12),
 * not here — the executor needs them.
 */

import Database from "better-sqlite3";
import type {
  CanvasEdge,
  CanvasInfo,
  CanvasNode,
} from "./types.js";

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canvases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canvas_nodes (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        position_x REAL,
        position_y REAL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canvas_edges (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        source_port TEXT,
        target_id TEXT NOT NULL,
        target_port TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canvas_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_canvas ON canvas_nodes(canvas_id);
      CREATE INDEX IF NOT EXISTS idx_edges_canvas ON canvas_edges(canvas_id);
      CREATE INDEX IF NOT EXISTS idx_history_session ON chat_history(canvas_id, session_id);
    `);
  }

  // ─── Canvases ───────────────────────────────────────────────────────────────

  createCanvas(name: string): CanvasInfo {
    const id = "cv_" + crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO canvases (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, name, now, now);
    return { id, name, createdAt: now, updatedAt: now };
  }

  listCanvases(): CanvasInfo[] {
    return this.db
      .prepare("SELECT * FROM canvases ORDER BY created_at")
      .all() as unknown as CanvasInfo[];
  }

  getCanvas(id: string): CanvasInfo | undefined {
    return this.db.prepare("SELECT * FROM canvases WHERE id = ?").get(id) as
      | CanvasInfo
      | undefined;
  }

  deleteCanvas(id: string): void {
    this.db.prepare("DELETE FROM canvases WHERE id = ?").run(id);
  }

  // ─── Nodes ──────────────────────────────────────────────────────────────────

  createNode(
    canvasId: string,
    type: string,
    data: Record<string, unknown>,
    position?: { x: number; y: number },
  ): CanvasNode {
    const id = "node_" + crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO canvas_nodes (id, canvas_id, type, position_x, position_y, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, canvasId, type, position?.x ?? 0, position?.y ?? 0, JSON.stringify(data), now, now);
    return this.getNode(id)!;
  }

  getNode(id: string): CanvasNode | undefined {
    const row = this.db.prepare("SELECT * FROM canvas_nodes WHERE id = ?").get(id) as
      | {
          id: string;
          canvas_id: string;
          type: string;
          position_x: number | null;
          position_y: number | null;
          data: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      canvasId: row.canvas_id,
      type: row.type,
      position:
        row.position_x != null && row.position_y != null
          ? { x: row.position_x, y: row.position_y }
          : undefined,
      data: JSON.parse(row.data) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listNodes(canvasId: string): CanvasNode[] {
    return (this.db
      .prepare("SELECT id FROM canvas_nodes WHERE canvas_id = ? ORDER BY created_at, id")
      .all(canvasId) as unknown as { id: string }[]).map((r) => this.getNode(r.id)!);
  }

  updateNode(id: string, data: Record<string, unknown>): CanvasNode | undefined {
    const existing = this.getNode(id);
    if (!existing) return undefined;
    // Note: full replacement, matching PRO semantics (RFC-049 lesson: merge is
    // the caller's job in v0.1 — same behavior the AI client already knows).
    this.db
      .prepare("UPDATE canvas_nodes SET data = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(data), new Date().toISOString(), id);
    return this.getNode(id);
  }

  deleteNode(id: string): void {
    this.db.prepare("DELETE FROM canvas_nodes WHERE id = ?").run(id);
  }

  // ─── Edges ──────────────────────────────────────────────────────────────────

  createEdge(
    canvasId: string,
    sourceId: string,
    targetId: string,
    sourcePort?: string,
    targetPort?: string,
  ): CanvasEdge {
    const id = "edge_" + crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO canvas_edges (id, canvas_id, source_id, source_port, target_id, target_port, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, canvasId, sourceId, sourcePort ?? null, targetId, targetPort ?? null, now);
    return this.getEdge(id)!;
  }

  getEdge(id: string): CanvasEdge | undefined {
    const row = this.db.prepare("SELECT * FROM canvas_edges WHERE id = ?").get(id) as
      | {
          id: string;
          canvas_id: string;
          source_id: string;
          source_port: string | null;
          target_id: string;
          target_port: string | null;
          created_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      canvasId: row.canvas_id,
      sourceId: row.source_id,
      sourcePort: row.source_port ?? undefined,
      targetId: row.target_id,
      targetPort: row.target_port ?? undefined,
      createdAt: row.created_at,
    };
  }

  listEdges(canvasId: string): CanvasEdge[] {
    return (this.db
      .prepare("SELECT id FROM canvas_edges WHERE canvas_id = ? ORDER BY created_at, id")
      .all(canvasId) as unknown as { id: string }[]).map((r) => this.getEdge(r.id)!);
  }

  deleteEdge(id: string): void {
    this.db.prepare("DELETE FROM canvas_edges WHERE id = ?").run(id);
  }

  // ─── Conversation history (chat-history node) ───────────────────────────────

  appendTurn(
    canvasId: string,
    sessionId: string,
    role: "user" | "assistant",
    content: string,
  ): void {
    this.db
      .prepare(
        "INSERT INTO chat_history (canvas_id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(canvasId, sessionId, role, content, new Date().toISOString());
  }

  getHistory(canvasId: string, sessionId: string, depth: number): { role: string; content: string }[] {
    const rows = this.db
      .prepare(
        "SELECT role, content FROM chat_history WHERE canvas_id = ? AND session_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(canvasId, sessionId, depth > 0 ? depth * 2 : -1) as unknown as {
      role: string;
      content: string;
    }[];
    return rows.reverse();
  }

  close(): void {
    this.db.close();
  }
}