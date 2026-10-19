# Area: development

Trackers, solvers, mesh, node packs, tests. Free to try things, in its own folders only.

| What | Where |
|---|---|
| R&D work, one folder per topic | `50_RND/<topic>_<yyyy-mm-dd>/` |
| Quick looks for Resolve or online review (bucket: transient, untracked) | `80_TEST-BUCKET/<type>_<topic>_<yyyy-mm-dd>/` |
| Development scripts | `02_SCRIPTS/solve/`, `solve-blender/`, `solve-offline/`, new tools in `02_SCRIPTS/<tool>/` |
| Container definitions | `02_SCRIPTS/containers/` |

**Promotion into the shot pipeline:** Binc's visual check plus a node. The promoted file is copied in as a new version; the development copy stays where it is. Nothing in development edits a shot folder.
