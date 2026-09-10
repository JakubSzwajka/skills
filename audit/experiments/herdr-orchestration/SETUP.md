# Experiment: herdr sessions instead of pi-subagents

Trial setup written 2026-09-10. Nothing here has been applied. Run the commands yourself.

Motive: on 2026-09-09 about 250 minutes went to subagent deadline kills, runs marked failed
after delivering a complete handoff, a forked child silently losing its thinking level, and
stale attention pings. See [`../../FINDINGS-2026-09-09.md`](../../FINDINGS-2026-09-09.md).

## What is already backed up

`snapshot/` holds the current state. These files are the entire rollback surface.

| File | What it is |
| --- | --- |
| `pi-agent-settings.json` | `~/.pi/agent/settings.json`, includes the packages list |
| `subagents-model-routing.json` | the `subagents.agentOverrides` block on its own, your per-role model map |
| `AGENTS.md` | global doctrine, has the Delegation section |
| `ORCHESTRATION.md` | delegation detail, written entirely around subagents |
| `agents-pi-settings.json` | `~/.agents/pi/settings.json` |
| `pi-list-before.txt` | installed packages before the switch |

## Switch on

```bash
# 1. install the messaging layer
pi install npm:pi-intercom

# 2. remove the subagent tool
pi uninstall npm:pi-subagents

# 3. confirm
pi list

# 4. restart pi. the extension only connects on session start.
```

The `subagents` block in `~/.pi/agent/settings.json` can stay. It goes inert without the
package and it is the only written record of which model each role used.

## Switch back

```bash
pi install npm:pi-subagents
pi uninstall npm:pi-intercom     # optional, the two coexist fine
cp ~/.agents/audit/experiments/herdr-orchestration/snapshot/AGENTS.md ~/.agents/AGENTS.md
cp ~/.agents/audit/experiments/herdr-orchestration/snapshot/ORCHESTRATION.md ~/.agents/ORCHESTRATION.md
# restart pi
```

If settings got mangled, restore the whole file:

```bash
cp ~/.agents/audit/experiments/herdr-orchestration/snapshot/pi-agent-settings.json ~/.pi/agent/settings.json
```

## The delegation primitive already exists

`lucy start` creates a tab at the repo root, starts a pi agent in it, names it, delivers the
first instruction, and rolls back the process group and tab if startup fails. That is the
spawn half of pi-subagents, already written and tested.

| Need | pi-subagents | herdr + lucy today |
| --- | --- | --- |
| spawn with a brief | `subagent({agent, task})` | `lucy start <repo> "<brief>" --name N --model M` |
| pick a model | `subagents.agentOverrides` | `--model` per call |
| follow up | `action: resume` | `lucy prompt <target> "..."` |
| correct mid-run | `action: steer` | `lucy steer <target> "..."` |
| stop | `action: stop` | `lucy stop <target>` |
| child asks a question | `contact_supervisor` | `intercom` tool, once installed |
| deadline kill | `timeoutMs` | none, and that is the point |
| read the result | return value or `output.md` | `lucy show <target>`, terminal scrape |
| know it finished | native completion wake | poll, or `herdr agent wait --until idle` |
| structured output | `outputSchema`, acceptance | none |
| per-child metrics | `_meta.json` with cost and turns | plain session log |

## The two real gaps

**1. No completion wake.** With subagents the parent is woken. With panes, someone has to
ask. `herdr agent wait <target> --until idle --timeout MS` blocks until the agent is idle,
so the mechanism exists; nothing composes it yet.

**2. No structured return.** `lucy show` scrapes the terminal. That is fine for a human and
poor for a parent that has to act on the result.

Both are solved by the same move, and it is the one the 2026-09-09 findings already asked
for: name the handoff file in the brief, have the child write it, read the file. Then the
return is a real artifact instead of scraped text, and it survives the pane closing.

## Suggested lucy command, not built

```
lucy delegate <repo-root> "<brief>" --handoff <path> [--model M] [--name N] [--wait] [--timeout D]
```

Composes what already exists:

```
lucy start … ──► herdr agent wait --until idle ──► read <handoff> ──► print it, exit non-zero if missing
```

That single command replaces the subagent call, the completion notification and the return
contract. Everything under it is already implemented in `src/herdr.ts`, `src/agent-control.ts`
and `src/commands/start.ts`.

## Doctrine edits the trial needs

Not applied. These are what make the agent actually delegate this way.

- [ ] `AGENTS.md`, Delegation section. Replace child and worktree language with pane and
      session language. Keep every ownership rule; they are transport independent.
- [ ] `ORCHESTRATION.md`. Briefs, ownership, integration and the reviewer/fixer/verifier
      split all survive unchanged. Lanes, `workflowScript`, acceptance and managed worktrees
      do not. Rewrite the Mechanics section, keep the rest.
- [ ] Add the pi-intercom snippet the package README recommends, so sessions know when to
      talk to each other.
- [ ] Every brief must name its handoff file path. Without a structured return this is the
      only way a result survives.

## What breaks and is not worth fixing for a two-day trial

- `pi/extensions/subagent-history/` reads subagent artifacts. Goes quiet.
- `pi/extensions/compact-tools/foreign-row.ts` renders subagent rows. Goes quiet.
- `lucy subagents` and `lucy attention` read pi-subagents lifecycle artifacts. Both break.
- Skills that spawn subagents: `code-review`, `research`, `visualize`, `repo-atlas`,
  `ask-matt`, and the `impeccable` copies under `image-gen/`.

## What breaks and you will feel within an hour

`pi/extensions/task-log/child-binding.ts` carries task identity into a child. A herdr pane is
a separate session, so an attached task does not follow the worker. Expect to hand the task
id to each pane by hand during the trial.

## What will not improve

Measured on 2026-09-09, none of these are caused by pi-subagents:

- 80 min of `WebSocket idle timeout after 300000ms`. That is pi's provider layer, identical
  in any session.
- 636 min, 47% of active time, with no worker running at all. That is the orchestrator.
- 1.22x parallelism. That is planning, not tooling.

Expect the trial to remove the most annoying quarter of the loss. Not the bulk.

## Measurement

By decision, the trial runs blind and is judged by feel. Worth knowing what that costs:
`audit/tools/analyze.py` levels 1, 2, 3 and 5 read `subagent-artifacts/*_meta.json`, which
herdr panes never produce. During the trial those levels see nothing. The pane sessions do
write ordinary pi session logs, so the data is not lost and the tool could be pointed at it
later if the trial looks promising.
