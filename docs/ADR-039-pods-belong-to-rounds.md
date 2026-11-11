# ADR-039: Pods belong to rounds; a round holds a series of pods and is renamable

**Date:** 2026-11-09
**Status:** Accepted; built on `feature/pods-in-rounds` (from `develop`): the map, the grouping and collapsible round lists, the card's Round choice, rename, two MCP tools, with unit and browser tests. Not run against real pods (it never touches one).
**Extends:** ADR-028 (MCP does what the window does). Related, on other branches: ADR-035 (a pull picks a pod), ADR-038 (importing a round queues work for pool pods).

## Context

Lucas (2026-11-09): "we have Create Pod. Pods sections. pods belong in rounds. have an encompassing rounds section. leave create pod where it is, but have an option to drop the pod into a round"; "rounds have a series of pods in them"; "rounds are renamable". Until now pods were one flat list (optionally grouped by datacenter) and nothing tied a pod to the delivery round it works on.

## Decision

1. **A pod is in at most one round, or in none.** The round is a delivery round's name (`brynley-comfy-2026-11-06`). The link is a map on our side (`pod-rounds.json`, keyed by pod id), like pod names: RunPod is not told, the pod is not touched, no spend. It goes with Recreate and is gone with Delete.
2. **Rounds are a way to group the pod list, next to grouping by datacenter.** Lucas (2026-11-09, after the first build showed nothing until a pod had a round): "we can group by data center, but we also want to group by round, and rounds should be a collapsible list of pods in the round". The Pods card has two switches, **Group by round** (on by default, remembered) and **Group by datacenter** (off by default, remembered), and they combine: with both on, each round lists its pods by datacenter.
   - With **Group by round** on, the card is headed "Rounds" and holds one **collapsible list per round**: a header with a chevron, the round's name (renamable, see 4), a count of its pods, and its pod cards. The open or closed state of each round is remembered. Every round is listed, **empty ones too** (they say "No pods in this round yet"), so the section is there before any pod is in it. The pods in no round come last under "No round".
   - The rounds listed are those in the exchange bucket (as far as the exchange is set up) plus any round that already has pods.
   - With it off, the card is the plain "Pods" list as before. **Create Pod stays where it is.**
3. **A pod is dropped into a round from its card** (the Round choice: the rounds in the exchange bucket plus any round that already has pods, or "No round"), **and the Create Pod form has the same Round choice** (Lucas, 2026-11-09: "no round" in the form, "add it"), optional, "No round" by default. Create Pod stays where it is; the new pod is put in its round as it is created, and a round that cannot be used is refused before anything is spent. MCP `create_pod` takes `round` too.
4. **A pod card is dragged by a handle onto another round** (or onto "No round") to move it there (Lucas, 2026-11-09: "allow drag and drop (with confirm) of moving pods to a different round"). Only the grip at the left of the card's title starts a drag (Lucas: "cards should have a handle for the drag"), so the card's buttons, fields and text behave as before; the whole card is the picture that follows the pointer. Dropping asks first, naming the pod and the round (Cancel leaves everything as it was); the round under the pointer is outlined while dragging. It works while grouped by round, onto a collapsed round's header too, and does the same as the card's Round choice: a map on our side, no spend.
5. **A round is renamable.** The pencil on a round's header sets a name shown in this app (`round-names.json`); the round's own name stays the key, so the link to the bucket's round is kept. An empty name goes back to it. The old name stays as a tooltip.
6. **MCP does the same** (ADR-028): `set_pod_round` (empty takes a pod out) and `rename_round`; `list_pods` and `get_pod` show `round` and `round_label`. Neither spends, so neither needs `approved_by`. Changes are written to the History as a `moved` pod event.

## Assumptions (Lucas can overrule)

- "Round" means the delivery round (an S3 round), not a free-form group, so a round cannot be made up in the app. Where the exchange is not set up, only rounds that already have pods are listed.
- Group by round is on by default, since a Rounds section was asked for; a user who wants the old flat list turns it off.
- Renaming is a label, not a rename of the bucket's round.
- Import Round (ADR-038) lives in the Rounds header and puts the pods it creates into the round it imports (this branch carries ADR-037/038, merged in from `feature/round-import-queue`).

## Consequences

Pods can be read by round. Nothing about how pods are created, billed or stopped changes.

## Amendment (2026-11-09): rounds with no pod are hidden until asked for

- Listing every bucket round (a dozen, each "0 pods") buried the pods. The Rounds list now shows only rounds that have a pod, plus "No round"; a **Show empty rounds (N)** switch (remembered) lists the rest. A shown empty round says where its files are ("On this PC: n files", "On the volume: n files") before the hint to pick it on a pod's Round choice.
- A round still appears in every Round choice (card, Create Pod, Import Round(s)), whether or not it is listed.
