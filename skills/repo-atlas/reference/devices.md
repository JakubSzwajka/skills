# Devices

Six things that carried more weight than any individual section. They are
independent of which sections a repo earns, and they are what separates an atlas
from a directory listing.

---

## 1. The refusals column

For every boundary you describe — a workspace, a module, a layer — say what it
**will not do**. Not what it lacks. What it actively refuses even when doing it
would be convenient.

> `apps/site` — Astro, prerendered marketing.
> **Refuses:** Postgres, sessions, proxying the API. That refusal is what keeps it static.

A boundary described only by what it contains is a list. A boundary described by
what it turns away is a decision, and the reader can tell whether the code still
honours it.

**Where refusals come from, in order of preference:**

1. A boundaries or principles doc that states them. Quote it.
2. The module's own README.
3. Derived: what it demonstrably does not import, touch or depend on. Say that this
   is derived, and name the check that supports it.

**Never invent a refusal.** A plausible-sounding one that the code does not honour
is worse than no refusals section, because it will be cited later.

---

## 2. Counts as findings, not decoration

Never write a number you did not just derive from a command. Put the count where
the reader is already looking — in the tree row, in the table cell, in the title.

`"Seven workspaces"` and `"Four domains and a drawer"` are titles that carry a
finding. `"Workspace Inventory"` is a label. Write the finding.

A count that surprises you is a section. `plans` used by **zero** workflows,
`features/` holding **33 test files and not one `.tsx`**, a hooks folder with
**one file** — each of those is a sentence about how the codebase actually behaves,
and none of them required an opinion.

---

## 3. Direction, stated explicitly

Whenever you draw a relationship, say which way it runs — and if two directions
exist, draw them as two marks.

- **Control direction**: who calls whom. Solid arrow.
- **Data direction**: what comes back. Dashed arrow, and only where something does.

Conflating the two is how architecture diagrams imply a cycle the code does not
have. The asymmetry is usually the interesting part: modules that are *asked* for
facts sit on one side, modules that are *told* to act sit on the other, and the
gradient between them is often the actual design.

A matrix records relationships exhaustively but **hides direction by default**.
Either encode direction in the cell, or ship a directed graph alongside it.

---

## 4. The placement lookup

One table, two columns: the thing someone is about to write, and where it goes.

It is the section people return to. It is also the cheapest to get right, because
every row is already implied by the sections above it — you are converting a
description into an instruction.

Include at least one row whose answer is **not a path in this repo**. Task status,
secrets, and deployment state usually live elsewhere, and a row that says so
prevents somebody from helpfully adding a `STATUS.md`.

---

## 5. The known-gaps note

Every atlas ends with what it does not cover. Three lines is enough:

- What the counts were derived from, and at which commit.
- Anything deliberately excluded, and why.
- Any drift found between documentation and code, stated as an observation.

This is not humility decoration. It stops a reader from treating an omission as an
assertion, and it dates the artifact so the next person knows whether to trust it.

---

## 6. Structure that encodes something true

Numbered sections, eyebrows, dividers and colour must carry information or come out.

- Number sections only if the order means something — outside-in, or a real sequence.
- Colour by what a thing *is* (prose / gate / machine / code), not to brighten a page.
- A legend earns its place only when the same encoding repeats. Otherwise put the
  meaning on the mark.

If a structural device would look the same on any repo's atlas, it is decoration.

---

## Anti-patterns

**A diagram of a fiction.** If the service has no layers and everything lives in
`routes/`, that is the finding. Draw what is there, not what the framework's
tutorial implies.

**Sections that exist because the template lists them.** A trigger that is false
means the section does not exist for this repo. Twenty empty boxes are worse than
six full ones.

**Prose that restates the diagram.** The figure shows the mechanism; the caption
states the one claim it supports; the body text says what follows from it. If a
paragraph could be deleted with nothing lost, delete it.

**A tree dump.** `tree -L 3` pasted into a page is not a map. Every row needs a
note saying what the directory is for, and rows the reader does not need should
not be there at all.
