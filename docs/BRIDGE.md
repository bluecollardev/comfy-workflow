# Remote Instances: see another RunPod Manager

Decision and reasons: [ADR-054](./ADR-054-remote-instances-bridge.md). Status: the snapshot builder, redactor and freshness check are built and tested (`libs/core/src/bridge.ts`); the S3 writer and reader, the Connect tab and the account menu are next (see `NEXT-STEPS.md`). Nothing here can run anything on the other machine.

## What it is
Each Manager can **share its status**: every 30 seconds it writes a small JSON file to the Panama exchange bucket under `bridge/<name>/`. Another Manager adds that name under **Connect > Remote Instances** and sees it. The bucket is the bridge: no port, no tunnel, no account. The file is 30 seconds old at best, and says so.

## Share your status (the person being watched, e.g. Binc)
1. Open the account menu (the user icon, top right), set **Instance name** (lowercase letters, digits, `-`, `_`; for example `binc`).
2. Turn on **Share my status**. It is off until you do.
3. Check the first file appears at `bridge/<name>/status.json` in the bucket.

## Watch someone (e.g. Lucas watching Binc)
1. **Connect > Remote Instances > Add**: the instance name (`binc`). The bucket and prefix default to the exchange bucket's `bridge/`.
2. The card shows **live**, **late** or **offline** from the file's age (under 1 minute live, under 5 late), the pods, the Queue counts, Auto-publish state, spend and the last History events.
3. **Account menu > View** switches the whole window to that instance, read-only, with a banner and a way back to *This instance*.

## What is in the file (schema `rpm-bridge-1`)
Pods (id, name, card, status, cost per hour, round, idle stop), Queue (counts and up to 100 tasks), Auto-publish (enabled, dry run, pending reviews, uploaded today), spend against the cap, and the last 200 History events. It is built from a whitelist, so nothing else can get in. **Never in it:** keys, the Slack webhook, any URL (a presigned link carries a credential), folder paths under a home directory, settings values. Free text is redacted (URLs, AWS key ids, long tokens, home paths); `tests/bridge.test.ts` feeds it each of those and checks.

## What it cannot do (Phase 1)
Start, stop or cancel anything, change a setting, publish, or read a log. A later phase (ADR-054, Phase 2) adds commands as requests that the other person **approves in their own window**: an allowlist (`import_round` with a cap, `pause`, `cancel`, `publish plan`), never delete, resume or create a pod, change settings or go live with Auto-publish.

## Open questions
- Both keys must be able to write and read `bridge/`; reads of `returns/BKK/` work today, writes to `bridge/` are not proven. If the exchange bucket refuses, point the bridge at a bucket Lucas owns (the bucket and prefix are settings).
- Binc has to agree to share; ask before turning it on his side.
