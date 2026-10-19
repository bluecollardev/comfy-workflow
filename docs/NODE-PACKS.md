# Node packs: where they live and how they are versioned

The custom node packs are a separate repository,
`git@github.com:bluecollardev/comfy-node-packs.git`, mounted here as the git
submodule `shared/nodes/`. Every ComfyUI in this project loads its packs from
there: `apps/comfy-app/setup.sh` symlinks them into the Mac install,
`apps/comfy-app/build.sh` stages them into the Docker image. Nothing reads
packs from Binc's mirror any more; `shared/sync-nodes.sh` is the one path
from the mirror into the submodule.

## What the packs are

ShotPipe is one layered family, not nineteen alternatives: v7 is the base
(25 nodes), later versions add nodes beside it and import its code, and a
graph needs a **set**. The 14 current corrosion graphs use nodes from v7, v10,
v11, v12, v13, v14 and v26 at once; that set is `contract-v26` in the packs
repo's `sets.json`, and `COMFY_SHOTPIPE=contract-v26` links all seven.
BincStereo is a separate, self-contained pack. The full explanation, with
what each generation adds and the ShotPipe/BincStereo comparison, is
`shared/nodes/docs/SHOTPIPE.md`.

## What each pack declares about itself

Every pack carries two small files. `requirements.txt` lists the pip packages
it imports, and ComfyUI, `setup.sh` and the Dockerfile install it.
`pyproject.toml` has a `[tool.packs]` table: `requires`, the packs it imports
from at load time and therefore needs beside it in `custom_nodes/`, and
`supersedes`, a version with the same node names that must never be loaded
with it. `setup.sh` and `build.sh` resolve `requires` transitively, so
`COMFY_SHOTPIPE=v26` links v26, v14 and v7; the `contract-v26` set is still
the right request for the corrosion graphs, since they also use v10–v13
directly. The packs repo's `tools/manifest.py` reads these tables to build
[`docs/DEPENDENCIES.md`](../shared/nodes/docs/DEPENDENCIES.md) and fails if a
`requires` names a pack that is not there.

The shape of a pack is published in the packs repo as
[`shapes/node-pack.json`](../shared/nodes/shapes/node-pack.json), beside this
repo's other shapes in `shared/shapes/`; `shared/shapes/check.py pack <dir>`
checks a folder against it.

## Two folders: portable/ and bound/

Since tag `packs-2026-10-19b` every pack sits in one of two folders of the
packs repo, decided by its contents, not by hand:

| Folder | Rule | Today |
|---|---|---|
| `portable/` | no absolute binc-PC path anywhere in the pack's Python; usable on another project as is | ShotPipe v8–v14, v16, v26; BincStereo |
| `bound/` | CANALV2 paths (`/home/binc/…`, `/mnt/storage/…`) baked in as widget defaults; fine for CANALV2, where every runtime mounts those paths, not elsewhere untouched | ShotPipe v6, v7, v15, v17, v20–v25 |

`setup.sh`, `build.sh` and `sync-nodes.sh` look in both, so the split changes
nothing for an install. Portability is per pack; a set is only as portable as
its base, and `contract-v26` includes v7, which is bound. A pack never moves between the folders and is never
edited to become portable: a clean rewrite is a new version with a new prefix,
and it lands in `portable/`. The packs repo's `tools/manifest.py` regenerates
`packs.json`, `docs/NODES.md` and `docs/PORTABILITY.md` (every baked path by
file and line) and fails if a pack's contents disagree with its folder;
`sync-nodes.sh` runs it after an import.

## Three layers of version

| Layer | Versioned by | Moves when |
|---|---|---|
| A pack | its folder name: `ComfyUI-BH-ShotPipe-v26`; BincStereo by `version` in its `pyproject.toml` (0.2.0) | Binc cuts a new ShotPipe version, or BincStereo changes |
| The set of packs | a commit, and a tag, in `comfy-node-packs` | any pack is added or BincStereo changes |
| What this repo and its images use | the submodule pin, one commit hash of `comfy-node-packs` recorded in each comfy-workflow commit; the image carries it as the label `dev.bluecollar.comfy-node-packs` | this repo decides to move to a new set |

## Rules, from Binc's versioning policy and the packs themselves

- **A ShotPipe version is never edited once a graph has been cut against it.**
  A change is a new folder, `v27`, beside the old one. Versions only go up.
- **New or changed nodes take the version prefix**, `BH27_ObjectSolve`, so a
  graph pins the exact code by node name. The unprefixed `BH_*` names in v6
  to v24 are legacy: nine of them are defined in two versions each, which is
  why only the versions a graph needs are ever loaded together.
- **BincStereo is semver** in `pyproject.toml`. Bump it on any change; the
  repo tag records which set it shipped in.
- **The repo's `main` only gains folders and BincStereo bumps.** No pack
  folder is ever rewritten, deleted or renamed on `main`.
- **Binc's tree is upstream.** Until Binc has a repo, the mirror is the
  source and `sync-nodes.sh` the import. When they do, it becomes the
  `upstream` remote of `comfy-node-packs` and the sync script retires.

## Releasing a new set

```bash
./shared/sync-nodes.sh                      # import from the mirror; prints what changed
cd shared/nodes
git add -A
git commit -m "ShotPipe v27"                # one line: what was added or bumped
git tag packs-2026-10-26                    # the set; also shotpipe-v27 if a version was added
git push origin main --tags
cd ../..
git add shared/nodes                        # move the pin
git commit -m "nodes: pin comfy-node-packs packs-2026-10-26 (ShotPipe v27)"
```

Then, when an image is wanted:

```bash
apps/comfy-app/build.sh --shotpipe contract-v27   # after adding the set to sets.json; labelled with the packs commit
docker image inspect comfy-app:v27 --format '{{index .Config.Labels "dev.bluecollar.comfy-node-packs"}}'
```

Tags: `packs-<yyyy-mm-dd>` for a set, `shotpipe-v##` when a ShotPipe version
is added, `bincstereo-<semver>` when BincStereo is bumped. An image tag names
the ShotPipe version it carries (`comfy-app:v27`); the label names the exact
packs commit, so the two together say precisely what code is inside.

## Using it

```bash
git clone --recurse-submodules git@github.com:bluecollardev/comfy-workflow.git
git submodule update --init shared/nodes    # in an existing clone; start.sh and setup.sh do this too
COMFY_SHOTPIPE=contract-v26 apps/comfy-app/setup.sh  # BincStereo (always) plus the seven-pack ShotPipe set
apps/comfy-app/build.sh --shotpipe contract-v26      # the image for the corrosion graphs; or explicit versions v26,v14,v7
```

A graph opens only in a ComfyUI that has every ShotPipe version it uses. The
14 current corrosion graphs need the `contract-v26` set.
