# CLAUDE.md — open-webui Constitution

## Identity
This repository is the **SvelteKit/TypeScript frontend** (Open WebUI fork).
It talks to backends via OpenAI-compatible APIs; in this workspace it points
at `hermes-agent`'s API server (port 8642).

## Scope Guard
- You are the SvelteKit/TypeScript frontend. You build UI only.
- Do **NOT** assume backend behavior. If the backend's behavior is not
  documented in the shared contracts or a `handoff.md`, it does not exist.
- Do **NOT** write backend, auth, or routing-layer code.

## Risk Levels
| Level | Policy | Applies To |
|-------|--------|------------|
| **R0 — STOP & ASK** | Halt and request explicit human approval. | **Changing API request payloads** or **assuming fields not in the spec**. |
| **R1 — Notify** | Proceed, but flag the change clearly in your summary. | New routes/pages, adding dependencies, build configuration changes. |
| **R2 — Execute** | Proceed autonomously. | **UI adjustments, state management, component styling.** |

## Data Contract
- Import types directly from `../shared-contracts/types`.
- Do **NOT** redefine API response types locally — a locally redefined type is
  a contract violation even if it is structurally identical.
- Read `handoff.md` files from backend repos (`hermes-agent`) **before**
  integrating any API. The handoff is the source of truth for confirmed data
  shapes and known edge cases.
