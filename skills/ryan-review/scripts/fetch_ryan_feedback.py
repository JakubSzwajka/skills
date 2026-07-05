#!/usr/bin/env python3
"""Fetch Ryan-style review feedback from PRs authored by a GitHub user.

Requires the GitHub CLI (`gh`) to be installed and authenticated.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


DEFAULT_REVIEWER = "ryanmanns1-pubnub"


def run_json(args: list[str]) -> Any:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"command failed: {' '.join(args)}")
    text = proc.stdout.strip()
    if not text:
        return None
    return json.loads(text)


def gh_json(*args: str) -> Any:
    return run_json(["gh", *args])


def current_user() -> str:
    return gh_json("api", "user", "--jq", ".login")


def current_repo() -> str:
    data = gh_json("repo", "view", "--json", "nameWithOwner")
    return data["nameWithOwner"]


def api_list(path: str) -> list[dict[str, Any]]:
    data = gh_json("api", f"{path}?per_page=100")
    if data is None:
        return []
    if not isinstance(data, list):
        raise TypeError(f"expected list from {path}")
    return data


def authored_prs(repo: str, author: str, limit: int) -> list[dict[str, Any]]:
    data = gh_json(
        "pr",
        "list",
        "--repo",
        repo,
        "--author",
        author,
        "--state",
        "all",
        "--limit",
        str(limit),
        "--json",
        "number,title,url,state,createdAt,mergedAt,body",
    )
    return sorted(data, key=lambda pr: pr["number"])


def collect_feedback(repo: str, pr: dict[str, Any], reviewer: str) -> list[dict[str, Any]]:
    number = pr["number"]
    entries: list[dict[str, Any]] = []

    for comment in api_list(f"repos/{repo}/issues/{number}/comments"):
        if comment.get("user", {}).get("login") == reviewer:
            entries.append(
                {
                    "kind": "conversation",
                    "created_at": comment.get("created_at"),
                    "body": comment.get("body", "").strip(),
                }
            )

    for review in api_list(f"repos/{repo}/pulls/{number}/reviews"):
        body = review.get("body", "").strip()
        if review.get("user", {}).get("login") == reviewer and body:
            entries.append(
                {
                    "kind": f"review:{review.get('state', '').lower()}",
                    "created_at": review.get("submitted_at"),
                    "body": body,
                }
            )

    for comment in api_list(f"repos/{repo}/pulls/{number}/comments"):
        if comment.get("user", {}).get("login") == reviewer:
            entries.append(
                {
                    "kind": "inline",
                    "created_at": comment.get("created_at"),
                    "path": comment.get("path"),
                    "line": comment.get("line") or comment.get("original_line"),
                    "body": comment.get("body", "").strip(),
                }
            )

    return sorted(entries, key=lambda item: item.get("created_at") or "")


def render_markdown(repo: str, author: str, reviewer: str, prs: list[dict[str, Any]]) -> str:
    lines = [
        f"# Ryan Feedback for `{author}` in `{repo}`",
        "",
        f"- Reviewer: `{reviewer}`",
        f"- PRs inspected: {len(prs)}",
        "",
    ]

    with_feedback = 0
    for pr in prs:
        entries = collect_feedback(repo, pr, reviewer)
        if not entries:
            continue
        with_feedback += 1
        merged = pr.get("mergedAt") or ""
        lines.extend(
            [
                f"## PR #{pr['number']}: {pr['title']}",
                "",
                f"- State: `{pr['state']}`",
                f"- Created: `{pr['createdAt']}`",
                f"- Merged: `{merged}`" if merged else "- Merged: n/a",
                f"- URL: {pr['url']}",
                "",
            ]
        )
        for entry in entries:
            location = ""
            if entry.get("path"):
                location = f" `{entry['path']}:{entry.get('line') or '?'}`"
            lines.extend(
                [
                    f"### {entry['kind']} {entry.get('created_at') or ''}{location}",
                    "",
                    entry["body"],
                    "",
                ]
            )

    lines.insert(3, f"- PRs with reviewer feedback: {with_feedback}")
    return "\n".join(lines).rstrip() + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=None, help="GitHub repo, e.g. pubnub/illuminate")
    parser.add_argument("--author", default=None, help="PR author login; defaults to gh auth user")
    parser.add_argument("--reviewer", default=DEFAULT_REVIEWER, help="Reviewer login")
    parser.add_argument("--limit", type=int, default=1000, help="Max PRs to inspect")
    parser.add_argument("--out", type=Path, default=None, help="Optional Markdown output path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        repo = args.repo or current_repo()
        author = args.author or current_user()
        prs = authored_prs(repo, author, args.limit)
        markdown = render_markdown(repo, author, args.reviewer, prs)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.out:
        args.out.write_text(markdown)
    else:
        print(markdown, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
