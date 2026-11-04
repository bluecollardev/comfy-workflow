# ADR-032: Volumes are connected to the pods

**Status:** accepted, 2026-11-04 (Lucas: "connect the volumes to the instances", both ways)

## Context

A network volume and the pods that use it were two unconnected lists. The Volumes window knew each volume's pods; a pod card said nothing about its volume; the create form took the volume only from the Default Configuration, so using another volume meant editing the configuration and hunting for its datacenter.

## Decision

1. **A pod card shows its volume**: name, size and datacenter, linking to the Volumes window. The link is read from the Volumes list, which already holds each volume's pods (attached on RunPod, or named by the pod's own configuration). A pod with no volume shows no row.
2. **The create form has a Network volume field**: the configured volume (the default), none, or any of the account's. A volume never leaves its datacenter, so choosing one sets the datacenter, and the existing rules follow (a different datacenter is offered, not forced, ADR-026/027).
3. **The choice rides in the pod's own configuration**, the same mechanism as "Override configuration": `network_volume_id` and `data_center_id` in `config`. Choosing the configured volume again drops the override when the volume was all it held.

## Also in this change: H100 NVL and H200 NVL

The two NVL cards are in the card table (`gpus.ts`), explicit-only like the other big cards: RunPod's ids `NVIDIA H100 NVL` (94 GB) and `NVIDIA H200 NVL` (143 GB), read from its gpuTypes on 2026-11-04. They are Hopper, so they run the CUDA 12 image; they had been listed as "not in the table".

## Consequences

- The datacenter list is not narrowed to the volume's datacenter: another region stays choosable, with the existing "a volume is made there first" offer.
- A pod that gets a volume this way shows the "own configuration" badge, because that is where the choice is kept.
- Open: whether the list should hide other datacenters while a volume is chosen; attaching a volume to an existing pod (RunPod fixes it at creation, so it would be a Recreate).
