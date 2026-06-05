#!/usr/bin/env python3
"""Build the docs-versioning manifest — STABLE releases only.

Selection (per project decision):
  * 1.83.x line  -> only the releases promoted to `-stable` (1.83.3/7/10/14),
                    labeled with a `-stable` suffix (e.g. "1.83.10-stable").
  * 1.84.0+      -> every final semver release (the move to PEP 440 / semver
                    means each final X.Y.Z is the stable release), labeled as-is.
  * latest rc    -> the single most recent release candidate (e.g. 1.88.0rc3),
                    the only pre-release included.

Each release is mapped to the docs-repo commit current when it was published on
PyPI:  git rev-list -1 --before="<pypi_publish_timestamp>" origin/main

Output: versioning/manifest.json (oldest -> newest).
Each entry: {version (doc label), pip_version, channel, pypi_published,
             source_commit, source_commit_date}.
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
BRANCH = os.environ.get("DOCS_MAP_BRANCH", "origin/main")

# 1.83.x releases promoted to `-stable` (from litellm's `*-stable` git tags).
# The 1.83 line is closed, so this list is fixed.
STABLE_1_83 = ["1.83.3", "1.83.7", "1.83.10", "1.83.14"]
# From here on, every final semver release is a stable release.
SEMVER_FLOOR = (1, 84, 0)

FINAL_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
RC_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)rc(\d+)$")


def load_pypi():
    if os.path.isfile(PYPI_CACHE) and os.path.getsize(PYPI_CACHE) > 0:
        return json.load(open(PYPI_CACHE))
    with urllib.request.urlopen(PYPI_URL, timeout=30) as r:
        data = json.loads(r.read())
    json.dump(data, open(PYPI_CACHE, "w"))
    return data


def published_at(files):
    ts = [f["upload_time_iso_8601"] for f in files if f.get("upload_time_iso_8601")]
    return min(ts) if ts else None


def tup(v):
    return tuple(int(x) for x in v.split("."))


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
    rel = load_pypi()["releases"]
    pub = {v: published_at(f) for v, f in rel.items() if f and published_at(f)}

    # selected: list of (sort_key, label, pip_version, channel)
    selected = []

    # 1.83.x stable
    for v in STABLE_1_83:
        if v in pub:
            selected.append((tup(v) + (0,), f"{v}-stable", v, "stable"))

    # 1.84.0+ finals
    for v, ts in pub.items():
        m = FINAL_RE.match(v)
        if m and tup(v) >= SEMVER_FLOOR:
            selected.append((tup(v) + (0,), v, v, "stable"))

    # latest rc
    rcs = []
    for v in pub:
        m = RC_RE.match(v)
        if m:
            rcs.append((tuple(int(x) for x in m.groups()), v))
    if rcs:
        rcs.sort()
        _, rc = rcs[-1]
        base = RC_RE.match(rc)
        key = tuple(int(x) for x in base.groups()[:3]) + (-1,)  # before its final
        selected.append((key, rc, rc, "rc"))

    selected.sort(key=lambda x: x[0])

    entries = []
    for _key, label, pip_version, channel in selected:
        ts = pub[pip_version]
        sha = map_commit(ts)
        entries.append({
            "version": label,
            "pip_version": pip_version,
            "channel": channel,
            "pypi_published": ts,
            "source_commit": sha,
            "source_commit_date": commit_date(sha),
        })

    latest_stable = next(
        (e["version"] for e in reversed(entries) if e["channel"] == "stable"), None
    )
    manifest = {
        "selection": "stable releases from 1.83.x (+ latest rc)",
        "branch": BRANCH,
        "count": len(entries),
        "latest_stable": latest_stable,
        "versions": entries,
    }
    out = os.path.join(HERE, "manifest.json")
    json.dump(manifest, open(out, "w"), indent=2)
    open(out, "a").write("\n")

    print(f"wrote {out}: {manifest['count']} versions; latest_stable={latest_stable}")
    for e in entries:
        print(f"  {e['version']:16s} <- {e['source_commit'][:10]} ({e['pypi_published'][:10]}, {e['channel']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
