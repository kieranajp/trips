// Pure string helpers. No imports, no state.
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
