# ADR-047: Choosing several cards: your order, the first free one, one pod, the same type first

**Date:** 2026-11-18
**Status:** Accepted and built (v1.3.4, v1.3.5). Not yet tried against RunPod's real stock; tested with fakes and unit tests.
**Context from:** Lucas ("allow multi select for GPUs"; "the first selected available GPU gets used"; "in import rounds, allow GPU multiselect as well - Choose Card"; "when splitting the job into multiple pods, different pods can use different GPUs, but try to get all the same type of GPU first"; "by default datacenters should be filtered in Choose Card"; "filter datacenters can be a dropdown too"; "make sure our choose card allows us to select multiple GPUs").
**Extends:** ADR-042 section 19 (Retry Later), ADR-038 (Import Round and the pool), ADR-026 (the card and datacenter table), ADR-028 (MCP parity). The dated amendments in ADR-042 and ADR-038 carry the build detail; this page is the one rule they share.

## Context

A card was one choice: one GPU for a Retry Later wait, one GPU for every shot of an import. RunPod's stock changes minute to minute, so waiting on exactly one card means waiting longer than needed; and a person usually has an order of preference (the card they want, then ones that will do). Two places choose a card: **Retry Later > Another GPU** (a new pod when a stopped pod's host is full) and **Import Round > Choose Card** (the card for every shot; the pool makes pods on it).

## Decision

### 1. One rule everywhere
1. **Several cards, ranked in the order you click them** (a badge shows 1, 2, 3; unticking moves the rest up). That order is the preference.
2. **The first card that has one free is used.** A try asks the cards in order; only a definite "no card" answer moves on to the next. A rate limit, or an answer that is unknown (a lost reply), ends the try without asking another card.
3. **At most one pod per try, and ONE pod for a wait.** An unknown answer never leads to a second card, because the first may have made a pod.
4. **The cheapest safe pricing:** an estimate for a choice of several cards uses the most expensive of them, so a cost cap is never passed by the card that gets picked.

### 2. Retry Later > Another GPU (ADR-042 section 19)
- The card list in the popup is checkboxes; the first card starts ticked so one click still works. The wait is one create watch (`gpus`), tried every 2 minutes up to 12 hours; one wait per pod.
- **One shared pod name** (`<old name>-alt`; a single card keeps `<old name>-<card>`): a lost answer is found by that name on the next try, so it is never followed by a second pod on another card.
- It creates a **new** pod like the old one (image, disk, volume, configuration) in the same datacenter; **the old pod is never touched**. The wait shows on the old pod's card with its own Cancel.

### 3. Import Round > Choose Card (ADR-038)
- The window ticks several cards of **one** datacenter (pods and volumes are tied to a datacenter, so a card at another datacenter replaces the selection and the datacenter). **Use these cards** confirms; the datacenter's volumes are offered next. A single card is still sent as one key; several as an ordered list per shot (`cards`: a key or a list; the run task keeps `gpus` and `gpu` = the first).
- **The same type first when the job is split across pods:** every new pod asks from the **first** card, never a round-robin; it falls back to the next card only when the earlier ones have none, and the next pod starts again from the first (stock frees up). The result is mixed cards only when availability forces it; the card each pod really got is on its Queue row. A line in step 3 says it in words.
- **Number of Pods** (was "Pods at once") is how many of an import's shots run at the same time, one shot per pod, so the job is split into chunks that run together; it is a cap, not the total pods created over a long job; typed values are clamped to 1 to 20 and never overwritten.

### 4. Choose Card's datacenter list
Every datacenter and card is listed (ADR-026), which is 32 cards across 24 datacenters. The window now has a **Datacenters shown** dropdown next to the text filter and starts on the datacenters where the person has a network volume (a pod can only run there); a volume-source round starts on its own volume's datacenter; *All datacenters* and each single datacenter are one choice away (a datacenter with no volume of yours is there for the "Create a new volume" flow); a chosen datacenter never vanishes; the text filter works inside the choice. Create Pod and the Configuration keep the full list.

### 5. For agents (MCP, ADR-028)
`create_pod { like_pod_id, gpus: [...], approved_by, retry_until_free }` (a string `gpu` still works); `plan_round_import`, `import_round` and `import_rounds` take `cards` as a key or a list; `pod_retry_options { pod_id }` returns the cards and the waits; `pod_watch` lists the waits on a pod's card. The same rules apply: order, the first free one, one pod.

## Alternatives considered
- **Cheapest free card first** (ignoring the person's order): rejected; the person ranks cards for reasons the price does not show (speed, memory, the image).
- **Round-robin or spreading pods across the chosen cards:** rejected by Lucas's rule: same type first keeps the chunks finishing together and the cost predictable.
- **Asking every card at once and keeping the first answer:** rejected: it can create several pods; one pod per try is the guard against double billing.
- **A stock check before asking:** stock is a label that can be stale; asking RunPod is the truth, and a refusal costs nothing.

## Consequences
- A job can end up on mixed cards when the preferred card runs out; chunks then finish at different times. The Queue shows each pod's card.
- The most-expensive pricing makes the estimate high when the preferred card is the cheap one; the plan says so.
- Waiting for several cards still bills nothing until a pod exists.
- Not covered by tests: a card list on a volume-source round in the browser (the core and the shared picker are tested), and any run against real stock.

## Where it lives
`libs/core/src/podwatch.ts` (the create watch, `gpus`), `libs/core/src/pods.ts` (`createLikeWhenFree`, `requestLike`), `libs/core/src/queue.ts` (cards as lists, the pod creation order, the estimate), `src/components/RetryLaterModal.vue`, `src/components/ChooseCardModal.vue`, `src/components/DatacenterTable.vue`, `src/components/ImportRoundModal.vue`, `mcp/server.mjs`, `mcp/app-tools.mjs`.
