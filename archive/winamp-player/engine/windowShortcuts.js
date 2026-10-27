// Opt-in desktop window shortcuts. The host owns confirmation and closing.
export function installWindowShortcuts(blocked = () => false) {
  if (!window.parent || window.parent === window) return;
  let hostOrigin = null, enabled = false;
  function trustedOrigin(origin) {
    try {
      const url = new URL(origin);
      return origin === 'https://nates-software.com' || origin === 'https://nates-software.pages.dev'
        || (url.protocol === 'https:' && /^[a-f0-9]{8}\.nates-software\.pages\.dev$/.test(url.hostname))
        || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
    } catch { return false; }
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !trustedOrigin(event.origin)
      || event.data?.type !== 'nsw:window-shortcuts' || typeof event.data.enabled !== 'boolean') return;
    hostOrigin = event.origin;
    enabled = event.data.enabled;
  });
  window.addEventListener('keydown', event => {
    if (!enabled || !hostOrigin || !event.isTrusted || event.key !== 'Escape' || event.repeat
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // Capture before the game's own Escape handler dismisses a menu or drag.
    if (document.querySelector('dialog[open], details[open], [role="menu"]:not([hidden]), [aria-haspopup="menu"][aria-expanded="true"]') || blocked()) return;
    window.parent.postMessage({ type: 'nsw:request-close' }, hostOrigin);
  }, true);
  window.parent.postMessage({ type: 'nsw:window-shortcuts-ready' }, '*');
}
