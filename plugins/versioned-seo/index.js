/**
 * versioned-seo
 *
 * Post-build pass that marks every NON-latest docs page as `noindex` and points
 * its canonical URL at the equivalent page on the latest version. This prevents
 * ~73 backfilled versions from creating duplicate-content SEO dilution and keeps
 * search crawlers (incl. Inkeep's indexer) scoped to the latest docs.
 *
 * "Non-latest" = any HTML under `<outDir>/docs/<segment>/...` where `<segment>`
 * is a semver-looking version (e.g. 1.79.0) or the in-development `main`. The
 * latest version is served directly under `<outDir>/docs/...` and is left alone.
 */
const fs = require('fs');
const path = require('path');

const VERSION_SEGMENT = /^(?:\d+\.\d+\.\d+|main)$/;

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/** Build the canonical site path for an old-version HTML file. */
function canonicalPathFor(relFromDocs) {
  // relFromDocs e.g. "1.79.0/proxy/configs/index.html" or "main/index.html"
  const parts = relFromDocs.split(path.sep);
  parts.shift(); // drop the version segment -> equivalent latest path
  let rest = parts.join('/');
  rest = rest.replace(/index\.html$/, '').replace(/\.html$/, '');
  if (rest.length && !rest.endsWith('/')) rest += '/';
  return '/docs/' + rest;
}

module.exports = function versionedSeoPlugin() {
  return {
    name: 'versioned-seo',
    async postBuild({siteConfig, outDir}) {
      const docsRoot = path.join(outDir, 'docs');
      if (!fs.existsSync(docsRoot)) return;

      const base = (siteConfig.url || '').replace(/\/$/, '');
      let patched = 0;

      for (const seg of fs.readdirSync(docsRoot, {withFileTypes: true})) {
        if (!seg.isDirectory() || !VERSION_SEGMENT.test(seg.name)) continue;
        const versionDir = path.join(docsRoot, seg.name);

        for (const file of walk(versionDir, [])) {
          const relFromDocs = path.relative(docsRoot, file);
          const canonical = base + canonicalPathFor(relFromDocs);

          let html = fs.readFileSync(file, 'utf8');
          const robots =
            '<meta name="robots" content="noindex, follow"/>';
          const canonicalTag =
            `<link rel="canonical" href="${canonical}"/>`;

          // Replace Docusaurus' self-referential canonical, if present.
          if (/<link[^>]+rel="canonical"[^>]*>/i.test(html)) {
            html = html.replace(
              /<link[^>]+rel="canonical"[^>]*>/i,
              canonicalTag,
            );
          } else {
            html = html.replace('</head>', canonicalTag + '</head>');
          }

          // Add robots noindex once.
          if (!/name="robots"/i.test(html)) {
            html = html.replace('</head>', robots + '</head>');
          }

          fs.writeFileSync(file, html);
          patched++;
        }
      }

      console.log(
        `[versioned-seo] noindex + canonical applied to ${patched} non-latest docs pages`,
      );
    },
  };
};
