import test from "node:test";
import assert from "node:assert/strict";
import { installBrowserStubs } from "./helpers/browser-stubs.js";

installBrowserStubs(); // the module pulls in state/actions, which expect browser globals at call time

const { parseCsv } = await import("../../web/features/setup/import-export.js");

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
