import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("map tiles bypass service-worker storage for both basemaps", async () => {
  const handlers = {};
  runInNewContext(await readFile(new URL("../../web/sw.js", import.meta.url), "utf8"), {
    self: { location: { origin: "https://trips.example" }, addEventListener: (name, fn) => { handlers[name] = fn; } },
    URL,
  });
  for (const url of ["https://tile.openstreetmap.org/12/1/2.png", "https://a.basemaps.cartocdn.com/rastertiles/voyager/12/1/2.png"]) {
    let intercepted = false;
    handlers.fetch({ request: { method: "GET", url }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});
