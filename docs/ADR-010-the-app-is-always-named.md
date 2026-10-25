# ADR-010: A screen always says which app it is in

**Date:** 2026-10-24
**Status:** Accepted (Lucas, 2026-10-24: "in header of adapter studio show our logo like we do on regular app ... users should always know what app they're in").
**Owner:** Lucas (Blue Collar Dev)
**Relates to:** ADR-009 (the Adapter Studio, the first full-screen modal)

## Context

The pod manager's navbar carries the app's mark (the microchip icon) and its name, "RunPod Manager",
and the no-spend badge when pods are simulated. Ordinary modals sit over that navbar, so the app is
still named behind them. The Adapter Studio is a full-screen modal with its own IDE-style header and
covers the navbar completely: inside it nothing said which app it was, and nothing said that pods are
simulated.

## Decision

1. **One component carries the brand: `AppBrand`** (the icon, the name from `app.title`, and the
   no-spend badge). The navbar uses it; so does every surface that covers the navbar.
2. **A full-screen or full-window modal puts `AppBrand` first in its header**, followed by the screen's
   own title ("RunPod Manager | Adapter Studio"). The Studio is the first; any later full-screen modal
   follows the same rule.
3. **Ordinary modals do not repeat it**: they leave the navbar visible, which already names the app.
4. **The no-spend badge travels with the brand**, so a full-screen modal cannot hide that pods are
   simulated.
5. **It is tested**: the Studio's header has the brand and the app's name from the language file, and
   the no-spend badge appears in it when pods are simulated.

## Consequences

- A change to the app's name or mark is made once.
- Full-screen screens cost a little header width; on a phone the name collapses to the icon.

## Alternatives considered

- **Only the page title (`document.title`) names the app.** Invisible inside an Electron window with no
  address bar; not enough.
- **Repeat the brand in every modal.** Noise; modals already sit over the navbar.
