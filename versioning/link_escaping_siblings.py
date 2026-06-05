#!/usr/bin/env python3
"""Symlink repo-root sibling dirs into versioned_docs/ so escaping refs resolve.

Historical docs reference repo-root siblings via relative paths that escape the
docs tree, e.g. `../../img/x.png`, `../src/components/Y.js`, `../static/img/z.png`.
Because `versioned_docs/version-N/` is one level deeper than `docs/`, every such
ref lands at `versioned_docs/<sibling>/...`. Exposing each referenced sibling as
a symlink there (`versioned_docs/img -> ../img`, etc.) makes webpack/MDX resolve
them across all versions, regardless of the referencing file's depth.

Content dirs (docs/blog/release_notes) are intentionally NOT linked: links into
them are markdown doc-links resolved by Docusaurus, not webpack modules, and
linking them would mis-resolve versioned links to the current content.
"""
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VDOCS = os.path.join(REPO, "versioned_docs")
SKIP = {"docs", "blog", "release_notes"}  # markdown content, resolved by Docusaurus

PATTERNS = [
    re.compile(r'\]\(\s*((?:\.\./)+[^)\s]+)'),                       # ![](..) / [](..)
    re.compile(r'(?:src|href)=["\']((?:\.\./)+[^"\']+)["\']'),        # html src/href
    re.compile(r'require\(\s*["\']((?:\.\./)+[^"\']+)["\']'),         # require('..')
    re.compile(r'import\s+[^\'"]*from\s+["\']((?:\.\./)+[^"\']+)["\']'),
    re.compile(r'import\(\s*["\']((?:\.\./)+[^"\']+)["\']'),          # dynamic import
]


def main():
    needed = set()
    for root, dirs, files in os.walk(VDOCS):
        # don't descend into already-created sibling symlinks
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
        for fn in files:
            if not fn.endswith((".md", ".mdx")):
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, VDOCS).split(os.sep, 1)[1]  # drop version-N/
            D = rel.count(os.sep)
            try:
                txt = open(full, encoding="utf-8").read()
            except OSError:
                continue
            for pat in PATTERNS:
                for m in pat.finditer(txt):
                    ref = m.group(1)
                    k = ref.count("../")
                    if k >= D + 1:  # escapes the version dir -> lands at versioned_docs/<seg>
                        seg = ref.split("../")[-1].split("/")[0]
                        needed.add(seg)

    linked = []
    for seg in sorted(needed):
        if seg in SKIP:
            continue
        if not os.path.isdir(os.path.join(REPO, seg)):
            continue  # not a real repo-root dir (e.g. a stray ../foo.md doc link)
        link = os.path.join(VDOCS, seg)
        if os.path.islink(link) or os.path.exists(link):
            continue
        os.symlink(os.path.join("..", seg), link)
        linked.append(seg)

    print(f"[link-siblings] symlinked into versioned_docs/: {linked or '(none new)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
