# SOURCE: Binc's delivery-controller prompt (original, verbatim)

**Kept as received. Do not edit.** The revised version is `binc-delivery-controller-prompt-v2.md` in this folder.

- **Received:** 2026-11-19, pasted by Lucas ("that is his prompt") while diagnosing why Binc's agent had not posted files since the previous night.
- **From:** Binc / BH, the prompt his own coding agent was given on binc-PC (it names "Pod Manager 1.5.3").
- **Why it is a source and not a policy:** it describes what Binc's side wants from a delivery controller. Our rules (`shared/governance/`, ADR-050 to ADR-053) say how this app does it.

---

You are implementing production infrastructure in this repository.

The existing session has been operating through individual commands.
There is no verified persistent controller managing the delivery.
Build that missing execution layer using the existing Pod Manager 1.5.3
integration. Do not create another policy document or dashboard.

FIRST:
Inspect the existing Manager adapter, queue scripts, manifests and
background processes. Identify what already works and extend it.
Keep active renders and transfers untouched.

IMPLEMENT AND START a persistent runner that:
- Saves jobs and state on disk.
- Reconciles Manager state before submitting or retrying.
- Dispatches approved, staged graphs to suitable authorised pods.
- Monitors execution independently of an LLM turn.
- Detects failures and records concrete recovery actions.
- Prepares completed outputs for review and immediately notifies Binc.
- Transfers only exact packages Binc has inspected and released.
- Updates the existing tracker.
- Resumes safely after restart without duplicate submissions.

Use one controller as the queue writer. Other sessions may prepare
graphs but must not independently dispatch the same jobs.

Preserve existing authorisations, colour pipelines and graph versions.
Keep credentials out of logs. Leave CLAUDE.md unchanged.

Start small: connect one existing approved job to the runner.
Demonstrate observed execution progress, persistent state and a
working completion/failure notification. Then feed in the remaining
approved queue.

If an interface is unavailable, report the precise missing capability.
Do not invent an API or claim background operation that isn't running.

Return the controller process/service identity, state-file location,
log location and first actual job ID—not merely a plan.
