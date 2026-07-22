// Pull the coordinates, place name and canonical URL out of a Google Maps
// link. Handles the three shapes a full maps.google.com URL comes in; short
// (goo.gl/maps) links carry no coordinates, so they return null.
export function parseMapsLink(link) {
  if (!link) return null;
  const coords = link.match(/!3d(-?\d[\d.]*)!4d(-?\d[\d.]*)/)
    || link.match(/@(-?\d[\d.]*),(-?\d[\d.]*)/)
    || link.match(/[?&](?:q|query)=(-?\d[\d.]*),(-?\d[\d.]*)/);
  if (!coords) return null;
  const name = decodeURIComponent(link.match(/\/place\/([^/@]+)/)?.[1] || "").replace(/\+/g, " ");
  return { name, lat: +coords[1], lng: +coords[2], url: link };
}

export const MAPS_LINK_HINT =
  "No coordinates in that link — open the place in Google Maps and copy the full URL (short links won't work)";

// Parse a "lat, lng" text field into numbers, or null if it isn't one.
export function parseLatLng(text) {
  const parts = String(text ?? "").split(",").map((value) => parseFloat(value.trim()));
  if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
  return { lat: parts[0], lng: parts[1] };
}

export const COORDS_HINT = "Coordinates need to be: lat, lng";
