// Minimal @preact/signals stand-in for Node tests. Implements just what the
// code under test uses: signal (.value get/set, peek), computed (lazy), and
// effect (re-runs when a signal it read changes). Not a faithful clone —
// no batching, no diamond dedup — but the state modules only need the basics.
let currentEffect = null;

class Signal {
  #value;
  #subs = new Set();
  constructor(value) { this.#value = value; }
  get value() {
    if (currentEffect) this.#subs.add(currentEffect);
    return this.#value;
  }
  set value(next) {
    if (next === this.#value) return;
    this.#value = next;
    for (const run of [...this.#subs]) run();
  }
  peek() { return this.#value; }
}

export const signal = (value) => new Signal(value);

// Recomputes on every read; reads inside an effect subscribe the effect to
// the underlying signals, which is all the tests rely on.
export const computed = (fn) => ({
  get value() { return fn(); },
  peek: fn,
});

export function effect(fn) {
  let disposed = false;
  const run = () => {
    if (disposed) return;
    const prev = currentEffect;
    currentEffect = run;
    try { fn(); } finally { currentEffect = prev; }
  };
  run();
  // Dispose: the subscription entries leak (they just no-op), which is fine
  // for test lifetimes.
  return () => { disposed = true; };
}
