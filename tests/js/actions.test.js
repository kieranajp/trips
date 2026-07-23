import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installBrowserStubs } from "./helpers/browser-stubs.js";

const stubs = installBrowserStubs();

const { cats, flights, only, pins, stays, toastMsg, trip } = await import("../../web/state/signals.js");
const {
  deleteCat, removePin, reset, savePin, saveStay, toggleCatalog, toggleOnly, toggleVisited,
} = await import("../../web/state/actions.js");
const { todayLocal } = await import("../../web/lib/dates.js");

const catalogItem = { cid: "gure", name: "Gure Toki", lat: 43.2593, lng: -2.9222, cat: "pintxos", note: "n", url: "u" };

beforeEach(() => {
  stubs.store.clear();
  stubs.setConfirm(true);
  trip.value = {
    id: "testtrip",
    categories: [{ id: "pintxos", name: "Pintxos", color: "#d9822b" }],
    seedOnMap: ["gure"],
    catalog: [catalogItem],
  };
  cats.value = [
    { id: "pintxos", name: "Pintxos", color: "#d9822b" },
    { id: "sights", name: "Sights", color: "#3f6ea3" },
  ];
  pins.value = [];
  flights.value = [];
  stays.value = [];
  only.value = null;
  toastMsg.value = "";
});

test("savePin adds a new pin with a generated id and null src", () => {
  savePin({ name: "New bar", cat: "pintxos", lat: 1, lng: 2, note: "" });
  assert.equal(pins.value.length, 1);
  const pin = pins.value[0];
  assert.match(pin.id, /^p_/);
  assert.equal(pin.src, null);
  assert.equal(pin.name, "New bar");
  // save() persisted it to localStorage straight away
  const saved = JSON.parse(stubs.store.get("trip_state_testtrip"));
  assert.equal(saved.pins.length, 1);
});

test("savePin with a target patches that pin only", () => {
  pins.value = [
    { id: "p_a", name: "A", cat: "pintxos" },
    { id: "p_b", name: "B", cat: "pintxos" },
  ];
  savePin({ cat: "sights" }, pins.value[1]);
  assert.equal(pins.value[0].cat, "pintxos");
  assert.equal(pins.value[1].cat, "sights");
  assert.equal(pins.value[1].name, "B"); // untouched fields survive
});

test("removePin respects the confirm dialog", () => {
  pins.value = [{ id: "p_a", name: "A", cat: "pintxos" }];
  stubs.setConfirm(false);
  removePin("p_a");
  assert.equal(pins.value.length, 1);
  stubs.setConfirm(true);
  removePin("p_a");
  assert.equal(pins.value.length, 0);
});

test("toggleCatalog adds a catalogue idea to the map, then removes it", () => {
  toggleCatalog(catalogItem);
  assert.equal(pins.value.length, 1);
  assert.equal(pins.value[0].src, "gure");
  assert.match(toastMsg.value, /added/);

  toggleCatalog(catalogItem);
  assert.equal(pins.value.length, 0);
  assert.match(toastMsg.value, /removed/);
});

test("deleteCat refuses to delete the last category", () => {
  cats.value = [{ id: "pintxos", name: "Pintxos", color: "#d9822b" }];
  deleteCat("pintxos");
  assert.equal(cats.value.length, 1);
  assert.match(toastMsg.value, /at least one/);
});

test("deleteCat moves orphaned pins to the neighbouring category", () => {
  pins.value = [{ id: "p_a", name: "A", cat: "sights" }];
  deleteCat("sights");
  assert.deepEqual(cats.value.map((category) => category.id), ["pintxos"]);
  assert.equal(pins.value[0].cat, "pintxos");
});

test("deleteCat of the first category falls back to the second", () => {
  pins.value = [{ id: "p_a", name: "A", cat: "pintxos" }];
  deleteCat("pintxos");
  assert.equal(pins.value[0].cat, "sights");
});

test("saveStay adds with an st_ id and patches on update", () => {
  saveStay({ name: "Hotel", lat: 43.26, lng: -2.92 });
  assert.equal(stays.value.length, 1);
  assert.match(stays.value[0].id, /^st_/);
  saveStay({ name: "Hotel renamed" }, stays.value[0]);
  assert.equal(stays.value.length, 1);
  assert.equal(stays.value[0].name, "Hotel renamed");
  assert.equal(stays.value[0].lat, 43.26);
});

test("toggleVisited checks a pin off with today's date and persists it", () => {
  pins.value = [{ id: "p_a", name: "Gure Toki", cat: "pintxos" }];
  toggleVisited(pins.value[0]);
  assert.equal(pins.value[0].visitedAt, todayLocal());
  assert.match(toastMsg.value, /checked off/);
  const saved = JSON.parse(stubs.store.get("trip_state_testtrip"));
  assert.equal(saved.pins[0].visitedAt, todayLocal());
});

test("toggleVisited accepts an explicit date and clears on the second toggle", () => {
  pins.value = [{ id: "p_a", name: "Gure Toki", cat: "pintxos" }];
  toggleVisited(pins.value[0], "2026-07-20");
  assert.equal(pins.value[0].visitedAt, "2026-07-20");
  toggleVisited(pins.value[0]);
  assert.equal(pins.value[0].visitedAt, null);
  assert.match(toastMsg.value, /unmarked/);
});

test("toggleOnly toggles the single-category filter", () => {
  toggleOnly("pintxos");
  assert.equal(only.value, "pintxos");
  toggleOnly("sights");
  assert.equal(only.value, "sights");
  toggleOnly("sights");
  assert.equal(only.value, null);
});

test("reset restores the seeded state from the trip definition", () => {
  pins.value = [{ id: "p_x", name: "User pin", cat: "pintxos" }];
  cats.value = [...cats.value, { id: "extra", name: "Extra", color: "#000" }];
  reset();
  assert.deepEqual(pins.value.map((pin) => pin.id), ["p_gure"]);
  assert.deepEqual(cats.value.map((category) => category.id), ["pintxos"]);
});
