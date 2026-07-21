import { useEffect, useRef } from "preact/hooks";
import { html } from "htm/preact";
import { areasOn, cats, editing, only, pinMatches, pins, search, tab, trip } from "../../state/signals.js";
import { canEdit } from "../../state/auth.js";
import { removePin, savePin, toggleOnly, toast } from "../../state/actions.js";
import { MAPS_LINK_HINT, parseMapsLink } from "../../lib/maps.js";
import { flyTo, invalidate, mountMap } from "./leaflet.js";

const truncate = (text, length) => text.length > length ? text.slice(0, length - 1) + "…" : text;

function pinFromLink() {
  const link = prompt("Paste a Google Maps link");
  if (!link) return;
  const place = parseMapsLink(link);
  if (!place) { toast(MAPS_LINK_HINT); return; }
  editing.value = { latlng: { lat: place.lat, lng: place.lng }, name: place.name, url: place.url };
}

function Filters() {
  return html`
    <div class="filters">
      <span class="flabel">${only.value ? "Showing one — tap again for all" : "Tap to show only"}</span>
      ${cats.value.map((category) => {
        const count = pins.value.filter((pin) => pin.cat === category.id && pinMatches(pin, search.value)).length;
        const active = only.value === category.id;
        return html`<span class=${"chip" + (active ? " on" : "") + (only.value && !active ? " off" : "")}
          title="Show only this" onClick=${() => toggleOnly(category.id)}>
          <span class="sw" style=${`background:${category.color}`}></span>${category.name} <span class="cnt">${count}</span></span>`;
      })}
    </div>`;
}

function PinList() {
  const visible = pins.value.filter((pin) =>
    (!only.value || pin.cat === only.value) && pinMatches(pin, search.value));
  if (!visible.length) {
    const empty = search.value.trim()
      ? html`<div class="empty">No pins match “${search.value.trim()}”.</div>`
      : html`<div class="empty">No pins to show. Add one, or grab some from the Ideas tab.</div>`;
    return html`<div class="pinlist">${empty}</div>`;
  }
  return html`
    <div class="pinlist">
      ${cats.value.map((category) => {
        const categoryPins = visible.filter((pin) => pin.cat === category.id);
        if (!categoryPins.length) return null;
        return html`
          <div class="pl-cat"><span class="sw" style=${`background:${category.color}`}></span>${category.name}</div>
          ${categoryPins.map((pin) => html`
            <div class="pi" style=${`border-left-color:${category.color}`}>
              <div class="txt" onClick=${() => flyTo(pin)}>
                <div class="nm">${pin.name}</div>
                ${pin.note ? html`<div class="nt">${truncate(pin.note, 90)}</div>` : null}
              </div>
              ${canEdit.value ? html`
                <select class="picat" value=${pin.cat} title="Change category"
                  onClick=${(event) => event.stopPropagation()}
                  onChange=${(event) => savePin({ cat: event.currentTarget.value }, pin)}>
                  ${cats.value.map((item) => html`<option value=${item.id}>${item.name}</option>`)}
                </select>
                <span class="x" title="Remove" onClick=${(event) => { event.stopPropagation(); removePin(pin.id); }}>×</span>` : null}
            </div>`)}
        `;
      })}
    </div>`;
}

export function MapView() {
  const mapRef = useRef();
  useEffect(() => { mountMap(mapRef.current); }, []);
  useEffect(() => { if (tab.value === "map") invalidate(); }, [tab.value]);
  const hasNeighbourhoods = trip.value.neighbourhoods?.length;
  return html`
    <section class=${"view" + (tab.value === "map" ? " on" : "")} id="view-map">
      <div id="map" ref=${mapRef}></div>
      <aside class="side">
        <h2>Your pins</h2>
        <div class="subtle">Tap a pin in the list to fly to it; tap a category below to show only that.</div>
        <div class="actionbar">
          ${canEdit.value ? html`<button class="btn primary" title="Paste a Google Maps link to add a pin" onClick=${pinFromLink}>+ Paste Maps link</button>` : null}
          ${hasNeighbourhoods ? html`<button class=${"btn" + (areasOn.value ? "" : " ghost")} title="Toggle neighbourhood areas"
            onClick=${() => (areasOn.value = !areasOn.value)}>Areas: ${areasOn.value ? "on" : "off"}</button>` : null}
        </div>
        <div class="pinsearch">
          <input type="search" placeholder="Search pins & notes…"
            value=${search.value} onInput=${(event) => (search.value = event.target.value)}/>
          ${search.value ? html`<button class="clear" title="Clear search" onClick=${() => (search.value = "")}>×</button>` : null}
        </div>
        <${Filters}/>
        <${PinList}/>
      </aside>
    </section>`;
}
