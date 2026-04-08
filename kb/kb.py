#!/usr/bin/env python3
"""Knowledge graph CLI — wraps Obsidian CLI for the ~/knowledge vault.

Commands:
  search   <query> [--tag <t>] [--limit N] [--context]
  get      <name>                              read a node by wikilink name
  links    <name>                              outgoing links from a node
  backlinks <name>                             incoming links to a node
  graph    <name> [--depth N]                  local neighborhood (links + backlinks, expandable)
  create   <name> --description "..." --tags t1,t2 [--content "..."]
  tags     [--sort count|name] [--prefix <p>]
  orphans                                      nodes with zero inbound links
  deadends                                     nodes with zero outbound links
  unresolved                                   broken wikilinks
  lint                                         run lint.py quality checks
  list     [--tag <t>] [--sort name|modified]  list all nodes
  info     <name>                              file metadata (size, dates)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import textwrap
from pathlib import Path

VAULT = "knowledge"
KNOWLEDGE_FOLDER = "knowledge"
KNOWLEDGE_DIR = Path.home() / "knowledge" / "knowledge"
LINT_SCRIPT = Path.home() / "knowledge" / "scripts" / "lint.py"
OBSIDIAN = "obsidian"


def obs(*args: str, check: bool = True) -> str:
    """Run an obsidian CLI command targeting the knowledge vault."""
    cmd = [OBSIDIAN, *args, f"vault={VAULT}"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if check and result.returncode != 0:
        err = result.stderr.strip() or result.stdout.strip()
        print(f"obsidian error: {err}", file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip()


# ── search ────────────────────────────────────────────────────────────


def cmd_search(args: argparse.Namespace) -> None:
    query = args.query
    limit = str(args.limit)

    if args.context:
        sub = "search:context"
    else:
        sub = "search"

    parts = [sub, f"query={query}", f"path={KNOWLEDGE_FOLDER}", f"limit={limit}"]
    output = obs(*parts)

    # If tag filter requested, post-filter results
    if args.tag and output:
        filtered = _filter_by_tag(output, args.tag)
        output = filtered

    if not output:
        print("No results.")
    else:
        print(output)


def _filter_by_tag(search_output: str, tag: str) -> str:
    """Filter search results to only files that carry a specific tag."""
    # Extract unique file paths from search output
    paths = set()
    for line in search_output.splitlines():
        # search output format: "knowledge/foo.md" or "knowledge/foo.md:42: text"
        if "/" in line:
            path = line.split(":")[0].strip()
            paths.add(path)

    # Get files for this tag
    tag_output = obs("tag", f"name={tag}", "verbose")
    tag_files = set(tag_output.splitlines()[1:])  # skip count line

    # Intersect
    matching = paths & tag_files
    if not matching:
        return ""

    # Return only matching lines
    result_lines = []
    for line in search_output.splitlines():
        for p in matching:
            if line.startswith(p):
                result_lines.append(line)
                break
    return "\n".join(result_lines)


# ── get ───────────────────────────────────────────────────────────────


def cmd_get(args: argparse.Namespace) -> None:
    name = args.name
    path = f"{KNOWLEDGE_FOLDER}/{name}.md"
    try:
        content = Path(KNOWLEDGE_DIR / f"{name}.md").read_text()
        print(content)
    except FileNotFoundError:
        print(f"Node not found: {name}", file=sys.stderr)
        print(f"  Tried: {KNOWLEDGE_DIR / f'{name}.md'}", file=sys.stderr)
        # Suggest similar
        _suggest_similar(name)
        sys.exit(1)


def _suggest_similar(name: str) -> None:
    """Suggest nodes with overlapping name fragments."""
    parts = name.split("-")
    candidates = set()
    for md in KNOWLEDGE_DIR.glob("*.md"):
        stem = md.stem
        if stem == "README":
            continue
        for part in parts:
            if len(part) > 2 and part in stem:
                candidates.add(stem)
                break
    if candidates:
        print("  Similar nodes:", file=sys.stderr)
        for c in sorted(candidates)[:8]:
            print(f"    {c}", file=sys.stderr)


# ── links / backlinks ────────────────────────────────────────────────


def cmd_links(args: argparse.Namespace) -> None:
    output = obs("links", f"file={args.name}")
    if output:
        print(output)
    else:
        print("No outgoing links.")


def cmd_backlinks(args: argparse.Namespace) -> None:
    output = obs("backlinks", f"file={args.name}", "counts")
    if output:
        print(output)
    else:
        print("No incoming links.")


# ── graph ─────────────────────────────────────────────────────────────


def cmd_graph(args: argparse.Namespace) -> None:
    """Show the local neighborhood of a node: outgoing + incoming, optionally expanded."""
    name = args.name
    depth = args.depth
    visited: set[str] = set()
    _print_neighborhood(name, depth, visited, indent=0)


def _print_neighborhood(name: str, depth: int, visited: set[str], indent: int) -> None:
    if name in visited or depth < 0:
        return
    visited.add(name)

    prefix = "  " * indent
    marker = "→" if indent > 0 else "●"

    # Get description from frontmatter
    desc = _get_description(name)
    desc_str = f"  — {desc}" if desc else ""
    print(f"{prefix}{marker} [[{name}]]{desc_str}")

    if depth == 0:
        return

    # Outgoing links
    out_raw = obs("links", f"file={name}", check=False)
    outgoing = _parse_file_list(out_raw)

    # Incoming links
    in_raw = obs("backlinks", f"file={name}", check=False)
    incoming = _parse_file_list(in_raw)

    if outgoing:
        print(f"{prefix}  outgoing:")
        for target in outgoing:
            stem = _path_to_stem(target)
            if stem and stem not in visited:
                _print_neighborhood(stem, depth - 1, visited, indent + 2)
            elif stem and stem in visited:
                print(f"{prefix}    ↺ [[{stem}]]")

    if incoming:
        print(f"{prefix}  incoming:")
        for source in incoming:
            stem = _path_to_stem(source)
            if stem and stem not in visited:
                _print_neighborhood(stem, depth - 1, visited, indent + 2)
            elif stem and stem in visited:
                print(f"{prefix}    ↺ [[{stem}]]")


def _parse_file_list(output: str) -> list[str]:
    """Parse obsidian CLI file list output (one path per line, possibly with counts)."""
    if not output:
        return []
    results = []
    for line in output.splitlines():
        parts = line.split("\t")
        results.append(parts[0].strip())
    return results


def _path_to_stem(path: str) -> str | None:
    """Convert 'knowledge/foo.md' to 'foo'."""
    p = Path(path)
    if p.stem == "README":
        return None
    return p.stem


def _get_description(name: str) -> str | None:
    """Extract description from frontmatter."""
    path = KNOWLEDGE_DIR / f"{name}.md"
    if not path.exists():
        return None
    try:
        text = path.read_text()
        match = re.search(r"^description:\s*(.+)$", text, re.MULTILINE)
        return match.group(1).strip() if match else None
    except Exception:
        return None


# ── create ────────────────────────────────────────────────────────────


def cmd_create(args: argparse.Namespace) -> None:
    name = args.name
    target = KNOWLEDGE_DIR / f"{name}.md"

    if target.exists() and not args.overwrite:
        print(f"Node already exists: {name}", file=sys.stderr)
        print(f"  Use --overwrite to replace, or pick a different name.", file=sys.stderr)
        sys.exit(1)

    # Validate tags
    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    has_type = any(t.startswith("type/") for t in tags)
    has_topic = any(t.startswith("topic/") for t in tags)
    if not has_type:
        print("Warning: missing type/* tag (e.g. type/concept, type/pattern)", file=sys.stderr)
    if not has_topic:
        print("Warning: missing topic/* tag (e.g. topic/domain-driven-design)", file=sys.stderr)

    # Build frontmatter
    tag_yaml = "\n".join(f"  - {t}" for t in tags)
    from datetime import date
    today = date.today().isoformat()

    frontmatter = textwrap.dedent(f"""\
        ---
        name: {name}
        description: {args.description}
        tags:
        {tag_yaml}
        created: {today}
        ---
    """)

    body = args.content if args.content else ""
    full_content = frontmatter + "\n" + body

    # Write via obsidian CLI
    obs("create", f"path={KNOWLEDGE_FOLDER}/{name}.md", f"content={full_content}", "overwrite")
    print(f"Created: {name}")

    # Verify
    if target.exists():
        print(f"  Path: {target}")
        print(f"  Tags: {', '.join(tags)}")
    else:
        print("  Warning: file not found after creation, check obsidian vault", file=sys.stderr)


# ── tags ──────────────────────────────────────────────────────────────


def cmd_tags(args: argparse.Namespace) -> None:
    parts = ["tags", "counts"]
    if args.sort:
        parts.append(f"sort={args.sort}")

    output = obs(*parts)
    if args.prefix:
        lines = [l for l in output.splitlines() if l.startswith(f"#{args.prefix}")]
        output = "\n".join(lines)

    print(output or "No tags.")


# ── orphans / deadends / unresolved ───────────────────────────────────


def cmd_orphans(_args: argparse.Namespace) -> None:
    output = obs("orphans")
    # Filter to knowledge/ only
    lines = [l for l in output.splitlines() if l.startswith(f"{KNOWLEDGE_FOLDER}/")]
    print("\n".join(lines) if lines else "No orphan nodes in knowledge/.")


def cmd_deadends(_args: argparse.Namespace) -> None:
    output = obs("deadends")
    lines = [l for l in output.splitlines() if l.startswith(f"{KNOWLEDGE_FOLDER}/")]
    print("\n".join(lines) if lines else "No dead-end nodes in knowledge/.")


def cmd_unresolved(_args: argparse.Namespace) -> None:
    output = obs("unresolved", "verbose", "counts")
    print(output or "No unresolved links.")


# ── lint ──────────────────────────────────────────────────────────────


def cmd_lint(_args: argparse.Namespace) -> None:
    if not LINT_SCRIPT.exists():
        print(f"Lint script not found: {LINT_SCRIPT}", file=sys.stderr)
        sys.exit(1)
    result = subprocess.run(
        [sys.executable, str(LINT_SCRIPT)],
        capture_output=True, text=True,
    )
    print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    sys.exit(result.returncode)


# ── list ──────────────────────────────────────────────────────────────


def cmd_list(args: argparse.Namespace) -> None:
    if args.tag:
        # Use tag command to get files
        output = obs("tag", f"name={args.tag}", "verbose")
        lines = output.splitlines()
        # First line is count, rest are file paths
        files = [l for l in lines[1:] if l.startswith(f"{KNOWLEDGE_FOLDER}/") and "README" not in l]
    else:
        files = sorted(
            f"{KNOWLEDGE_FOLDER}/{p.name}"
            for p in KNOWLEDGE_DIR.glob("*.md")
            if p.name != "README.md"
        )

    if not files:
        print("No nodes found.")
        return

    # Optionally sort by modified time
    if args.sort == "modified":
        def mtime(f: str) -> float:
            p = Path.home() / "knowledge" / f
            return p.stat().st_mtime if p.exists() else 0
        files.sort(key=mtime, reverse=True)

    for f in files:
        stem = Path(f).stem
        desc = _get_description(stem)
        desc_str = f"  — {desc}" if desc else ""
        print(f"  {stem}{desc_str}")

    print(f"\n{len(files)} nodes")


# ── info ──────────────────────────────────────────────────────────────


def cmd_info(args: argparse.Namespace) -> None:
    output = obs("file", f"file={args.name}")
    print(output)

    # Also show tags
    tags_out = obs("tags", f"file={args.name}", check=False)
    if tags_out:
        print(f"\nTags:\n{tags_out}")


# ── main ──────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="kb",
        description="Knowledge graph CLI — Obsidian-backed.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # search
    p = sub.add_parser("search", help="Search knowledge nodes")
    p.add_argument("query", help="Search query text")
    p.add_argument("--tag", help="Filter results by tag")
    p.add_argument("--limit", type=int, default=10, help="Max results (default: 10)")
    p.add_argument("--context", action="store_true", help="Show matching line context")
    p.set_defaults(func=cmd_search)

    # get
    p = sub.add_parser("get", help="Read a node by wikilink name")
    p.add_argument("name", help="Node name (wikilink style, e.g. tactical-ddd-value-objects)")
    p.set_defaults(func=cmd_get)

    # links
    p = sub.add_parser("links", help="Outgoing links from a node")
    p.add_argument("name")
    p.set_defaults(func=cmd_links)

    # backlinks
    p = sub.add_parser("backlinks", help="Incoming links to a node")
    p.add_argument("name")
    p.set_defaults(func=cmd_backlinks)

    # graph
    p = sub.add_parser("graph", help="Local neighborhood of a node")
    p.add_argument("name")
    p.add_argument("--depth", type=int, default=1, help="Traversal depth (default: 1)")
    p.set_defaults(func=cmd_graph)

    # create
    p = sub.add_parser("create", help="Create a new knowledge node")
    p.add_argument("name", help="Node name (kebab-case)")
    p.add_argument("--description", required=True, help="One-line description")
    p.add_argument("--tags", required=True, help="Comma-separated tags (e.g. type/concept,topic/ddd)")
    p.add_argument("--content", default="", help="Node body content")
    p.add_argument("--overwrite", action="store_true", help="Overwrite existing node")
    p.set_defaults(func=cmd_create)

    # tags
    p = sub.add_parser("tags", help="List tags in the vault")
    p.add_argument("--sort", choices=["count", "name"], default="count")
    p.add_argument("--prefix", help="Filter tags by prefix (e.g. topic/)")
    p.set_defaults(func=cmd_tags)

    # orphans
    p = sub.add_parser("orphans", help="Nodes with zero inbound links")
    p.set_defaults(func=cmd_orphans)

    # deadends
    p = sub.add_parser("deadends", help="Nodes with zero outbound links")
    p.set_defaults(func=cmd_deadends)

    # unresolved
    p = sub.add_parser("unresolved", help="Broken wikilinks")
    p.set_defaults(func=cmd_unresolved)

    # lint
    p = sub.add_parser("lint", help="Run knowledge lint checks")
    p.set_defaults(func=cmd_lint)

    # list
    p = sub.add_parser("list", help="List all knowledge nodes")
    p.add_argument("--tag", help="Filter by tag")
    p.add_argument("--sort", choices=["name", "modified"], default="name")
    p.set_defaults(func=cmd_list)

    # info
    p = sub.add_parser("info", help="File metadata for a node")
    p.add_argument("name")
    p.set_defaults(func=cmd_info)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
