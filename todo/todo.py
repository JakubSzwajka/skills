#!/usr/bin/env python3
"""pi-todo: Task manager backed by Obsidian vault markdown files.

Enforces folder structure:
  tasks/
    <project>.md                      # project file
    <project>/
      <task>.md                       # task
      <task>/
        <subtask>.md                  # subtask
    _inbox/
      <task>.md                       # tasks without a project
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OBSIDIAN_BIN = "/usr/local/bin/obsidian"
TASKS_ROOT = "tasks"
INBOX_DIR = "_inbox"

# ---------------------------------------------------------------------------
# Obsidian CLI wrapper
# ---------------------------------------------------------------------------

def obsidian(*args: str, timeout: int = 5) -> str:
    try:
        r = subprocess.run(
            [OBSIDIAN_BIN, *args],
            capture_output=True, text=True, timeout=timeout,
        )
        out = r.stdout
        if out.startswith("Error: "):
            raise RuntimeError(out.strip())
        return out
    except FileNotFoundError:
        die("Obsidian CLI not found at " + OBSIDIAN_BIN)
    except subprocess.TimeoutExpired:
        die("Obsidian CLI timed out — is Obsidian running?")


def obsidian_search(query: str, path: str | None = None) -> list[str]:
    args = ["search", f"query={query}", "format=json"]
    if path:
        args.append(f"path={path}")
    out = obsidian(*args).strip()
    if not out or out == "No matches found.":
        return []
    return json.loads(out)


def obsidian_read(path: str) -> str:
    return obsidian("read", f"path={path}")


def obsidian_properties(path: str) -> dict:
    out = obsidian("properties", f"path={path}", "format=json").strip()
    if not out or out.startswith("No "):
        return {}
    return json.loads(out)


def obsidian_create(name: str, directory: str, content: str) -> None:
    obsidian("create", f"name={name}", f"path={directory}", f"content={content}")


def obsidian_delete(path: str) -> None:
    obsidian("delete", f"path={path}", "permanent")


def obsidian_property_set(path: str, name: str, value: str) -> None:
    obsidian("property:set", f"path={path}", f"name={name}", f"value={value}")


def obsidian_exists(path: str) -> bool:
    try:
        obsidian_read(path)
        return True
    except (RuntimeError, Exception):
        return False

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def die(msg: str) -> None:
    print(f"\033[31m{msg}\033[0m", file=sys.stderr)
    sys.exit(1)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def slugify(text: str) -> str:
    s = text.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s[:64]


def unique_slug(base: str, directory: str) -> str:
    candidate = slugify(base)
    if not obsidian_exists(f"{directory}/{candidate}.md"):
        return candidate
    i = 2
    while True:
        attempt = f"{candidate}-{i}"
        if not obsidian_exists(f"{directory}/{attempt}.md"):
            return attempt
        i += 1


def fmt_log_entry(author: str, text: str, at: str | None = None) -> str:
    dt = datetime.fromisoformat(at) if at else datetime.now(timezone.utc)
    ts = dt.strftime("%Y-%m-%d %H:%M")
    return f"- **{ts} ({author}):** {text}"

# ---------------------------------------------------------------------------
# Path resolution (enforces folder structure)
# ---------------------------------------------------------------------------

def project_path(project_slug: str) -> str:
    """Path to a project file: tasks/<project>.md"""
    return f"{TASKS_ROOT}/{project_slug}.md"


def project_dir(project_slug: str) -> str:
    """Directory for tasks in a project: tasks/<project>/"""
    return f"{TASKS_ROOT}/{project_slug}"


def task_dir(project_slug: str) -> str:
    """Directory where task files live."""
    return project_dir(project_slug)


def subtask_dir(project_slug: str, parent_slug: str) -> str:
    """Directory for subtasks: tasks/<project>/<parent>/"""
    return f"{TASKS_ROOT}/{project_slug}/{parent_slug}"


def resolve_task_path(task_slug: str) -> str | None:
    """Find a task file anywhere in the vault by slug."""
    paths = obsidian_search("tag:type/task", TASKS_ROOT)
    for p in paths:
        if p.endswith(f"/{task_slug}.md"):
            return p
    return None


def resolve_project_for_task(task_props: dict, all_tasks: dict | None = None) -> str | None:
    """Resolve effective project: from own props or walk up parent chain."""
    if task_props.get("project"):
        return task_props["project"]
    parent = task_props.get("parent")
    if parent and all_tasks and parent in all_tasks:
        return resolve_project_for_task(all_tasks[parent], all_tasks)
    if parent:
        parent_path = resolve_task_path(parent)
        if parent_path:
            parent_props = obsidian_properties(parent_path)
            return resolve_project_for_task(parent_props)
    return None

# ---------------------------------------------------------------------------
# Markdown generation
# ---------------------------------------------------------------------------

def yaml_quote(val: str) -> str:
    return f'"{val}"'


def task_to_markdown(
    title: str,
    status: str = "open",
    project: str = "",
    parent: str = "",
    tags: list[str] | None = None,
    description: str = "",
    log_entries: list[str] | None = None,
    created: str = "",
    updated: str = "",
) -> str:
    now = now_iso()
    created = created or now
    updated = updated or now
    all_tags = ["type/task"] + [t for t in (tags or []) if t != "type/task"]

    lines = ["---", "type: task", f"title: {yaml_quote(title)}", f"status: {status}"]
    if project:
        lines.append(f"project: {project}")
    if parent:
        lines.append(f"parent: {parent}")
    lines.append("tags:")
    for t in all_tags:
        lines.append(f"  - {t}")
    lines.append(f"created: {created}")
    lines.append(f"updated: {updated}")
    lines.append("---")
    lines.append("")

    # Relationship wiki-links
    if project:
        lines.append(f"Project: [[{project}]]")
    if parent:
        lines.append(f"Parent: [[{parent}]]")
    if project or parent:
        lines.append("")

    if description:
        lines.append(description)
        lines.append("")

    lines.append("## Log")
    lines.append("")
    if log_entries:
        for entry in log_entries:
            lines.append(entry)
        lines.append("")

    return "\n".join(lines)


def project_to_markdown(
    name: str,
    description: str = "",
    created: str = "",
    updated: str = "",
) -> str:
    now = now_iso()
    created = created or now
    updated = updated or now

    lines = ["---", "type: project", f"name: {yaml_quote(name)}"]
    if description:
        lines.append(f"description: {yaml_quote(description)}")
    lines.append("tags:")
    lines.append("  - type/project")
    lines.append(f"created: {created}")
    lines.append(f"updated: {updated}")
    lines.append("---")
    lines.append("")
    if description:
        lines.append(description)
        lines.append("")

    return "\n".join(lines)

# ---------------------------------------------------------------------------
# Load all tasks (indexed by slug)
# ---------------------------------------------------------------------------

def load_all_tasks() -> dict[str, dict]:
    """Return {slug: {path, props...}} for every task."""
    paths = obsidian_search("tag:type/task", TASKS_ROOT)
    tasks = {}
    for p in paths:
        slug = p.rsplit("/", 1)[-1].replace(".md", "")
        props = obsidian_properties(p)
        tasks[slug] = {"_path": p, "slug": slug, **props}
    return tasks


def load_all_projects() -> dict[str, dict]:
    """Return {slug: {path, props...}} for every project."""
    # Search across all of tasks/ since projects may be at tasks/<slug>.md
    # or tasks/projects/<slug>.md during migration
    paths = obsidian_search("tag:type/project", TASKS_ROOT)
    projects = {}
    for p in paths:
        slug = p.rsplit("/", 1)[-1].replace(".md", "")
        props = obsidian_properties(p)
        projects[slug] = {"_path": p, "slug": slug, **props}
    return projects

# ---------------------------------------------------------------------------
# Commands: Projects
# ---------------------------------------------------------------------------

def cmd_project_list():
    projects = load_all_projects()
    if not projects:
        print("\033[90mNo projects.\033[0m")
        return

    tasks = load_all_tasks()
    for slug, proj in sorted(projects.items()):
        count = sum(1 for t in tasks.values()
                    if resolve_project_for_task(t, tasks) == slug and not t.get("parent"))
        desc = proj.get("description", "")
        desc_chip = f"  \033[90m{desc}\033[0m" if desc else ""
        print(f"\033[1m{proj.get('name', slug)}\033[0m \033[90m({slug})\033[0m  \033[35m{count} tasks\033[0m{desc_chip}")


def cmd_project_add(args):
    name = args.name
    slug = slugify(args.id or name)

    if obsidian_exists(project_path(slug)):
        die(f"Project already exists: {slug}")

    md = project_to_markdown(name=name, description=args.description or "")
    obsidian_create(slug, TASKS_ROOT, md)
    print(f"\033[32m✓\033[0m Added project \033[1m{name}\033[0m ({slug})")


def cmd_project_show(args):
    slug = args.id
    path = project_path(slug)
    if not obsidian_exists(path):
        die(f"Project not found: {slug}")

    props = obsidian_properties(path)
    tasks = load_all_tasks()

    print(f"\033[1m{props.get('name', slug)}\033[0m \033[90m({slug})\033[0m")
    if props.get("description"):
        print(f"\033[2m{props['description']}\033[0m")
    print()

    project_tasks = {s: t for s, t in tasks.items()
                     if resolve_project_for_task(t, tasks) == slug}

    if not project_tasks:
        print("\033[90mNo tasks.\033[0m")
        return

    # Print as tree
    def print_tree(parent_slug: str, indent: str):
        children = [(s, t) for s, t in project_tasks.items()
                    if (t.get("parent") or "") == parent_slug]
        for s, t in children:
            st = t.get("status", "?")
            st_sym = {"open": "○", "in_progress": "◑", "done": "●", "cancelled": "✕"}.get(st, "?")
            tags = [x for x in t.get("tags", []) if x != "type/task"]
            tag_chip = "  " + " ".join(f"\033[36m#{x}\033[0m" for x in tags) if tags else ""
            print(f"{indent}{st_sym} \033[2m#{s}\033[0m  {t.get('title', s)}  [{st}]{tag_chip}")
            print_tree(s, indent + "  ")

    print_tree("", "  ")


def cmd_project_delete(args):
    slug = args.id
    path = project_path(slug)
    if not obsidian_exists(path):
        die(f"Project not found: {slug}")

    tasks = load_all_tasks()
    project_tasks = [s for s, t in tasks.items()
                     if resolve_project_for_task(t, tasks) == slug]
    if project_tasks:
        die(f"Cannot delete project {slug}; {len(project_tasks)} tasks still reference it")

    obsidian_delete(path)
    print(f"\033[32m✓\033[0m Deleted project {slug}")

# ---------------------------------------------------------------------------
# Commands: Tasks
# ---------------------------------------------------------------------------

VALID_STATUSES = ("open", "in_progress", "done", "cancelled")


def cmd_add(args):
    title = args.title
    project_slug = args.project or ""
    parent_slug = args.parent or ""

    # Resolve project from parent if subtask
    if parent_slug:
        parent_path = resolve_task_path(parent_slug)
        if not parent_path:
            die(f"Parent task not found: {parent_slug}")
        parent_props = obsidian_properties(parent_path)
        all_tasks = load_all_tasks()
        effective_project = resolve_project_for_task(parent_props, all_tasks)
        if not effective_project:
            die(f"Parent task {parent_slug} has no project — subtasks need a project context")
        project_slug = effective_project

    if project_slug and not obsidian_exists(project_path(project_slug)):
        die(f"Project not found: {project_slug}")

    # Determine target directory
    if parent_slug:
        directory = subtask_dir(project_slug, parent_slug)
    elif project_slug:
        directory = task_dir(project_slug)
    else:
        directory = f"{TASKS_ROOT}/{INBOX_DIR}"

    slug = unique_slug(title, directory)
    tags = [t.strip() for t in (args.tags or "").split(",") if t.strip()] if args.tags else []

    log_entries = []
    if args.note:
        log_entries.append(fmt_log_entry(args.author or "kuba", args.note))

    md = task_to_markdown(
        title=title,
        project=project_slug if not parent_slug else "",  # subtasks don't store project
        parent=parent_slug,
        tags=tags,
        description=args.description or "",
        log_entries=log_entries,
    )

    obsidian_create(slug, directory, md)
    print(f"\033[32m✓\033[0m Added \033[1m#{slug}\033[0m — {title}")
    if parent_slug:
        print(f"  \033[90m↳ parent: #{parent_slug} in @{project_slug}\033[0m")


def cmd_list(args):
    tasks = load_all_tasks()
    if not tasks:
        print("\033[90mNo tasks.\033[0m")
        return

    # Filter
    filtered = {}
    for slug, t in tasks.items():
        st = t.get("status", "")
        if not args.all and st in ("done", "cancelled"):
            continue
        if args.status and st != args.status:
            continue
        if args.project:
            effective = resolve_project_for_task(t, tasks)
            if effective != args.project:
                continue
        if args.tag:
            task_tags = [x for x in t.get("tags", []) if x != "type/task"]
            if args.tag not in task_tags:
                continue
        filtered[slug] = t

    if not filtered:
        print("\033[90mNo tasks.\033[0m")
        return

    if args.tree:
        _print_tree(filtered, tasks)
    else:
        for slug, t in filtered.items():
            _print_task_line(slug, t, tasks)


def _print_task_line(slug: str, t: dict, all_tasks: dict):
    st = t.get("status", "?")
    st_sym = {"open": "○", "in_progress": "◑", "done": "●", "cancelled": "✕"}.get(st, "?")
    project = resolve_project_for_task(t, all_tasks)
    proj_chip = f"  \033[35m@{project}\033[0m" if project else ""
    tags = [x for x in t.get("tags", []) if x != "type/task"]
    tag_chip = "  " + " ".join(f"\033[36m#{x}\033[0m" for x in tags) if tags else ""
    print(f"{st_sym} \033[2m#{slug}\033[0m  \033[1m{t.get('title', slug)}\033[0m  [{st}]{proj_chip}{tag_chip}")


def _print_tree(filtered: dict, all_tasks: dict, parent: str = "", indent: str = ""):
    children = [(s, t) for s, t in filtered.items()
                if (t.get("parent") or "") == parent]
    for slug, t in children:
        _print_task_line_indented(slug, t, all_tasks, indent)
        _print_tree(filtered, all_tasks, slug, indent + "  ")


def _print_task_line_indented(slug: str, t: dict, all_tasks: dict, indent: str):
    st = t.get("status", "?")
    st_sym = {"open": "○", "in_progress": "◑", "done": "●", "cancelled": "✕"}.get(st, "?")
    project = resolve_project_for_task(t, all_tasks)
    proj_chip = f"  \033[35m@{project}\033[0m" if project else ""
    tags = [x for x in t.get("tags", []) if x != "type/task"]
    tag_chip = "  " + " ".join(f"\033[36m#{x}\033[0m" for x in tags) if tags else ""
    print(f"{indent}{st_sym} \033[2m#{slug}\033[0m  {t.get('title', slug)}  [{st}]{proj_chip}{tag_chip}")


def cmd_show(args):
    slug = args.id
    path = resolve_task_path(slug)
    if not path:
        die(f"Task not found: {slug}")

    content = obsidian_read(path)
    props = obsidian_properties(path)
    all_tasks = load_all_tasks()

    st = props.get("status", "?")
    project = resolve_project_for_task(props, all_tasks)
    parent = props.get("parent", "")
    tags = [x for x in props.get("tags", []) if x != "type/task"]

    print(f"\033[1m#{slug}\033[0m  {props.get('title', slug)}")
    print(f"  Status: {st}")
    if project:
        print(f"  Project: @{project}")
    if parent:
        print(f"  Parent: #{parent}")
    if tags:
        print(f"  Tags: {' '.join(f'#{t}' for t in tags)}")
    print(f"  Path: {path}")

    # Description (between frontmatter and ## Log)
    body = re.sub(r"^---[\s\S]*?---\s*", "", content)
    log_idx = body.find("## Log")
    desc_raw = body[:log_idx] if log_idx >= 0 else body
    # Strip relationship lines
    desc_lines = []
    past_relations = False
    for line in desc_raw.strip().split("\n"):
        stripped = line.strip()
        if not past_relations and re.match(r"^(Project|Parent|Folder|Depends on):\s+\[\[", stripped):
            continue
        if not past_relations and stripped == "":
            continue
        past_relations = True
        desc_lines.append(line)
    desc = "\n".join(desc_lines).strip()
    if desc:
        print(f"\n  \033[2m{desc}\033[0m")

    # Subtasks
    subtasks = [(s, t) for s, t in all_tasks.items() if t.get("parent") == slug]
    if subtasks:
        print(f"\n  \033[2mSubtasks:\033[0m")
        for s, t in subtasks:
            st2 = t.get("status", "?")
            st_sym = {"open": "○", "in_progress": "◑", "done": "●", "cancelled": "✕"}.get(st2, "?")
            print(f"    {st_sym} \033[2m#{s}\033[0m  {t.get('title', s)}  [{st2}]")

    # Log
    log_section = body[log_idx:] if log_idx >= 0 else ""
    log_lines = [l for l in log_section.split("\n") if l.strip().startswith("- **")]
    if log_lines:
        print(f"\n  \033[2mLog:\033[0m")
        for l in log_lines:
            print(f"  {l.strip()}")


def cmd_status(args):
    slug = args.id
    new_status = args.status
    if new_status not in VALID_STATUSES:
        die(f"Invalid status. Use: {' | '.join(VALID_STATUSES)}")

    path = resolve_task_path(slug)
    if not path:
        die(f"Task not found: {slug}")

    props = obsidian_properties(path)
    old_status = props.get("status", "?")

    obsidian_property_set(path, "status", new_status)
    obsidian_property_set(path, "updated", now_iso())
    print(f"\033[32m✓\033[0m #{slug}  {old_status} → {new_status}")


def cmd_log(args):
    slug = args.id
    text = args.text
    author = args.author or "kuba"

    path = resolve_task_path(slug)
    if not path:
        die(f"Task not found: {slug}")

    # Read current content, prepend log entry after ## Log header
    content = obsidian_read(path)
    entry = fmt_log_entry(author, text)

    log_marker = "## Log\n"
    idx = content.find(log_marker)
    if idx >= 0:
        insert_pos = idx + len(log_marker)
        # Skip any blank line after ## Log
        rest = content[insert_pos:]
        if rest.startswith("\n"):
            insert_pos += 1
            rest = rest[1:]
        new_content = content[:insert_pos] + entry + "\n" + rest
    else:
        new_content = content.rstrip() + f"\n\n## Log\n\n{entry}\n"

    # Rewrite file
    obsidian_delete(path)
    name = path.rsplit("/", 1)[-1].replace(".md", "")
    directory = path.rsplit("/", 1)[0]
    obsidian_create(name, directory, new_content)
    obsidian_property_set(path, "updated", now_iso())
    print(f"\033[32m✓\033[0m Note added to #{slug}")


def cmd_update(args):
    slug = args.id
    path = resolve_task_path(slug)
    if not path:
        die(f"Task not found: {slug}")

    props = obsidian_properties(path)
    content = obsidian_read(path)

    if args.title:
        obsidian_property_set(path, "title", args.title)
    if args.status:
        if args.status not in VALID_STATUSES:
            die(f"Invalid status. Use: {' | '.join(VALID_STATUSES)}")
        obsidian_property_set(path, "status", args.status)
    if args.tags:
        tag_list = ["type/task"] + [t.strip() for t in args.tags.split(",") if t.strip()]
        obsidian_property_set(path, "tags", json.dumps(tag_list))

    # For description update, need to rewrite content
    if args.description is not None:
        body = re.sub(r"^---[\s\S]*?---\s*", "", content)
        log_idx = body.find("## Log")
        log_section = body[log_idx:] if log_idx >= 0 else "## Log\n"

        project = props.get("project", "")
        parent = props.get("parent", "")
        rel_lines = []
        if project:
            rel_lines.append(f"Project: [[{project}]]")
        if parent:
            rel_lines.append(f"Parent: [[{parent}]]")

        new_body = "\n".join(rel_lines)
        if rel_lines:
            new_body += "\n\n"
        if args.description:
            new_body += args.description + "\n\n"
        new_body += log_section

        # Extract frontmatter
        fm_match = re.match(r"^(---[\s\S]*?---)\s*", content)
        fm = fm_match.group(1) if fm_match else "---\n---"
        new_content = fm + "\n\n" + new_body

        obsidian_delete(path)
        name = path.rsplit("/", 1)[-1].replace(".md", "")
        directory = path.rsplit("/", 1)[0]
        obsidian_create(name, directory, new_content)

    obsidian_property_set(path, "updated", now_iso())
    print(f"\033[32m✓\033[0m Updated #{slug}")


def cmd_delete(args):
    slug = args.id
    path = resolve_task_path(slug)
    if not path:
        die(f"Task not found: {slug}")

    # Check for subtasks
    all_tasks = load_all_tasks()
    children = [s for s, t in all_tasks.items() if t.get("parent") == slug]
    if children:
        die(f"Cannot delete #{slug}; has {len(children)} subtask(s): {', '.join(f'#{c}' for c in children)}")

    props = obsidian_properties(path)
    obsidian_delete(path)
    print(f"\033[32m✓\033[0m Deleted #{slug} — {props.get('title', slug)}")

# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="todo", description="Task manager backed by Obsidian vault")
    sub = parser.add_subparsers(dest="command")

    # --- Task commands ---
    p_add = sub.add_parser("add", help="Add a task")
    p_add.add_argument("title")
    p_add.add_argument("--project", default="")
    p_add.add_argument("--parent", default="")
    p_add.add_argument("--description", default="")
    p_add.add_argument("--tags", default="")
    p_add.add_argument("--note", default="")
    p_add.add_argument("--author", default="kuba")

    p_list = sub.add_parser("list", help="List tasks")
    p_list.add_argument("--project", default="")
    p_list.add_argument("--status", default="")
    p_list.add_argument("--tag", default="")
    p_list.add_argument("--all", action="store_true")
    p_list.add_argument("--tree", action="store_true")

    p_show = sub.add_parser("show", help="Show task detail")
    p_show.add_argument("id")

    p_status = sub.add_parser("status", help="Change task status")
    p_status.add_argument("id")
    p_status.add_argument("status", choices=VALID_STATUSES)

    p_log = sub.add_parser("log", help="Add log entry")
    p_log.add_argument("id")
    p_log.add_argument("text")
    p_log.add_argument("--author", default="kuba")

    p_update = sub.add_parser("update", help="Update task fields")
    p_update.add_argument("id")
    p_update.add_argument("--title", default=None)
    p_update.add_argument("--description", default=None)
    p_update.add_argument("--status", default=None)
    p_update.add_argument("--tags", default=None)

    p_delete = sub.add_parser("delete", help="Delete a task")
    p_delete.add_argument("id")

    # --- Project commands ---
    p_proj = sub.add_parser("project", help="Project commands")
    proj_sub = p_proj.add_subparsers(dest="project_command")

    proj_sub.add_parser("list", help="List projects")

    p_proj_add = proj_sub.add_parser("add", help="Add a project")
    p_proj_add.add_argument("name")
    p_proj_add.add_argument("--id", default="")
    p_proj_add.add_argument("--description", default="")

    p_proj_show = proj_sub.add_parser("show", help="Show project detail")
    p_proj_show.add_argument("id")

    p_proj_del = proj_sub.add_parser("delete", help="Delete a project")
    p_proj_del.add_argument("id")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    if args.command == "add":
        cmd_add(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "show":
        cmd_show(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "log":
        cmd_log(args)
    elif args.command == "update":
        cmd_update(args)
    elif args.command == "delete":
        cmd_delete(args)
    elif args.command == "project":
        if args.project_command == "list":
            cmd_project_list()
        elif args.project_command == "add":
            cmd_project_add(args)
        elif args.project_command == "show":
            cmd_project_show(args)
        elif args.project_command == "delete":
            cmd_project_delete(args)
        else:
            parser.parse_args(["project", "--help"])
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
