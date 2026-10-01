import test from "node:test";
import assert from "node:assert/strict";
import { freshState } from "../../web/state/trips.js";

const definition = {
  id: "demo",
  categories: [{ id: "coffee", name: "Coffee", color: "#6f4e37" }],
  seedOnMap: ["gure", "gugg"],
  catalog: [
    { cid: "gure", name: "Gure Toki", lat: 43.2593, lng: -2.9222, cat: "coffee", note: "n1", url: "u1" },
    { cid: "gugg", name: "Guggenheim", lat: 43.2686, lng: -2.934, cat: "coffee", note: "n2", url: "u2" },
    { cid: "extra", name: "Not seeded", lat: 0, lng: 0, cat: "coffee", note: "", url: "" },
  ],
};

test("freshState seeds only the catalog entries listed in seedOnMap", () => {
  const state = freshState(definition);
  assert.deepEqual(state.pins.map((pin) => pin.src), ["gure", "gugg"]);
  assert.equal(state.pins[0].id, "p_gure");
  assert.equal(state.pins[0].name, "Gure Toki");
  assert.equal(state.pins[0].cat, "coffee");
});

test("freshState copies categories so edits don't leak back into the definition", () => {
  const state = freshState(definition);
  state.categories[0].name = "Mutated";
  assert.equal(definition.categories[0].name, "Coffee");
});

test("freshState defaults flights and stays to empty arrays", () => {
  const state = freshState(definition);
  assert.deepEqual(state.flights, []);
  assert.deepEqual(state.stays, []);

  const withLogistics = freshState({
    ...definition,
    flights: [{ id: "fl_1", from: "LGW", to: "BIO" }],
    stays: [{ id: "st_1", name: "Hotel" }],
  });
  assert.equal(withLogistics.flights.length, 1);
  assert.equal(withLogistics.stays[0].name, "Hotel");
});

test("fresh state follows area seeds", () => assert.equal(freshState(definition).areaOverride, null));
test("boot accepts missing, null and empty overrides and rejects malformed data", async () => {
  const { installBrowserStubs } = await import("./helpers/browser-stubs.js");
  const { boot } = await import("../../web/state/trips.js");
  const { areaOverride, areaErrors } = await import("../../web/state/signals.js");
  const stubs = installBrowserStubs();
  globalThis.location = { search: "?trip=demo" }; globalThis.document = {};
  globalThis.fetch = async () => ({ ok: true, json: async () => definition });
  for (const override of [undefined, null, [], "bad"]) {
    stubs.store.set("trip_state_demo", JSON.stringify({ ...freshState(definition), areaOverride: override }));
    await boot();
    assert.deepEqual(areaOverride.value, Array.isArray(override) ? [] : null);
    assert.equal(areaErrors.value.length > 0, override === "bad");
  }
});
