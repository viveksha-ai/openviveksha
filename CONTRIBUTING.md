# Contributing

OpenViveksha is a minimal core on purpose. The bar for the runtime is:
every change keeps `spec/laws.md` §1–§10 true and every law keeps a test.

## Reporting

- **Security**: never in public issues — see `SECURITY.md`.
- Bugs: open an issue with the canvas file (strip secrets to `${ENV_NAME}`)
  and the exact tool calls or HTTP requests.
- Node ideas: build it first. If it only needs the existing contract, ship it
  as a package, not a PR.

## Pull requests

1. One logical change per PR. `npx tsc --noEmit` and `npm test` green.
2. Executor or spec changes must update `spec/` **and** the law tests in the
   same PR. The spec is the arbiter; the code follows it.
3. New node types are added to `spec/nodes.schema.json` first, then to
   `src/nodes/`. If it is niche, publish it as a third-party module instead —
   your name, your license.
4. No new runtime dependencies without a discussion issue.
5. CI must pass: TypeScript strict, vitest, demo smoke.

## Project rules

- Local-first: nothing in the core phones home.
- The runtime proves one thing: an AI client can program an executable agent
  system through MCP. Features that do not serve that goal go to plugins.
- Be direct in issues and reviews. Code arguments only.