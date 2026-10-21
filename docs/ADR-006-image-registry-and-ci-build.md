# ADR-006: The ComfyUI image is built on CI next to a private registry; workflows ride on the volume

**Date:** 2026-10-20
**Status:** Accepted
**Owner:** Lucas (Blue Collar Dev)
**Extends:** ADR-004 (where the workflows run) and ADR-005 (the app on one PC).

## Context

A pod needs an image RunPod can pull. Ours (`apps/comfy-app`, Dockerfile on
`pytorch/pytorch` with CUDA, ComfyUI pinned, Binc's node packs) is 4.94 GB on
disk; one layer, the base image's Python packages with torch and the CUDA
libraries, is 6.8 GB uncompressed and about 3 GB on the wire. No base image
makes that small: it is torch.

On 2026-10-20 the first pod Lucas opened showed no workflows. It ran RunPod's
stock image with no volume, because our image had never been pushed and pod
creation refuses a bare local name on purpose. Two pushes from the Mac then
took about an hour each; the first died on its last layer with a dropped
connection. Lucas: "can have a smaller layer then".

A second question came with the first working pod: where do the workflows
live? The image baked `apps/comfy-app/workflows/` into ComfyUI's user folder,
so a change meant a rebuild and a push, and a graph saved in a pod's UI died
with the pod. Lucas: "ideally they're mounted".

## Decision

1. **The image lives in a private registry of Lucas's**:
   `registry.gitlab.com/bcdevlucas/comfy-workflow/comfy-app:<tag>`, a GitLab
   project that holds only the registry (the source stays on GitHub). Private,
   because the image carries Binc's packs. RunPod pulls with a read-only deploy
   token saved on the account (`saveRegistryAuth`); its id is a field of the
   mount configuration (`registry_auth_id`, under the image in the panel) and
   goes with every pod as `containerRegistryAuthId`.
2. **The image is built and pushed on GitLab CI, not on the Mac.**
   `./start.sh comfy-image --remote --wait` (`build.sh --remote`) stages the
   packs as before, pushes the build context, under 2 MB, as a branch of the
   registry project with a generated `.gitlab-ci.yml`, and a shared runner
   builds natively on amd64 and pushes into the project's registry over the
   datacenter's link. The torch layer never leaves the Mac; a rebuild is about
   five minutes. One branch per run (`build-<tag>-<utc>`), pruned on success,
   because the first branch became the project's default and refused force
   pushes. `--push <ref>` after `docker login` remains as the slow local way.
3. **Workflows are on the volume, not in the image.** The entrypoint links
   ComfyUI's Workflows panel to `/workspace/comfy-shared/workflows` and copies
   the repo's graphs in only while that folder is empty. A workflow saved in
   one pod's UI shows in the next; changing them needs no rebuild. On the Mac
   the panel keeps reading the repo folder through the link `setup.sh` makes,
   and `./start.sh sync` copies that folder to the volume.
4. **The image runs sshd and rsync** when RunPod passes `PUBLIC_KEY`, so the
   sync can reach a pod. Found the hard way: the first pod from our image
   refused SSH and the sync could not start.

## Consequences

- Pods pull a 3 GB image on first boot on a host, a few minutes; the card
  shows a step bar meanwhile. RunPod caches it per host afterwards.
- GitLab's free CI minutes cover a handful of builds a month; the pack
  staging means the client's nodes are in a private GitLab repo as well as the
  private GitHub submodule, the same confidentiality either way.
- Two registries' worth of credentials to keep: the GitLab token on the Mac
  (`GITLAB_TOKEN` or the stored `docker login`), the deploy token on RunPod.
- Models and plates are never in the image (unchanged); the volume carries
  them (ADR-007).

## Alternatives considered

- **A public registry or Docker Hub.** Docker Hub would mount the base layers
  from `pytorch/pytorch` without upload, but the image would have to be public
  or on a paid private plan, and it carries Binc's packs. Rejected.
- **A slimmer base.** `nvidia/cuda` plus `pip install torch` moves the same
  2.5 GB of wheels into our layer. No gain.
- **Build on the Mac, push from a faster link.** Still the Mac's uplink or a
  second machine to keep. CI is the second machine, free.
