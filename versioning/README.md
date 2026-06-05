# Docs versioning

This directory contains the tooling that backfills **Docusaurus versioned docs**
for LiteLLM, so users can read the documentation as it existed for the specific
`litellm` pip version they have installed.

- Check your version: `litellm --version` (or `pip show litellm`).
- Browse all versions: **/versions**. The newest release is the default at `/docs/`.
- The unversioned working tree (`docs/`) is published as **main** at `/docs/main/`
  with an "unreleased" banner; older versions show an "unmaintained" banner.

## What gets versioned

- **Range:** every *final* `X.Y.Z` pip release from `1.79.0` (2025-10-26) through
  the latest stable (`floor_version` in `manifest.json`). Pre-releases
  (`.devN`, `rcN`, `postN`) are excluded — they are not `pip install` targets in
  production.
- **Scope:** the entire `docs/` tree. `release_notes/` and `blog/` are
  intentionally **not** versioned — they are already chronological.

## How the mapping works (and its caveat)

This docs repo has **no release tags** (pip releases are tagged in `berriai/litellm`).
We map each release to a docs commit by **publish date**:

```
git rev-list -1 --before="<PyPI upload timestamp>" origin/main
```

i.e. the last `main` commit that existed when the release was published on PyPI.

> **Caveat — best effort.** Documentation edits that landed shortly *after* a
> release was cut are attributed to the *next* version. A snapshot therefore
> reflects "the docs as of the release date", not a tag-exact correspondence.
> Same-day releases may share a source commit. This is acceptable per the
> project decision; see `manifest.json` for the exact commit each version maps to.

## Files

| File | Purpose |
| --- | --- |
| `build_manifest.py` | Builds `manifest.json`: for each final release ≥ floor, resolves the source commit via the date mapping above. |
| `manifest.json` | Generated. The source of truth: `version`, `pypi_published`, `source_commit`, `source_commit_date`. |
| `generate_versions.sh` | Materializes each version's historical `docs/` + `sidebars.js` and runs `docusaurus docs:version` to snapshot it. |

## Regenerating (reproducible)

```bash
# 1. Refresh the manifest from PyPI + git history (needs full history of origin/main).
git fetch --unshallow origin main   # if the clone is shallow
python3 versioning/build_manifest.py

# 2. Regenerate all versioned_docs / versioned_sidebars / versions.json from scratch.
versioning/generate_versions.sh --reset

# 3. Build to validate.
npm run build
```

`generate_versions.sh --reset` is idempotent: a clean re-run reproduces an
identical `versioned_docs/` tree, `versioned_sidebars/`, and `versions.json`.

To regenerate only a subset (e.g. for a quick build check):

```bash
versioning/generate_versions.sh --reset --only "1.79.0 1.85.0 1.87.1"
```

## Going forward (not yet automated)

Cutting a doc version for **future** releases is intentionally left manual for
now. Until automation is added, after a new release simply re-run step 1–2 above
(or add the single new version and run `docusaurus docs:version <new>`), then
commit. A future enhancement can hook this into the release pipeline.
