import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installBrowserStubs } from "./helpers/browser-stubs.js";

const stubs = installBrowserStubs(); // the module pulls in state/actions, which expect browser globals at call time

const { cats, pins, trip } = await import("../../web/state/signals.js");
const { importJson, parseCsv } = await import("../../web/features/setup/import-export.js");

test("parseCsv splits simple rows and fields", () => {
  assert.deepEqual(parseCsv("a,b,c\nd,e,f"), [["a", "b", "c"], ["d", "e", "f"]]);
});

test("parseCsv keeps commas inside quoted fields", () => {
  assert.deepEqual(parseCsv('name,"one, two",z'), [["name", "one, two", "z"]]);
});

test("parseCsv unescapes doubled quotes", () => {
  assert.deepEqual(parseCsv('"say ""hi""",x'), [['say "hi"', "x"]]);
});

test("parseCsv keeps newlines inside quoted fields", () => {
  assert.deepEqual(parseCsv('"line1\nline2",x'), [["line1\nline2", "x"]]);
});

test("parseCsv normalises CRLF and bare CR line endings", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d\re,f"), [["a", "b"], ["c", "d"], ["e", "f"]]);
});

test("parseCsv drops blank and whitespace-only rows", () => {
  assert.deepEqual(parseCsv("a,b\n\n , \nc,d\n"), [["a", "b"], ["c", "d"]]);
});

test("parseCsv handles a final row without a trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
});

beforeEach(() => {
  stubs.store.clear();
  trip.value = { id: "testtrip" };
  cats.value = [{ id: "pintxos", name: "Pintxos", color: "#d9822b" }];
  pins.value = [{ id: "p_old", name: "Existing", lat: 1, lng: 1, cat: "pintxos" }];
});

test("importJson replace swaps everything and backfills missing pin ids", () => {
  stubs.setConfirm(false); // Cancel = replace
  importJson({
    categories: [{ id: "saved", name: "Saved", color: "#5b6672" }],
    pins: [{ name: "No id", lat: 2, lng: 2, cat: "saved" }],
  });
  assert.deepEqual(cats.value.map((category) => category.id), ["saved"]);
  assert.equal(pins.value.length, 1);
  assert.match(pins.value[0].id, /^p_/);
});

test("importJson merge unions categories by id and skips duplicate pins", () => {
  stubs.setConfirm(true); // OK = merge
  importJson({
    categories: [
      { id: "pintxos", name: "Renamed — must not clobber", color: "#000" },
      { id: "saved", name: "Saved", color: "#5b6672" },
    ],
    pins: [
      { id: "p_dup", name: "Existing", lat: 1.00001, lng: 1.00001, cat: "pintxos" }, // same name+coords
      { name: "New place", lat: 3, lng: 3, cat: "saved" },
    ],
  });
  assert.deepEqual(cats.value.map((category) => category.id), ["pintxos", "saved"]);
  assert.equal(cats.value[0].name, "Pintxos"); // existing category kept
  assert.deepEqual(pins.value.map((pin) => pin.name), ["Existing", "New place"]);
  assert.match(pins.value[1].id, /^p_/); // id assigned on the way in
});
