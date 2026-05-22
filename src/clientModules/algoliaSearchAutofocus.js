/**
 * Force the Algolia DocSearch modal input to receive keyboard focus when the
 * modal opens.
 *
 * Background
 * ----------
 * When a user hits Cmd+K (or Ctrl+K), Docusaurus's Algolia theme opens the
 * DocSearch modal. The modal's `<input>` is marked with React's `autoFocus`
 * prop, which *should* call `.focus()` after the modal mounts.
 *
 * In practice, this is racy:
 *   - The DocSearchModal component is loaded via a dynamic `import()` on
 *     first invocation, so the modal mounts asynchronously after the
 *     keydown event.
 *   - The modal is rendered into a portal that is prepended to
 *     `document.body`. If anything else steals focus during that frame
 *     (third-party widgets like the Crisp chat script, or the original
 *     document.activeElement re-asserting focus when the modal portal is
 *     inserted before it), the input is rendered but unfocused — exactly
 *     the bug reported on the docs site: "the search popup opens but the
 *     cursor isn't in the input, I have to click before I can type".
 *
 * Fix
 * ---
 * Run a `MutationObserver` on `document.body` for the lifetime of the page.
 * Whenever a `.DocSearch-Container` element is inserted, schedule three
 * focus attempts on its `.DocSearch-Input` (synchronous, next animation
 * frame, and 60 ms later). Each attempt is idempotent — focusing an
 * already-focused element is a no-op — so this never fights React's own
 * autoFocus when it works on the first try.
 *
 * The observer also guards against future re-opens: every time the modal
 * is re-added to the DOM, the input is focused again.
 */

const CONTAINER_SELECTOR = '.DocSearch-Container';
const INPUT_SELECTOR = '.DocSearch-Input';

function focusModalInput(container) {
  if (!container) return false;
  const input = container.querySelector(INPUT_SELECTOR);
  if (!input) return false;
  if (document.activeElement === input) return true;
  try {
    input.focus({preventScroll: true});
  } catch (_e) {
    input.focus();
  }
  // Place the caret at the end of any pre-filled query (Cmd+K with a prior
  // search) so the user's first keystroke appends rather than replaces.
  if (typeof input.value === 'string' && input.value.length > 0) {
    try {
      input.setSelectionRange(input.value.length, input.value.length);
    } catch (_e) {
      // not all input types support setSelectionRange — ignore.
    }
  }
  return document.activeElement === input;
}

function scheduleFocusAttempts(container) {
  // 1) Synchronous — covers the case where the input is already mounted.
  focusModalInput(container);

  // 2) Next animation frame — covers the case where the input was just
  // inserted but React hasn't yet committed its autoFocus side effect.
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    window.requestAnimationFrame(() => {
      focusModalInput(container);
    });
  }

  // 3) Short timeout — covers the case where another script steals focus
  // immediately after the modal opens (e.g. third-party widgets reacting
  // to body mutations).
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      focusModalInput(container);
    }, 60);
  }
}

function handleNode(node) {
  if (!(node instanceof Element)) return;
  if (node.matches?.(CONTAINER_SELECTOR)) {
    scheduleFocusAttempts(node);
    return;
  }
  // The container might be added wrapped in an outer element on first paint.
  const container = node.querySelector?.(CONTAINER_SELECTOR);
  if (container) {
    scheduleFocusAttempts(container);
  }
}

function start() {
  if (typeof document === 'undefined') return;
  if (typeof MutationObserver === 'undefined') return;

  // If a DocSearch container is already in the DOM at module-load time
  // (highly unlikely, but cheap to check), focus it now.
  const existing = document.querySelector(CONTAINER_SELECTOR);
  if (existing) {
    scheduleFocusAttempts(existing);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes?.forEach(handleNode);
    }
  });

  observer.observe(document.body, {childList: true, subtree: true});
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {once: true});
  } else {
    start();
  }
}
