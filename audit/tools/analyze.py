#!/usr/bin/env python3
"""Analyze Pi parent sessions and child-run artifacts without third-party packages."""

from __future__ import annotations

import argparse
import bisect
import collections
import datetime as dt
import html
import json
import os
import re
import statistics
import subprocess
import sys
from pathlib import Path
from typing import Any

UTC = dt.timezone.utc
AGENTS = ("worker", "reviewer", "delegate", "scout", "oracle", "researcher")
BREAKDOWN_ORDER = (
    "model_stall", "bash", "write", "edit", "read", "grep", "find", "ls",
    "supervisor_wait", "other_tool",
)
FAILURE_ORDER = (
    "provider_429", "run_timeout", "tool_timeout", "output_contract",
    "extension_load", "provider_auth", "tool_capability_mismatch",
    "stopped_by_user", "other",
)
UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
PARENT_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T\d{2}-\d{2}-\d{2}-\d{3}Z_([0-9a-f-]+)\.jsonl$",
    re.I,
)


def parse_time(value: Any) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    except ValueError:
        return None


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        with path.open(encoding="utf-8", errors="replace") as source:
            for line in source:
                try:
                    row = json.loads(line)
                    if isinstance(row, dict):
                        rows.append(row)
                except (json.JSONDecodeError, ValueError):
                    continue
    except OSError:
        pass
    return rows


def text_content(message: dict[str, Any]) -> str:
    content = message.get("content") or []
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "".join(
        str(item.get("text") or "")
        for item in content
        if isinstance(item, dict) and item.get("type") == "text"
    )


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    # Nearest-rank matches the baseline's p90 calculation.
    return ordered[max(0, min(len(ordered) - 1, int((len(ordered) * fraction) + 0.999999) - 1))]


def classify_failure(message: Any) -> str:
    value = json.dumps(message) if isinstance(message, (dict, list)) else str(message or "")
    lower = value.lower()
    if "rate_limit" in lower or "rate limit" in lower or re.search(r"\b429\b", lower):
        return "provider_429"
    if "timed out after" in lower or "run timeout" in lower:
        return "run_timeout"
    if "exceeded its timeout" in lower or "tool timeout" in lower:
        return "tool_timeout"
    if ("file-only output was not produced" in lower or "structured output" in lower
            or "structured_output" in lower or "output contract" in lower):
        return "output_contract"
    if "failed to load extension" in lower or "extension load" in lower:
        return "extension_load"
    if "credentials" in lower or "unauthorized" in lower or "authentication" in lower:
        return "provider_auth"
    if "unavailable child tools" in lower or "capability mismatch" in lower:
        return "tool_capability_mismatch"
    if "stopped by user" in lower:
        return "stopped_by_user"
    return "other"


def event_message(row: dict[str, Any]) -> dict[str, Any]:
    message = row.get("message")
    return message if isinstance(message, dict) else {}


def event_time(row: dict[str, Any]) -> dt.datetime | None:
    return parse_time(row.get("timestamp"))


def extract_calls(
    events: list[dict[str, Any]], run_id: str, agent: str, default_cwd: str,
) -> list[dict[str, Any]]:
    calls: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    cwd = default_cwd
    for row in events:
        if isinstance(row.get("cwd"), str):
            cwd = row["cwd"]
        when = event_time(row)
        if when is None:
            continue
        message = event_message(row)
        role = message.get("role")
        if role == "assistant":
            content = message.get("content") or []
            if not isinstance(content, list):
                continue
            for item in content:
                if not isinstance(item, dict) or item.get("type") != "toolCall":
                    continue
                call_id = str(item.get("id") or "")
                if not call_id or call_id in calls:
                    continue
                arguments = item.get("arguments")
                if not isinstance(arguments, dict):
                    arguments = {}
                calls[call_id] = {
                    "id": call_id,
                    "name": str(item.get("name") or "unknown"),
                    "arguments": arguments,
                    "start": when,
                    "end": None,
                    "duration_seconds": 0.0,
                    "run_id": run_id,
                    "agent": agent,
                    "cwd": cwd,
                }
                order.append(call_id)
        elif role == "toolResult":
            call_id = str(message.get("toolCallId") or "")
            call = calls.get(call_id)
            if call is not None and call["end"] is None:
                call["end"] = when
                call["duration_seconds"] = max(0.0, (when - call["start"]).total_seconds())
    return [calls[call_id] for call_id in order]


def gap_breakdown(events: list[dict[str, Any]]) -> tuple[collections.Counter[str], collections.Counter[str]]:
    counts: collections.Counter[str] = collections.Counter()
    seconds: collections.Counter[str] = collections.Counter()
    pending: dict[str, str] = {}
    previous: dt.datetime | None = None
    for row in events:
        when = event_time(row)
        if when is None:
            continue
        if previous is not None:
            gap = (when - previous).total_seconds()
            if gap > 60:
                if pending:
                    tool = next(iter(pending.values()))
                    if tool == "contact_supervisor":
                        bucket = "supervisor_wait"
                    elif tool in BREAKDOWN_ORDER:
                        bucket = tool
                    else:
                        bucket = "other_tool"
                else:
                    bucket = "model_stall"
                counts[bucket] += 1
                seconds[bucket] += gap
        message = event_message(row)
        if message.get("role") == "assistant":
            content = message.get("content") or []
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "toolCall" and item.get("id"):
                        pending[str(item["id"])] = str(item.get("name") or "unknown")
        elif message.get("role") == "toolResult":
            pending.pop(str(message.get("toolCallId") or ""), None)
        previous = when
    return counts, seconds


def first_last(events: list[dict[str, Any]]) -> tuple[dt.datetime | None, dt.datetime | None]:
    times = [stamp for row in events if (stamp := event_time(row)) is not None]
    return (times[0], times[-1]) if times else (None, None)


def parent_date_and_id(path: Path) -> tuple[dt.date, str] | None:
    match = PARENT_RE.match(path.name)
    if not match:
        return None
    return dt.date(int(match[1]), int(match[2]), int(match[3])), match[4]


def parent_files(sessions_dir: Path, since: dt.date, until: dt.date, repo: str | None) -> list[Path]:
    output: list[Path] = []
    if not sessions_dir.is_dir():
        return output
    for project in sessions_dir.iterdir():
        if not project.is_dir() or (repo and repo not in project.name):
            continue
        try:
            paths = project.iterdir()
        except OSError:
            continue
        for path in paths:
            parsed = parent_date_and_id(path)
            if parsed and since <= parsed[0] <= until:
                output.append(path)
    return sorted(output)


def parent_files_with_activity(
    sessions_dir: Path, floor: dt.datetime, ceiling: dt.datetime, repo: str | None,
) -> list[Path]:
    """Find root parent transcripts with at least one event in the requested window."""
    output: list[Path] = []
    if not sessions_dir.is_dir():
        return output
    for project in sessions_dir.iterdir():
        if not project.is_dir() or (repo and repo not in project.name):
            continue
        try:
            paths = project.iterdir()
        except OSError:
            continue
        for path in paths:
            if not path.is_file() or parent_date_and_id(path) is None:
                continue
            if any(
                floor <= stamp < ceiling
                for row in read_jsonl(path)
                if (stamp := event_time(row)) is not None
            ):
                output.append(path)
    return sorted(output)


def all_child_meta_files(sessions_dir: Path, repo: str | None) -> list[Path]:
    output: list[Path] = []
    if not sessions_dir.is_dir():
        return output
    for project in sessions_dir.iterdir():
        if not project.is_dir() or (repo and repo not in project.name):
            continue
        artifact_dir = project / "subagent-artifacts"
        if artifact_dir.is_dir():
            output.extend(artifact_dir.glob("*_meta.json"))
    return sorted(output)


def child_meta_files(sessions_dir: Path, since: dt.date, until: dt.date, repo: str | None) -> list[Path]:
    output: list[Path] = []
    if not sessions_dir.is_dir():
        return output
    for project in sessions_dir.iterdir():
        if not project.is_dir() or (repo and repo not in project.name):
            continue
        artifact_dir = project / "subagent-artifacts"
        if not artifact_dir.is_dir():
            continue
        for path in artifact_dir.glob("*_meta.json"):
            try:
                day = dt.datetime.fromtimestamp(path.stat().st_mtime).date()
            except OSError:
                continue
            if since <= day <= until:
                output.append(path)
    return sorted(output)


def child_meta_files_for_ids(
    sessions_dir: Path, run_ids: set[str], existing: set[Path],
) -> list[Path]:
    """Find referenced children that finished outside the child mtime range."""
    if not run_ids or not sessions_dir.is_dir():
        return []
    output = []
    for project in sessions_dir.iterdir():
        artifact_dir = project / "subagent-artifacts"
        if not artifact_dir.is_dir():
            continue
        for path in artifact_dir.glob("*_meta.json"):
            if path not in existing and path.name.split("_", 1)[0] in run_ids:
                output.append(path)
    return sorted(output)


def load_parents(paths: list[Path]) -> list[dict[str, Any]]:
    output = []
    for path in paths:
        parsed = parent_date_and_id(path)
        if not parsed:
            continue
        events = read_jsonl(path)
        if not events:
            continue
        cwd = str(events[0].get("cwd") or "")
        start, end = first_last(events)
        event_times = [stamp for row in events if (stamp := event_time(row))]
        timeline_start = min(event_times) if event_times else None
        timeline_end = max(event_times) if event_times else None
        calls = extract_calls(events, parsed[1], "orchestrator", cwd)
        gap_counts, gap_seconds = gap_breakdown(events)
        output.append({
            "kind": "parent", "id": parsed[1], "agent": "orchestrator", "path": path,
            "project": path.parent.name, "cwd": cwd, "events": events, "calls": calls,
            "start": start, "end": end, "wall_seconds": max(0.0, (end - start).total_seconds()) if start and end else 0.0,
            "timeline_start": timeline_start, "timeline_end": timeline_end,
            "failed": False, "cost": 0.0, "turns": 0,
            "failure_counts": collections.Counter(), "gap_counts": gap_counts, "gap_seconds": gap_seconds,
        })
    return output


def load_children(paths: list[Path]) -> list[dict[str, Any]]:
    output = []
    for path in paths:
        try:
            meta = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            continue
        if not isinstance(meta, dict):
            continue
        transcript = path.with_name(path.name[:-10] + "_transcript.jsonl")
        events = read_jsonl(transcript)
        run_id = str(meta.get("runId") or path.name.split("_")[0])
        agent = str(meta.get("agent") or "unknown")
        cwd = next((str(row.get("cwd")) for row in events if row.get("cwd")), "")
        start, end = first_last(events)
        calls = extract_calls(events, run_id, agent, cwd)
        gap_counts, gap_seconds = gap_breakdown(events)
        failures: collections.Counter[str] = collections.Counter()
        attempts = meta.get("modelAttempts") or []
        if isinstance(attempts, list):
            for attempt in attempts:
                if isinstance(attempt, dict) and not attempt.get("success"):
                    failures[classify_failure(attempt.get("error") or attempt.get("failureReason") or meta.get("error"))] += 1
        usage = meta.get("usage") or {}
        if not isinstance(usage, dict):
            usage = {}
        output.append({
            "kind": "child", "id": run_id, "agent": agent, "path": path,
            "project": path.parent.parent.name, "cwd": cwd, "events": events, "calls": calls,
            "start": start, "end": end, "wall_seconds": max(0.0, (end - start).total_seconds()) if start and end else 0.0,
            "failed": meta.get("exitCode") != 0, "cost": float(usage.get("cost") or 0),
            "turns": int(usage.get("turns") or 0), "failure_counts": failures,
            "gap_counts": gap_counts, "gap_seconds": gap_seconds, "meta": meta,
            "model": str(meta.get("model") or "unknown"),
        })
    return output


def parent_child_ids(parent: dict[str, Any]) -> set[str]:
    """Read child IDs only from subagent results and native control messages."""
    mentioned: set[str] = set()
    for row in parent["events"]:
        message = event_message(row)
        is_subagent_result = message.get("role") == "toolResult" and message.get("toolName") == "subagent"
        is_native_notice = str(row.get("customType") or "").startswith("subagent")
        if is_subagent_result or is_native_notice:
            mentioned.update(UUID_RE.findall(json.dumps(row, separators=(",", ":"))))
    return mentioned


def scope_session(
    parents: list[dict[str, Any]], children: list[dict[str, Any]], prefix: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    selected = [run for run in parents if run["id"].startswith(prefix) or prefix in run["path"].name]
    if not selected:
        return [], []
    mentioned = set().union(*(parent_child_ids(parent) for parent in selected))
    return selected, [run for run in children if run["id"] in mentioned]


def metric(runs: list[dict[str, Any]]) -> dict[str, Any]:
    walls = [float(run["wall_seconds"]) for run in runs]
    failure_counts: collections.Counter[str] = collections.Counter()
    gap_counts: collections.Counter[str] = collections.Counter()
    gap_seconds: collections.Counter[str] = collections.Counter()
    for run in runs:
        failure_counts.update(run["failure_counts"])
        gap_counts.update(run["gap_counts"])
        gap_seconds.update(run["gap_seconds"])
    failed = sum(bool(run["failed"]) for run in runs)
    return {
        "run_count": len(runs), "failure_count": failed,
        "failure_rate": round(100 * failed / len(runs), 1) if runs else 0.0,
        "wall_minutes": round(sum(walls) / 60, 2),
        "median_minutes": round(statistics.median(walls) / 60, 2) if walls else 0.0,
        "p90_minutes": round(percentile(walls, 0.90) / 60, 2),
        "max_minutes": round(max(walls) / 60, 2) if walls else 0.0,
        "time_breakdown_minutes": {key: round(gap_seconds[key] / 60, 2) for key in BREAKDOWN_ORDER},
        "time_breakdown_events": {key: gap_counts[key] for key in BREAKDOWN_ORDER},
        "failure_taxonomy": {key: failure_counts[key] for key in FAILURE_ORDER},
        "cost_usd": round(sum(float(run["cost"]) for run in runs), 4),
        "turns": sum(int(run["turns"]) for run in runs),
    }


def normalize_call(call: dict[str, Any]) -> str | None:
    name = call["name"]
    args = call["arguments"]
    if name == "bash":
        command = " ".join(str(args.get("command") or "").split())
        return f"bash | {call['cwd']} | {command}" if command else None
    if name in ("read", "ls"):
        path = str(args.get("path") or "")
        return f"{name} | {path}" if path else None
    if name in ("grep", "find"):
        pattern = str(args.get("pattern") or "")
        path = str(args.get("path") or "")
        return f"{name} | {pattern} | {path}" if pattern or path else None
    return None


def git_root(cwd: str, cache: dict[str, str | None]) -> str | None:
    if not cwd:
        return None
    if cwd in cache:
        return cache[cwd]
    try:
        result = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"], capture_output=True,
            text=True, timeout=4, check=False,
        )
        root = result.stdout.strip() if result.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        root = ""
    cache[cwd] = root or None
    return cache[cwd]


def write_repo_root(call: dict[str, Any], cache: dict[str, str | None]) -> str | None:
    """Resolve the repository actually targeted by a write/edit call."""
    raw_path = str(call.get("arguments", {}).get("path") or "")
    if not raw_path:
        return call.get("repo_root")
    target = Path(raw_path).expanduser()
    if not target.is_absolute():
        target = Path(call.get("cwd") or ".") / target
    probe = target if target.is_dir() else target.parent
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    return git_root(str(probe), cache) or call.get("repo_root")


def head_timeline(root: str, cache: dict[str, tuple[list[float], list[str]]]) -> tuple[list[float], list[str]]:
    if root in cache:
        return cache[root]
    rows: list[tuple[float, str]] = []
    try:
        result = subprocess.run(
            ["git", "-C", root, "log", "--format=%H%x09%cI", "--reverse"],
            capture_output=True, text=True, timeout=8, check=False,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                try:
                    sha, stamp = line.split("\t", 1)
                    when = parse_time(stamp)
                    if when:
                        rows.append((when.timestamp(), sha))
                except ValueError:
                    continue
    except (OSError, subprocess.TimeoutExpired):
        pass
    rows.sort()
    cache[root] = ([row[0] for row in rows], [row[1] for row in rows])
    return cache[root]


def sha_at(call: dict[str, Any], timeline_cache: dict[str, tuple[list[float], list[str]]]) -> str:
    root = call.get("repo_root")
    if not root:
        return "unknown"
    stamps, shas = head_timeline(root, timeline_cache)
    index = bisect.bisect_right(stamps, call["start"].timestamp()) - 1
    return shas[index] if index >= 0 else "unknown"


def repeated_work(runs: list[dict[str, Any]]) -> dict[str, Any]:
    all_calls = [call for run in runs for call in run["calls"]]
    root_cache: dict[str, str | None] = {}
    for call in all_calls:
        call["repo_root"] = git_root(call["cwd"], root_cache)
    writes = []
    for call in all_calls:
        if call["name"] in ("write", "edit"):
            call["write_repo_root"] = write_repo_root(call, root_cache)
            if call["write_repo_root"]:
                writes.append(call)
    writes.sort(key=lambda call: call["start"])
    by_key: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    for call in all_calls:
        key = normalize_call(call)
        if key:
            by_key[key].append(call)
    timeline_cache: dict[str, tuple[list[float], list[str]]] = {}
    rows: list[dict[str, Any]] = []
    wasted_seconds = 0.0
    informative_seconds = 0.0
    for key, occurrences in by_key.items():
        if len(occurrences) < 2:
            continue
        occurrences.sort(key=lambda call: call["start"])
        details = []
        wasted = informative = 0
        key_wasted = key_informative = 0.0
        previous: dict[str, Any] | None = None
        for index, call in enumerate(occurrences):
            sha = sha_at(call, timeline_cache)
            classification = "first"
            if previous is not None:
                previous_end = previous["end"] or previous["start"]
                intervening_edit = any(
                    edit["write_repo_root"] == call["repo_root"]
                    and previous_end < edit["start"] < call["start"]
                    for edit in writes
                )
                previous_sha = details[-1]["sha"]
                same_repo = (
                    call["repo_root"] == previous["repo_root"]
                    and (call["repo_root"] is not None or call["cwd"] == previous["cwd"])
                )
                if same_repo and sha == previous_sha and not intervening_edit:
                    classification = "wasted"
                    wasted += 1
                    key_wasted += call["duration_seconds"]
                else:
                    classification = "informative"
                    informative += 1
                    key_informative += call["duration_seconds"]
            details.append({
                "run_id": call["run_id"], "agent": call["agent"],
                "at": call["start"].isoformat(), "duration_minutes": round(call["duration_seconds"] / 60, 3),
                "sha": sha, "repo_root": call["repo_root"] or "unknown", "classification": classification,
            })
            previous = call
        wasted_seconds += key_wasted
        informative_seconds += key_informative
        rows.append({
            "key": key, "occurrence_count": len(occurrences), "wasted_count": wasted,
            "informative_count": informative, "wasted_minutes": round(key_wasted / 60, 3),
            "informative_minutes": round(key_informative / 60, 3), "occurrences": details,
        })
    rows.sort(key=lambda row: (-row["wasted_minutes"], -row["occurrence_count"], row["key"]))
    tool_seconds = sum(float(call["duration_seconds"]) for call in all_calls)
    return {
        "total_wasted_minutes": round(wasted_seconds / 60, 3),
        "total_informative_repeat_minutes": round(informative_seconds / 60, 3),
        "total_tool_minutes": round(tool_seconds / 60, 3),
        "wasted_share_of_tool_time_percent": round(100 * wasted_seconds / tool_seconds, 2) if tool_seconds else 0.0,
        "keys": rows,
    }


def child_runs_by_parent(
    parents: list[dict[str, Any]], children: list[dict[str, Any]],
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    """Associate a child with the latest-starting containing session in its project."""
    output = {parent["id"]: [] for parent in parents}
    reasons: collections.Counter[str] = collections.Counter()
    unattributed = []
    for child in children:
        if child["start"] is None:
            reason = "missing child start"
            matching = []
        else:
            same_project = [parent for parent in parents if parent["project"] == child["project"]]
            matching = [
                parent for parent in same_project
                if (parent.get("timeline_start") or parent["start"])
                and (parent.get("timeline_end") or parent["end"])
                and (parent.get("timeline_start") or parent["start"]) <= child["start"]
                <= (parent.get("timeline_end") or parent["end"])
            ]
            reason = "no parent in project" if not same_project else "start outside parent windows"
        if matching:
            # Long-lived sessions can overlap a newer session in the same project. The
            # latest start is the active conversation at the child's start time.
            parent = max(matching, key=lambda run: run.get("timeline_start") or run["start"])
            output[parent["id"]].append(child)
        else:
            reasons[reason] += 1
            unattributed.append({
                "run_id": child["id"], "project": child["project"], "reason": reason,
                "start": child["start"].isoformat() if child["start"] else None,
            })
    return output, {
        "count": len(unattributed), "reasons": dict(sorted(reasons.items())),
        "children": unattributed,
    }


def merged_intervals(
    intervals: list[tuple[dt.datetime, dt.datetime]],
) -> list[tuple[dt.datetime, dt.datetime]]:
    ordered = sorted((start, end) for start, end in intervals if end > start)
    merged: list[tuple[dt.datetime, dt.datetime]] = []
    for start, end in ordered:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def interval_seconds(intervals: list[tuple[dt.datetime, dt.datetime]]) -> float:
    return sum((end - start).total_seconds() for start, end in merged_intervals(intervals))


def clip_interval(
    start: dt.datetime | None, end: dt.datetime | None,
    floor: dt.datetime, ceiling: dt.datetime,
) -> tuple[dt.datetime, dt.datetime] | None:
    if start is None:
        return None
    clipped = (max(start, floor), min(end or ceiling, ceiling))
    return clipped if clipped[1] > clipped[0] else None


def inactive_intervals(
    parent: dict[str, Any], children: list[dict[str, Any]],
    start: dt.datetime, end: dt.datetime, threshold_seconds: float = 900,
) -> list[tuple[dt.datetime, dt.datetime]]:
    """Return complete-inactivity gaps, treating open tools and children as activity."""
    components = [
        (max(start, stamp), min(end, stamp))
        for row in parent["events"]
        if (stamp := event_time(row)) is not None and start <= stamp <= end
    ]
    components.extend(
        interval for call in parent["calls"] if call["end"] is not None
        and (interval := clip_interval(call["start"], call["end"], start, end))
    )
    components.extend(
        interval for child in children
        if (interval := clip_interval(child["start"], child["end"], start, end))
    )
    components.extend(((start, start), (end, end)))
    components.sort()
    joined: list[tuple[dt.datetime, dt.datetime]] = []
    for left, right in components:
        if joined and left <= joined[-1][1]:
            joined[-1] = (joined[-1][0], max(joined[-1][1], right))
        else:
            joined.append((left, right))
    return [
        (left[1], right[0]) for left, right in zip(joined, joined[1:])
        if (right[0] - left[1]).total_seconds() > threshold_seconds
    ]


def session_time_split(
    parent: dict[str, Any], children: list[dict[str, Any]],
    start: dt.datetime, end: dt.datetime,
) -> dict[str, float]:
    if end <= start:
        return {key: 0.0 for key in ("human_wait", "child_running", "parent_only", "dead_air")}
    human = [
        interval for call in parent["calls"] if call["name"] == "ask_user_question"
        and (interval := clip_interval(call["start"], call["end"], start, end))
    ]
    child_active = [
        interval for child in children
        if (interval := clip_interval(child["start"], child["end"], start, end))
    ]
    # The five-minute split is separate from the 15-minute active-time cutoff.
    parent_tool_intervals = [
        interval for call in parent["calls"]
        if (interval := clip_interval(call["start"], call["end"], start, end))
    ]
    event_times = sorted({
        start, end, *(stamp for row in parent["events"]
                      if (stamp := event_time(row)) is not None and start <= stamp <= end),
    })
    dead_candidates = []
    for left, right in zip(event_times, event_times[1:]):
        if (right - left).total_seconds() <= 300:
            continue
        if not any(tool_start < right and tool_end > left for tool_start, tool_end in parent_tool_intervals):
            dead_candidates.append((left, right))

    boundaries = {start, end}
    for intervals in (human, child_active, dead_candidates):
        for left, right in intervals:
            boundaries.update((left, right))
    ordered = sorted(boundaries)
    seconds = collections.Counter()
    for left, right in zip(ordered, ordered[1:]):
        midpoint = left + (right - left) / 2
        duration = (right - left).total_seconds()
        contains = lambda intervals: any(a <= midpoint < b for a, b in intervals)
        if contains(human):
            seconds["human_wait"] += duration
        elif contains(child_active):
            seconds["child_running"] += duration
        elif contains(dead_candidates):
            seconds["dead_air"] += duration
        else:
            seconds["parent_only"] += duration
    return {key: round(seconds[key] / 60, 3) for key in (
        "human_wait", "child_running", "parent_only", "dead_air",
    )}


def session_wall_clock(
    parents: list[dict[str, Any]], children: list[dict[str, Any]],
    floor: dt.datetime, ceiling: dt.datetime,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    by_parent, unattributed = child_runs_by_parent(parents, children)
    rows = []
    for parent in parents:
        session_children = by_parent[parent["id"]]
        raw_start = parent.get("timeline_start") or parent["start"]
        raw_end = parent.get("timeline_end") or parent["end"]
        if not raw_start or not raw_end:
            continue
        timeline_start = max(raw_start, floor)
        timeline_end = min(raw_end, ceiling)
        if timeline_end <= timeline_start:
            continue
        child_intervals = [
            interval for child in session_children
            if (interval := clip_interval(child["start"], child["end"], timeline_start, timeline_end))
        ]
        child_seconds = sum((end - start).total_seconds() for start, end in child_intervals)
        busy_seconds = interval_seconds(child_intervals)
        factor = child_seconds / busy_seconds if busy_seconds else None
        if factor is not None:
            assert factor >= 1.0 - 1e-12, (
                f"parallelism factor below 1 for session {parent['id']}: {factor}"
            )
        elapsed = (timeline_end - timeline_start).total_seconds()
        idle_seconds = interval_seconds(inactive_intervals(
            parent, session_children, timeline_start, timeline_end,
        ))
        active_seconds = elapsed - idle_seconds
        assert busy_seconds <= active_seconds + 1e-9 <= elapsed + 1e-9, (
            f"invalid session durations for {parent['id']}: "
            f"busy={busy_seconds}, active={active_seconds}, elapsed={elapsed}"
        )
        gantt = []
        for child in sorted(session_children, key=lambda run: (run["start"] or dt.datetime.max.replace(tzinfo=UTC))):
            clipped = clip_interval(child["start"], child["end"], timeline_start, timeline_end)
            if not clipped:
                continue
            offset = 100 * (clipped[0] - timeline_start).total_seconds() / elapsed
            width = 100 * (clipped[1] - clipped[0]).total_seconds() / elapsed
            gantt.append({
                "run_id": child["id"], "agent": child["agent"], "failed": bool(child["failed"]),
                "start": clipped[0].isoformat(), "end": clipped[1].isoformat(),
                "wall_minutes": round((clipped[1] - clipped[0]).total_seconds() / 60, 3),
                "offset_percent": round(max(0.0, min(100.0, offset)), 4),
                "width_percent": round(max(0.0, min(100.0 - offset, width)), 4),
            })
        rows.append({
            "session_id": parent["id"], "project": parent["project"],
            "start": timeline_start.isoformat(), "end": timeline_end.isoformat(),
            "elapsed_minutes": round(elapsed / 60, 3),
            "active_minutes": round(active_seconds / 60, 3),
            "idle_minutes_removed": round(idle_seconds / 60, 3),
            "child_wall_minutes": round(child_seconds / 60, 3),
            "busy_union_minutes": round(busy_seconds / 60, 3),
            "child_span_minutes": round(busy_seconds / 60, 3),
            "parallelism_factor": round(factor, 3) if factor is not None else None,
            "time_split_minutes": session_time_split(parent, session_children, timeline_start, timeline_end),
            "child_count": len(gantt),
            "failure_count": sum(bool(child["failed"]) for child in session_children if clip_interval(
                child["start"], child["end"], timeline_start, timeline_end
            )),
            "cost_usd": round(sum(float(child["cost"]) for child in session_children if clip_interval(
                child["start"], child["end"], timeline_start, timeline_end
            )), 4),
            "children": gantt,
        })
    rows.sort(key=lambda row: (-row["active_minutes"], row["session_id"]))
    return rows, unattributed


BASH_MUTATION_RE = re.compile(
    r"(?:^|[;&|]\s*)(?:sudo\s+)?(?:rm|mv|cp|mkdir|rmdir|touch|chmod|chown|ln|install|patch)\b"
    r"|\b(?:sed|perl)\s+-[^\n;&|]*i\b"
    r"|\bgit\s+(?:add|commit|checkout|switch|reset|restore|clean|merge|rebase|cherry-pick|apply)\b"
    r"|\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update)\b"
    r"|(?<![<>=])>(?![>=])\s*(?!/dev/null\b)", re.I,
)


def bash_is_read_only(command: str) -> bool:
    """Conservatively identify shell commands that do not write files or Git state."""
    return not BASH_MUTATION_RE.search(command)


def phase_shares(values: dict[str, float]) -> dict[str, float]:
    total = sum(values.values())
    if not total:
        return {key: 0.0 for key in ("orientation", "doing", "reporting")}
    first = round(100 * values["orientation"] / total, 1)
    second = round(100 * values["doing"] / total, 1)
    return {"orientation": first, "doing": second, "reporting": round(100.0 - first - second, 1)}


def child_phases(run: dict[str, Any]) -> dict[str, Any]:
    wall = float(run["wall_seconds"])
    start, end = run["start"], run["end"]
    if not start or not end or end <= start:
        seconds = {"orientation": 0.0, "doing": 0.0, "reporting": 0.0}
        return {"seconds": seconds, "minutes": seconds.copy(), "share_percent": phase_shares(seconds), "read_only": True}
    edits = [call for call in run["calls"] if call["name"] in ("edit", "write")]
    mutating_bash = [
        call for call in run["calls"] if call["name"] == "bash"
        and not bash_is_read_only(str(call["arguments"].get("command") or ""))
    ]
    first_doing = min(edits, key=lambda call: call["start"]) if edits else (
        min(mutating_bash, key=lambda call: call["start"]) if mutating_bash else None
    )
    if first_doing is None:
        seconds = {"orientation": wall, "doing": 0.0, "reporting": 0.0}
        read_only = True
    else:
        doing_calls = [
            call for call in run["calls"]
            if call["name"] in ("edit", "write", "bash") and call["start"] >= first_doing["start"]
        ]
        doing_end = max((call["end"] or call["start"] for call in doing_calls), default=first_doing["start"])
        doing_end = min(max(doing_end, first_doing["start"]), end)
        orientation = max(0.0, (first_doing["start"] - start).total_seconds())
        doing = max(0.0, (doing_end - first_doing["start"]).total_seconds())
        seconds = {"orientation": orientation, "doing": doing, "reporting": max(0.0, wall - orientation - doing)}
        read_only = False
    return {
        "seconds": {key: round(value, 3) for key, value in seconds.items()},
        "minutes": {key: round(value / 60, 3) for key, value in seconds.items()},
        "share_percent": phase_shares(seconds), "read_only": read_only,
    }


def argument_summary(call: dict[str, Any], limit: int = 140) -> str:
    args = call["arguments"]
    name = call["name"]
    if name == "bash":
        value = str(args.get("command") or "")
    elif name in ("read", "write", "edit", "ls"):
        value = str(args.get("path") or "")
    elif name in ("grep", "find"):
        value = " | ".join(str(args.get(key) or "") for key in ("pattern", "path") if args.get(key))
    else:
        paths = [str(value) for key, value in args.items() if "path" in key.lower() or key.lower() in ("command", "pattern")]
        value = " | ".join(paths) or "(arguments omitted)"
    value = " ".join(value.split())
    return value if len(value) <= limit else value[:limit - 1] + "…"


def model_stall_operations(run: dict[str, Any]) -> list[dict[str, Any]]:
    stalls = []
    pending: set[str] = set()
    previous: dt.datetime | None = None
    for row in run["events"]:
        when = event_time(row)
        if when is None:
            continue
        if previous is not None and not pending and (when - previous).total_seconds() > 60:
            stalls.append({
                "duration_seconds": (when - previous).total_seconds(), "tool": "model stall",
                "argument": f"{previous.isoformat()} to {when.isoformat()}",
                "run_id": run["id"], "agent": run["agent"], "model": str(run.get("model") or "unknown"),
            })
        message = event_message(row)
        if message.get("role") == "assistant":
            content = message.get("content") or []
            if isinstance(content, list):
                pending.update(
                    str(item["id"]) for item in content
                    if isinstance(item, dict) and item.get("type") == "toolCall" and item.get("id")
                )
        elif message.get("role") == "toolResult":
            pending.discard(str(message.get("toolCallId") or ""))
        previous = when
    return stalls


def child_life(children: list[dict[str, Any]]) -> dict[str, Any]:
    run_rows = []
    totals: collections.Counter[str] = collections.Counter()
    by_agent_seconds: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    operations = []
    stall_by_agent: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    stall_by_model: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    for run in children:
        phases = child_phases(run)
        for key, value in phases["seconds"].items():
            totals[key] += value
            by_agent_seconds[run["agent"]][key] += value
        run_rows.append({
            "run_id": run["id"], "agent": run["agent"], "model": run.get("model") or "unknown",
            "wall_minutes": round(float(run["wall_seconds"]) / 60, 3), **phases,
        })
        for call in run["calls"]:
            operations.append({
                "duration_seconds": float(call["duration_seconds"]), "tool": call["name"],
                "argument": argument_summary(call), "run_id": run["id"],
                "agent": run["agent"], "model": run.get("model") or "unknown",
            })
        for stall in model_stall_operations(run):
            operations.append(stall)
            for key in ("seconds", "count"):
                increment = stall["duration_seconds"] if key == "seconds" else 1
                stall_by_agent[run["agent"]][key] += increment
                stall_by_model[str(run.get("model") or "unknown")][key] += increment
            stall_by_agent[run["agent"]]["max_seconds"] = max(
                stall_by_agent[run["agent"]]["max_seconds"], stall["duration_seconds"]
            )
            stall_by_model[str(run.get("model") or "unknown")]["max_seconds"] = max(
                stall_by_model[str(run.get("model") or "unknown")]["max_seconds"], stall["duration_seconds"]
            )
    phase_keys = ("orientation", "doing", "reporting")
    summarize = lambda values: {
        "minutes": {key: round(values[key] / 60, 3) for key in phase_keys},
        "share_percent": phase_shares({key: values[key] for key in phase_keys}),
    }
    stalls = lambda groups: {
        name: {"count": int(values["count"]), "minutes": round(values["seconds"] / 60, 3),
               "max_minutes": round(values["max_seconds"] / 60, 3)}
        for name, values in sorted(groups.items())
    }
    operations.sort(key=lambda operation: -operation["duration_seconds"])
    for operation in operations:
        operation["duration_minutes"] = round(operation.pop("duration_seconds") / 60, 3)
    run_rows.sort(key=lambda row: (-row["wall_minutes"], row["run_id"]))
    return {
        "totals": summarize(totals),
        "by_agent": {agent: summarize(values) for agent, values in sorted(by_agent_seconds.items())},
        "runs": run_rows, "slowest_operations": operations[:30],
        "model_stalls_by_agent": stalls(stall_by_agent),
        "model_stalls_by_model": stalls(stall_by_model),
    }


def build_report(
    sessions_dir: Path, since: dt.date, until: dt.date, repo: str | None, session: str | None,
) -> dict[str, Any]:
    floor = dt.datetime.combine(since, dt.time.min, tzinfo=UTC)
    ceiling = dt.datetime.combine(until + dt.timedelta(days=1), dt.time.min, tzinfo=UTC)
    level4_parents = load_parents(parent_files_with_activity(sessions_dir, floor, ceiling, repo))
    level4_children = [
        child for child in load_children(all_child_meta_files(sessions_dir, repo))
        if child["start"] is not None and floor <= child["start"] < ceiling
    ]
    parents = load_parents(parent_files(sessions_dir, since, until, repo))
    children = load_children(child_meta_files(sessions_dir, since, until, repo))
    if session:
        parents, children = scope_session(parents, children, session)
    if not parents and not children and not level4_parents:
        raise RuntimeError("no Pi session data matched the requested range and filters")
    sessions, unattributed = session_wall_clock(
        level4_parents, level4_children, floor, ceiling,
    )
    if session:
        sessions = [
            row for row in sessions
            if row["session_id"].startswith(session)
        ]
    all_runs = children + parents
    by_agent = {agent: metric([run for run in children if run["agent"] == agent]) for agent in AGENTS}
    extra_agents = sorted({run["agent"] for run in children} - set(AGENTS))
    by_agent.update({agent: metric([run for run in children if run["agent"] == agent]) for agent in extra_agents})
    by_agent["orchestrator (parent)"] = metric(parents)
    return {
        "schema_version": 1,
        "range": {"since": since.isoformat(), "until": until.isoformat(), "inclusive": True},
        "filters": {"repo": repo, "session": session},
        "source": str(sessions_dir),
        "level_1_all_children": metric(children),
        "level_2_by_agent": by_agent,
        "level_3_repeated_work": repeated_work(all_runs),
        "level_4_session_wall_clock": sessions,
        "level_4_unattributed_children": unattributed,
        "level_5_child_life": child_life(children),
        "parent_session_count": len(parents),
        "level_4_parent_session_count": len(sessions),
        "notes": [
            "Levels 1–3 and 5 select children by _meta.json file mtime; level 4 selects parent sessions and children by in-range activity.",
            "Child wall time is the first-to-last transcript timestamp; missing transcripts contribute zero wall time.",
            "Failure taxonomy counts failed model attempts, while failure count counts child runs with non-zero or missing exitCode.",
            "Parent cost, turns, and failure state are unavailable in parent session logs and are reported as zero.",
            "Level 4 assigns each child to the latest-starting parent session in the same project whose activity window contains the child's start; unmatched children are reported explicitly.",
            "Level 4 clips session and child intervals to the requested UTC date range. Active time removes complete-inactivity gaps over 15 minutes.",
            "Dead air is a parent event gap over five minutes with no parent tool in flight; human-wait and child-running intervals take priority in the elapsed-time split.",
            "Phase boundaries use source-changing shell commands as doing; a run with only reads and read-only shell commands is reported as read-only with no doing phase.",
        ],
    }


def fmt(value: Any, digits: int = 1) -> str:
    if isinstance(value, float):
        return f"{value:,.{digits}f}"
    return f"{value:,}" if isinstance(value, int) else str(value)


def bar_html(values: dict[str, float]) -> str:
    total = sum(values.values()) or 1
    colors = {
        "model_stall": "#ef8354", "bash": "#4f86c6", "write": "#66a182", "edit": "#87b37a",
        "read": "#9b7ede", "grep": "#b084cc", "find": "#cb997e", "ls": "#ddbea9",
        "supervisor_wait": "#e0a458", "other_tool": "#8d99ae",
    }
    segments = "".join(
        f'<span title="{html.escape(key)}: {value:.1f} min" style="width:{100*value/total:.3f}%;background:{colors[key]}"></span>'
        for key, value in values.items() if value > 0
    )
    legend = " ".join(
        f'<span><i style="background:{colors[key]}"></i>{html.escape(key.replace("_", " "))} {value:.1f}m</span>'
        for key, value in values.items() if value > 0
    ) or "<span>No gaps over 60 seconds</span>"
    return f'<div class="bar">{segments}</div><div class="legend">{legend}</div>'


def metric_card(title: str, data: dict[str, Any]) -> str:
    failures = " · ".join(
        f'{key.replace("_", " ")} <b>{count}</b>'
        for key, count in data["failure_taxonomy"].items() if count
    ) or "none"
    return f'''<section class="metric-card">
<h3>{html.escape(title)}</h3>
<div class="numbers"><b>{data['run_count']}</b> runs · <b>{data['failure_count']}</b> failed ({data['failure_rate']:.1f}%) · <b>{data['wall_minutes']:.1f}</b> wall min<br>
median {data['median_minutes']:.1f} · p90 {data['p90_minutes']:.1f} · max {data['max_minutes']:.1f} min · ${data['cost_usd']:.2f} · {data['turns']} turns</div>
{bar_html(data['time_breakdown_minutes'])}
<div class="taxonomy"><b>Failed attempts:</b> {failures}</div>
</section>'''


AGENT_COLORS = {
    "worker": "#287271", "reviewer": "#8f5aa2", "delegate": "#d17b49",
    "scout": "#4f86c6", "oracle": "#bd4f6c", "researcher": "#6b8e23",
    "unknown": "#7b8794",
}


def elapsed_label(minutes: float) -> str:
    hours, mins = divmod(int(round(minutes)), 60)
    return f"{hours}h {mins:02d}m" if hours else f"{mins}m"


def phase_bar_html(shares: dict[str, float]) -> str:
    colors = {"orientation": "#9b7ede", "doing": "#287271", "reporting": "#e0a458"}
    segments = "".join(
        f'<span title="{key}: {value:.1f}%" style="width:{value:.1f}%;background:{colors[key]}"></span>'
        for key, value in shares.items() if value > 0
    )
    legend = " ".join(
        f'<span><i style="background:{colors[key]}"></i>{key} {value:.1f}%</span>'
        for key, value in shares.items()
    )
    return f'<div class="bar">{segments}</div><div class="legend">{legend}</div>'


def session_card(row: dict[str, Any]) -> str:
    split = row["time_split_minutes"]
    total = sum(split.values()) or 1
    split_colors = {
        "human_wait": "#e0a458", "child_running": "#287271",
        "parent_only": "#4f86c6", "dead_air": "#ef8354",
    }
    segments = "".join(
        f'<span title="{key.replace("_", " ")}: {value:.1f} min" style="width:{100*value/total:.3f}%;background:{split_colors[key]}"></span>'
        for key, value in split.items() if value > 0
    )
    legend = " ".join(
        f'<span><i style="background:{split_colors[key]}"></i>{key.replace("_", " ")} {value:.1f}m</span>'
        for key, value in split.items()
    )
    gantt_rows = []
    for child in row["children"]:
        color = AGENT_COLORS.get(child["agent"], AGENT_COLORS["unknown"])
        failed = " failed" if child["failed"] else ""
        marker = " ×" if child["failed"] else ""
        gantt_rows.append(f'''<div class="gantt-row"><div class="gantt-label" title="{html.escape(child['run_id'])}">
<span class="agent-dot" style="background:{color}"></span>{html.escape(child['agent'])} · {child['run_id'][:8]} · {child['wall_minutes']:.1f}m{marker}</div>
<div class="gantt-track"><span class="gantt-run{failed}" title="{html.escape(child['agent'])} {html.escape(child['run_id'])}: {child['wall_minutes']:.1f} min" style="left:{child['offset_percent']:.4f}%;width:{child['width_percent']:.4f}%;background:{color}"></span></div></div>''')
    if not gantt_rows:
        gantt_rows.append('<p class="sub">No child started in this session during the requested range.</p>')
    parallelism = f"{row['parallelism_factor']:.2f}×" if row["parallelism_factor"] is not None else "n/a"
    return f'''<section class="session-card"><div class="session-head"><div><h3>{html.escape(row['project'])}</h3>
<code>{html.escape(row['session_id'])}</code></div><b>{elapsed_label(row['active_minutes'])} active</b></div>
<div class="session-numbers"><b>{row['child_count']}</b> children · <b>{row['failure_count']}</b> failed · ${row['cost_usd']:.2f} · {row['child_wall_minutes']:.1f} child min · parallelism <b>{parallelism}</b><br>
{row['elapsed_minutes']:.1f} elapsed min · {row['idle_minutes_removed']:.1f} idle min excluded · {row['busy_union_minutes']:.1f} child busy min</div>
<div class="bar split-bar">{segments}</div><div class="legend">{legend}</div>
<div class="gantt">{''.join(gantt_rows)}</div></section>'''


def render_html(report: dict[str, Any]) -> str:
    level1 = report["level_1_all_children"]
    level2 = report["level_2_by_agent"]
    repeated = report["level_3_repeated_work"]
    sessions = report["level_4_session_wall_clock"]
    unattributed = report["level_4_unattributed_children"]
    child_life_data = report["level_5_child_life"]
    agent_rows = "".join(metric_card(name, values) for name, values in level2.items())
    repeat_rows = []
    for row in repeated["keys"][:100]:
        actors = ", ".join(sorted({f"{item['agent']}:{item['run_id'][:8]}" for item in row["occurrences"]}))
        repeat_rows.append(f'''<tr><td><code>{html.escape(row['key'])}</code></td><td>{row['occurrence_count']}</td>
<td>{row['wasted_count']} / {row['wasted_minutes']:.2f}m</td><td>{row['informative_count']} / {row['informative_minutes']:.2f}m</td><td>{html.escape(actors)}</td></tr>''')
    rows_html = "".join(repeat_rows) or '<tr><td colspan="5">No repeated normalized calls.</td></tr>'
    session_rows = "".join(session_card(row) for row in sessions)
    phase_cards = [
        ("All children", child_life_data["totals"]),
        *[(agent, values) for agent, values in child_life_data["by_agent"].items()],
    ]
    phase_html = "".join(
        f'''<section class="phase-card"><h3>{html.escape(name)}</h3>
<div><b>{sum(data['minutes'].values()):.1f}</b> wall min · orientation {data['minutes']['orientation']:.1f}m · doing {data['minutes']['doing']:.1f}m · reporting {data['minutes']['reporting']:.1f}m</div>
{phase_bar_html(data['share_percent'])}</section>'''
        for name, data in phase_cards
    )
    run_phase_rows = "".join(
        f'''<tr><td>{html.escape(row['agent'])}</td><td><code>{html.escape(row['run_id'])}</code></td><td>{row['wall_minutes']:.2f}</td>
<td>{row['minutes']['orientation']:.2f} / {row['share_percent']['orientation']:.1f}%</td>
<td>{"read-only; no doing phase" if row['read_only'] else f"{row['minutes']['doing']:.2f} / {row['share_percent']['doing']:.1f}%"}</td>
<td>{row['minutes']['reporting']:.2f} / {row['share_percent']['reporting']:.1f}%</td></tr>'''
        for row in child_life_data["runs"]
    )
    operation_rows = "".join(
        f'''<tr><td>{operation['duration_minutes']:.2f}m</td><td>{html.escape(operation['tool'])}</td>
<td><code>{html.escape(operation['argument'])}</code></td><td><code>{html.escape(operation['run_id'])}</code></td>
<td>{html.escape(operation['agent'])}</td><td><code>{html.escape(operation['model'])}</code></td></tr>'''
        for operation in child_life_data["slowest_operations"]
    )
    stall_agent_rows = "".join(
        f"<tr><td>{html.escape(name)}</td><td>{values['count']}</td><td>{values['minutes']:.2f}</td><td>{values['max_minutes']:.2f}</td></tr>"
        for name, values in child_life_data["model_stalls_by_agent"].items()
    )
    stall_model_rows = "".join(
        f"<tr><td><code>{html.escape(name)}</code></td><td>{values['count']}</td><td>{values['minutes']:.2f}</td><td>{values['max_minutes']:.2f}</td></tr>"
        for name, values in child_life_data["model_stalls_by_model"].items()
    )
    notes = "".join(f"<li>{html.escape(note)}</li>" for note in report["notes"])
    title = f"Pi sessions {report['range']['since']} to {report['range']['until']}"
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title>
<style>
:root{{--ink:#17212b;--muted:#607080;--line:#d9e0e6;--paper:#fff;--wash:#f4f6f8}}*{{box-sizing:border-box}}
body{{margin:0;background:var(--wash);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
main{{max-width:1180px;margin:auto;padding:24px}}h1{{margin:0 0 4px;font-size:28px}}h2{{margin-top:34px;border-bottom:1px solid var(--line);padding-bottom:7px}}
.sub{{color:var(--muted)}}.metric-card{{background:var(--paper);border:1px solid var(--line);border-radius:7px;padding:14px;margin:10px 0}}
.metric-card h3{{margin:0 0 5px}}.numbers{{margin-bottom:10px}}.bar{{height:18px;display:flex;overflow:hidden;background:#e9edf0;border-radius:4px}}
.bar span{{display:block;min-width:1px}}.legend{{display:flex;flex-wrap:wrap;gap:5px 13px;margin:7px 0;color:var(--muted);font-size:12px}}
.legend i{{display:inline-block;width:9px;height:9px;margin-right:4px;border-radius:2px}}.taxonomy{{font-size:12px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:10px}}.grid .metric-card{{margin:0}}
.summary{{display:flex;gap:20px;flex-wrap:wrap;background:#17212b;color:white;padding:16px;border-radius:7px}}.summary b{{font-size:22px}}
.table-wrap{{overflow:auto;background:white;border:1px solid var(--line);border-radius:7px}}table{{border-collapse:collapse;width:100%;min-width:850px}}
th,td{{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}}th{{position:sticky;top:0;background:#edf1f4}}
.session-card,.phase-card{{background:white;border:1px solid var(--line);border-radius:7px;padding:14px;margin:12px 0}}.session-head{{display:flex;justify-content:space-between;gap:12px;align-items:start}}
.session-head h3,.phase-card h3{{margin:0 0 3px}}.session-head>b{{font-size:20px;white-space:nowrap}}.session-numbers{{margin:10px 0}}.split-bar{{height:14px}}
.gantt{{margin-top:12px;border-top:1px solid var(--line);padding-top:7px}}.gantt-row{{display:grid;grid-template-columns:190px minmax(0,1fr);gap:8px;align-items:center;min-height:21px}}
.gantt-label{{font:11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}.agent-dot{{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}}
.gantt-track{{position:relative;height:12px;background:#edf1f4;border-radius:2px;overflow:hidden}}.gantt-run{{position:absolute;top:1px;height:10px;min-width:2px;border-radius:2px}}.gantt-run.failed{{background-image:repeating-linear-gradient(135deg,transparent 0 4px,rgba(0,0,0,.55) 4px 6px)!important;outline:1px solid #9b1c1c;outline-offset:-1px}}
.phase-card{{margin:0}}.phase-card .bar{{margin-top:8px}}.two-tables{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}.two-tables table{{min-width:0}}
code{{font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}}footer{{color:var(--muted);margin:25px 0}}@media(max-width:700px){{main{{padding:12px}}.grid,.two-tables{{grid-template-columns:1fr}}.gantt-row{{grid-template-columns:130px minmax(0,1fr)}}}}
</style></head><body><main><h1>{html.escape(title)}</h1>
<p class="sub">{report['parent_session_count']} artifact-date parent sessions · {report['level_4_parent_session_count']} activity-date sessions · source {html.escape(report['source'])}</p>
<h2>Level 1 · all child agents</h2>{metric_card('All child runs', level1)}
<h2>Level 2 · agent types</h2><div class="grid">{agent_rows}</div>
<h2>Level 3 · repeated work</h2><div class="summary"><span><b>{repeated['total_wasted_minutes']:.1f}</b><br>wasted minutes</span>
<span><b>{repeated['wasted_share_of_tool_time_percent']:.1f}%</b><br>of measured tool time</span><span><b>{len(repeated['keys'])}</b><br>repeated keys</span></div>
<p>A repeat is wasted only when it has the same normalized key and repository HEAD as the prior occurrence, with no write/edit in that repo between them. Unknown SHA can match unknown only within the same resolved repo (or both unresolved).</p>
<div class="table-wrap"><table><thead><tr><th>Normalized key</th><th>Calls</th><th>Wasted</th><th>Informative</th><th>Agents and runs</th></tr></thead><tbody>{rows_html}</tbody></table></div>
<h2>Level 4 · session wall clock</h2>
<p>Levels 1 to 3 and 5 select child runs by artifact date. Level 4 selects parent sessions and children by activity date, so counts can differ slightly.</p>
<p>Sessions are sorted by active time, with complete-inactivity gaps over 15 minutes excluded. Elapsed time remains visible. Parallelism is summed child wall time divided by the union of child run intervals; 1× means serial child work. Failed runs are striped.</p>
<p><b>{unattributed['count']} unattributed children.</b> Reasons: {html.escape(', '.join(f'{key}: {value}' for key, value in unattributed['reasons'].items()) or 'none')}.</p>
{session_rows}
<h2>Level 5 · where a child’s life goes</h2>
<p>Orientation ends at the first edit/write, or the first source-changing shell command when there is no edit. Doing runs through the last edit/write/bash. A read-only run has no doing phase.</p>
<div class="grid">{phase_html}</div>
<h3>Every child run</h3><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Run</th><th>Wall min</th><th>Orientation min / share</th><th>Doing min / share</th><th>Reporting min / share</th></tr></thead><tbody>{run_phase_rows}</tbody></table></div>
<h3>30 slowest operations</h3><p>Model stalls are event gaps over 60 seconds with no tool call in flight. Arguments show only commands, paths, and search patterns.</p>
<div class="table-wrap"><table><thead><tr><th>Duration</th><th>Operation</th><th>Argument</th><th>Run</th><th>Agent</th><th>Model</th></tr></thead><tbody>{operation_rows}</tbody></table></div>
<h3>Model stalls</h3><div class="two-tables"><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Events</th><th>Total min</th><th>Max min</th></tr></thead><tbody>{stall_agent_rows}</tbody></table></div>
<div class="table-wrap"><table><thead><tr><th>Model</th><th>Events</th><th>Total min</th><th>Max min</th></tr></thead><tbody>{stall_model_rows}</tbody></table></div></div>
<footer><ul>{notes}</ul></footer></main></body></html>'''


def print_summary(report: dict[str, Any]) -> None:
    data = report["level_1_all_children"]
    repeat = report["level_3_repeated_work"]
    print(f"Pi sessions {report['range']['since']}..{report['range']['until']} (inclusive)")
    print(f"children {data['run_count']} | failed {data['failure_count']} ({data['failure_rate']:.1f}%) | wall {data['wall_minutes']:.1f} min")
    print(f"median {data['median_minutes']:.1f} | p90 {data['p90_minutes']:.1f} | max {data['max_minutes']:.1f} min | cost ${data['cost_usd']:.2f} | turns {data['turns']}")
    print(f"wasted repeats {repeat['total_wasted_minutes']:.1f} min ({repeat['wasted_share_of_tool_time_percent']:.1f}% of measured tool time)")


def parse_date(value: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid date {value!r}; use YYYY-MM-DD") from exc


def main(argv: list[str] | None = None) -> int:
    today = dt.date.today()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", type=parse_date, default=today - dt.timedelta(days=7))
    parser.add_argument("--until", type=parse_date, default=today)
    parser.add_argument("--html", type=Path, metavar="PATH")
    parser.add_argument("--json", type=Path, metavar="PATH")
    parser.add_argument("--sessions-dir", type=Path, default=Path("~/.pi/agent/sessions").expanduser())
    parser.add_argument("--repo", metavar="SUBSTR")
    parser.add_argument("--session", metavar="ID-OR-PREFIX")
    args = parser.parse_args(argv)
    if args.until < args.since:
        parser.error("--until must be on or after --since")
    try:
        report = build_report(args.sessions_dir.expanduser(), args.since, args.until, args.repo, args.session)
    except RuntimeError as exc:
        parser.exit(2, f"analyze.py: error: {exc}\n")
    try:
        if args.json:
            args.json.expanduser().write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        if args.html:
            args.html.expanduser().write_text(render_html(report), encoding="utf-8")
    except OSError as exc:
        parser.exit(1, f"analyze.py: error: cannot write output: {exc}\n")
    if not args.json and not args.html:
        print_summary(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
