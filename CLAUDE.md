# CLAUDE.md — open-webui Constitution

## Identity
This repository is **axi's shell**: an Open WebUI fork, both its SvelteKit
frontend and its Python backend (`backend/open_webui`). It owns sign-in,
users and sessions for the whole stack, hosts the salem and finny pages at
`/x/<app>/…`, and reaches the other services through the gateway.

## Scope Guard
- Frontend and backend changes both belong here, including open-webui's own
  auth (users, sessions, sign-in flows).
- Do **NOT** assume another service's behavior. If salem, finny, hermes,
  contact-layer or security-layer behavior is not documented in
  `../shared-contracts` or a `handoff.md`, it does not exist.
- Token verification for the other services belongs to `security`, and
  routing to `gateway`. Change those in their own repos.

## Risk Levels
| Level | Policy | Applies To |
|-------|--------|------------|
| **R0 — STOP & ASK** | Halt and request explicit human approval. | **Changing API request payloads** another service relies on, or **assuming another service's fields that are not in the spec**. |
| **R1 — Notify** | Proceed, but flag the change clearly in your summary. | New routes/pages, adding dependencies, build configuration changes. |
| **R2 — Execute** | Proceed autonomously. | **UI adjustments, state management, component styling.** |

## Data Contract
- Import types directly from `../shared-contracts/types`.
- Do **NOT** redefine API response types locally — a locally redefined type is
  a contract violation even if it is structurally identical.
- A new field this fork's backend adds and its UI relies on (e.g.
  `must_change_password`) goes into `../shared-contracts` in the same change.
- Read `handoff.md` files from backend repos (`hermes-agent`) **before**
  integrating any API. The handoff is the source of truth for confirmed data
  shapes and known edge cases.
