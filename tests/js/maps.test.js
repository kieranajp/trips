import test from "node:test";
import assert from "node:assert/strict";
import { parseMapsLink } from "../../web/lib/maps.js";

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

test("links without coordinates return null", () => {
  assert.equal(parseMapsLink("https://goo.gl/maps/abc123"), null); // short link
  assert.equal(parseMapsLink("https://maps.google.com/?q=Guggenheim+Bilbao"), null); // text query
  assert.equal(parseMapsLink("not a url"), null);
  assert.equal(parseMapsLink(""), null);
  assert.equal(parseMapsLink(null), null);
});
