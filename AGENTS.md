# Drama Workbench

Read docs/方案.md before changing domain behavior. This is a local-first foundation, not an operational autonomous film studio yet.

- Overview is a read model derived from authoritative tables. Never persist duplicate current-stage fields on projects.
- Agents belong to workflow nodes. No job/role-template entity. A coordinator is attached to a coordinator node.
- Workflow creation, node setup, node AI assignment and work-item setup belong to the AI-facing APIs. Keep the workflow UI focused on inspection, navigation, discussion and user review; do not reintroduce manual setup controls.
- Present workflows as a direct panel without zoom/fit controls. Optional sections express shared preparation, repeatable episode/chapter units and final delivery. Units have independent nodes and sessions, share explicit asset versions, and extend through the units API; do not model repetition as cyclic dependency edges. Final delivery waits on every unit and cannot silently acquire new prerequisites after starting.
- The main flow is one connected vertical overview: coordinator/project information, actual shared steps, optional seasons, clickable episode/chapter entries, and archive. Opening a unit shows its own internal graph. Seasons only group existing units; overview membership/navigation links never become execution dependencies. Do not require seasons or fabricate future seasons/episodes to fill the layout.
- New projects start with only a coordinator node, its unconfigured AI and one empty session. Published workflows remain appendable through APIs; units may start empty, preparation and archive are optional until needed. Adding nodes never rewrites ordinary existing dependencies. Delivery gates are added transactionally and audited; started delivery or its started items block production expansion, and empty units cannot pass archive checks.
- Navigation begins with collapsed project folders. Each project has exactly two entries: 制作流程 and 故事资产库. The flow page contains one clickable graph; node details and chats open on demand. The library opens with category folders; each folder lists and searches only its own records. Keep production records separate from creative assets, and never default to an all-records table. Aggregate without duplicating authoritative data.
- Humans message the coordinator only; child discussions are readable and quotable. Do not add fake AI replies.
- Persist agent identity, sessions, external session identifiers, configuration snapshots, messages and discussion highlights independently.
- Deterministic APIs: explicit filters, standard JSON, no fallback guesses or silent relaxed matches.
- Asset variants coexist; versions revise the same asset. Published versions and their lineage are immutable.
- Store media outside Git. Never commit user media, tutorial downloads, databases, credentials or raw conversation exports.
- Story imports only persist original text/files and metadata. Content parsing belongs to downstream AI; do not decode uploads, infer encodings, extract text or generate previews during import or metadata lookup. Serve original bytes through the download API.
- Optional style preferences and creator notes are persisted separately from source bytes. After import, a separate idempotent discussion API stores one human message with the story reference and preferences in the coordinator session. The UI opens that chat; failure leaves the imported source intact. Preferences remain tentative, and an unconfigured runtime must not claim analysis has started.
- Core first, personal automation second, teams/skill marketplace later. Do not claim runtime execution exists before a real provider is connected.
- Run npm test, npm run typecheck, npm run build before delivery. Add meaningful tests for invariants.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
