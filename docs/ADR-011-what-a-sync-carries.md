# ADR-011: What a sync carries from ComfyUI-Shared

Status: accepted, 2026-10-25

## Context
A push sent all of ComfyUI-Shared, including `output/` (what pods write; large, and on this PC mostly stale renders). Lucas asked to exclude it, then to choose among `input`, `models`, `output`, `workflows`, per pod and in the default, with separate rows for Push and Pull.

## Decision
- Config keys `sync_shared` (push; default `input, models, workflows`) and `pull_shared` (pull; default `output`), in the Default Configuration and in a pod's own configuration (the pod's wins).
- The Sync window starts from the effective choice and may change it for one run (`shared` on the request; MCP `sync.shared`; CLI `--shared a,b`).
- Unchosen folders are excluded with an anchored pattern (`/output/`): top level of ComfyUI-Shared only. The `workflows` step (the repo's graphs) goes with `workflows`. S3 transport gets the equivalent excludes.
- Pull steps for output keep the key `output`; other folders are `shared/<dir>`. Shots' review and deliver folders are unaffected.
- Anything else in a chosen folder always goes; nothing is ever deleted.

## Consequences
Existing saved configurations pick up the defaults for the new keys; `sync_parallel` default is 8 for new configurations only.
