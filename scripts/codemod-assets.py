#!/usr/bin/env python3
"""Wrap static asset references that live in `public/` with apiPath().

Targets the asset folders we actually own: /providers/, /icons/, /favicon.svg,
/sw.js. Two passes:

  1. JSX attributes:  src="/providers/x.png"  →  src={apiPath("/providers/x.png")}
  2. Bare string literals (returns, object props, ternaries, etc.):
        "/providers/x.png"  →  apiPath("/providers/x.png")
     Skips cases already wrapped (negative lookbehind on `apiPath(`).

Idempotent — running twice is a no-op.
Adds the `import { apiPath } from "@/lib/basePath"` if missing.

Usage:
  python3 scripts/codemod-assets.py [--apply]
"""
from __future__ import annotations
import argparse
import re
from pathlib import Path

ROOT = Path("/home/itolstov/Projects/other/9router")
SRC = ROOT / "src"

# Paths inside public/ that are *our* assets and need the prefix.
ASSET_BODY = r'(?:/providers/[^"\'`]+|/icons/[^"\'`]+|/favicon\.svg|/sw\.js)'

# Pass 1 — JSX attribute form: `attr="/asset"`. Convert the entire attribute
# value to a JSX expression so apiPath() runs at render time.
JSX_ATTR = re.compile(r'(\w+)="(' + ASSET_BODY + r')"')

# Pass 2 — bare string literal that's NOT already inside apiPath(...).
# Negative lookbehind on `apiPath(` (six chars) keeps the codemod idempotent.
BARE_LITERAL = re.compile(
    r'(?<!apiPath\()(["\'`])(' + ASSET_BODY + r')(\1)'
)


def transform(content: str) -> tuple[str, int]:
    count = 0

    def jsx_repl(m: re.Match) -> str:
        nonlocal count
        attr, path = m.group(1), m.group(2)
        count += 1
        return f'{attr}={{apiPath("{path}")}}'

    def lit_repl(m: re.Match) -> str:
        nonlocal count
        quote, path, _ = m.group(1), m.group(2), m.group(3)
        count += 1
        return f"apiPath({quote}{path}{quote})"

    new = JSX_ATTR.sub(jsx_repl, content)
    new = BARE_LITERAL.sub(lit_repl, new)
    return new, count


def add_import(content: str) -> str:
    if "from \"@/lib/basePath\"" in content or "from '@/lib/basePath'" in content:
        return content
    lines = content.splitlines(keepends=True)
    last_import_idx = -1
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("import ") and stripped.endswith(";"):
            last_import_idx = i
        elif stripped and not stripped.startswith(("//", "/*", "*", '"use client"', "'use client'")):
            if last_import_idx >= 0:
                break
    insert_at = last_import_idx + 1
    new_import = 'import { apiPath } from "@/lib/basePath";\n'
    return "".join(lines[:insert_at]) + new_import + "".join(lines[insert_at:])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    targets = sorted(SRC.rglob("*.js"))
    total_files = 0
    total_refs = 0
    for p in targets:
        text = p.read_text(encoding="utf-8")
        new_text, n = transform(text)
        if n == 0:
            continue
        new_text = add_import(new_text)
        total_files += 1
        total_refs += n
        if args.apply:
            p.write_text(new_text, encoding="utf-8")
        else:
            print(f"  would change {p.relative_to(ROOT)}: {n} refs")

    verb = "rewritten" if args.apply else "would be rewritten"
    print(f"\n{total_files} files, {total_refs} asset refs {verb}")


if __name__ == "__main__":
    main()
