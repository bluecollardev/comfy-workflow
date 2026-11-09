# ADR-039: Pods belong to rounds; a round holds a series of pods and is renamable

**Date:** 2026-11-09
**Status:** Accepted; built on `feature/pods-in-rounds` (from `develop`): the map, the Rounds sections, the card's Round choice, rename, two MCP tools, with unit and browser tests. Not run against real pods (it never touches one).
**Extends:** ADR-028 (MCP does what the window does). Related, on other branches: ADR-035 (a pull picks a pod), ADR-038 (importing a round queues work for pool pods).

## Context

Lucas (2026-11-09): "we have Create Pod. Pods sections. pods belong in rounds. have an encompassing rounds section. leave create pod where it is, but have an option to drop the pod into a round"; "rounds have a series of pods in them"; "rounds are renamable". Until now pods were one flat list (optionally grouped by datacenter) and nothing tied a pod to the delivery round it works on.

## Decision

1. **A pod is in at most one round, or in none.** The round is a delivery round's name (`brynley-comfy-2026-11-06`). The link is a map on our side (`pod-rounds.json`, keyed by pod id), like pod names: RunPod is not told, the pod is not touched, no spend. It goes with Recreate and is gone with Delete.
2. **The dashboard shows rounds as sections.** One section per round that has pods, in name order, each holding its pods as cards; pods with no round stay in the pod list, under the heading "No round" once any round exists (with "Pods" and the datacenter grouping as before when none does). **Create Pod stays where it is.**
3. **A pod is dropped into a round from its card** (the Round choice: the rounds in the exchange bucket plus any round that already has pods, or "No round"). Create Pod itself has no round field yet.
4. **A round is renamable.** The pencil on a round's header sets a name shown in this app (`round-names.json`); the round's own name stays the key, so the link to the bucket's round is kept. An empty name goes back to it. The old name stays as a tooltip.
5. **MCP does the same** (ADR-028): `set_pod_round` (empty takes a pod out) and `rename_round`; `list_pods` and `get_pod` show `round` and `round_label`. Neither spends, so neither needs `approved_by`. Changes are written to the History as a `moved` pod event.

## Assumptions (Lucas can overrule)

- "Round" means the delivery round (an S3 round), not a free-form group. A round with no pods is not shown as a section; it is offered in the Round choice if the exchange is set up.
- Renaming is a label, not a rename of the bucket's round.
- The Import Round queue (ADR-038) does not yet put the pods it starts into the round it imports; that is a small follow-up once both are merged.

## Consequences

Pods can be read by round. Nothing about how pods are created, billed or stopped changes.
