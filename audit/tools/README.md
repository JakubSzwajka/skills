# Pi session analyzer

`analyze.py` answers three historical questions: what repeats, what takes time, and where a child agent spends its wall clock. It uses only the Python 3 standard library and reads Pi logs without changing them.

## Use

```sh
PYTHONDONTWRITEBYTECODE=1 python3 ~/.agents/audit/tools/analyze.py --since 2026-09-09 --html /tmp/agent-report.html
PYTHONDONTWRITEBYTECODE=1 python3 ~/.agents/audit/tools/analyze.py --since 2026-09-09 --json /tmp/agent-report.json
PYTHONDONTWRITEBYTECODE=1 python3 ~/.agents/audit/tools/analyze.py --since 2026-09-02 --until 2026-09-09
```

Dates are inclusive. `--since` defaults to seven days ago and `--until` to today. Use `--sessions-dir PATH` for another Pi log root, `--repo SUBSTR` to select project slugs, or `--session ID-OR-PREFIX` to select one parent conversation. With no output option, the tool prints a compact summary. HTML output is one self-contained, offline page with no JavaScript or remote assets.

## How things get selected

Levels 1 to 3 and 5 select child runs by `_meta.json` file modification date. Their parent rows use the UTC date in the parent filename. Level 4 instead includes a parent session when any transcript activity falls in the requested UTC date range. It reports only the portion inside that range. Level 4 includes children whose start falls in the range. Counts can differ between levels because their source selection rules differ.

## Report levels

1. All child runs: wall time, failures, long-gap categories, cost, and turns.
2. The same measures by agent type, plus the parent orchestrator.
3. Repeated normalized tool calls and the subset classified as wasted.
4. Parent session wall clock: raw elapsed time, active time, removed idle time, child time and cost, parallelism, an elapsed-time split, and a child gantt. Active time removes complete-inactivity gaps over 15 minutes. Parallelism is summed child wall time divided by the union of child run intervals. It is at least 1× when child work exists, and 1× means serial work. The elapsed split gives human wait first priority, then child activity, then dead air, with the remainder classed as parent-only time.
5. Child life: orientation, doing, and reporting totals and shares overall, by agent, and for every run. It also lists the 30 slowest tool calls or model stalls and attributes stalls by agent and model.

## Measurement notes

- Child runs are included by `_meta.json` file modification date. Parent sessions are included by the UTC timestamp in their filename. This is an approximation required by the source formats; child mtime can differ slightly from transcript event time.
- Real child wall time is measured from the first to last valid transcript timestamp. It does not use `durationMs`. A missing or unreadable transcript contributes zero wall time.
- Level 4 assigns a child to the parent in the same project whose activity window contains the child's start. If long-lived sessions overlap, the latest-starting containing session wins. The report gives an unattributed count and reason breakdown for children with no match.
- Level 4 clips session windows, child intervals, active time, elapsed time, and gantt labels to the requested range. No level 4 time figure includes activity outside that window.
- Human wait is an open `ask_user_question` call. Dead air is a parent event gap over five minutes with no parent tool in flight. The four elapsed categories are exclusive and sum to session elapsed time.
- The gantt is scaled to the in-range parent elapsed time. Failed children use a striped marker. Each track clips at the session and requested-range boundaries.
- Orientation ends at the first `edit`/`write`, or at the first source-changing `bash` when no edit exists. Doing continues through the last `edit`, `write`, or `bash`; reporting is the remainder. A run with only reads and read-only shell commands is explicitly reported as read-only with no doing phase.
- A model stall is a transcript event gap over 60 seconds with no tool call in flight. Slow-operation arguments include commands, paths, and search patterns only; write content and prompt text are omitted.
- Failure count is run-level (`exitCode`); the taxonomy is failed-attempt-level because one run may try more than one provider.
- Parent logs do not expose a final exit code or aggregate cost/turn count, so the orchestrator row reports those fields as zero.

## Repeated-work rule

Normalized keys are command plus run `cwd` for `bash`, path for `read`/`ls`, and pattern plus path for `grep`/`find`. For an absolute write/edit target, the analyzer resolves Git root from the target path; relative targets use the run `cwd`. It loads that repository's current-HEAD history once with `git log` and maps call time to the newest commit at or before it. Missing/non-Git directories use `sha: unknown`.

A repeat is **wasted** only if the immediately prior identical call has the same mapped HEAD and no `write` or `edit` call touched that repository after the prior call ended and before the repeat began. It is **informative** when HEAD changed, an intervening write/edit occurred, or the resolved repository differs. Wasted minutes are the measured durations of wasted repeat calls. Incomplete calls have zero measured duration.
