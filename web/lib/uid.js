// Ids only need to be unique within one trip's state. The random tail keeps
// two items created in the same millisecond (e.g. during an import loop)
// from colliding.
export const uid = (prefix) =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
