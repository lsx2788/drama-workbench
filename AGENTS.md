# Drama Workbench

Read docs/方案.md before changing domain behavior. This is a local-first foundation, not an operational autonomous film studio yet.

- Overview is a read model derived from authoritative tables. Never persist duplicate current-stage fields on projects.
- Agents belong to workflow nodes. No job/role-template entity. A coordinator is attached to a coordinator node.
- Humans message the coordinator only; child discussions are readable and quotable. Do not add fake AI replies.
- Persist agent identity, sessions, external session identifiers, configuration snapshots, messages and discussion highlights independently.
- Deterministic APIs: explicit filters, standard JSON, no fallback guesses or silent relaxed matches.
- Asset variants coexist; versions revise the same asset. Published versions and their lineage are immutable.
- Store media outside Git. Never commit user media, tutorial downloads, databases, credentials or raw conversation exports.
- Core first, personal automation second, teams/skill marketplace later. Do not claim runtime execution exists before a real provider is connected.
- Run npm test, npm run typecheck, npm run build before delivery. Add meaningful tests for invariants.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
