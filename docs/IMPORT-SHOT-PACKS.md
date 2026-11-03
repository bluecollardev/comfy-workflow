# Importing a shot pack: setup and use

How to bring a package folder (Kyle's delivery packages, or any folder an adapter knows) into
ComfyUI-Shared and onto a pod. The design is `docs/ADR-008-import-adapters.md`; the adapter
spec is `docs/IMPORT-ADAPTERS.md`; the build plan and what was verified is
`docs/PLAN-IMPORT-ADAPTERS.md`. Status: built and tested on `feature/import-adapters`; not yet
on `develop`, not in a packaged build.

## Set up once

1. **Run the app on this branch:** `./start.sh desktop` (it rebuilds the core and the UI).
2. **Map ComfyUI-Shared:** Default Configuration > Folders > ComfyUI-Shared. Imports land here,
   in `input/`, `workflows/<project>/<round>/` and `node-packs/<project>/<pack>/`.
3. **Merge the Drive parts first** if the package came in several: copy `*/comfy`, `*/nodes` and
   the `MANIFEST.json` files together into one folder named for the round (keep names and
   paths). Every copied file is then hash-checked; one part alone imports but cannot check the
   shots whose manifest is in another part.
4. **For the sync after an import:** a network volume set in Default Configuration (Volume),
   and either a running pod or the S3 keys for a stopped one (ADR-007). Without them the import
   still works; a clickable "Sync not configured. Click here to configure." toast says what is
   missing.
5. **Optional, for Claude:** an Anthropic API key. Either paste it in Default Configuration >
   Anthropic API key and press **Test key**, or put `ANTHROPIC_API_KEY=sk-ant-...` in the repo's
   `.env` (the environment is read first, then `~/.config/runpod-pod-manager/.env`). Without a
   key everything else works; the Claude buttons say so and take you to the key field.

## Use it

**In the app.** On a pod's card press the primary **Import Shot Pack** button.
1. Type the folder's path or press **Browse**; choosing it attaches it. The plan appears (what
   goes where, by kind, with findings and a Fenced badge). With a key set, Claude also writes a
   short description of the pack (switch it off with "Describe new folders with Claude").
2. **Dry run** shows what would happen and writes nothing. **Import** copies into ComfyUI-Shared
   (a different file already there is a conflict and is left alone, unless "Replace" is on).
3. A good import then starts the Sync of ComfyUI-Shared to that pod; follow it on the card.

**From the terminal.** `./start.sh import <folder> --dry-run`, then without `--dry-run`.
`--list` shows the adapters, `--show <id>` prints one's code, `--adapter <id>` picks one,
`--to <dir>` imports somewhere other than the mapped ComfyUI-Shared, `--overwrite` replaces.

**From an agent.** The pod-manager MCP server has `adapter_spec`, `adapters_list`,
`adapter_save`, `import_plan` and `import_apply` (`docs/MCP-ENDPOINTS.md`).

## Adapters

An adapter is one `.mjs` file in `~/.config/runpod-pod-manager/adapters/` that the app loads at runtime:
a small JavaScript module that reads a folder and returns a list of what should be copied where. It
runs in its own fenced Node process, never writes by itself, and is picked up the next time an import
runs. What it is, how it runs and who writes them: `docs/IMPORT-ADAPTERS.md`, "What an adapter is".

Default Configuration > **Import adapters** (Import Shot Pack links to it with Manage adapters)
lists every adapter with its code hash: **Inspect** the code, **New adapter** from a template,
**Edit**, **Duplicate** (the way to change a built-in), **Delete**. There is no approval step;
adapters run fenced (read access to the folder they are given, no writes, no child processes;
the network is not blocked, so read what you did not write).

**Edit** (any adapter, built-ins too), **New adapter** and **Write an adapter with Claude** (Import Shot Pack,
next to Plan) all open the **Adapter Studio**: your adapters and the package as a tree on the left, the code, the
prompt and the package's files in tabs (Code, Preview or Split as icon buttons) in the middle, and the chat with
Claude on the right. Chat with Claude about the package; it keeps the prompt up to date and builds the adapter from
it; the prompt is text you can edit yourself. Save is explicit (no autosave); Save checks the adapter and Claude
fixes what fails. Claude writes adapters and their prompts and nothing else. Details: `docs/IMPORT-ADAPTERS.md`,
"The Adapter Studio".

## Where things are

| What | Where |
|---|---|
| Your adapters, and their prompts | `~/.config/runpod-pod-manager/adapters/<id>.mjs` and `<id>.prompt.md` (a built-in you edit gets an override file of the same name) |
| A record of each import | `~/.config/runpod-pod-manager/imports/` |
| The Anthropic key | `~/.config/runpod-pod-manager/.env` (mode 600) or the environment |
| Built-in adapters and the runner | `apps/runpod-dashboard/libs/core/runtime/` |
| The core | `apps/runpod-dashboard/libs/core/src/imports.ts` |

## Known limits

- The fence does not block the network; reading the code is the control (ADR-008, open point 2).
- Checked in dev only, not in a packaged build.
- No autosave and no version list yet: Save is explicit and there is no Revert (todo in `NEXT-STEPS.md`).
- The same shot id in two projects shares `input/shots/<shot>/`: the second import reports a
  conflict and never overwrites.
- A Drive part imported alone cannot hash-check shots whose manifest is in another part.
- Only the `panama-imax-redux` format has a hand-written adapter; Binc's CANALV2 is read in
  place, not imported.

## Import from the BH library (the Panama S3 bucket)

Added 2026-11-03 (`docs/ADR-016`, `ADR-021`). The pod card has one **Import Shot Pack** button. It always opens on a source picker first:
**Zip or folder on this PC** (everything above) or **Panama S3 bucket**. Until the bucket is set up the Panama card is disabled, with a link to Default Configuration.
Every screen after the picker has a **Change source** link back to it.

**Set up once.** The bucket, region and AWS-profile fields in Default Configuration > Panama bucket (BH) come prefilled with the built-in defaults (`bh-panama-exchange-610140802195`, `us-west-2`, `panama`); each has a reset button, and a value equal to its default is not stored. Default Configuration > Panama bucket (BH): the read-only access key ID and secret BH issued. They are kept in the app's settings file,
shown only as their last four characters. With no keys the app falls back to an AWS profile named `panama`. Without either, the Panama card stays disabled and the folder or zip import works as before.

**Use.**
1. The list shows each round in the bucket and what is on this PC: nothing (**Download**), part of it (**partial: 391 of 1,283 files**, button **Resume**),
   all of it but not yet checked (**downloaded, not verified**), or all of it verified (green **downloaded**, button **Re-Download**).
2. **Download** copies the round to `<ComfyUI-Shared>/temp/rounds/<round>` with `aws s3 sync`: read-only against the bucket, no deleting, and a stopped or
   cancelled download carries on from the files already there. **Cancel** is in the download card's header. A round is 9 to 39 GB; **Size** shows it first.
3. When the files are down, the app checks every one against the round's `MANIFEST.json` (size and sha256, the same check as BH's `verify_round.py`). A round that
   does not match, or has no file list, is not offered for import.
4. **Import Package** hands the staged folder to the ordinary import: pick the adapter, read the plan, Dry run, Import. Only the files the adapter maps are copied
   into `input/` and `workflows/`; the rest stays in `temp/rounds`.

5. **Delete** (on any round with something on disk, including a partial one) removes its copy from this computer to free space. Each row shows what the round takes on
   disk; Delete asks first and names the size. It touches only `temp/rounds/<round>` on this PC: never the bucket, a pod, or ComfyUI-Shared's `input/` and `workflows/`, where
   an import already copied files. It is refused while that round is downloading (Cancel first), and for any name that is not a single folder inside the staging folder.

**Pod mode (built in the UI, gated).** The pane has a **Local | Pod** switch (docs/ADR-022). Local is everything above. Pod stages the round **on the network volume** at `/workspace/comfy-shared/temp/rounds/<round>`, pulled by a pod straight from the bucket, so nothing comes through this PC.
The same rows, badges, Download / Resume / Re-Download and Delete apply, acting on the volume; because the state of the volume can only be read by a pod, the rows show what was **last seen** and say when ("as of ..."). Starting a Pod download or a Pod delete first shows what it would do and what it costs: on a pod of yours that is already running (no new pod), or a short-lived pod on the volume
(its card in the pod list is tagged temporary, it is deleted when the job ends, and the idle timer stops it if the job dies). Cancel sits in the job card's header. There is no Import Package in Pod mode yet; import runs from Local. **Pod is switched off until the core reports that it is available** (`status().pod.available`; the core side is built separately), and its tooltip then gives the reason, so nothing in the real app starts a pod yet.

**Where things are.** Staged rounds are in `temp/rounds/` inside the mapped ComfyUI-Shared. A Sync never carries `temp/`. `PANAMA_ROUNDS_DIR` in the settings file moves
the staging folder. Not every entry in the bucket is an import package (the inbox round holds text entries only).

