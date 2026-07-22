// The state modules reach for two browser globals at call time: localStorage
// (persistence) and confirm (destructive actions). Node has neither; install
// controllable stand-ins before exercising those code paths.
export function installBrowserStubs() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
  let confirmResult = true;
  globalThis.confirm = () => confirmResult;
  return {
    store,
    setConfirm: (value) => { confirmResult = value; },
  };
}
