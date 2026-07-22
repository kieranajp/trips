import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { authUser } from "../../web/state/auth.js";
import { cats } from "../../web/state/signals.js";
import { escapeHtml } from "../../web/lib/html.js";
import { mapsUrl, pinPopupHtml, stayPopupHtml } from "../../web/features/map/popups.js";

beforeEach(() => {
  cats.value = [{ id: "pintxos", name: "Pintxos", color: "#d9822b" }];
  authUser.value = null;
});

test("escapeHtml neutralises markup and attribute breakouts", () => {
  assert.equal(escapeHtml(`<img src=x onerror=alert(1)>`), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(escapeHtml(`a"b & c`), "a&quot;b &amp; c");
  assert.equal(escapeHtml(null), "");
});

test("mapsUrl passes http(s) links through and rejects other schemes", () => {
  assert.equal(mapsUrl({ url: "https://maps.google.com/x", name: "Bar" }), "https://maps.google.com/x");
  assert.equal(mapsUrl({ url: "HTTP://maps.google.com/x", name: "Bar" }), "HTTP://maps.google.com/x");
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "vbscript:x", ""]) {
    assert.equal(mapsUrl({ url, name: "Gure Toki" }),
      "https://www.google.com/maps/search/?api=1&query=Gure%20Toki");
  }
});

test("pinPopupHtml keeps a hostile url from escaping the href attribute", () => {
  const pin = {
    id: "p_1", cat: "pintxos", name: "Bar",
    url: `https://x.test/" onmouseover="steal()`,
  };
  const html = pinPopupHtml(pin);
  assert.ok(!html.includes(`" onmouseover`), "raw quote broke out of the attribute");
  assert.ok(html.includes("&quot; onmouseover=&quot;steal()"));
});

test("pinPopupHtml escapes name, note, and the data-edit id", () => {
  authUser.value = { user: "k" };
  const html = pinPopupHtml({
    id: `x" onclick="p`, cat: "pintxos",
    name: "<b>Bar</b>", note: `<script>alert(1)</script>`,
  });
  assert.ok(!html.includes("<b>"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes(`data-edit="x&quot; onclick=&quot;p"`));
});

test("pinPopupHtml only offers Edit when logged in", () => {
  const pin = { id: "p_1", cat: "pintxos", name: "Bar" };
  assert.ok(!pinPopupHtml(pin).includes("data-edit"));
  authUser.value = { user: "k" };
  assert.ok(pinPopupHtml(pin).includes("data-edit"));
});

test("stayPopupHtml escapes name and address", () => {
  const html = stayPopupHtml({ name: `<i>Hotel</i>`, address: `1 "Main" St`, url: "javascript:x" });
  assert.ok(!html.includes("<i>"));
  assert.ok(html.includes("1 &quot;Main&quot; St"));
  assert.ok(!html.includes("javascript:"));
});
