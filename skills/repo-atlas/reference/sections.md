# Section catalogue

Twenty sections in two lanes. **None is mandatory.** Each carries a trigger; if the
trigger is false, the section does not exist for that repo and emitting it produces
filler. A small library might earn six sections. A monorepo with module boundaries
might earn all twenty.

Each entry gives four things:

- **Asks** — the one question a reader brings to that section.
- **From** — where the answer is derived. Always a command or a file, never memory.
- **Form** — the visual device from `assets/base.css`.
- **Only if** — the trigger.

Titles are written fresh per repo. `"Seven workspaces"` and `"Four domains and a
drawer"` read as findings because they carry the real count. `"Workspace Inventory"`
reads as a header. Write the finding.

---

## Lane A — where things are

### A1 · Entry points

- **Asks** Where do I start reading, and is there more than one door?
- **From** Root-level tracked files. `git ls-files | awk -F/ 'NF==1'`.
- **Form** `.tbl-wrap` table, path + job.
- **Only if** Always. Every repo has an entry story, even if the finding is "there
  is no door, the README is a badge wall."
- **The finding to look for** The ratio of prose to config at the root, and whether
  a second audience (agents, contributors, operators) has its own door.

### A2 · Annotated tree

- **Asks** What is here?
- **From** `git ls-files | awk -F/ 'NF>1{print $1}' | sort | uniq -c | sort -rn`.
- **Form** `.tree`, one row per top-level entry, with per-row counts.
- **Only if** Always. This is the spine of the whole artifact.
- **Colour by what a directory *is*, not where it sits**: `prose` (you read it),
  `gate` (it enforces something), `machine` (generated, not read), default (code).
  That classification is usually more useful than the alphabet.

### A3 · Workspace inventory

- **Asks** What are the deployable or publishable units?
- **From** `package.json` workspaces, `go.work`, `Cargo.toml` members, `pyproject`
  — whatever the ecosystem uses. Plus per-unit file counts.
- **Form** `.tbl-wrap` table: unit, files, what it is, **what it may not do**.
- **Only if** The repo has more than one unit. A single-package repo skips this and
  folds the description into A2.
- The refusal column is the one worth the effort. See `devices.md`.

### A4 · Source trees of the biggest units

- **Asks** Inside the units that matter, where does code live?
- **From** `git ls-files <unit>/src | awk -F/ ...` per unit.
- **Form** `.pair` holding two `.tree` blocks side by side.
- **Only if** One or two units dominate the file count. Three or more trees is a
  wall; pick the two that carry the work and say so.

### A5 · Docs organization

- **Asks** Where does written knowledge live, and what happens to it when code changes?
- **From** The docs tree, plus any docs README that states the scheme.
- **Form** Table of domains with counts, then a second table for the *kind* test if
  the repo has one (door / law / truth / work / machine / data / archive).
- **Only if** `docs/` exists and has internal structure. A flat `docs/` folder with
  nine files does not need a taxonomy section.

### A6 · Agent and tooling surface

- **Asks** How do agents and tooling work in this repo, and which files are generated?
- **From** Dot-directories: `.ai/`, `.agents/`, `.claude/`, `.cursor/`, `.github/`,
  generated contracts, lockfiles for skills or codegen.
- **Form** Table: path, kind, what it holds.
- **Only if** These directories exist and are non-trivial.
- **Say which files are generated**, because the reader's instinct is to edit them.

### A7 · Placement lookup

- **Asks** I am about to write a new thing. Where does it go?
- **From** The conventions found in A1–A6 plus any architecture principles doc.
- **Form** `table.lookup`, two columns: "you are writing…" → "it goes in".
- **Only if** Always. **This is the highest-value section in the artifact.** If time
  runs short, cut something else.
- Include at least one row whose answer is *not a path* — status, task state, and
  secrets usually belong somewhere outside the repo, and saying so prevents a mess.

### A8 · Enforcement and gates

- **Asks** What will stop me if I get this wrong?
- **From** CI workflow jobs, pre-commit hooks, the `check`/`lint`/`verify` scripts
  in the package manifest, and any custom gate scripts.
- **Form** Table: gate → what it refuses. Plus a `.callout` for any gate that is a
  human rather than a script.
- **Only if** Always. A repo with no gates is itself the finding — report it plainly.
- **Read what each gate actually enforces**, not its name. A script called
  `check-docs` might enforce a line limit and link resolution, which is worth
  stating exactly, because those are the two ways a contributor trips over it.

---

## Lane B — how it runs

### B1 · System context

- **Asks** Who talks to this system, and what does it talk to?
- **From** Auth config, outbound clients, webhook handlers, env var names for third
  parties, existing architecture docs.
- **Form** `figure` with hand-authored SVG. Actors left, system centre, externals right.
- **Only if** The repo is a running system rather than a library.

### B2 · Containers

- **Asks** What are the deployed pieces, and what talks to what?
- **From** Dockerfiles, compose files, deploy workflows, the workspace list.
- **Form** SVG with a dashed boundary around the owned system.
- **Only if** More than one deployable piece.
- **Distinct from A3.** A3 lists *source units*; B2 shows *running processes and
  stores* and the edges between them. A unit that never deploys belongs in A3 only.

### B3 · Layer cake

- **Asks** What are the layers on the server side, and what may each one do?
- **From** The source tree of the main service plus any principles doc.
- **Form** Top-to-bottom SVG stack, plus a `.callout` listing what the outermost
  layer may never do.
- **Only if** The service has named layers. If everything is in `routes/`, that is
  the finding and it belongs in one honest sentence, not a diagram of a fiction.

### B4 · Read path vs write path

- **Asks** Does reading work differently from writing here?
- **From** Trace one GET and one POST end to end, naming real files.
- **Form** Two-lane comparison SVG with a divider.
- **Only if** The two paths genuinely differ. If every request goes through the same
  controller, skip it — a comparison of identical things is noise.

### B5 · Module inventory and refusals

- **Asks** What are the capability boundaries, and what does each one refuse?
- **From** Module folders, their READMEs, any boundaries doc.
- **Form** `.cards` grid, `.owns` and `.refuses` lists per module.
- **Only if** The repo has named module boundaries with documented ownership.
- If refusals are not written down anywhere, **do not invent them**. Derive them
  from what the module demonstrably does not import or touch, and say that is the
  basis. See `devices.md`.

### B6 · Module internal shape

- **Asks** What is public in a module, and what is sealed?
- **From** `index.ts` / `mod.rs` / `__init__.py` exports versus internal folders.
- **Form** SVG: callers on the left, public doorway, a wall, internals on the right,
  plus one refused edge drawn crossed.
- **Only if** There is a public/private convention. Verify it holds — grep for
  imports that cross the wall before drawing the wall.

### B7 · Data ownership

- **Asks** Which table, collection or store belongs to which part of the code?
- **From** Schema files and migrations, matched against module repositories.
- **Form** Ledger rows: owner → the stores it owns, with a note per row.
- **Only if** There is a database or persistent store.
- **Mark shared or split ownership explicitly** — those rows are where the real
  design tension lives, and hiding them makes the map a lie.

### B8 · Client-side layers

- **Asks** How is the frontend split, and why there?
- **From** The client source tree plus the test file distribution.
- **Form** Top-to-bottom SVG stack.
- **Only if** There is a client app.
- **Test counts prove the seam.** If the split claims logic is testable without a
  renderer, count the test files and their extensions to show it.

### B9 · Core state machine

- **Asks** What is the one lifecycle everything else serves?
- **From** The status enum, plus every guard that permits or refuses a transition.
- **Form** SVG state diagram: states, labelled transitions, terminals, and any way back.
- **Only if** A dominant entity has a status field with real transition rules.
- **Read every transition guard**, including the ones that run on a timer or a
  sweep. A lifecycle diagram that misses a scheduled transition is wrong.

### B10 · Directed dependency graph

- **Asks** Which way do the calls point?
- **From** Imports between modules, and the declared dependencies of each workflow.
- **Form** SVG. Sort nodes by whether they are asked for facts, told to act, or both.
- **Only if** There are several modules and any composition layer.
- **Two directions, drawn separately.** Solid arrow for the call, dashed for what
  comes back. Conflating them implies a cycle the code may not have.
- **A zero is a finding.** If no module imports another, say so first and loudly —
  it means the graph lives one layer up and the reader should look there.

### B11 · Dependency matrix

- **Asks** Exhaustively, which workflow touches which module, and how?
- **From** Declared dependencies per workflow, then classify each as ask / tell / both.
- **Form** `table.matrix`, workflows down, modules across, totals in `tfoot`.
- **Only if** B10 exists and the reader will want the register behind it.
- The matrix is the reference; **the graph is what people read.** Ship the graph
  first. A matrix alone hides direction, which is exactly the complaint it earns.

### B12 · One workflow close-up

- **Asks** What does a single edge actually look like in code?
- **From** Read the busiest workflow line by line.
- **Form** SVG sequence with a transaction or commit line through the middle.
- **Only if** B10 or B11 exists.
- Pick a workflow whose **ordering encodes a rule** — something that commits
  together, or something deliberately allowed to fail. That is what makes the
  close-up worth a section instead of a paragraph.

---

## Sections worth adding that the first two artifacts lacked

These were gaps found after the fact. Treat them as first-class.

### A9 · Test topology

- **Asks** Where do tests live, what kind are they, and how do they get their world?
- **From** Test file locations and extensions, the test runner config, any fixture
  or container provisioning in test setup.
- **Form** Table: kind, where, how many, how it provisions.
- **Only if** Always, unless there are no tests — which is itself worth one line.

### A10 · Environment and configuration

- **Asks** What must be set for this to run, and where is the schema?
- **From** `.env.example` files, config schema, secrets referenced in CI.
- **Form** Table: variable group, who needs it, what breaks without it.
- **Only if** The repo needs configuration to run.
- **Never print secret values.** Names only.

### A11 · Build and release path

- **Asks** How does a commit become something running?
- **From** Dockerfiles, CI workflows, deploy scripts, tags and release automation.
- **Form** Left-to-right SVG: commit → CI → artifact → environment, with the gate
  on each arrow.
- **Only if** The repo deploys or publishes.
- **Name the point of no return** — the step after which a change is live, and
  whether a human stands there.

### B13 · External integrations

- **Asks** What outside services does this depend on, and what breaks if each dies?
- **From** SDK dependencies, client wrappers, webhook routes, third-party env vars.
- **Form** Table: service, what it does here, blast radius if unavailable.
- **Only if** There is more than one external dependency.

### B14 · Language pointer

- **Asks** What do the words in this codebase mean?
- **From** A glossary file, a domain model doc, or naming conventions in code.
- **Form** A short `.note` pointing at the real glossary, plus any term whose code
  name differs from its product name.
- **Only if** A glossary exists, or a name mismatch would mislead a reader. Do not
  write a glossary from scratch here — point at the one that must stay authoritative.
