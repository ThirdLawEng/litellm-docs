import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import {useVersions} from '@docusaurus/plugin-content-docs/client';
import manifest from '@site/versioning/manifest.json';

// version string -> PyPI publish date (YYYY-MM-DD)
const RELEASED = Object.fromEntries(
  (manifest.versions || []).map((v) => [
    v.version,
    (v.pypi_published || '').slice(0, 10),
  ]),
);

function landingHref(version) {
  const mainDoc = version.docs.find((d) => d.id === version.mainDocId);
  return (mainDoc && mainDoc.path) || version.path;
}

export default function Versions() {
  // Versions for the default docs plugin, newest-first (incl. "current"/main).
  const versions = useVersions(undefined);
  const current = versions.find((v) => v.name === 'current');
  const released = versions.filter((v) => v.name !== 'current');

  return (
    <Layout
      title="Documentation versions"
      description="Browse LiteLLM documentation for every released pip version.">
      <main className="container margin-vert--lg">
        <h1>LiteLLM documentation versions</h1>
        <p>
          Each version below matches a published <code>litellm</code> pip
          release. Check your installed version with{' '}
          <code>litellm --version</code> (or <code>pip show litellm</code>) and
          open the matching docs. The newest release is the default, served at{' '}
          <Link to="/docs/">/docs</Link>.
        </p>

        {current && (
          <>
            <h2>Current (in development)</h2>
            <table>
              <tbody>
                <tr>
                  <th>{current.label}</th>
                  <td>tracks the <code>main</code> branch (unreleased)</td>
                  <td>
                    <Link to={landingHref(current)}>Documentation</Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        <h2>Released versions ({released.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Released (PyPI)</th>
              <th>Docs</th>
            </tr>
          </thead>
          <tbody>
            {released.map((version) => (
              <tr key={version.name}>
                <th>
                  {version.label}
                  {version.isLast && (
                    <span
                      className="badge badge--primary"
                      style={{marginLeft: 8}}>
                      latest
                    </span>
                  )}
                </th>
                <td>{RELEASED[version.name] || '—'}</td>
                <td>
                  <Link to={landingHref(version)}>Documentation</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{marginTop: '2rem'}}>
          <small>
            Historical versions are reconstructed from the documentation as it
            existed when each release was published; see{' '}
            <a href="https://github.com/BerriAI/litellm-docs/blob/main/versioning/README.md">
              versioning/README.md
            </a>{' '}
            for the methodology and its caveats.
          </small>
        </p>
      </main>
    </Layout>
  );
}
