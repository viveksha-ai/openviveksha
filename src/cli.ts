#!/usr/bin/env node
/**
 * openviveksha CLI.
 *
 *   openviveksha serve [--port 8031] [--db ./openviveksha.sqlite] [--host 127.0.0.1]
 *   openviveksha mcp    [--db ./openviveksha.sqlite]        # stdio MCP (AI clients spawn this)
 *
 * Defaults: HTTP binds 127.0.0.1; binding a public host must be explicit
 * (canvas-spec.md, Local trust boundary).
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { createRuntime } from "./index.js";
import { createHttpServer } from "./server.js";
import { serveMcpStdio } from "./mcp/server.js";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "serve" }, // serve | mcp
    port: { type: "string", default: "8031" },
    host: { type: "string", default: "127.0.0.1" },
    db: { type: "string", default: "./openviveksha.sqlite" },
  },
});

const dbPath = resolve(values.db!);
const rt = createRuntime(dbPath);

if (values.mode === "mcp") {
  await serveMcpStdio(rt);
} else {
  const port = Number(values.port);
  const host = values.host!;
  createHttpServer(rt, { port, host });
  console.log(`openviveksha: http://${host}:${port} (db: ${dbPath})`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.warn("openviveksha: WARNING — bound beyond localhost; a canvas is code, add your own auth.");
  }
}