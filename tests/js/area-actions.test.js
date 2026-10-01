import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installBrowserStubs } from "./helpers/browser-stubs.js";
const stubs = installBrowserStubs();
const { areaOverride, effectiveAreas, trip, pins, cats } = await import("../../web/state/signals.js");
const { authUser } = await import("../../web/state/auth.js");
const { previewAreas, previewRestore, applyAreas } = await import("../../web/state/areas.js");
const area = { id: "demo", name: "Demo", note: "", color: "#abcdef", approximate: true, ring: [[1,1],[1,2],[2,2]] };
const file = (areas = [area], tripId = "demo") => JSON.stringify({ type: "trips-areas", version: 1, tripId, areas });
beforeEach(() => {
  stubs.store.clear(); authUser.value = { user: "editor" }; trip.value = { id: "demo", neighbourhoods: [area] };
  areaOverride.value = null; pins.value = []; cats.value = [];
});
test("preview and cancel do not mutate; apply preserves latest unrelated state", () => {
  const { preview } = previewAreas(file([]));
  assert.equal(areaOverride.value, null);
  assert.equal(stubs.store.size, 0);
  pins.value = [{ id: "new" }];
  assert.deepEqual(applyAreas(preview).errors, []);
  assert.deepEqual(effectiveAreas.value, []);
  assert.equal(JSON.parse(stubs.store.get("trip_state_demo")).pins[0].id, "new");
});
test("empty override survives storage and restore returns to null", () => {
  applyAreas(previewAreas(file([])).preview);
  assert.deepEqual(JSON.parse(stubs.store.get("trip_state_demo")).areaOverride, []);
  assert.deepEqual(applyAreas(previewRestore().preview).errors, []);
  assert.equal(areaOverride.value, null);
  assert.equal(effectiveAreas.value.length, 1);
});
test("wrong trip and lost permission reject without changing areas", () => {
  assert.ok(previewAreas(file([], "other")).errors.length);
  const { preview } = previewAreas(file([]));
  authUser.value = null;
  assert.ok(applyAreas(preview).errors.length);
  assert.equal(areaOverride.value, null);
});
test("trip change invalidates preview", () => {
  const { preview } = previewAreas(file([]));
  trip.value = { id: "other" };
  assert.ok(applyAreas(preview).errors.length);
});
test("stale preview refreshes comparison and requires another apply", () => {
  const { preview } = previewAreas(file([]));
  areaOverride.value = [{ ...area, note: "changed" }];
  const refreshed = applyAreas(preview);
  assert.equal(refreshed.errors[0].code, "stale");
  assert.equal(areaOverride.value.length, 1);
  assert.deepEqual(applyAreas(refreshed.preview).errors, []);
});
test("storage failure and oversized complete payload reject atomically", () => {
  const { preview } = previewAreas(file([]));
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("quota"); };
  try { assert.match(applyAreas(preview).errors[0].message, /quota/); }
  finally { localStorage.setItem = original; }
  assert.equal(areaOverride.value, null);
  pins.value = [{ note: "x".repeat(1024 * 1024) }];
  assert.match(applyAreas(preview).errors[0].message, /1 MiB/);
  assert.equal(areaOverride.value, null);
});
test("restore preview also refreshes and rejects storage failure", () => {
  areaOverride.value = [];
  const { preview } = previewRestore();
  areaOverride.value = [{ ...area, note: "custom" }];
  const refreshed = applyAreas(preview);
  assert.equal(refreshed.errors[0].code, "stale");
  assert.equal(refreshed.preview.override, null);
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("quota"); };
  try { assert.ok(applyAreas(refreshed.preview).errors.length); } finally { localStorage.setItem = original; }
  assert.equal(areaOverride.value[0].note, "custom");
});
