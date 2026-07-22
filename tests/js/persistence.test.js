import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installBrowserStubs } from "./helpers/browser-stubs.js";

const stubs = installBrowserStubs();

const { cats, pins, trip } = await import("../../web/state/signals.js");
const { localLoad, save } = await import("../../web/state/persistence.js");

beforeEach(() => {
  stubs.store.clear();
  trip.value = { id: "testtrip" };
  cats.value = [{ id: "coffee", name: "Coffee", color: "#6f4e37" }];
  pins.value = [{ id: "p_1", name: "Gure Toki", cat: "coffee" }];
});

test("localLoad returns null when nothing is stored", () => {
  assert.equal(localLoad("testtrip"), null);
});

test("localLoad round-trips what save wrote", () => {
  save();
  const state = localLoad("testtrip");
  assert.equal(state.pins[0].name, "Gure Toki");
  assert.equal(state.categories[0].id, "coffee");
  assert.deepEqual(state.flights, []);
});

test("localLoad survives corrupt JSON", () => {
  stubs.store.set("trip_state_testtrip", "{not json");
  assert.equal(localLoad("testtrip"), null);
});

test("save writes to the per-trip key immediately (before the debounced PUT)", () => {
  save();
  assert.ok(stubs.store.has("trip_state_testtrip"));
  assert.ok(!stubs.store.has("trip_state_other"));
});
