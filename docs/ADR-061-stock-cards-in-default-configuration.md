# ADR-061: The stock cards that "Cheapest in Stock" tries are a setting in Default Configuration

**Date:** 2026-11-25
**Status:** Accepted (Lucas, 2026-11-25: "configure my stock default cards in the app", "i don't see them in default pod configuration do this"). Built on `feature/default-stock-cards`, merged to `develop` (`987bbbc`), not released.
**Context from:** the Default Configuration modal (`ConfigModal.vue`), `gpus.autoCards()`, [ADR-027](ADR-027-datacenter-is-chosen-by-card.md), [ADR-024](ADR-024-pull-pods-any-card-and-default-image.md).

## 1. What happened (the evidence)
- Default Configuration had one **Default card** select (`default_gpu`). The list of cards that `auto` (Cheapest in Stock) tries was fixed in core: the card table minus the explicit-only big cards. It was the one "stock cards" setting Lucas could not see or change.

## 2. Decisions
1. **A new config field `auto_cards`:** the card keys, in the order they are tried. **Empty means the built-in stock list**, so every existing config behaves as before.
2. **Where it is used:** card choice at pod creation and the pull-pod card choice read the saved list instead of the fixed one.
3. **Validation:** an unknown card key is refused with a plain message.
4. **The UI:** a checkbox list **Stock cards for Cheapest in Stock** under Options next to Default card, ticked with the stock list at first. Unticking a card or ticking a big card saves Lucas's own list; ticking exactly the stock list saves an empty list. **Reset To Stock List** goes back. It saves through the modal's normal full-config save (never a partial put of the mounts config).
5. **Name:** not "Stock default cards" (it matched `Default card` in `default-card.spec.js`).

## 3. Consequences
- Lucas can drop a card he does not want rented, or allow a big one, without a code change.
- A new card added to the table appears in the stock list for everyone with an empty list, and not for anyone who saved their own.

## 4. Open
- "Stock default cards" was read as this list; if Lucas meant something else (for example the card shown on the pod form), say so.
