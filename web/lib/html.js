// For the imperative corners of the app (Leaflet popups, divIcon HTML) where
// there's no Preact to escape for us. Everything interpolated into those raw
// HTML strings is user state or imported JSON — untrusted — so it all comes
// through here.
export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
}[character]));
