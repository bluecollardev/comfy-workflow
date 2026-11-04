# ADR-031: A zero cost is never shown; a stopped pod shows its price as an estimate

**Status:** accepted, 2026-11-04 (Lucas: "total cost reverts to 0 ... just hide the 0 from display and total cost too ... it starts again when pod is started ... adr this, we will have other requirements later"; then: "even when stopped i should see the price/hr for a pod")

## Context

RunPod reports `costPerHr` as 0 for a stopped pod: nothing is billed for compute while it is stopped (the volume still is, and that is shown separately as the monthly storage card). The pod card's details showed "$0/h", which reads as a price when it is the absence of one. The create form also shows a price now (the chosen card's hourly price times the GPU count, ADR-027).

## Decision

1. **A cost of 0 is never displayed**, not as "$0/h" and not in any total built from it.
2. **A stopped pod still shows its price per hour**, because that is what it costs when it runs. RunPod reports 0, so the core (`pods.details`) fills it with the listed price of the pod's card in the pod's datacenter times its GPU count, and sets `cost_estimated`. The card shows it as "≈ $0.28/h" with a tooltip saying why. When no price can be found the row is left out.
3. **A running pod shows RunPod's own figure**, exact, with no "≈". It is read each time the details open, so starting a pod switches from the estimate to the real number with no state to clear.
4. **The create form's price is a forecast, not a bill.** It is the listed price of the chosen card at the chosen datacenter times the GPU count (on Automatic, the cheapest card in stock there, marked "from"), with day and month equivalents. It does not include the volume, which has its own monthly card.

## Consequences

- Only a positive `cost_per_hr` renders (`PodCard.vue`); test `a stopped pod still shows its price per hour` in `e2e/pod-card.spec.js`.
- The estimate is the secure-cloud listed price, like the datacenter table's; a community or spot pod may pay differently, which is why it is marked "≈".
- **Open, "other requirements later":** a running total (spend so far, per pod and across pods), the spend cap of USD 100 in the governance policy, and whether a stopped pod should show what its volume costs instead. None is decided here; extend this ADR or supersede it.
