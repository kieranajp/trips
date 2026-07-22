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
