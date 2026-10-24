# Import adapters

**Status:** design (ADR-008, 2026-10-24). Nothing here is built. This page is the spec an
adapter writer works from, human or coding agent; the app will serve the same text to
agents as a tool result.

An **adapter** maps one kind of source folder (a delivery package, a project tree, a
colleague's zip) onto the **ComfyUI-Shared structure**. It is a single ES module that
plans; the app applies the plan. The source folder is never changed.

## The target: the ComfyUI-Shared structure

What every adapter lands things in, under the mapped ComfyUI-Shared folder
(`docs/MOUNT-POINTS.md`; on a pod it is `/workspace/comfy-shared`):

| Destination | Holds | Rule |
|---|---|---|
| `input/` | files graphs load, by path relative to ComfyUI's input folder | keep source-relative paths; never rename or flatten |
| `workflows/` | graphs (`.json`, their `_api.json` and inputs manifests beside them) | one subfolder per source/round so rounds do not mix |
| `models/` | checkpoints, LoRAs, weights, by ComfyUI's model folders | only when the source carries them |
| `output/` | what pods write | adapters do not write here |
| node packs | custom nodes a graph needs | staged as `<pack>/` (drop `-vN`); linked by the image's setup, not into the volume |

Anything an adapter finds that does not belong in those (finals, approved renders,
provenance notes, docs) is **left where it is** and recorded as a `note` or `reference`,
not copied.

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
        ops.push({ op: 'copy', kind: 'workflow', from: f.path, to: `workflows/${ctx.roundName}/${f.name}`, bytes: f.bytes })
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
Op      = { op: 'copy' | 'link' | 'merge' | 'verify' | 'note' | 'placeholder',
            kind: 'input' | 'workflow' | 'model' | 'node-pack' | 'reference' | 'manifest',
            from?: string,   // relative to the source
            to?: string,     // relative to the ComfyUI-Shared root
            bytes?: number, sha256?: string, note?: string }
Finding = { level: 'info' | 'warn' | 'problem', text: string, path?: string }
```

- `copy`: source file to destination. `link`: the same as a symbolic link, for big files
  that need not be duplicated on this machine. `merge`: a folder into an existing one,
  adding files, never replacing.
- `verify`: check hashes against a manifest before anything is written; a mismatch stops
  the import.
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

## Where adapters live and how they load

- Built in: `comfy-shared`, `panama-imax-redux`.
- Yours: `~/.config/runpod-pod-manager/adapters/*.mjs`. The folder is watched; saving a
  file reloads it with no restart. A new or changed file shows its source and hash and
  runs only after you approve it. A broken one is listed with its error, nothing else is
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
4. You read the plan, approve the adapter, and apply.

A good adapter is boring: detects by a few telltale files, maps by globs and manifest
entries, keeps source-relative paths, leaves everything else in place, and reports what it
could not place instead of guessing.

## The two built-ins, in terms of the target

**`panama-imax-redux`** (Kyle's delivery packages, read from `projects/contract/` and the
first package; see `docs/DELIVERY-PACKAGES.md`):

| In the package | Goes to |
|---|---|
| `<shot>/comfy/input/shots/<shot>/...` | `input/shots/<shot>/...` (unchanged) |
| `<shot>/comfy/workflows/*.json` (+ `_api`, inputs manifest) | `workflows/<round>/` |
| `<shot>/nodes/<pack>-vN/` | staged as `<pack>/`; packs the image lacks are findings |
| `final/`, `approved/`, `provenance/`, docs, templates | left in place, noted |
| `MANIFEST.json` (top level and per shot) | verified first: sha256 of every file |

Known from the package's own text: workflows may also be dragged onto the canvas; a pack's
`config.ini` provider key is not shipped (hence `placeholder`); the ComfyUI floor is
recorded in the manifest (0.39.2 for the 2026-10-20 round, 0.42.1 for 2026-10-23).

**`comfy-shared`**: the folder already has `input/`, `models/`, `output/`; the plan is
`merge`.

## Not in scope

Merging a package's five Drive parts (do that first; the adapter takes the merged tree),
signing or notarising anything, pushing to RunPod, and running any graph.
