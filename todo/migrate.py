#!/usr/bin/env python3
"""Migrate flat tasks/ structure to project-based folder hierarchy.

Before:
  tasks/
    <any-task>.md
    projects/
      <project>.md

After:
  tasks/
    <project>.md
    <project>/
      <task>.md
      <task>/
        <subtask>.md
    _inbox/
      <orphan-task>.md
"""

import json
import subprocess
import sys

OBSIDIAN_BIN = "/usr/local/bin/obsidian"
TASKS_ROOT = "tasks"


def obsidian(*args):
    r = subprocess.run([OBSIDIAN_BIN, *args], capture_output=True, text=True, timeout=5)
    if r.stdout.startswith("Error: "):
        raise RuntimeError(r.stdout.strip())
    return r.stdout


def search(query, path=None):
    args = ["search", f"query={query}", "format=json"]
    if path:
        args.append(f"path={path}")
    out = obsidian(*args).strip()
    if not out or out == "No matches found.":
        return []
    return json.loads(out)


def read(path):
    return obsidian("read", f"path={path}")


def props(path):
    out = obsidian("properties", f"path={path}", "format=json").strip()
    if not out or out.startswith("No"):
        return {}
    return json.loads(out)


def create(name, directory, content):
    obsidian("create", f"name={name}", f"path={directory}", f"content={content}")


def delete(path):
    obsidian("delete", f"path={path}", "permanent")


def main():
    dry_run = "--dry-run" in sys.argv

    # 1. Load all projects
    project_paths = search("tag:type/project")
    projects = {}
    for p in project_paths:
        slug = p.rsplit("/", 1)[-1].replace(".md", "")
        projects[slug] = {"path": p, "props": props(p), "content": read(p)}
    print(f"Found {len(projects)} projects: {', '.join(projects.keys())}")

    # 2. Load all tasks
    task_paths = search("tag:type/task", TASKS_ROOT)
    tasks = {}
    for p in task_paths:
        slug = p.rsplit("/", 1)[-1].replace(".md", "")
        tasks[slug] = {"path": p, "props": props(p), "content": read(p)}
    print(f"Found {len(tasks)} tasks")

    # 3. Resolve effective project for each task (walk parent chain)
    def resolve_project(slug, visited=None):
        if visited is None:
            visited = set()
        if slug in visited:
            return None
        visited.add(slug)
        t = tasks.get(slug)
        if not t:
            return None
        proj = t["props"].get("project", "")
        if proj:
            return proj
        parent = t["props"].get("parent", "")
        if parent:
            return resolve_project(parent, visited)
        return None

    task_projects = {}
    for slug in tasks:
        task_projects[slug] = resolve_project(slug)

    # 4. Plan moves
    moves = []

    # 4a. Projects: tasks/projects/<slug>.md → tasks/<slug>.md
    for slug, proj in projects.items():
        new_path = f"{TASKS_ROOT}/{slug}.md"
        if proj["path"] != new_path:
            moves.append(("project", slug, proj["path"], new_path, TASKS_ROOT, proj["content"]))

    # 4b. Tasks: figure out target directory
    for slug, task in tasks.items():
        effective_project = task_projects[slug]
        parent = task["props"].get("parent", "")

        if parent and effective_project:
            # Subtask: tasks/<project>/<parent>/<slug>.md
            target_dir = f"{TASKS_ROOT}/{effective_project}/{parent}"
        elif effective_project:
            # Top-level task: tasks/<project>/<slug>.md
            target_dir = f"{TASKS_ROOT}/{effective_project}"
        else:
            # Orphan: tasks/_inbox/<slug>.md
            target_dir = f"{TASKS_ROOT}/_inbox"

        new_path = f"{target_dir}/{slug}.md"
        if task["path"] != new_path:
            moves.append(("task", slug, task["path"], new_path, target_dir, task["content"]))

    # 5. Report
    print(f"\nPlanned {len(moves)} moves:")
    for kind, slug, old, new, _, _ in moves:
        print(f"  [{kind}] {old} → {new}")

    if dry_run:
        print("\n--dry-run: no changes made.")
        return

    # 6. Execute: create new files first, then delete old ones
    print("\nCreating new files...")
    created = []
    for kind, slug, old, new, target_dir, content in moves:
        try:
            create(slug, target_dir, content)
            created.append((slug, new))
            print(f"  ✓ {new}")
        except Exception as e:
            print(f"  ✗ {new}: {e}", file=sys.stderr)

    print("\nDeleting old files...")
    for kind, slug, old, new, _, _ in moves:
        # Only delete if we successfully created the new one
        if any(s == slug and n == new for s, n in created):
            try:
                delete(old)
                print(f"  ✓ deleted {old}")
            except Exception as e:
                print(f"  ✗ {old}: {e}", file=sys.stderr)

    # 7. Clean up old projects/ directory if empty
    remaining = search("tag:type/project", f"{TASKS_ROOT}/projects")
    if not remaining:
        print("\nOld projects/ directory is empty.")

    print(f"\nDone. Migrated {len(created)} files.")


if __name__ == "__main__":
    main()
