// In the browser, bare specifiers like "@preact/signals" resolve through the
// import map in web/index.html (CDN, no node_modules — see AGENTS.md). Node
// knows nothing about import maps, so this loader points the one bare
// specifier the state modules need at a tiny local stand-in. Tests stay
// hermetic: no npm install, no network.
const stubs = new Map([
  ["@preact/signals", new URL("./stubs/preact-signals.js", import.meta.url).href],
]);

export function resolve(specifier, context, nextResolve) {
  const stub = stubs.get(specifier);
  if (stub) return { url: stub, shortCircuit: true };
  return nextResolve(specifier, context);
}
