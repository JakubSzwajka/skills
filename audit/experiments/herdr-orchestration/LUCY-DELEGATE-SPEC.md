# lucy delegate: the ceremony it must hide

Spec written 2026-09-10 from a live test drive of herdr-based delegation. Every item
below is something the orchestrator actually hit in one afternoon, not a theoretical
concern.

## What launching one worker costs today

```bash
herdr tab create --workspace w0 --cwd <repo> --label lane --no-focus
  → parse JSON → .result.root_pane.pane_id
herdr agent start <name> --kind pi --pane <id> --timeout 90000 -- --name <n> --model <m>
  → parse JSON → .result.type == "agent_started", check .result.agent.agent_status
herdr agent prompt <name> "<brief>" --wait --until working --timeout 20000
  → parse JSON → .result.type == "agent_prompted"
herdr agent wait <name> --until idle --until done --until blocked --timeout 900000
  → parse JSON, DIFFERENT SHAPE on timeout
lucy show <name> --lines 80
  → raw text, not JSON
read the handoff file
lucy stop <name>            → fails if the agent is not `working`
herdr pane close <id>       → or `tab close`, depending on how you created it
herdr agent list            → grep to prove it is gone
```

Nine calls, four different output shapes, one of them not JSON.

## The traps, each one hit for real

1. **`--until done` is mandatory.** `idle` means ready-for-input *and the tab was seen
   in the focused UI*. A pane you never focused finishes in `done`. Waiting on `idle`
   alone blocks forever. Cost: one abandoned wait, operator had to interrupt.

2. **`wait` has two output shapes.** Success is `{"result":{...}}`. Timeout is
   `{"error":{"code":"timeout","message":...}}`. A parser written against the happy path
   silently yields nulls.

3. **`agent read` is not JSON.** Every other herdr command returns JSON. This one
   returns terminal text. Piping it to a JSON parser fails.

4. **`--timeout` requires `--wait` on `agent prompt`.** lucy passed `--timeout` alone,
   so `lucy start` could not deliver a single brief. Fixed 2026-09-10.

5. **`lucy stop` cannot stop a finished worker.** It demands a `working` session, only
   sends Esc, and never closes a pane. The worker's own smoke test hit
   `stop requires a working Pi session; w0:pY is done` and had to call
   `herdr tab close` by hand.

6. **`agent_pane_busy` is transient.** First `lucy start` attempt failed on it; a retry
   worked. Needs a retry, not an error.

7. **Cleanup path depends on the creation path.** Tab-created workers need
   `herdr tab close`; split-created workers need `herdr pane close`. The caller has to
   remember which it did.

8. **Nothing wakes you.** No completion notification exists. Forgetting to wait means
   finished work sits unread in a pane.

## The command that should replace all of it

```
lucy delegate <repo-root> "<brief>" --handoff <path> [--name N] [--model M]
              [--tools LIST] [--exclude-tools LIST] [--thinking LEVEL]
              [--direction right|down] [--ratio F] [--timeout D] [--keep] [--json]
```

One call. Blocks until the worker is finished. Prints the handoff. Cleans up.

Behaviour:

1. Split the calling pane. Fail clearly if not inside a herdr pane, naming
   `HERDR_PANE_ID`. Never silently create a tab.
2. Start pi with the given model, tool policy and thinking level.
3. Deliver the brief. Retry once on `agent_pane_busy`.
4. Wait for `idle`, `done` or `blocked` together. Never `idle` alone.
5. On `blocked`, return immediately with a distinct exit code and say what it is
   waiting for. A blocked worker is the one case the operator must see at once.
6. On finish, read `--handoff`. Missing file means the lane failed, whatever the
   terminal said.
7. Terminate the process group and close the pane. `--keep` opts out for debugging.
8. Verify nothing is left behind and say so.

Exit codes:

```
0   finished, handoff present, pane closed
1   finished, handoff missing            → lane failed
2   blocked, needs the operator          → pane left open on purpose
3   timed out                            → pane left open on purpose
4   cleanup failed, something is left behind
```

`--json` returns the same facts as a record: name, pane, session id, final state,
handoff path, handoff body, cleanup result.

## Why this shape

The audit of 2026-09-09 measured 250 minutes lost to workers that were killed or whose
returns were discarded, and 47% of active session time with no worker running at all.
Both get worse when launching is nine error-prone calls. The orchestrator writes a brief,
runs one command, and reads a file. That is the whole interface.
