import test from "node:test";
import assert from "node:assert/strict";
import { fmtDay, todayLocal } from "../../web/lib/dates.js";

test("todayLocal formats the local calendar day as YYYY-MM-DD", () => {
  assert.equal(todayLocal(new Date(2026, 6, 22)), "2026-07-22");
  assert.equal(todayLocal(new Date(2026, 0, 3)), "2026-01-03"); // zero-padded
});

test("fmtDay renders the calendar day without a timezone shift", () => {
  const formatted = fmtDay("2026-07-22");
  // Locale-dependent formatting, but the *day* must stay the 22nd — the
  // classic bug is new Date("2026-07-22") slipping to the 21st west of UTC.
  assert.match(formatted, /22/);
  assert.match(formatted, /2026/);
});

test("fmtDay passes unparseable values through untouched", () => {
  assert.equal(fmtDay("soonish"), "soonish");
  assert.equal(fmtDay(""), "");
  assert.equal(fmtDay(null), "");
});
