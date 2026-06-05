#!/usr/bin/env python3
"""Build the docs-versioning manifest.

For every FINAL pip release of `litellm` (X.Y.Z, no rc/dev/post) at or after the
floor version, map the release to the docs-repo commit that was current when the
release was published on PyPI, using:

    git rev-list -1 --before="<pypi_publish_timestamp>" origin/main

This yields a deterministic, reproducible mapping of "docs as of release X.Y.Z"
to a concrete commit SHA. The mapping is best-effort (docs touched shortly after
a release land in the next version); see versioning/README.md for the caveat.

Output: versioning/manifest.json  (sorted oldest -> newest)
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PYPI_CACHE = os.environ.get("PYPI_CACHE", "/tmp/litellm.json")
PYPI_URL = "https://pypi.org/pypi/litellm/json"
FLOOR = (1, 79, 0)          # inclusive lower bound
BRANCH = "origin/main"      # docs history to map against
FINAL_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def load_pypi():
    if os.path.isfile(PYPI_CACHE) and os.path.getsize(PYPI_CACHE) > 0:
        with open(PYPI_CACHE) as f:
            return json.load(f)
    with urllib.request.urlopen(PYPI_URL, timeout=30) as r:
        data = json.loads(r.read())
    with open(PYPI_CACHE, "w") as f:
        json.dump(data, f)
    return data


def published_at(files):
    ts = [f["upload_time_iso_8601"] for f in files if f.get("upload_time_iso_8601")]
    return min(ts) if ts else None


def map_commit(ts):
    out = subprocess.run(
        ["git", "-C", REPO, "rev-list", "-1", f"--before={ts}", BRANCH],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    if not out:
        raise RuntimeError(f"no commit before {ts} on {BRANCH}")
    return out


def commit_date(sha):
    return subprocess.run(
        ["git", "-C", REPO, "show", "-s", "--format=%cI", sha],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def main():
    data = load_pypi()
    rows = []
    for ver, files in data["releases"].items():
        m = FINAL_RE.match(ver)
        if not m or not files:
            continue
        tup = tuple(int(x) for x in m.groups())
        if tup < FLOOR:
            continue
        ts = published_at(files)
        if not ts:
            continue
        rows.append((tup, ver, ts))

    rows.sort(key=lambda r: r[0])
    entries = []
    for tup, ver, ts in rows:
        sha = map_commit(ts)
        entries.append({
            "version": ver,
            "pypi_published": ts,
            "source_commit": sha,
            "source_commit_date": commit_date(sha),
        })

    manifest = {
        "floor_version": ".".join(map(str, FLOOR)),
        "branch": BRANCH,
        "count": len(entries),
        "latest_version": entries[-1]["version"] if entries else None,
        "versions": entries,
    }
    out_path = os.path.join(HERE, "manifest.json")
    with open(out_path, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print(f"wrote {out_path}")
    print(f"count={manifest['count']} floor={manifest['floor_version']} "
          f"latest={manifest['latest_version']}")
    if entries:
        print(f"oldest: {entries[0]['version']} -> {entries[0]['source_commit'][:10]} "
              f"({entries[0]['source_commit_date']})")
        print(f"newest: {entries[-1]['version']} -> {entries[-1]['source_commit'][:10]} "
              f"({entries[-1]['source_commit_date']})")


if __name__ == "__main__":
    sys.exit(main())
