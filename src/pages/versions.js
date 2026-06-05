import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import manifest from '@site/versioning/manifest.json';

// Manifest is oldest-first; show newest first.
const ALL = (manifest.versions || []).slice().reverse();

export default function Versions() {
  const {siteConfig} = useDocusaurusContext();
  const {
    builtVersions = [],
    defaultVersion = null,
    currentDocsPath = '/docs/',
  } = siteConfig.customFields || {};
  const built = new Set(builtVersions);

  const urlFor = (v) => {
    if (!built.has(v)) return null;
    return v === defaultVersion ? '/docs/' : `/docs/${v}/`;
  };

  const stable = ALL.filter((v) => v.channel !== 'rc');
  const rc = ALL.filter((v) => v.channel === 'rc');

  const Row = ({v}) => {
    const url = urlFor(v.version);
    return (
      <tr key={v.version}>
        <th>
          {v.version}
          {v.version === defaultVersion && (
            <span className="badge badge--primary" style={{marginLeft: 8}}>
              latest
            </span>
          )}
        </th>
        <td>{(v.pypi_published || '').slice(0, 10)}</td>
        <td>{url ? <Link to={url}>Documentation</Link> : <em>not built</em>}</td>
      </tr>
    );
  };

  return (
    <Layout
      title="Documentation versions"
      description="Browse LiteLLM documentation for each stable release.">
      <main className="container margin-vert--lg">
        <h1>LiteLLM documentation versions</h1>
        <p>
          Each version below matches a stable <code>litellm</code> release. Check
          your installed version with <code>litellm --version</code> (or{' '}
          <code>pip show litellm</code>) and open the matching docs. The latest
          stable is the default at <Link to="/docs/">/docs</Link>.
        </p>

        <h2>Current</h2>
        <table>
          <tbody>
            <tr>
              <th>main 🚧</th>
              <td>in development (tracks the latest commit)</td>
              <td>
                <Link to={currentDocsPath}>Documentation</Link>
              </td>
            </tr>
          </tbody>
        </table>

        {rc.length > 0 && (
          <>
            <h2>Release candidate</h2>
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Published</th>
                  <th>Docs</th>
                </tr>
              </thead>
              <tbody>
                {rc.map((v) => (
                  <Row key={v.version} v={v} />
                ))}
              </tbody>
            </table>
          </>
        )}

        <h2>Stable versions ({stable.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Released (PyPI)</th>
              <th>Docs</th>
            </tr>
          </thead>
          <tbody>
            {stable.map((v) => (
              <Row key={v.version} v={v} />
            ))}
          </tbody>
        </table>

        <p style={{marginTop: '2rem'}}>
          <small>
            Versions are reconstructed from the documentation as it existed when
            each release was published; see{' '}
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
