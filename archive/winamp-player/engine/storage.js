/** One namespaced key, versioned envelope; defaults is a factory for fresh fallback data. */
export function createStorage(key, { version = 1, defaults = () => ({}), validate = () => true,
  storage = () => globalThis.localStorage } = {}) {
  const backend = () => typeof storage === 'function' ? storage() : storage;
  return {
    get() {
      try {
        const value = JSON.parse(backend().getItem(key));
        if (value?.version === version && Object.hasOwn(value, 'data') && validate(value.data)) return value.data;
      } catch { /* unavailable storage, invalid JSON, or failed validation */ }
      return defaults();
    },
    set(data) {
      try {
        if (!validate(data)) return false;
        const json = JSON.stringify({ version, data });
        if (!Object.hasOwn(JSON.parse(json), 'data')) return false;
        backend().setItem(key, json);
        return true;
      } catch { return false; }
    },
    remove() { try { backend().removeItem(key); return true; } catch { return false; } },
  };
}
