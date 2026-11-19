# ADR-054: Remote Instances: see what is going on in someone else's RunPod Manager, and later run things there

**Date:** 2026-11-19
**Status:** Proposed. Phase 1 (read-only status) is being built in the next patch; Phase 2 (commands) is designed here and not built.
**Context from:** Lucas ("I want the ability to see what's going on in Binc's RunPod Manager on his machine via some sort of bridge that connects his local instance and mine"; "in the Connect menu I want to be able to connect to someone else's instance"; "this will allow us to run things on Binc's machine").
**Touches:** ADR-005 (a TypeScript core, no server), ADR-050 (publishing and the exchange bucket), ADR-051 (events and History), ADR-052 (destructive actions need a named yes), the Connect window, and Binc's `agent-permissions.md` (read-only on locked shots, a named yes for spend and anything leaving the machine, USD 100 cap).

## Context

Each Manager is one app on one PC: its queue, pods, Auto-publish and History live in that PC's config folder and in its own process memory. Lucas cannot see Binc's without asking him, and an agent or a person on one side cannot start work on the other side's machine. The two already share one thing with credentials on both ends: the Panama exchange bucket (`bh-panama-exchange-…`), which the app writes `returns/BKK/` to today.

Two different needs are hiding in the request, with very different risk:
1. **See** the other instance (pods, queue, Auto-publish, spend, History). Harmless if it cannot reveal a secret.
2. **Run** things on it. That is remote control of a machine that spends money and touches the client's material.

## Options for the link
| | What | Good | Bad |
|---|---|---|---|
| **A. Snapshots through the exchange bucket** | Each instance writes a small JSON status file under `bridge/<name>/` every 30 s; a follower reads it | no inbound port, no tunnel, no account, no new service; uses credentials both sides already have; read-only by construction (a file has no control path) | 30 s old, not live; log tails and screens are not possible; needs write access to the prefix |
| **B. Expose the MCP port through a tunnel** (Tailscale, Cloudflare) | The follower calls the other's MCP at `127.0.0.1:8765` through a tunnel | live, full tool set | the MCP has tools that spend and delete; one leaked URL is remote control; needs Binc to install and run a tunnel |
| **C. A relay we host** | Both connect out to a server | live, can carry commands | something to host, secure and pay for; a new trust boundary |

## Decision
**Phase 1: A, read-only, in a new patch.** The bucket is the bridge.
- **Publisher** ("Share my status"): off by default. When on, every 30 s the app builds a snapshot from a **whitelist** of fields (never by copying objects and redacting after) and writes `bridge/<instance>/status.json` plus `bridge/<instance>/events.jsonl` (the last 200 History events, rewritten whole). Schema `rpm-bridge-1`.
- **Follower** ("Remote Instances", a tab in the **Connect** window): Add an instance by name (and bucket and prefix when it is not the exchange bucket's `bridge/`), see a card per instance: live / late / offline from the file's age, its pods, queue, Auto-publish state, spend, and its recent History. Nothing on a card can change the other machine.
- **No secrets leave.** The snapshot carries no keys, webhook, URLs (presigned links especially), file paths under a home folder, or settings values; free text (History, failures) goes through the redactor (URLs, AWS key ids, long tokens, home paths). A test feeds it every secret shape and asserts none survives.
- **Staleness is a first-class state**, not an error: age under 2 intervals is live, under 10 is late, else offline, and a card says "last heard 4 min ago".

**The view switch (Lucas, 2026-11-19).** A new **account menu** (the user icon, last in the top bar) holds a **View** switch: *This instance* (the default, everything as today) or any Remote Instance added in Connect. Choosing a remote one swaps the whole window to that instance's snapshot: the pods, Queue, Publishing and History screens render from the file instead of from this PC, under a fixed banner "Viewing binc (live, 12 s ago). Read-only." with a button back to *This instance*. In a remote view every control that would change something is hidden or disabled (Phase 1 has no way to send it), the MCP tools and agents keep acting on **this** instance only, and the choice is remembered per PC but never starts a remote view that is offline without saying so. The same menu holds the instance's own name and the **Share my status** switch.

**Phase 2: commands, designed now, built only after Phase 1 has been used, behind its own ADR amendment.** Binc's side decides, never ours:
- Commands travel as files in `bridge/<instance>/inbox/` (an inbox on the *target's* prefix), each signed with a shared secret entered on both sides.
- The target never executes one by itself. Each command appears in the target's **window** as a request ("Lucas asks: import round X, shots A and B, cap USD 20") and runs only on that person's **Approve** there. Auto-approve is a per-command-kind setting the target turns on, never default.
- Allowlist only: `import_round` (a named round, shots, a cap), `pause` and `cancel` of a queued task, `publish plan`. Never over the bridge: delete anything, resume or create a pod, change settings, go live with Auto-publish, anything under `models/`, locked shots. Binc's USD 100 cap and read-only-on-locked rules apply on the target and are checked there.
- Every command and its answer are in both Histories.

## Assumptions (to verify, recorded so they are not forgotten)
1. Both keys can write and read the `bridge/` prefix of the exchange bucket. Reads of `returns/BKK/` work today (the access check lists it); write access to `bridge/` is **not yet proven** from either machine. Fallback: the prefix and bucket are settings, so a bucket Lucas owns can carry the bridge.
2. 30 s is enough for "what is going on". Logs and live progress between snapshots are out of scope for Phase 1; Option B stays available later as an optional live view.
3. Binc agrees to Share my status (a message to ask; the feature is off until he turns it on).
4. Names are unique per bucket; the publisher refuses to write when another instance's file under its name is newer than itself (two machines sharing a name).

## Consequences
- No new server or port. The cost is a few KB of S3 writes every 30 s per sharing instance.
- The agent prompt for Binc's agent can point at the snapshot instead of asking him.
- Phase 2 is a deliberately separate, human-approved step, so the first patch cannot be used to run anything.
