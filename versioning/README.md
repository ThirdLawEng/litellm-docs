# Docs versioning

Versioned LiteLLM docs, so users can read the documentation for the specific
stable `litellm` release they're running.

- Check your version: `litellm --version` (or `pip show litellm`).
- Browse all versions: **/versions**. The latest stable is the default at `/docs/`.
- The unversioned working tree is **main** at `/docs/main/` (unreleased banner);
  the latest rc gets an unreleased banner; older stables get an "unmaintained" banner.

## What gets versioned

**Stable releases only**, from the 1.83.x line onward, plus the latest rc:

- **1.83.x line** → only the releases promoted to `-stable` (1.83.3, 1.83.7,
  1.83.10, 1.83.14), labeled with a `-stable` suffix (e.g. `1.83.10-stable`).
- **1.84.0+** → every final semver release (the move to PEP 440 / semver means
  each final `X.Y.Z` is the stable release), labeled as-is.
- **latest rc** → the single most recent release candidate (e.g. `1.88.0rc3`),
  the only pre-release included.

Scope: the entire `docs/` tree. `release_notes/` and `blog/` are not versioned.

## How it's built (important)

The version snapshots are **derived artifacts** — they are NOT committed. They are
regenerated from git history at build time:

```
npm run build
  └─ prebuild: versioning/prepare-snapshots.sh   (regenerates versioned_docs/ from manifest + git history)
  └─ build:    docusaurus build                  (renders current + all versions)
```

This keeps the repo clean (only the ~small `manifest.json` is committed) and means
the live build renders the versions directly — there's no separate archive to host.
With ~two dozen stable versions the build stays well under typical CI/Vercel limits.

`DOCS_VERSIONS_BUILD_LIMIT` controls how many versions a build renders:

- `all` **(default)** — every stable version + latest rc + main.
- `current` — current docs only (fast preview; no snapshots).
- `<N>` — main + the latest N versions.

> **Hosts that shallow-clone:** `prepare-snapshots.sh` deepens git history as
> needed to reach each version's source commit. If history/python/git aren't
> available it logs a warning and the build falls back to current-docs-only
> rather than failing.

## Version → commit mapping (and its caveat)

This docs repo has no release tags (pip releases are tagged in `berriai/litellm`).
Each release is mapped to a docs commit by **publish date**:

```
git rev-list -1 --before="<PyPI upload timestamp>" origin/main
```

> **Best effort.** Docs edits that landed shortly *after* a release are attributed
> to the next version; same-day releases may share a source commit. See
> `manifest.json` for the exact commit each version maps to.

## Files

| File | Purpose |
| --- | --- |
| `build_manifest.py` | Selects the stable release set (+ latest rc) and maps each to a source commit. Writes `manifest.json`. |
| `manifest.json` | Committed source of truth: `version` (doc label), `pip_version`, `channel`, `pypi_published`, `source_commit`. |
| `prepare-snapshots.sh` | npm `prebuild` hook: regenerates snapshots at build time (deepens history as needed; degrades gracefully). |
| `generate_versions.sh` | Materializes each version's historical `docs/` + `sidebars.js` and runs `docusaurus docs:version`; links sibling dirs, restores missing images, sanitizes sidebars. |
| `link_escaping_siblings.py` | Symlinks repo-root siblings (img/src/static) into `versioned_docs/` so escaping relative refs resolve. |
| `fill_missing_images.py` | Restores images referenced by old snapshots but since removed from `img/`. |
| `sanitize_sidebars.py` | Removes versioned-sidebar refs to doc ids absent from a snapshot. |
| `graceful-fs-preload.js` | Bounds concurrent file ops so many-version builds don't hit EMFILE on low-ulimit hosts. |

## Regenerating / updating

```bash
# Refresh the manifest from PyPI + git history (needs full history of origin/main).
git fetch --unshallow origin main   # if shallow
python3 versioning/build_manifest.py

# Regenerate snapshots locally (optional; CI/build does this automatically).
versioning/generate_versions.sh --reset

# Build.
npm run build
```

For new releases, `build_manifest.py` automatically picks up new 1.84.0+ finals
and the latest rc from PyPI, so re-running it refreshes the set. The 1.83.x
`-stable` list is fixed (that line is closed).
