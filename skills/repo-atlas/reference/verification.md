# Verification

An atlas is only useful if its numbers are right, because every number in it reads
as authoritative. These are the checks, and the specific ways this has gone wrong
before.

Run the numbers pass **before** writing, and the claims pass **before** publishing.
Both, every time. Skipping the second one is how four wrong numbers reached a
published page that had already been checked for layout.

---

## Rule 1 — Count the thing, not the files

A directory's file count is not the count of what lives there.

> `readmodels/` holds 11 `.ts` files. It holds **9 readmodels** — the other two are
> a barrel export and a shared row type.

Before stating "N of X", list the members and look at them. Barrels, index files,
type-only modules, test files, fixtures and generated snapshots all inflate a naive
count.

**Check:** if a count came from `ls | wc -l`, it is a file count. Say "files", or
go and count the actual things.

---

## Rule 2 — Read declared dependencies, not call sites

Grepping for `moduleName.` finds where a module is *called*. It misses every place
the dependency is declared and then handed to a helper.

> Counting call sites gave `reminders` **7** workflows. Counting declared
> dependencies gave **10** — three workflows pass the facade straight into a
> shared helper and never call it themselves.

**Check:** derive dependency counts from the type or constructor signature, then
spot-check two workflows by reading them end to end.

---

## Rule 3 — Committed, or somebody's working tree?

A value read off disk may be an uncommitted edit, and reporting it as repo state
turns a colleague's work-in-progress into a fabricated defect.

> `.ai/agentic.config.json` read `"tracker": "notion"`. The committed value was
> `"github"`. The notion line was uncommitted local work.

**Check:** for any config value or file you are about to characterise as
"the repo does X", confirm with `git show HEAD:<path>` and run `git status --short`
once at the start. Describe HEAD; note the dirty tree in the colophon.

---

## Rule 4 — Follow every trigger, including the ones on timers

A lifecycle or flow described only from the request path misses whatever a
scheduler does.

> "Expiry is lazy: nothing sweeps the table" — but a sweep ran hourly, capped at
> 500 rows, and another section of the same artifact listed it. The page
> contradicted itself.

**Check:** grep for timers, cron, queue consumers and background passes. Every
transition they cause belongs in the state section.

---

## Rule 5 — "The most X" needs to be actually the most

Superlatives are claims. `"the busiest row"` was one of five rows tied at the same
size.

**Check:** either verify the superlative or downgrade it to "one of the".

---

## Rule 6 — Never write a number you did not derive

If a number is not in your scrollback attached to the command that produced it, it
is a guess. This has produced invented test-file counts that survived a layout
review because layout review does not check arithmetic.

**Check:** every number in the artifact traces to a command in this session.

---

## The numbers pass

Before writing a single section:

```bash
git rev-parse --short HEAD
git status --short                       # note in-flight work, do not touch it
git ls-files | wc -l                     # total
git ls-files | awk -F/ 'NF==1'           # root files
git ls-files | awk -F/ 'NF>1{print $1}' | sort | uniq -c | sort -rn
```

Then per unit that will get a section, the same `awk` one level deeper. Keep the
output; every count in the artifact comes from it.

---

## The claims pass

Before publishing, strip the markup and read the prose end to end. Not the layout —
the sentences.

```bash
python3 - <<'PY'
import re, html
s = open('index.html').read()
s = re.sub(r'<style>.*?</style>', '', s, flags=re.S)
s = re.sub(r'<svg.*?</svg>', '[SVG]', s, flags=re.S)
s = re.sub(r'<(p|h1|h2|h3|div|li|figcaption|section|tr)\b[^>]*>', '\n', s)
s = html.unescape(re.sub(r'<[^>]+>', ' ', s))
print('\n\n'.join(l.strip() for l in re.sub(r'[ \t]+', ' ', s).split('\n') if len(l.strip()) > 3))
PY
```

Read it for four things:

1. **Numbers** — does each one trace to a command?
2. **Contradictions** — does any section deny what another asserts?
3. **Superlatives and absolutes** — "only", "never", "every", "the most". Each is a claim.
4. **Invented specifics** — a number or name with no source is the worst failure mode,
   because it is indistinguishable from a real one.

---

## The render pass

Structure checks are more reliable than screenshots, which go blank on long pages.

```js
// SVG text escaping its viewBox
document.querySelectorAll('svg').forEach((s, i) => {
  const vb = s.viewBox.baseVal;
  s.querySelectorAll('text').forEach(t => {
    const b = t.getBBox();
    if (b.x < vb.x - 1 || b.y < vb.y - 1 ||
        b.x + b.width > vb.x + vb.width + 1 ||
        b.y + b.height > vb.y + vb.height + 1) console.log('overflow', i, t.textContent);
  });
});

// edge labels colliding with node boxes
// page scrolling sideways
document.documentElement.scrollWidth > innerWidth
```

Also confirm: every contents anchor resolves, wide blocks scroll inside their own
container at 375px, and both themes resolve — check a token's computed value with
the viewer set to light and to dark, not just the one you happen to be in.
