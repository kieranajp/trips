import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { catById, cats, onMap, pinMatches, pins } from "../../web/state/signals.js";

beforeEach(() => {
  cats.value = [
    { id: "coffee", name: "Coffee", color: "#6f4e37" },
    { id: "saved", name: "Saved", color: "#5b6672" },
  ];
  pins.value = [];
});

test("pinMatches: empty or whitespace query matches everything", () => {
  const pin = { name: "Gure Toki", note: "" };
  assert.equal(pinMatches(pin, ""), true);
  assert.equal(pinMatches(pin, "   "), true);
});

test("pinMatches searches name and note, case-insensitively", () => {
  const pin = { name: "Gure Toki", note: "Best tortilla in the Casco" };
  assert.equal(pinMatches(pin, "gure"), true);
  assert.equal(pinMatches(pin, "  TORTILLA "), true);
  assert.equal(pinMatches(pin, "pintxo"), false);
});

test("pinMatches copes with missing name/note", () => {
  assert.equal(pinMatches({}, "x"), false);
  assert.equal(pinMatches({ name: null, note: null }, ""), true);
});

test("catById finds a category, and falls back to the last one for unknown ids", () => {
  assert.equal(catById("coffee").name, "Coffee");
  assert.equal(catById("deleted-cat").id, "saved");
});

test("onMap reports whether a catalogue entry has been placed", () => {
  assert.equal(onMap("gure"), false);
  pins.value = [{ id: "p_1", src: "gure" }];
  assert.equal(onMap("gure"), true);
  assert.equal(onMap("victor"), false);
});
