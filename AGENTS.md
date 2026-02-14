# Repository Guidelines

## Project Structure & Module Organization
This repository contains a runnable WebCLI MVP plus protocol documentation and JSON Schemas.

- `frontend/public/`: static frontend resources.
- `backend/src/`: backend implementation (`api`, `ws`, `term`, `utils`).
- `tests/unit/` and `tests/e2e/`: unit and end-to-end tests.
- `docs/specs/`: requirements, workflow, protocol design, state machine, and versioning rules (`01...md` to `08...md`).
- `schemas/common/`: shared schema building blocks (`rpc`, `error`, `segments`, `stylemap`, `envelope`).
- `schemas/term/`: terminal data-plane messages (`term.snapshot`, `term.patch`, `term.stdin`, etc.) and `index.v1.json` aggregator.
- `schemas/control/`: control-plane RPC request/response payloads and `index.v1.json` aggregator.
- `schemas/README.md`: canonical schema usage and validation guidance.

## Build, Test, and Development Commands
Use project scripts for MVP verification and schema checks for protocol verification.

- `npm run dev`
Run backend dev server with auto-reload.
- `npm run build`
Compile backend TypeScript to `dist/`.
- `npm run test`
Run unit tests.
- `npm run test:e2e`
Run end-to-end workflow tests.

- `find schemas -name '*.json' -print0 | xargs -0 -n1 jq empty`
Validates JSON syntax for every schema file.
- `npx ajv-cli compile --spec=draft2020 -s schemas/term/index.v1.json -r schemas/term/*.json -r schemas/common/*.json`
Compiles term schemas and resolves references.
- `npx ajv-cli compile --spec=draft2020 -s schemas/control/index.v1.json -r schemas/control/*.json -r schemas/common/*.json`
Compiles control schemas and resolves references.

## Coding Style & Naming Conventions
- Use 2-space indentation in JSON and keep key ordering stable where practical.
- Keep filenames versioned as `*.v1.json`; only bump version for breaking changes.
- Control RPC schema names follow `<method>.<req|resp>.v1.json` (example: `create_instance.req.v1.json`).
- Term message types follow dot notation (example: `term.history.chunk`).
- Prefer additive, optional fields for backward-compatible evolution.

## Testing Guidelines
- Treat schema compilation and sample payload validation as required checks before PR.
- Validate both success and error envelopes for control methods (`ok=true` and `ok=false`).
- When changing `index.v1.json`, verify new/updated message routes are covered.

## Commit & Pull Request Guidelines
Git history is not available in this workspace, so follow a strict convention:

- Commit subject: imperative and scoped, e.g. `schema(control): add HealthCheck error details`.
- In PR description, include: intent, affected schema paths, compatibility impact, and migration notes.
- For protocol changes, include at least one request/response example and call out whether `v` changes.
