#!/usr/bin/env python3
"""Codemod: wrap fetch("/api/...") and fetch(`/api/...`) calls in apiPath().

Adds `import { apiPath } from "@/lib/basePath";` to files that get rewritten
and don't already have it. Idempotent — skips already-wrapped calls.

Usage:
  python3 codemod-fetch.py [--apply]
"""
from __future__ import annotations
import argparse
import re
from pathlib import Path

ROOT = Path("/home/itolstov/Projects/other/9router")
SRC = ROOT / "src"

# Match `<callee>("/api/...` for the URL-using browser APIs we care about.
# `new EventSource(...)` becomes `new EventSource(apiPath(...))` and so on.
# Idempotent: the rewritten form has no quote right after the `(`, so it
# does not re-match.
PATTERN = re.compile(
    r'(fetch|new\s+EventSource|new\s+WebSocket|navigator\.sendBeacon)\(\s*(["\'`])(/api/[^"\'`]*)(\2)'
)


def transform(content: str) -> tuple[str, int]:
    count = 0

    def repl(m: re.Match) -> str:
        nonlocal count
        callee, quote, path, _close = m.group(1), m.group(2), m.group(3), m.group(4)
        count += 1
        return f"{callee}(apiPath({quote}{path}{quote})"

    new = PATTERN.sub(repl, content)
    return new, count


def add_import(content: str) -> str:
    if "from \"@/lib/basePath\"" in content or "from '@/lib/basePath'" in content:
        return content
    # Insert after the last existing top-level `import ... from ...;` line
    lines = content.splitlines(keepends=True)
    last_import_idx = -1
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("import ") and stripped.endswith(";"):
            last_import_idx = i
        # Stop after first non-import, non-blank, non-comment line
        elif stripped and not stripped.startswith("//") and not stripped.startswith("/*") \
                and not stripped.startswith("*") and not stripped.startswith('"use client"') \
                and not stripped.startswith("'use client'"):
            if last_import_idx >= 0:
                break
    insert_at = last_import_idx + 1
    new_import = 'import { apiPath } from "@/lib/basePath";\n'
    return "".join(lines[:insert_at]) + new_import + "".join(lines[insert_at:])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = ap.parse_args()

    targets = sorted(SRC.rglob("*.js"))
    total_files = 0
    total_calls = 0
    for p in targets:
        text = p.read_text(encoding="utf-8")
        if "fetch(" not in text:
            continue
        new_text, n = transform(text)
        if n == 0:
            continue
        new_text = add_import(new_text)
        total_files += 1
        total_calls += n
        if args.apply:
            p.write_text(new_text, encoding="utf-8")
        else:
            print(f"  would change {p.relative_to(ROOT)}: {n} calls")

    print(f"\n{total_files} files, {total_calls} fetch calls "
          f"{'rewritten' if args.apply else 'would be rewritten'}")


if __name__ == "__main__":
    main()
