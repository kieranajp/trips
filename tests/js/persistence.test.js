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

const { areaOverride, areaErrors, syncStatus } = await import("../../web/state/signals.js");
const { authUser } = await import("../../web/state/auth.js");
const { commitCandidate, snapshot, pullState, retrySync, initSync } = await import("../../web/state/persistence.js");
const remote = (override) => ({ categories: [], pins: [{ id: "remote" }], areaOverride: override });
beforeEach(() => { areaOverride.value = null; areaErrors.value = []; authUser.value = { user: "editor" }; });

test("null and empty area overrides round trip", () => {
  for (const value of [null, []]) {
    areaOverride.value = value; save();
    assert.deepEqual(localLoad("testtrip").areaOverride, value);
  }
});
test("pull adopts valid overrides and legacy missing overrides", async () => {
  for (const value of [[], null, undefined]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => remote(value) });
    assert.equal(await pullState(), "adopted");
    assert.deepEqual(areaOverride.value, value ?? null);
  }
});
test("invalid remote override is rejected and boot never pushes over it", async () => {
  let puts = 0;
  globalThis.window = { addEventListener() {} };
  globalThis.fetch = async (_, options) => {
    if (options?.method === "PUT") puts++;
    return { ok: true, json: async () => remote("invalid") };
  };
  pins.value = [{ id: "local" }];
  await initSync();
  assert.equal(puts, 0); assert.equal(pins.value[0].id, "local");
  assert.ok(areaErrors.value.length);
});
test("pending metadata and state share one atomic write", () => {
  let calls = 0;
  const original = localStorage.setItem;
  localStorage.setItem = (key, text) => { calls++; const data = JSON.parse(text); assert.equal(data._sync.pending, true); original(key, text); };
  try { commitCandidate(snapshot()); } finally { localStorage.setItem = original; }
  assert.equal(calls, 1);
});
test("reload retries durable pending pins before any pull and omits metadata", async () => {
  stubs.store.set("trip_state_testtrip", JSON.stringify({ ...remote([]), _sync: { generation: 50, pending: true } }));
  const calls = [];
  globalThis.window = { addEventListener() {} };
  globalThis.fetch = async (_, options) => { calls.push(options); return { ok: true }; };
  await initSync();
  assert.equal(calls.length, 1); assert.equal(calls[0].method, "PUT");
  assert.equal(JSON.parse(calls[0].body)._sync, undefined);
  assert.equal(localLoad("testtrip")._sync.pending, false);
});
test("failed writes survive reload and focus pull until retry succeeds", async () => {
  save();
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  assert.equal(await retrySync(), false);
  assert.equal(localLoad("testtrip")._sync.pending, true);
  assert.equal(await pullState(), "pending");
  assert.equal(pins.value[0].name, "Gure Toki");
  globalThis.fetch = async () => ({ ok: true });
  assert.equal(await retrySync(), true);
  assert.equal(syncStatus.value.state, "synced");
});
test("an old completion cannot clear a newer generation", async () => {
  let finish;
  const bodies = [];
  globalThis.fetch = async (_, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) await new Promise((resolve) => { finish = resolve; });
    return { ok: true };
  };
  save(); const pushing = retrySync();
  pins.value = [{ id: "newer" }]; save();
  finish(); await pushing;
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].pins[0].id, "newer");
  assert.equal(localLoad("testtrip")._sync.pending, false);
});
test("a pull started before a pin edit cannot replace that edit", async () => {
  let finish;
  globalThis.fetch = async () => { await new Promise((resolve) => { finish = resolve; }); return { ok: true, json: async () => remote([]) }; };
  const pulling = pullState();
  pins.value = [{ id: "local-new" }]; save(); finish();
  assert.equal(await pulling, "skipped");
  assert.equal(pins.value[0].id, "local-new");
  globalThis.fetch = async () => ({ ok: false, status: 503 });
});
test("stale trip response cannot report current trip as synced", async () => {
  let finish;
  globalThis.fetch = async () => { await new Promise((resolve) => { finish = resolve; }); return { ok: true }; };
  save(); const pushing = retrySync();
  trip.value = { id: "elsewhere" }; syncStatus.value = { state: "idle" };
  finish(); await pushing;
  assert.equal(syncStatus.value.state, "idle");
});

test("rejected remote override does not change the local record", async () => {
  const stored = JSON.stringify(remote([]));
  stubs.store.set("trip_state_testtrip", stored);
  globalThis.fetch = async () => ({ ok: true, json: async () => remote([{}]) });
  assert.equal(await pullState(), "rejected");
  assert.equal(stubs.store.get("trip_state_testtrip"), stored);
});
test("pull storage failure retains rendered state", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => remote([]) });
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("quota"); };
  try { assert.equal(await pullState(), "unavailable"); } finally { localStorage.setItem = original; }
  assert.equal(pins.value[0].name, "Gure Toki");
});
