#!/usr/bin/env bash
# Regenerate the versioned-docs snapshots at BUILD time from git history, so they
# never have to be committed. Runs as an npm "prebuild" hook (see package.json).
#
# Design goals:
#  - Keeps the repo clean: versioned_docs/ etc. are derived artifacts, not source.
#  - Graceful: if git history / python / the manifest isn't available (so the
#    snapshots can't be rebuilt), it logs a warning and exits 0, and the build
#    falls back to current-docs-only rather than failing.
#  - Idempotent for local dev: if snapshots already exist, it does nothing.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# current-only build (e.g. a fast preview) -> nothing to prepare.
LIMIT="$(echo "${DOCS_VERSIONS_BUILD_LIMIT:-all}" | tr '[:upper:]' '[:lower:]')"
case "$LIMIT" in
  current|none|0|"") echo "[prepare-snapshots] DOCS_VERSIONS_BUILD_LIMIT=$LIMIT -> current docs only; skipping"; exit 0 ;;
esac

# Already generated (local dev / a prior step)? leave as-is.
if [ -f versions.json ] && [ -d versioned_docs ]; then
  echo "[prepare-snapshots] snapshots already present; skipping regeneration"
  exit 0
fi

warn() { echo "[prepare-snapshots] WARNING: $*; building current docs only" >&2; exit 0; }

command -v git >/dev/null 2>&1 || warn "git not found"
[ -d .git ] || warn "no .git (shallow deploy without history)"
command -v python3 >/dev/null 2>&1 || warn "python3 not found"
[ -f versioning/manifest.json ] || warn "no versioning/manifest.json"

# Ensure the mapped source commits are present. Hosts often shallow-clone, so
# deepen history until every source commit in the manifest is reachable.
missing_commits() {
  python3 - <<'PY'
import json, subprocess, sys
m = json.load(open("versioning/manifest.json"))
miss = 0
for e in m.get("versions", []):
    sha = e["source_commit"]
    r = subprocess.run(["git", "cat-file", "-e", sha + "^{commit}"],
                       capture_output=True)
    if r.returncode != 0:
        miss += 1
print(miss)
PY
}

if [ "$(missing_commits)" != "0" ]; then
  echo "[prepare-snapshots] fetching history for source commits..."
  git fetch --unshallow --quiet 2>/dev/null \
    || git fetch --deepen=5000 --quiet 2>/dev/null \
    || true
fi
if [ "$(missing_commits)" != "0" ]; then
  warn "some source commits unreachable even after deepening"
fi

echo "[prepare-snapshots] regenerating snapshots (DOCS_VERSIONS_BUILD_LIMIT=$LIMIT)..."
if [ "$LIMIT" = "all" ]; then
  versioning/generate_versions.sh --reset || warn "generation failed"
else
  # latest N: manifest is oldest-first, so take the last N versions
  ONLY="$(python3 -c "import json;v=[e['version'] for e in json.load(open('versioning/manifest.json'))['versions']];print(' '.join(v[-int('$LIMIT'):]))")"
  versioning/generate_versions.sh --reset --only "$ONLY" || warn "generation failed"
fi
echo "[prepare-snapshots] done"
