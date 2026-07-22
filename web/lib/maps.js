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

// The share-sheet domains Google Maps hands out. These URLs carry no
// coordinates themselves — only the redirect target does.
const shortMapsLinkRe = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl|g\.co)\//i;

export function isShortMapsLink(link) {
  return shortMapsLinkRe.test(String(link ?? "").trim());
}

// Resolve any pasted Google Maps link to { name, lat, lng, url }. Full URLs
// parse locally; short links are expanded through the server's /expand
// endpoint (the browser can't follow the redirect itself — CORS hides the
// Location header). Newer share links expand to a URL that carries no
// coordinates at all, so the server also scrapes lat/lng and the place name
// out of the destination page and sends them alongside the URL. Returns
// null when no coordinates can be found any of those ways.
export async function resolveMapsLink(link) {
  const trimmed = String(link ?? "").trim();
  const direct = parseMapsLink(trimmed);
  if (direct || !isShortMapsLink(trimmed)) return direct;
  try {
    const res = await fetch("/expand?url=" + encodeURIComponent(trimmed));
    if (!res.ok) return null;
    const data = await res.json();
    const place = parseMapsLink(data.url)
      || (Number.isFinite(data.lat) && Number.isFinite(data.lng)
        ? { name: "", lat: data.lat, lng: data.lng } : null);
    if (!place) return null;
    // Keep the short link as the pin's URL — it's the canonical share link.
    return { ...place, name: place.name || data.name || "", url: trimmed };
  } catch {
    return null;
  }
}

export const MAPS_LINK_HINT =
  "Couldn't find coordinates in that link — paste a Google Maps share link or the full URL of the place";

// Parse a "lat, lng" text field into numbers, or null if it isn't one.
export function parseLatLng(text) {
  const parts = String(text ?? "").split(",").map((value) => parseFloat(value.trim()));
  if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
  return { lat: parts[0], lng: parts[1] };
}

export const COORDS_HINT = "Coordinates need to be: lat, lng";
