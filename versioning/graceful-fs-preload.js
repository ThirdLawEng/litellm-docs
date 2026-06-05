// Preloaded via NODE_OPTIONS (see package.json "build") so the WHOLE process is
// resilient to EMFILE ("too many open files") when Docusaurus loads many doc
// versions concurrently on hosts with a low file-descriptor ulimit (macOS
// defaults to 256; some Linux CI/containers to 1024-4096). Docusaurus loads all
// versions' content in parallel, so with 70+ versions the open-FD count explodes.
//
// Layers:
//  1. graceful-fs.gracefulify(fs) — queues/retries on EMFILE (callback API).
//  2. A real concurrency *limiter* (semaphore) around the file-reading methods
//     of BOTH the callback API (used by fs-extra, which Docusaurus uses) and the
//     promises API. Each wrapped op holds a slot for its full duration (open ->
//     read -> close), so concurrent open FDs stay bounded regardless of how
//     aggressively Docusaurus parallelizes. `open`/streams are intentionally not
//     wrapped (the FD outlives the call, so a slot can't bound it).
//
// Must be loaded via `node --require` so the patch is in place before Docusaurus
// core captures any fs bindings.
const fs = require('fs');
const gracefulFs = require('graceful-fs');
gracefulFs.gracefulify(fs);

const MAX_CONCURRENT = Number(process.env.FS_MAX_CONCURRENT || 256);
let active = 0;
const waiters = [];

function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}
function release() {
  active--;
  const next = waiters.shift();
  if (next) {
    active++;
    next();
  } else if (active < 0) {
    active = 0;
  }
}

const WRAPPED = Symbol('fs-semaphore-wrapped');
// Methods that open->use->close within the single call, so a slot bounds the FD.
const METHODS = [
  'readFile', 'readdir', 'stat', 'lstat',
  'realpath', 'readlink', 'access', 'copyFile', 'writeFile',
];

function wrapPromise(obj) {
  if (!obj) return;
  for (const name of METHODS) {
    const orig = obj[name];
    if (typeof orig !== 'function' || orig[WRAPPED]) continue;
    const bound = orig.bind(obj);
    const wrapped = async (...args) => {
      await acquire();
      try {
        return await bound(...args);
      } finally {
        release();
      }
    };
    wrapped[WRAPPED] = true;
    obj[name] = wrapped;
  }
}

function wrapCallback(obj) {
  if (!obj) return;
  for (const name of METHODS) {
    const orig = obj[name];
    if (typeof orig !== 'function' || orig[WRAPPED]) continue;
    const wrapped = function (...args) {
      const cbIdx = args.length - 1;
      const cb = args[cbIdx];
      if (typeof cb !== 'function') {
        // No callback (e.g. used as a promisify target source) — run directly.
        return orig.apply(obj, args);
      }
      acquire().then(() => {
        args[cbIdx] = function (...cbArgs) {
          release();
          cb.apply(this, cbArgs);
        };
        orig.apply(obj, args);
      });
    };
    wrapped[WRAPPED] = true;
    obj[name] = wrapped;
  }
}

// Core fs.
wrapCallback(fs);
wrapPromise(fs.promises);
// graceful-fs's own exports — fs-extra (Docusaurus's file layer) does
// `require('graceful-fs')` and uses these directly, NOT core fs, so they must be
// wrapped too or the limiter is bypassed entirely.
wrapCallback(gracefulFs);
wrapPromise(gracefulFs.promises);
try {
  wrapPromise(require('fs/promises'));
} catch (e) {
  /* older Node without fs/promises module — ignore */
}
