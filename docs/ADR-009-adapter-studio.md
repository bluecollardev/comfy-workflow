# ADR-009: The Adapter Studio: chat builds a prompt, the prompt builds the adapter

**Date:** 2026-10-24
**Status:** Accepted for the build (Lucas, 2026-10-24, over several messages and a screenshot). Not yet built; the plan is at the end. Until it is built, the screens that exist are the ones in "What exists against what was asked".
**Owner:** Lucas (Blue Collar Dev)
**Extends:** ADR-008 (import adapters). Supersedes ADR-008's "Write an adapter with Claude" preview-and-textarea flow (decisions 7, 10, 12 keep their rules; their screens change).

## Context

ADR-008 gave adapters a prompt loop in a side panel and a plain textarea editor in Default
Configuration. Lucas, 2026-10-24: "Write an adapter with Claude: this screen should have a
source code pane, and the ability to chat side by side ... I want to see the fuckin' file we're
editing ... this should look like an IDE editor ... you write and manage the adapters ... you
should be able to name these adapters too for easy reference ... have some sort of validation
when saving the adapter to make sure it's compatible, again, agentic driven ... driving the
adapter should allow you to chat, and that chat builds a prompt, that prompt is used to build
the final adapter ... that prompt, which is text, should be editable by the user when editing /
creating these adapters."

The problems with what exists: the code is not visible while Claude works; a one-shot prompt box
loses what was decided; nothing records *why* an adapter maps what it maps; and validation is a
button the person has to remember.

## What exists against what was asked

Lucas, 2026-10-24, with a screenshot of the current **Inspect** modal ("Adapter comfy-shared": a
read-only block of code, a Close button, its top lines scrolled out of sight): "we have inspect
buttons but obviously I need to change this too", "I don't see no chat interface to edit this",
"what happened to preview, code, or split options?".

| Asked | What exists (screenshot) | This ADR |
|---|---|---|
| A source pane and a chat side by side | Code only, no chat | decision 1 |
| An IDE look: line numbers, tabs, explorer, problems, status bar | A plain scrolling block | decision 1 |
| Edit any adapter, built-ins included | Read-only, Close only | decisions 10, 11 |
| View as code only, preview only, or both, as icon buttons | None | decision 9 |
| Name and rename adapters for easy reference | The title is the id | decision 5 |
| Chat that builds an editable prompt, which builds the adapter | None | decisions 2 to 4 |
| Validation on save, agent-driven | A syntax check on the editor's Save only | decision 7 |
| Claude writes and manages the adapters | One-shot draft | decision 6 |
| Inspect leads somewhere you can change things | A dead end | decision 11 |

## Decision

1. **One screen, the Adapter Studio, laid out like an IDE.** It opens from "Write an adapter
   with Claude" (Import Shot Pack) and from New adapter / Edit / Duplicate in Default
   Configuration, replacing the textarea editor. Left: an explorer (the built-in adapters
   read-only with a lock, yours, New). Centre: tabs and a real code editor (line numbers,
   JavaScript highlighting, the file path and sha256 above it) with a Problems panel and a
   status bar below (line and column, saved or modified, Valid or not). Right, **side by side
   with the code**: the chat with Claude. The file being edited is always on screen.
2. **The chat builds a prompt.** Talking to Claude about a shot pack (what the folders are,
   which graphs matter, what must stay where) is not the product; it is how the **adapter
   prompt** gets written. After each exchange Claude keeps the prompt up to date: the goal,
   the facts about the source format it was told or found by reading the folder, the mapping
   rules, the constraints, the open questions. The prompt is plain text in its own tab beside
   the code.
3. **The prompt is editable by the person**, when creating or editing an adapter, as text:
   typing in it is as valid as chatting. Claude reads the person's edits on its next turn and
   does not overwrite them without saying so; the prompt keeps a version history.
4. **The prompt builds the adapter.** **Build adapter** makes one generation call from the
   current prompt, the adapter spec and the attached folder's material (the same material
   ADR-008 decision 10 lists), and writes the module through the single save path. The module
   is the build output; the prompt is the source. Both are stored together
   (`adapters/<id>.mjs` and `adapters/<id>.prompt.md`), so an adapter can be rebuilt, audited
   and explained. A hand-edit to the code marks the adapter "edited since build"; Build then
   warns that it replaces those edits (the previous version stays in the history).
5. **Names.** An adapter has a display **name** (what lists and menus show) and an **id** (the
   file name, a slug made from the name, changeable). Both are set in the Studio's header, by
   the person or by Claude. Renaming moves the files (module, prompt, history) and updates the
   `id` and `name` in the module.
6. **Claude manages adapters through a fixed set of tools, and only those.** In the chat it
   can: read an adapter and its prompt; read small text files and list names in the attached
   folder (confined to that folder, 16 KB at a time); update the prompt; build the adapter;
   validate it; test it on the attached folder; rename it; and delete an adapter that it created
   in this session. It cannot write anywhere but `adapters/<id>.mjs` and
   `adapters/<id>.prompt.md`, cannot touch a built-in, cannot delete what the person made, and
   cannot run a shell. This restates ADR-008 decision 13 for the tool loop: the rule is the
   code path, tested by comparing the folder tree after a hostile reply.
7. **Validation on save is agentic.** Saving, by hand or by Claude, runs the structure check
   (ADR-008) and, when a folder is attached, a fenced test of the plan. If either fails and a
   key is set, Claude is handed the errors, the code and the prompt, fixes the module, and the
   save is checked again, up to three rounds, every round visible in the chat and the editor.
   If it still fails, the adapter stays saved but marked **Not valid** with the errors in the
   Problems panel, and the Import screen offers only valid adapters by default. Without a key,
   the checks still run; only the fixing is manual. Each overwrite keeps the previous version in
   `adapters/.history/<id>/`, twenty deep, with Revert in the Studio.
8. **How the chat runs.** One request per step, driven by the screen: the screen sends the
   conversation and the app's core makes one Messages API call with the tools above, executes
   the tool calls it returns, and answers with the new messages and what each tool did; the
   screen repeats until Claude ends its turn (at most ten steps). The screen shows each step
   as it lands, so nothing is hidden and a stop button works between steps.
9. **View modes, as icon buttons.** The editor's toolbar has three: **Code** (the source only),
   **Preview** (what the adapter does) and **Split** (both, side by side). The choice is
   remembered per viewer. *Preview* is the adapter run, fenced, on the attached folder: the
   plan by kind with counts and bytes, the destination tree it would make under ComfyUI-Shared
   (folders expand), the findings, and any structure or plan errors; it refreshes when the
   file is saved. With no folder attached it says to attach one. The chat is a separate pane
   on the right in every mode.
10. **Every adapter is editable, the built-ins too.** Editing a built-in writes an **override**:
    a file `adapters/<id>.mjs` with the built-in's id, which the app then uses instead of the
    shipped one. The shipped file is never touched. The list marks it "Built-in, modified",
    shows the diff against the original, and **Reset to built-in** deletes the override. The
    chat, the prompt and agentic validation work on a built-in exactly as on yours.
11. **Inspect opens the Studio.** There is no separate read-only viewer: Inspect (in Import Shot
    Pack and in Default Configuration) opens the adapter in the Studio, in Code view, with the
    chat on the right and the same Save, Revert and Reset.
12. **Nothing is a black box** (ADR-008 decision 12 stays): the code, the prompt, every tool
   call and result, the version history and the sha256 are all on screen. The Studio shows,
   before the first message of a session, exactly what will be sent (names, counts, the small
   READMEs and manifests) and sends nothing until the person confirms.

## Consequences

- Built-in adapters are no longer pristine in use: an override can change what an import does.
  The list says so, the original is always one click away, and Reset is one click.

- The prompt becomes the durable description of an adapter: a person or an agent can read why
  it does what it does, edit the intent, and rebuild.
- Two files per adapter, plus a history folder; the manager, the CLI (`--list`, `--show`) and
  the MCP tools learn about the prompt (`adapter_save` takes an optional prompt).
- A code editor library (CodeMirror 6) is added to the UI; it is a dependency of the renderer
  only.
- More Anthropic usage per adapter than a single draft: each chat step is a call, each save with
  a failure may add up to three. The Studio shows a running count of calls in the session.
- Auto-fix can change code a person typed. That is the reason for the history and for showing
  the fix as a diff in the chat before the next save overwrites it.

## Alternatives considered

- **Keep the one-shot prompt box and the textarea.** What exists; the person cannot see the file
  Claude is working on and the intent is lost. Rejected (the reason for this ADR).
- **Make the chat the source of truth, no separate prompt.** Chats are long and noisy; a
  distilled, editable prompt is what the person can read in a minute and Claude can rebuild from.
- **Let Claude write anywhere in the config folder** (settings, mounts) so it can "manage" more.
  Rejected: ADR-008 decision 13 stands; the studio's tools are adapters and their prompts.
- **Auto-fix without a cap, until valid.** Can loop on a bad prompt and burn calls; three rounds
  then hand back to the person.
- **Monaco instead of CodeMirror.** Heavier, workers and a bundler config for Electron; CodeMirror
  6 is enough for one file at a time.

## Open points

1. Whether "Valid" should require a passing test on a folder, or the structure alone when no
   folder is attached (planned: structure alone, with a note).
2. Streaming the model's text as it is written; the plan is whole replies per step, which is
   simpler and enough.
3. Whether the prompt travels with a shared adapter (copying the `.mjs` alone would lose it).
4. A diff view for auto-fixes; the plan is the history plus a plain before and after in the chat.

## Plan

1. **Core** (`libs/core/src/imports.ts` and a new `studio.ts`): the prompt files and history,
   rename and display name, `build`, the tool set and the one-step chat function, the agentic
   save check; tests with a stand-in Anthropic server that returns `tool_use` blocks and a
   hostile one.
2. **IPC and MCP:** a `studio` namespace; `adapter_save` accepts the prompt.
3. **The Studio screen** (CodeMirror, explorer, tabs, Problems, status bar, prompt tab, chat),
   replacing the textarea editor; browser specs against the fake API, a real-app spec against the
   stand-in server.
4. **Docs:** `docs/IMPORT-SHOT-PACKS.md`, `docs/IMPORT-ADAPTERS.md`, the README and the changelog.
