#!/usr/bin/env python3
"""
Validate README structure and relative links for code-module docs.

Usage:
  python3 audit_readmes.py --root /path/to/repo
  python3 audit_readmes.py --root /path/to/repo README.md src/runtime/core/README.md
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


FRONTMATTER_RE = re.compile(r"\A---\n.*?\n---\n", re.DOTALL)
HEADING_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")

CODE_MODULE_REQUIRED_SECTIONS = {
    "Activation",
    "Responsibility Boundary",
    "Operational Constraints",
    "Read Next",
}

ROOT_REQUIRED_SECTIONS = {
    "Structure",
    "Configuration",
    "Read Next",
}

CODE_MODULE_FRONTMATTER_KEYS = {
    "title",
    "section",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, help="Repository root")
    parser.add_argument("paths", nargs="*", help="Specific README paths to validate")
    return parser.parse_args()


def is_readme(path: Path) -> bool:
    return path.name.lower() == "readme.md"


def discover_readmes(root: Path) -> list[Path]:
    return sorted(
        path.relative_to(root)
        for path in root.rglob("*")
        if path.is_file() and is_readme(path)
    )


def load_targets(root: Path, raw_paths: list[str]) -> list[Path]:
    if not raw_paths:
        return discover_readmes(root)

    targets: list[Path] = []
    for raw in raw_paths:
        candidate = Path(raw)
        if candidate.is_absolute():
            path = candidate
        else:
            path = root / candidate

        if not path.exists():
            raise FileNotFoundError(f"Missing path: {raw}")

        if path.is_dir():
            readme = path / "README.md"
            if not readme.exists():
                raise FileNotFoundError(f"Directory has no README.md: {raw}")
            targets.append(readme.relative_to(root))
            continue

        if not is_readme(path):
            raise ValueError(f"Not a README.md path: {raw}")

        targets.append(path.relative_to(root))

    deduped: list[Path] = []
    seen: set[Path] = set()
    for path in targets:
        if path not in seen:
            seen.add(path)
            deduped.append(path)
    return deduped


def classify_readme(rel_path: Path) -> str:
    if rel_path == Path("README.md"):
        return "root"
    if rel_path.parts and rel_path.parts[0] == "src":
        return "code-module"
    return "other"


def parse_frontmatter(text: str) -> dict[str, str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}

    block = match.group(0).strip("-\n")
    result: dict[str, str] = {}
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        result[key.strip()] = value.strip()
    return result


def parse_sections(text: str) -> set[str]:
    return {match.group(1).strip() for match in HEADING_RE.finditer(text)}


def iter_relative_links(text: str) -> list[str]:
    links: list[str] = []
    for match in LINK_RE.finditer(text):
        target = match.group(1).strip()
        if not target:
            continue
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        links.append(target)
    return links


def validate_frontmatter(rel_path: Path, text: str, errors: list[str]) -> None:
    frontmatter = parse_frontmatter(text)
    missing = CODE_MODULE_FRONTMATTER_KEYS - set(frontmatter)
    if missing:
        errors.append(
            f"{rel_path}: missing frontmatter keys: {', '.join(sorted(missing))}"
        )


def validate_sections(rel_path: Path, text: str, kind: str, errors: list[str]) -> None:
    sections = parse_sections(text)
    required = (
        ROOT_REQUIRED_SECTIONS if kind == "root" else CODE_MODULE_REQUIRED_SECTIONS
    )
    missing = required - sections
    if missing:
        errors.append(
            f"{rel_path}: missing sections: {', '.join(sorted(missing))}"
        )


def resolve_link(base_file: Path, target: str) -> Path:
    target_no_fragment = target.split("#", 1)[0]
    return (base_file.parent / target_no_fragment).resolve()


def validate_links(root: Path, rel_path: Path, text: str, errors: list[str]) -> None:
    base_file = (root / rel_path).resolve()
    for target in iter_relative_links(text):
        resolved = resolve_link(base_file, target)
        if not resolved.exists():
            try:
                display = resolved.relative_to(root.resolve())
            except ValueError:
                display = resolved
            errors.append(f"{rel_path}: broken link {target} -> {display}")


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    if not root.exists():
        print(f"Root does not exist: {root}", file=sys.stderr)
        return 2

    try:
        targets = load_targets(root, args.paths)
    except (FileNotFoundError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2

    errors: list[str] = []
    checked = 0
    for rel_path in targets:
        text = (root / rel_path).read_text(encoding="utf-8")
        kind = classify_readme(rel_path)
        checked += 1

        if kind == "code-module":
            validate_frontmatter(rel_path, text, errors)
            validate_sections(rel_path, text, kind, errors)
            validate_links(root, rel_path, text, errors)
        elif kind == "root":
            validate_sections(rel_path, text, kind, errors)
            validate_links(root, rel_path, text, errors)
        else:
            validate_links(root, rel_path, text, errors)

    if errors:
        print(f"README audit failed: {len(errors)} issue(s) across {checked} file(s)")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"README audit passed: {checked} file(s) checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
