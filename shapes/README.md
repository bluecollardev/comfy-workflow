# Shapes

The fixed shapes in Binc's CANALV2 project, as JSON, so software can read
them: the dispatcher and crew that Binc's goal describes, linters, the
queue. Each file names the policy page it was taken from; where a shape was
confirmed against real files, it says "observed". The prose versions are
`docs/CANALV2-STRUCTURE.md` and the pages under `governance/`.

| File | Shape of |
|---|---|
| `project-tree.json` | The numbered top level of a project root |
| `shot-folder.json` | One file plus seven folders, every shot, every type |
| `graph.json` | A ComfyUI graph: lettered boxes in order, what every box and every revision must have, status terms, colour facts |
| `inbox-entry.json` | `ENTRY.md` header fields and `ASSETS.csv` columns; the entry lifecycle |
| `tracker-rows.json` | Columns of every tracker CSV, the state and status vocabularies, the six-stage tracker |
| `job-file.json` | An agent job brief and its in/running/done lifecycle |
| `report.json` | The report a job must produce, and the words it must not contain |
| `sidecar.json` | `.meta.json` beside a generated file: policy fields and the fields observed in the paint metadata |
| `names.json` | Every naming pattern as a regex, with examples and the exceptions pointer |

`check.py` validates real things against them, read-only:

```bash
shapes/check.py project projects/desktop/CANALV2
shapes/check.py shot    projects/desktop/CANALV2/10_CORROSION/corrosion-051
shapes/check.py job     queue/canalv2/in/job_001_corrosion-058_blender-full-carry.md
shapes/check.py name    corrosion-058_graph_v021.json solve_SA_v006.npz
```

The JSON is a plain, self-describing format, not JSON Schema: `entries` with
`name`, `kind`, `required` for folders; `fields` for documents; `patterns`
with regexes for names. When Binc's pages change, change the JSON to match
and note the source; the JSON never leads.
