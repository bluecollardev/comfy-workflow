# Node packs: where they live and how they are versioned

The custom node packs are a separate repository,
`git@github.com:bluecollardev/comfy-node-packs.git`, mounted here as the git
submodule `shared/nodes/`. Every ComfyUI in this project loads its packs from
there: `apps/comfy-app/setup.sh` symlinks them into the Mac install,
`apps/comfy-app/build.sh` stages them into the Docker image. Nothing reads
packs from Binc's mirror any more; `shared/sync-nodes.sh` is the one path
from the mirror into the submodule.

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
apps/comfy-app/build.sh --shotpipe v27      # comfy-app:v27, labelled with the packs commit
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
COMFY_SHOTPIPE=v26 apps/comfy-app/setup.sh  # link BincStereo (always) plus ShotPipe v26
apps/comfy-app/build.sh --shotpipe v26,v25  # image with two ShotPipe versions side by side
```

A graph opens only in a ComfyUI that has the ShotPipe version it was built
with. All 14 current corrosion graphs are v26.
