# Incoming-request tracker: Local Markdown

Central specs and local implementation tickets live under `~/.pi/specs/`. New specs never use `.scratch/`.

## Central spec conventions

- One spec folder: `~/.pi/specs/<YYYY-MM-DD>_<feature-slug>/`.
- Required metadata: `spec.json` with `schemaVersion: 1`, a non-empty `title`, and `status: pending|done`.
- `completedAt` is present only while status is `done`.
- Required intent: `SPEC.md`.
- Write `USER_STORIES.md` when the spec has user stories.
- Create `tickets/`, `research/`, `prototypes/`, and `log/` only when used.
- `/to-spec` creates the folder as pending. `/spec:status pending|done` is the only spec lifecycle control.
- `/spec` lists all pending specs and done specs completed within 72 hours. A mounted spec stays mounted regardless of status or age.

Ticket status, acceptance boxes, and blockers can describe or guide a ticket. They never set spec status, and `/spec` ignores them.

## Local ticket conventions

- Store one implementation ticket per file at `<central-spec>/tickets/<NN>-<slug>.md`, numbered from `01` in dependency order.
- Do not create a combined tickets file.
- A `Status:` line may describe a ticket when a triage flow needs one. It does not describe the spec.
- Comments and request history may append under `## Comments` in that ticket.
- These files are canonical and local. Do not mirror or sync them to a remote tracker.

## When a skill says "publish to the issue tracker"

Write a ticket under the selected central spec's `tickets/` directory. If no central spec exists, run `/to-spec` first. Do not create a new `.scratch` record.

## When a skill says "fetch the relevant ticket"

Read the exact central ticket path supplied by the user or master brief.

## Wayfinding operations

Used by `/wayfinder`. Keep the map and its decision tickets under the selected central spec without changing spec status.

- **Map**: `<central-spec>/tickets/map.md`, with Notes, Decisions so far, and Fog.
- **Child ticket**: `<central-spec>/tickets/<NN>-<slug>.md`, numbered from `01`, with the question in the body. `Type:` records `research`, `prototype`, `grilling`, or `task`; `Status:` records `claimed` or `resolved` for that ticket only.
- **Blocking**: `Blocked by: NN, NN`. A decision ticket is unblocked when every listed ticket is resolved.
- **Frontier**: choose an open, unblocked, unclaimed decision ticket by number.
- **Claim**: set its ticket status to `claimed` before work.
- **Resolve**: append the answer under `## Answer`, set its ticket status to `resolved`, and add a short pointer to the map's Decisions so far.

Existing `.scratch` records are legacy. Do not migrate, edit, delete, or use them as active spec locations.
