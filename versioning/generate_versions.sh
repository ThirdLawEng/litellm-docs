#!/usr/bin/env bash
# Backfill Docusaurus versioned docs from historical git state.
#
# For each version in versioning/manifest.json (ascending semver), this script
# materializes the docs-repo `docs/` + `sidebars.js` exactly as they existed at
# that release's mapped source commit, then runs `docusaurus docs:version` to
# snapshot them into versioned_docs/ + versioned_sidebars/ + versions.json.
#
# Idempotent: with --reset it wipes prior versioned output and rebuilds the full
# set, so a clean re-run reproduces an identical tree from PyPI + git.
#
# Usage:
#   versioning/generate_versions.sh [--reset] [--only "1.79.0 1.85.0 ..."]
#
#   --reset            wipe versioned_docs/ versioned_sidebars/ versions.json first
#   --only "<list>"    generate only the listed versions (for the feasibility gate)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
MANIFEST="versioning/manifest.json"

RESET=0
ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset) RESET=1; shift;;
    --only) ONLY="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

restore_worktree() {
  rm -rf docs sidebars.js
  git checkout -q HEAD -- docs sidebars.js
}
trap restore_worktree EXIT

if [[ "$RESET" == "1" ]]; then
  echo ">> reset: wiping versioned output"
  rm -rf versioned_docs versioned_sidebars versions.json
fi

# Emit "version<TAB>sha" ascending; optionally filter to --only set.
mapfile -t ROWS < <(python3 - "$MANIFEST" "$ONLY" <<'PY'
import json, sys
manifest, only = sys.argv[1], sys.argv[2].split()
data = json.load(open(manifest))
for e in data["versions"]:
    if only and e["version"] not in only:
        continue
    print(f"{e['version']}\t{e['source_commit']}")
PY
)

echo ">> generating ${#ROWS[@]} version(s)"
for row in "${ROWS[@]}"; do
  ver="${row%%$'\t'*}"
  sha="${row##*$'\t'}"
  echo ">> [$ver] <- $sha"
  rm -rf docs sidebars.js
  git archive "$sha" docs sidebars.js | tar -x
  if ! npx docusaurus docs:version "$ver"; then
    echo "!! docs:version failed for $ver (sha $sha)" >&2
    restore_worktree
    exit 1
  fi
done

restore_worktree
trap - EXIT
echo ">> done. versions.json:"
cat versions.json 2>/dev/null || echo "(none)"
