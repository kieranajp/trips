// Marker icon specs for L.divIcon — pure data, built here so tests can assert
// on them without Leaflet. The pin colour comes from user state (category
// colours are editable and importable), hence the escape.
import { escapeHtml } from "../../lib/html.js";

// Visited pins swap the centre dot for a tick, so the map itself reads as a
// checklist.
export const pinIconSpec = (color, visited = false) => ({
  className: "",
  iconSize: [26, 26],
  iconAnchor: [13, 25],
  popupAnchor: [0, -24],
  html: `<div class="pin"><svg width="26" height="26" viewBox="0 0 26 26">
    <path d="M13 25C13 25 23 15.5 23 9.5C23 3.7 18.5 0 13 0C7.5 0 3 3.7 3 9.5C3 15.5 13 25 13 25Z" fill="${escapeHtml(color)}" stroke="#f3efe6" stroke-width="1.4"/>
    ${visited
      ? `<path d="M9.2 9.8 L12 12.6 L16.8 6.9" fill="none" stroke="#f3efe6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<circle cx="13" cy="9.5" r="4.4" fill="#f3efe6"/>`}</svg></div>`,
});

export const homeIconSpec = () => ({
  className: "",
  iconSize: [34, 34],
  iconAnchor: [17, 33],
  popupAnchor: [0, -30],
  html: `<div class="home"><svg width="34" height="34" viewBox="0 0 34 34">
    <path d="M17 33 C17 33 30 20 30 12 C30 5 24 0 17 0 C10 0 4 5 4 12 C4 20 17 33 17 33 Z" fill="#1c2321" stroke="#f3efe6" stroke-width="1.5"/>
    <path d="M11.5 13.6 L17 9 L22.5 13.6 M13 12.7 V18 H21 V12.7" fill="none" stroke="#f3efe6" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
  </svg></div>`,
});
