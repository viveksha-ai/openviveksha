# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**), or contact the maintainer directly
through a private channel listed in the repository owner's profile.

You will get an acknowledgment within 72 hours and a fix or a status update
within 14 days for confirmed issues.

## Scope

OpenViveksha v0.1 is a **local, single-user runtime**:

- The HTTP server binds `127.0.0.1` by default. Binding beyond localhost is
  an explicit, unsupported-for-now operator decision.
- The local MCP server is unauthenticated by design: the trust boundary is
  the machine. **A canvas is code** — `mcp.command` values and node configs
  are executed. Never run canvas files you did not author.
- Webhook channels authenticate with a shared secret (`X-Ingress-Secret`,
  constant-time comparison). Webhook URLs are meant for localhost/VPN use in
  v0.1.

Out of scope for v0.1: multi-tenant isolation, public deployments, node
egress filtering. A hardened edition (net-guard for node HTTP egress) is a
commercial-edition concern and intentionally not part of this runtime.

**Secrets at rest:** canvas files store secrets as `${ENV_NAME}` references,
but resolved values live in the local SQLite database after the first run
(plaintext on your disk — within the local trust boundary above). Reads over
the API/MCP never return them, and traces redact them.

## What we especially want to hear about

- Ingress secret bypass or timing leaks
- Secret fields (`secret: true`) leaking into API reads, MCP responses, or
  traces
- Executor: non-termination, deadlocks, cross-wire value delivery violating
  spec/laws.md §1–§10
- Path traversal or command injection in anything the runtime itself spawns