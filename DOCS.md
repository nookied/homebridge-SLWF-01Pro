# Documentation Index

This repo keeps a small set of docs, each with one job. Use this file as the routing table before updating documentation.

## File Roles

| File | Audience | Shipped to npm? | Owns |
|---|---|---:|---|
| [README.md](README.md) | Users | Yes | Install, configuration, HomeKit behavior, troubleshooting, release commands |
| [CHANGELOG.md](CHANGELOG.md) | Users and maintainers | Yes | Versioned release history and GitHub Release notes source |
| [CLAUDE.md](CLAUDE.md) | Coding agents | No | Current architecture, project memory, working rules, known issues, release posture |
| [QA_TESTS.md](QA_TESTS.md) | Maintainers | No | Manual pre-release checklist, real-hardware validation, pairing/network diagnostic flow |
| [ROADMAP.md](ROADMAP.md) | Maintainers | No | Planned work, Verified-plugin readiness, feature gaps |
| [config.schema.json](config.schema.json) | Homebridge UI | Yes | Settings UI labels, defaults, constraints, and help text |
| [config-sample.json](config-sample.json) | Users | Yes | Copyable reference config matching current defaults |
| [AGENTS.md](AGENTS.md) | Coding agents | No | Pointer only; do not put project knowledge there |

Do not add new long-lived incident handoff files. If an investigation produces durable knowledge, fold it into the existing owner:

- Repro or manual diagnostic: `QA_TESTS.md`
- Current architecture or known issue: `CLAUDE.md`
- Shipped fix or release note: `CHANGELOG.md`
- User-facing workaround: `README.md`
- Future work: `ROADMAP.md`

## Update Process

1. Classify the change before editing docs:
   - New config key or default: `config.schema.json`, `config-sample.json`, `README.md`, `CLAUDE.md`, and often `QA_TESTS.md`.
   - User-visible behavior: `README.md`, `CHANGELOG.md`, `CLAUDE.md`, and relevant QA checks.
   - Internal architecture/refactor: `CLAUDE.md`, `CHANGELOG.md` if release-worthy.
   - Manual validation gap: `QA_TESTS.md`.
   - Planned feature or deferred work: `ROADMAP.md`.
   - Release workflow or packaging: `README.md`, `CLAUDE.md`, `QA_TESTS.md`, and `CHANGELOG.md`.
2. Keep one source of truth for each fact. Link to the owner instead of repeating long explanations in multiple files.
3. Avoid committed "live investigation" notes. Use issues, PR comments, or the current thread while debugging; commit only stable outcomes.
4. When a version, test count, schema version, Node/Homebridge support claim, or Homebridge Verified requirement changes, scan every doc before finishing.
5. Before release, verify the npm package surface with `npm pack --dry-run`; only `README.md` and `CHANGELOG.md` from this internal doc set should ship.

## Drift Check

Useful local scan before finishing documentation work:

```bash
rg -n "HANDOFF|StatusFault|StatusActive|ACCESSORY_SCHEMA_VERSION|0\\.5\\.|159|160|162|167|Homebridge Verified|Node 18|Node 20|Node 22|Node 24" README.md DOCS.md CLAUDE.md QA_TESTS.md ROADMAP.md CHANGELOG.md config.schema.json config-sample.json package.json
```

Expected matches are fine in historical changelog entries. Current-state docs should describe the current behavior, not superseded implementation attempts.
