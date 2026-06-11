#!/usr/bin/env python3
"""Validate a prd-create task folder (or a single prd.md) against the canonical
format in references/prd-format.md and references/task-format.md.

Usage:
  validate_prd.py <task-folder>      # validates prd.md + tasks.md + log.md
  validate_prd.py <path-to-prd.md>   # validates just the PRD

Exits non-zero and lists every problem if anything is off, so the skill can
self-check and fix before handoff. The goal is a mechanically executable
tasks.md: execution/AFK automation can only run a subtask when it can read all 8 fields
and trust an explicitly-empty `blockers`.
"""
import os
import re
import sys

PRD_SECTIONS = ["Problem", "Goal", "Scope", "Acceptance Criteria",
                "Key Cases", "Out of Scope", "Stop Conditions", "Collateral", "Notes"]
COLLATERAL_KEYS = ["Tests", "Docs", "Config", "Observability", "Schema"]
TASK_FIELDS = ["status", "deps", "intent", "target", "acceptance",
               "verification", "evidence", "blockers"]
VALID_STATUSES = {"open", "in_progress", "review", "done", "cancelled"}

errors, warns = [], []


def section_body(text, name):
    m = re.search(rf"^##\s+{re.escape(name)}\b(.*?)(^##\s+|\Z)", text, re.M | re.S)
    return m.group(1) if m else None


def check_prd(prd):
    if not re.search(r"^# \S", prd, re.M):
        errors.append("prd.md: missing H1 title (expected '# <Title>')")
    for s in PRD_SECTIONS:
        if not re.search(rf"^##\s+{re.escape(s)}\b", prd, re.M):
            errors.append(f"prd.md: missing required section '## {s}'")
    coll = section_body(prd, "Collateral") or ""
    for k in COLLATERAL_KEYS:
        if not re.search(rf"\b{k}\b", coll, re.I):
            errors.append(f"prd.md: Collateral is missing '{k}'")
    stop = section_body(prd, "Stop Conditions") or ""
    if not re.search(r"Ask (the )?(user|owner)", stop, re.I):
        warns.append("prd.md: Stop Conditions has no 'Ask user/owner' boundary")
    if not re.search(r"Move to review when", stop, re.I):
        warns.append("prd.md: Stop Conditions has no 'Move to review when' line")
    n = prd.count("\n") + 1
    if n > 300:
        errors.append(f"prd.md is {n} lines — hard cap is 300")
    elif n > 250:
        warns.append(f"prd.md is {n} lines — recommended max is 250")


def check_tasks(tasks):
    if not re.search(r"^# Tasks\b", tasks, re.M):
        errors.append("tasks.md: missing '# Tasks' heading")
    if not re.search(r"^Overall status:", tasks, re.M):
        errors.append("tasks.md: missing 'Overall status:' line")
    heads = list(re.finditer(r"^##\s+(T\d+)\b.*$", tasks, re.M))
    if not heads:
        errors.append("tasks.md: no subtasks found (expected '## T1', '## T2', ...)")
        return
    ids = {h.group(1) for h in heads}
    for i, h in enumerate(heads):
        tid = h.group(1)
        body = tasks[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(tasks)]
        for f in TASK_FIELDS:
            if not re.search(rf"^[\s-]*{f}:", body, re.M):
                errors.append(f"tasks.md: {tid} is missing field '{f}:'")
        sm = re.search(r"^[\s-]*status:\s*(\S+)", body, re.M)
        if sm and sm.group(1) not in VALID_STATUSES:
            errors.append(f"tasks.md: {tid} has invalid status '{sm.group(1)}' "
                          f"(use {'|'.join(sorted(VALID_STATUSES))})")
        dm = re.search(r"deps:\s*\[([^\]]*)\]", body)
        if dm:
            for dep in re.findall(r"T\d+", dm.group(1)):
                if dep not in ids:
                    errors.append(f"tasks.md: {tid} dep '{dep}' matches no defined task")


def main():
    if len(sys.argv) != 2:
        print("usage: validate_prd.py <task-folder|prd.md>", file=sys.stderr)
        sys.exit(2)
    arg = sys.argv[1]
    if os.path.isdir(arg):
        prd_p, tasks_p, log_p = (os.path.join(arg, f) for f in ("prd.md", "tasks.md", "log.md"))
    else:
        prd_p, tasks_p, log_p = arg, None, None

    if not os.path.isfile(prd_p):
        errors.append(f"prd.md not found at: {prd_p}")
    else:
        check_prd(open(prd_p, encoding="utf-8").read())
    if tasks_p is not None:
        if not os.path.isfile(tasks_p):
            errors.append(f"tasks.md not found at: {tasks_p}")
        else:
            check_tasks(open(tasks_p, encoding="utf-8").read())
        if not os.path.isfile(log_p):
            errors.append(f"log.md not found at: {log_p}")

    for e in errors:
        print(f"ERROR: {e}")
    for w in warns:
        print(f"WARN: {w}")
    if errors:
        print(f"Validation FAILED: {len(errors)} error(s), {len(warns)} warning(s)")
        sys.exit(1)
    if warns:
        print(f"Validation passed with {len(warns)} warning(s)")
    print(f"OK: {arg}")


if __name__ == "__main__":
    main()
