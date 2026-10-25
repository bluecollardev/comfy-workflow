# ADR-011: What a sync carries, and what it does with what is already there

Status: accepted, 2026-10-25. Builds on ADR-007 (the volume as the hub; additive, never deletes).

## Context
A push of this PC's folders was all or nothing: all of ComfyUI-Shared, including `output/` (what pods write), and the whole project tree. On the real CANALV2 that is 23,547 files and 86.7 GB, of which 63 GB is the shots' `06_REVIEW` renders and 14 GB is Binc's `80_TEST-BUCKET` (quick tests for his timeline, `00_POLICY/project_v002.md`). Lucas asked to exclude output, to choose among the ComfyUI-Shared folders per pod and in the default (with separate rows for Push and Pull), to skip the renders and the test bucket by default, and to skip files that are already on the pod, or replace them, as chosen.

## Decision

### 1. Which ComfyUI-Shared folders (configuration)
- `sync_shared` (push; default `input, models, workflows`: not `output`) and `pull_shared` (pull; default `output`), checkboxes in Default Configuration > Folders on this PC and in a pod's own configuration (the pod's wins). Two rows, Push and Pull, separated by a dotted rule.
- The Sync window starts from the effective choice and may change it for one run (`shared` on the request; MCP `sync.shared`; CLI `--shared a,b`).
- Unchosen folders are excluded with an anchored pattern (`/output/`): the top level of ComfyUI-Shared only, so an `output` folder deeper down still goes. The `workflows` step (the repo's graphs) goes with `workflows`. The S3 transport gets the equivalent excludes.
- Pull steps for output keep the key `output`; other folders are `shared/<dir>`. Each shot's review and deliver folders are unaffected.
- `sync_parallel` (rsync streams at a time) defaults to 8 for new configurations; a saved value is kept.

### 2. What to leave behind on a push (Sync window, per run)
Two switches, both on by default; the file and byte count in the confirmation follows them (from the listing passes):
- `skip_renders`: `05_TEMPS/ 06_REVIEW/ 07_DELIVER/` at any depth. Pull is what brings renders back.
- `skip_tests`: `/80_TEST-BUCKET/`, top level of the project only. No shot's graph reads it.
On the real tree: 23,547 files / 86.7 GB all; 4,564 / 17.5 GB without renders; 1,361 / 2.4 GB without renders and the test bucket (checked with `rsync -n`).

### 3. A file that is already on the pod (`existing`, SSH only)
| Choice | rsync flag | Sends | Misses |
|---|---|---|---|
| `update` (default) | none | a file whose size or time differs | nothing; resends a file whose time differs but whose content is identical |
| `size` | `--size-only` | a file whose size differs | a same-size edit |
| `checksum` | `--checksum` | a file whose content differs | nothing; reads every file at both ends, so it is slow |
| `replace` | `--ignore-times` | everything again | nothing |
The S3 transport uses `aws s3 cp`, which has no such choice. Nothing is ever deleted, in any mode.

**Skipped** is shown beside copied and errors: the files in scope less the files the chosen rule would send. Scope comes from a second dry-run listing with `--ignore-times` (every file counts as to-send), so it is exact and costs one more listing per folder; the confirmation and the running view use the same figure.

## Consequences
- A first push is about 16 GB instead of 87 GB; later pushes send only what changed.
- Existing saved configurations pick up the defaults for the new keys (`pull_shared`); `sync_parallel` stays as saved.
- The CLI has `--shared`, `--skip-renders`, `--skip-tests` and `--existing`; the MCP `sync` tool has `shared`, `skip_renders`, `skip_tests` and `existing`. Defaults there are off (the app's switches default on), so a script says what it means.
- Not run against a live pod: the flags and excludes were checked with real local rsync runs and the app in no-spend mode.
