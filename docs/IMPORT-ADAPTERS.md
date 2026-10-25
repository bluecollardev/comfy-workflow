# Import adapters

**Status:** built (ADR-008, 2026-10-24; plan in `docs/PLAN-IMPORT-ADAPTERS.md`). This page is the spec an
adapter writer works from, human or coding agent; the app serves the same text to
agents (`adapter_spec`). Setup and use: `docs/IMPORT-SHOT-PACKS.md`. Run it: `./start.sh import <folder> --dry-run`, or Import Shot Pack.

An **adapter** maps one kind of source folder (a delivery package, a project tree, a
colleague's zip) onto the **ComfyUI-Shared structure**. It is a single ES module that
plans; the app applies the plan. The source folder is never changed.

## What an adapter is

An adapter is **one `.mjs` file**: a plain JavaScript (ES) module, `adapters/<id>.mjs`, that the
app **loads at runtime**. It is not compiled into the app and it is not a plugin that needs a
build or a restart: put the file in the adapters folder, or save it from the Adapter Studio, and
the next import uses it. Edit the file and the next import uses the edit. Delete it and it is
gone. (Two ship with the app, under `libs/core/runtime/adapters/`, and are read-only.)

What it does is small and fixed. It `export default`s an object with an `id`, a `name`, and two
functions, `detect(root, ctx)` and `plan(root, ctx)`. `detect` looks at a folder and says
whether it knows that format; `plan` reads the folder and **returns a list of operations as data**
(copy this file there, note that one) plus findings. It never writes anything itself: the app
checks the list and carries it out, inside ComfyUI-Shared only. So an adapter is a *mapping*
from one source format onto the ComfyUI-Shared structure, written as code because real
formats need conditions (read a manifest, skip what is not listed, name a round) that a table
cannot say.

How it runs, every time: the app starts a **separate Node process** (its own executable run
as Node, so nothing needs installing), under Node's permission model with read access to
the folder being imported and to the adapter file, and no write access and no child
processes. The adapter reads the folder only through the `ctx` helpers it is handed, hands
back JSON, and the process ends. The network is not blocked by that fence, which is why every
adapter's code is open to read in Default Configuration and nothing is hidden.

Who writes them: you, in the editor; the Adapter Studio, where you chat with Claude and a prompt
builds the module (ADR-009); or any coding agent through the MCP tools (`adapter_spec`,
`adapter_save`). All three produce the same thing, a file in the adapters folder, and the app
treats them alike. Claude can write nothing else (ADR-008, decision 13).

## The target: the ComfyUI-Shared structure

What every adapter lands things in, under the mapped ComfyUI-Shared folder
(`docs/MOUNT-POINTS.md`; on a pod it is `/workspace/comfy-shared`):

| Destination | Holds | Rule |
|---|---|---|
| `input/` | files graphs load, by path relative to ComfyUI's input folder | keep source-relative paths; never rename or flatten |
| `workflows/` | graphs (`.json`, their `_api.json` and inputs manifests beside them) | under your project's own folder, then one subfolder per round: `workflows/<project>/<round>/` |
| `models/` | checkpoints, LoRAs, weights, by ComfyUI's model folders | only when the source carries them |
| `output/` | what pods write | adapters do not write here |
| `node-packs/` | custom nodes a graph needs, staged | `node-packs/<project>/<pack>/` (the `-vN` dropped); staging does not install them, the image links packs from its own sources (ADR-006) |

**Namespaces.** `workflows/` and `node-packs/` are namespaced by project. `input/` is not and
cannot be: graphs load files by paths relative to ComfyUI's input folder (`shots/<shot>/...`),
and those paths must not change, so the shot id is the only namespace there. Two projects
with the same shot id in the same ComfyUI-Shared would write the same paths; the app never
replaces a differing file (a conflict is reported), so the second import stops at the first
difference and says so. Binc's ComfyUI-Shared already has `input/shots/cgi-042`, and Kyle's
packages carry a `cgi-042` too: import into an empty ComfyUI-Shared (or a copy) first.

Anything an adapter finds that does not belong in those (finals, approved renders,
provenance notes, docs) is **left where it is** and recorded as a `note` or `reference`,
not copied.

## The documentation header (a rule)

Every adapter starts with a comment block before `export default` that says what it does: **What it does**,
**Detects**, **Maps** (source path to destination), **Leaves in place**, **Needs / assumes**, **Limits**. It is
a rule on generation, enforced three ways (ADR-009, decision 12): the prompts that make Claude write adapters
require it; the structure check fails an adapter with none (about 100 characters of comment), so it is not
Valid; and **Document** in the Studio (or the chat's `document_adapter`) has Claude rewrite the header from the
code as it stands, changing only the header. The header is shown in the Studio's Preview as "What this adapter
does". A new adapter's template already carries one.

## The module

```js
// ~/.config/runpod-pod-manager/adapters/panama-imax-redux.mjs
export default {
  id: 'panama-imax-redux',               // kebab-case, unique
  name: 'Panama Canal v2 delivery package',
  version: 1,

  // Cheap and read-only. Say whether this folder is yours and why.
  async detect(root, ctx) {
    const hasManifest = await ctx.exists('MANIFEST.json')
    const hasReadme = await ctx.exists('00_READ_ME.md')
    return { match: hasManifest && hasReadme ? 1 : 0, evidence: ['MANIFEST.json', '00_READ_ME.md'] }
  },

  // Return operations. Write nothing.
  async plan(root, ctx) {
    const ops = []
    const manifest = await ctx.json('MANIFEST.json')
    for (const shot of Object.keys(manifest.shots)) {
      for (const f of await ctx.list(`${shot}/comfy/input`, { recursive: true })) {
        ops.push({ op: 'copy', kind: 'input', from: f.path, to: `input/${f.path.replace(`${shot}/comfy/input/`, '')}`, bytes: f.bytes })
      }
      for (const f of await ctx.list(`${shot}/comfy/workflows`)) {
        ops.push({ op: 'copy', kind: 'workflow', from: f.path, to: `workflows/panama-imax-redux/${ctx.roundName}/${f.name}`, bytes: f.bytes })
      }
    }
    ops.push({ op: 'verify', kind: 'manifest', from: 'MANIFEST.json', note: 'sha256 of every file' })
    return { ops, findings: [] }
  },
}
```

This is a sketch of the shape, not a finished adapter.

### What `ctx` gives the adapter

Read-only, confined to the source folder, paths relative to it:

`exists(p)`, `stat(p)`, `list(dir, { recursive })` returning `{ path, name, bytes, isDir }`,
`text(p)`, `json(p)`, `sha256(p)`, plus `roundName` (the source folder's name, for
subfolders) and `target` (the ComfyUI-Shared structure above, as data). There is no way
to write through it.

### What `plan` returns

```
{ ops: Op[], findings: Finding[] }
Op      = { op: 'copy' | 'link' | 'verify' | 'note' | 'placeholder',
            kind: 'input' | 'workflow' | 'model' | 'node-pack' | 'reference' | 'manifest',
            from?: string,   // relative to the source
            to?: string,     // relative to the ComfyUI-Shared root
            bytes?: number, sha256?: string, note?: string }
Finding = { level: 'info' | 'warn' | 'problem', text: string, path?: string }
```

- `copy`: source file to destination, cloned on disks that can. With `sha256`, the app
  hashes the source first and refuses a file whose bytes differ (that file is not
  written; the others go on and the result is not ok). `link`: the same as a symbolic
  link, for big files that need not be duplicated on this machine. There is no `merge`:
  copying each file into an existing folder is the same thing, and an existing different
  file is a conflict.
- `verify`: hash a file left in place against a given `sha256`.
- `note`: something left in place (finals, provenance) that the user should know about.
- `placeholder`: a file the pack needs that the source cannot ship (a pack's `config.ini`
  provider key): written with a marked placeholder for the user to fill; never a real key.
- `findings` is where "this graph needs a node type the image lacks" goes (read from the
  manifest's `node_types`).

### What the app enforces, whatever the adapter says

- Every `to` resolves inside the ComfyUI-Shared root (no `..`, no absolute paths, no
  symlinks out). Every `from` resolves inside the source.
- Never deletes. Never overwrites an existing different file unless the user chose to.
- A dry run (the plan, rendered) comes first; applying needs a go.
- The plan, with the source hashes, is kept as the record of the import.
- Nothing is uploaded. Pushing to a volume is the sync (ADR-007), with its own rules.

## After the import: the sync

An import from a pod's card ends by starting the Sync of ComfyUI-Shared to that pod, when the
import had no conflicts or errors. No network volume, an unreachable pod, a simulated pod or
no pod each show a toast instead of syncing; a missing volume or transport reads "Sync not
configured. Click here to configure." and the click opens Default Configuration (ADR-008,
decision 8). Adapters do none of this: they plan, nothing more.

## The Adapter Studio

Edit, New adapter, Duplicate and Write an adapter with Claude all open the **Adapter Studio**
(`docs/ADR-009-adapter-studio.md`), one full-screen modal laid out like an IDE with the app's mark and name
in its header:

- **Explorer (left):** the adapters (built-ins locked, a dot on a modified one; **+** starts a new one) and the
  attached package folder as a tree. Each file is marked with what the adapter does with it: an arrow to its
  destination, "left in place", or "not matched" (a gap in a mapping); folders roll up the counts. Clicking a
  file opens it in a read-only viewer tab (text, JSON pretty-printed, small images, or its size).
- **Editor (centre):** tabs for `<id>.mjs`, the **Prompt** (plain text, yours to edit) and a viewed file; the file
  path; a CodeMirror editor with line numbers and highlighting; a Problems panel (the structure check as you
  type); a status bar (line and column, saved or modified, Valid or not). **Code, Preview and Split** are icon
  buttons (remembered): Preview is the adapter's own documentation, what it does to the attached folder
  (fenced run, by kind, findings), the package tree and the destination tree.
- **Chat (right):** Claude. The first message shows what it carries (folder names with counts, a name sample,
  small READMEs and manifests) and nothing is sent until you press Send; you can type, edit and save without a
  key. The chat keeps the **prompt** up to date, **builds the adapter from the prompt**, validates and tests it,
  and can name it (`rename_adapter`). Every tool call shows as a line. Claude can write `adapters/<id>.mjs`
  and `adapters/<id>.prompt.md` and nothing else.
- **Header:** the display **name** and the **id** (the file name), the **Code / Preview / Split** icons, a **line wrap** toggle (one setting for every editor, remembered), **Document**, **Reset to built-in**, **Save**.

**Save is explicit; there is no autosave and no Revert button for now** (autosave with versions is a todo). Save
runs the structure check and, with a folder attached, a fenced test of the plan; if either fails and a key is set,
Claude fixes it from the errors and the prompt, up to three rounds shown in the chat. If it still fails the
adapter stays saved and marked Not valid. If Claude's build is wrong, fix the prompt and build again.

**Built-ins are editable**: saving one writes an override (`adapters/<id>.mjs` with the built-in's id) that is
used instead; the shipped file is never touched; **Reset** deletes the override.

Default Configuration > Import adapters lists every adapter with its code hash: **Edit** (the Studio),
**Duplicate**, **Delete** (yours) or **Reset** (a modified built-in), and **New adapter**.

## Where adapters live and how they load

- Built in: `comfy-shared`, `panama-imax-redux`.
- Yours: `~/.config/runpod-pod-manager/adapters/*.mjs`. The folder is watched; saving a
  file reloads it with no restart. A new or changed file is listed with its hash and
  runs as saved, fenced. A broken one is listed with its error, nothing else is
  affected.
- They run in a separate Node process, not in the UI, under `--permission` with read
  access to the source folder and the adapter file only (no writes, no child processes),
  and return the plan as JSON. The permission model does not block the network; an
  adapter must not be trusted just because it is fenced (ADR-008, open point 2).

## Writing one with a coding agent

On any machine with the app's pod-manager MCP server connected (or the CLI):

1. Ask the agent to fetch the spec (this page) and the target structure.
2. Give it the source folder. It reads the layout and any manifest or setup notes in it
   (for packages: the READMEs and `MANIFEST.json`).
3. It writes the `.mjs`, saves it to the adapters folder, and dry-runs it against the
   folder: `./start.sh import <folder> --adapter <id> --dry-run`.
4. You read the plan and apply. (The adapter's code is open to read in Default Configuration.)

A good adapter is boring: detects by a few telltale files, maps by globs and manifest
entries, keeps source-relative paths, leaves everything else in place, and reports what it
could not place instead of guessing.

## The two built-ins, in terms of the target

**`panama-imax-redux`** (Kyle's delivery packages, read from `projects/contract/` and the
first package; see `docs/DELIVERY-PACKAGES.md`):

| In the package | Goes to |
|---|---|
| `<shot>/comfy/input/shots/<shot>/...` | `input/shots/<shot>/...` (unchanged) |
| `<shot>/comfy/workflows/*.json` (+ `_api`, inputs manifest) | `workflows/panama-imax-redux/<round>/` |
| `<shot>/nodes/<pack>-vN/` | `node-packs/panama-imax-redux/<pack>/`; packs the image lacks are findings |
| `final/`, `approved/`, `provenance/`, docs, templates | left in place, noted |
| `MANIFEST.json` (per shot; paths are relative to the package root and start with the shot id) | every file copied carries its sha256; a mismatch refuses that file |

Known from the package's own text: workflows may also be dragged onto the canvas; a pack's
`config.ini` provider key is not shipped (hence `placeholder`); the ComfyUI floor is
recorded in the manifest (0.39.2 for the 2026-10-20 round, 0.42.1 for 2026-10-23).

**`comfy-shared`**: the folder already has `input/`, `models/`, `output/`; the plan is
`merge`.

## Claude, in the app

Default Configuration takes an optional Anthropic API key (stored like the RunPod keys; `ANTHROPIC_API_KEY` in
the environment or the repo `.env` works too; the key tests itself when you type it and when the panel opens).
With it Claude **describes a shot pack** when you attach a folder (a few sentences, labelled as written by
Claude, with Describe again and a switch) and **chats in the Adapter Studio** as above.

**The rule.** The app's Claude writes adapters and nothing else: its reply becomes at most one
file, `<adapters folder>/<id>.mjs`, with an id the app chose; other blocks, file names and
commands in the reply are dropped and counted; a description is never stored. This is the code
path, not a request to the model. It applies to the app's Claude and the MCP tools, not to a
local coding agent working in its own session.

## Not in scope

Merging a package's five Drive parts (do that first; the adapter takes the merged tree),
signing or notarising anything, pushing to RunPod, and running any graph.
