import test from "node:test";
import assert from "node:assert/strict";
import { fmtDateTime, fmtTime, nights, sameDay } from "../../web/features/trip/format.js";

// Locale output varies by machine, so the fmt* tests assert shape and
// fallbacks, not exact strings.

test("fmtDateTime formats a valid datetime-local string", () => {
  const out = fmtDateTime("2026-05-01T15:30");
  assert.equal(typeof out, "string");
  assert.ok(out.includes("30"), `expected minutes in ${JSON.stringify(out)}`);
});

test("fmt* fall back to the raw value when unparseable, and '' when empty", () => {
  assert.equal(fmtDateTime(""), "");
  assert.equal(fmtDateTime(null), "");
  assert.equal(fmtDateTime("not-a-date"), "not-a-date");
  assert.equal(fmtTime(""), "");
  assert.equal(fmtTime("nope"), "nope");
});

test("nights counts whole nights between check-in and check-out", () => {
  assert.equal(nights("2026-05-01T15:00", "2026-05-05T11:00"), 4);
  // Overnight but under 24h still counts as one night.
  assert.equal(nights("2026-05-01T15:00", "2026-05-02T11:00"), 1);
});

test("nights is null when unset, equal, or inverted", () => {
  assert.equal(nights("", "2026-05-05T11:00"), null);
  assert.equal(nights("2026-05-01T15:00", ""), null);
  assert.equal(nights("2026-05-01T15:00", "2026-05-01T15:00"), null);
  assert.equal(nights("2026-05-05T11:00", "2026-05-01T15:00"), null);
});

test("sameDay compares calendar days and rejects invalid input", () => {
  assert.equal(sameDay("2026-05-01T06:00", "2026-05-01T23:59"), true);
  assert.equal(sameDay("2026-05-01T23:59", "2026-05-02T00:01"), false);
  assert.equal(sameDay("", "2026-05-01T06:00"), false);
  assert.equal(sameDay("garbage", "2026-05-01T06:00"), false);
});
