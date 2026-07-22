import test from "node:test";
import assert from "node:assert/strict";
import { isShortMapsLink, parseLatLng, parseMapsLink, resolveMapsLink } from "../../web/lib/maps.js";
import { uid } from "../../web/lib/uid.js";

test("place URL: prefers the precise !3d!4d coords over the @viewport", () => {
  const link = "https://www.google.com/maps/place/Gure+Toki/@43.2593,-2.9222,17z/data=!4m6!3m5!8m2!3d43.2593788!4d-2.9222899";
  const place = parseMapsLink(link);
  assert.equal(place.lat, 43.2593788);
  assert.equal(place.lng, -2.9222899);
  assert.equal(place.name, "Gure Toki");
  assert.equal(place.url, link);
});

test("place name: decodes percent-escapes and + as spaces", () => {
  const place = parseMapsLink("https://www.google.com/maps/place/V%C3%ADctor+Montes/@43.2589,-2.9223,17z");
  assert.equal(place.name, "Víctor Montes");
  assert.equal(place.lat, 43.2589);
});

test("bare @lat,lng viewport URL works, with an empty name", () => {
  const place = parseMapsLink("https://www.google.com/maps/@43.263,-2.935,14z");
  assert.deepEqual({ lat: place.lat, lng: place.lng, name: place.name }, { lat: 43.263, lng: -2.935, name: "" });
});

test("q= and query= coordinate URLs work", () => {
  assert.equal(parseMapsLink("https://maps.google.com/?q=43.263,-2.935").lat, 43.263);
  const place = parseMapsLink("https://www.google.com/maps/search/?api=1&query=-33.86,151.21");
  assert.equal(place.lat, -33.86);
  assert.equal(place.lng, 151.21);
});

test("parseLatLng accepts 'lat, lng' text in its various spacings", () => {
  assert.deepEqual(parseLatLng("43.2678, -2.9281"), { lat: 43.2678, lng: -2.9281 });
  assert.deepEqual(parseLatLng("43,-2"), { lat: 43, lng: -2 });
  assert.deepEqual(parseLatLng("  -33.86 , 151.21  "), { lat: -33.86, lng: 151.21 });
});

test("parseLatLng rejects anything that isn't exactly two numbers", () => {
  assert.equal(parseLatLng(""), null);
  assert.equal(parseLatLng(null), null);
  assert.equal(parseLatLng("43.2678"), null);
  assert.equal(parseLatLng("1,2,3"), null);
  assert.equal(parseLatLng("lat, lng"), null);
  assert.equal(parseLatLng("43.2, north"), null);
});

test("uid keeps the prefix and never collides in a burst", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => uid("p_")));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^p_/);
});

test("links without coordinates return null", () => {
  assert.equal(parseMapsLink("https://goo.gl/maps/abc123"), null); // short link
  assert.equal(parseMapsLink("https://maps.google.com/?q=Guggenheim+Bilbao"), null); // text query
  assert.equal(parseMapsLink("not a url"), null);
  assert.equal(parseMapsLink(""), null);
  assert.equal(parseMapsLink(null), null);
});

test("isShortMapsLink recognises the share-sheet hosts and nothing else", () => {
  assert.ok(isShortMapsLink("https://maps.app.goo.gl/H8VkkiU1bPjorJEU8"));
  assert.ok(isShortMapsLink("  https://maps.app.goo.gl/abc  ")); // pasted with whitespace
  assert.ok(isShortMapsLink("https://goo.gl/maps/abc123"));
  assert.ok(isShortMapsLink("https://g.co/kgs/abc"));
  assert.ok(!isShortMapsLink("https://www.google.com/maps/@43.263,-2.935,14z"));
  assert.ok(!isShortMapsLink("https://evilmaps.app.goo.gl.io/x")); // lookalike
  assert.ok(!isShortMapsLink(""));
  assert.ok(!isShortMapsLink(null));
});

// resolveMapsLink reaches for global fetch only on the short-link path; these
// tests install a scripted stand-in and always remove it after.
function withFetch(impl, run) {
  const calls = [];
  globalThis.fetch = (...args) => { calls.push(args[0]); return impl(...args); };
  return Promise.resolve(run(calls)).finally(() => { delete globalThis.fetch; });
}

test("resolveMapsLink parses full links locally without touching the network", () =>
  withFetch(() => { throw new Error("fetch must not be called"); }, async () => {
    const place = await resolveMapsLink("https://www.google.com/maps/place/Gure+Toki/@43.2593788,-2.9222899,17z");
    assert.equal(place.name, "Gure Toki");
    assert.equal(place.lat, 43.2593788);
  }));

test("resolveMapsLink expands a short link via /expand and keeps it as the pin URL", () =>
  withFetch(async () => ({
    ok: true,
    json: async () => ({ url: "https://www.google.com/maps/place/Gatz/@43.258,-2.926,17z/data=!3d43.25819!4d-2.92598" }),
  }), async (calls) => {
    const place = await resolveMapsLink("https://maps.app.goo.gl/H8VkkiU1bPjorJEU8");
    assert.equal(place.lat, 43.25819);
    assert.equal(place.lng, -2.92598);
    assert.equal(place.name, "Gatz");
    assert.equal(place.url, "https://maps.app.goo.gl/H8VkkiU1bPjorJEU8");
    assert.deepEqual(calls, ["/expand?url=" + encodeURIComponent("https://maps.app.goo.gl/H8VkkiU1bPjorJEU8")]);
  }));

test("resolveMapsLink uses server-scraped coords and name when the expanded URL has none", () =>
  withFetch(async () => ({
    ok: true,
    json: async () => ({
      url: "https://www.google.com/maps/place/Gure+Toki/data=!4m2!3m1!1s0xdead:0xbeef",
      name: "Gure Toki",
      lat: 43.2593788,
      lng: -2.9222899,
    }),
  }), async () => {
    const place = await resolveMapsLink("https://maps.app.goo.gl/H8VkkiU1bPjorJEU8");
    assert.equal(place.lat, 43.2593788);
    assert.equal(place.lng, -2.9222899);
    assert.equal(place.name, "Gure Toki");
    assert.equal(place.url, "https://maps.app.goo.gl/H8VkkiU1bPjorJEU8");
  }));

test("resolveMapsLink returns null when /expand fails or yields no coordinates", async () => {
  await withFetch(async () => ({ ok: false }), async () => {
    assert.equal(await resolveMapsLink("https://maps.app.goo.gl/abc"), null);
  });
  await withFetch(async () => ({ ok: true, json: async () => ({ url: "https://www.google.com/search?q=gatz" }) }), async () => {
    assert.equal(await resolveMapsLink("https://maps.app.goo.gl/abc"), null);
  });
  await withFetch(async () => { throw new Error("network down"); }, async () => {
    assert.equal(await resolveMapsLink("https://maps.app.goo.gl/abc"), null);
  });
});

test("resolveMapsLink returns null for coordinate-less non-short links without fetching", () =>
  withFetch(() => { throw new Error("fetch must not be called"); }, async () => {
    assert.equal(await resolveMapsLink("https://maps.google.com/?q=Guggenheim+Bilbao"), null);
    assert.equal(await resolveMapsLink(""), null);
  }));
