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
