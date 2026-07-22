import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pins, toastMsg, trip } from "../../web/state/signals.js";
import { followPermalink, pinPermalink, sharePin } from "../../web/features/map/permalink.js";

const base = { origin: "https://trips.example", pathname: "/" };

beforeEach(() => {
  trip.value = { id: "bilbao" };
  pins.value = [
    { id: "p_1", name: "Gure Toki", lat: 43.259, lng: -2.922, cat: "pintxos" },
  ];
  toastMsg.value = "";
});

test("pinPermalink builds ?trip=&pin= against the app's own origin and path", () => {
  assert.equal(pinPermalink("bilbao", "p_1", base), "https://trips.example/?trip=bilbao&pin=p_1");
  assert.equal(pinPermalink("bilbao", "p_1", { origin: "http://localhost:8080", pathname: "/app" }),
    "http://localhost:8080/app?trip=bilbao&pin=p_1");
});

test("pinPermalink percent-encodes hostile ids", () => {
  const url = pinPermalink("bilbao", `p&x=1#f "q"`, base);
  assert.equal(url, "https://trips.example/?trip=bilbao&pin=p%26x%3D1%23f+%22q%22");
  assert.equal(new URL(url).searchParams.get("pin"), `p&x=1#f "q"`); // round-trips
});

test("followPermalink flies to a pin that's already loaded", () => {
  const flown = [];
  followPermalink({ flyTo: (pin) => flown.push(pin.id) }, "?trip=bilbao&pin=p_1");
  assert.deepEqual(flown, ["p_1"]);
});

test("followPermalink waits for a pin that arrives with the server pull, and flies once", () => {
  const flown = [];
  followPermalink({ flyTo: (pin) => flown.push(pin.id) }, "?trip=bilbao&pin=p_9");
  assert.deepEqual(flown, []); // not there yet — seed rendered, sync in flight

  pins.value = [...pins.value, { id: "p_9", name: "Late", lat: 43.27, lng: -2.93, cat: "pintxos" }];
  assert.deepEqual(flown, ["p_9"]);

  pins.value = [...pins.value]; // further changes must not re-fly
  assert.deepEqual(flown, ["p_9"]);
});

test("followPermalink without a pin param subscribes to nothing", () => {
  const flown = [];
  followPermalink({ flyTo: (pin) => flown.push(pin.id) }, "?trip=bilbao");
  pins.value = [...pins.value];
  assert.deepEqual(flown, []);
});

test("sharePin prefers the Web Share sheet", async () => {
  const shared = [];
  await sharePin(pins.value[0], { share: (data) => { shared.push(data); return Promise.resolve(); } }, base);
  assert.deepEqual(shared, [{ title: "Gure Toki", url: "https://trips.example/?trip=bilbao&pin=p_1" }]);
  assert.equal(toastMsg.value, "");
});

test("sharePin stays quiet when the user closes the share sheet", async () => {
  const nav = {
    share: () => Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" })),
    clipboard: { writeText: () => { throw new Error("must not reach the clipboard"); } },
  };
  await sharePin(pins.value[0], nav, base);
  assert.equal(toastMsg.value, "");
});

test("sharePin falls back to the clipboard when sharing fails, and toasts", async () => {
  const copied = [];
  const nav = {
    share: () => Promise.reject(Object.assign(new Error("nope"), { name: "NotAllowedError" })),
    clipboard: { writeText: (text) => { copied.push(text); return Promise.resolve(); } },
  };
  await sharePin(pins.value[0], nav, base);
  assert.deepEqual(copied, ["https://trips.example/?trip=bilbao&pin=p_1"]);
  assert.equal(toastMsg.value, "Link copied");
});

test("sharePin falls back to prompt when the clipboard is unavailable", async () => {
  const prompts = [];
  globalThis.prompt = (_message, url) => { prompts.push(url); };
  try {
    await sharePin(pins.value[0], {}, base); // no share, no clipboard
    assert.deepEqual(prompts, ["https://trips.example/?trip=bilbao&pin=p_1"]);
    assert.equal(toastMsg.value, "");
  } finally {
    delete globalThis.prompt;
  }
});
