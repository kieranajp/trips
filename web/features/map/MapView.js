import { useEffect, useRef } from "preact/hooks";
import { html } from "htm/preact";
import { areasOn, cats, editing, only, pins, tab, trip } from "../../state/signals.js";
import { removePin, savePin, toggleOnly, toast } from "../../state/actions.js";
import { flyTo, invalidate, mountMap } from "./leaflet.js";

const truncate = (text, length) => text.length > length ? text.slice(0, length - 1) + "…" : text;

function pinFromLink() {
  const link = prompt("Paste a Google Maps link");
  if (!link) return;
  const coords = link.match(/!3d(-?\d[\d.]*)!4d(-?\d[\d.]*)/)
    || link.match(/@(-?\d[\d.]*),(-?\d[\d.]*)/)
    || link.match(/[?&](?:q|query)=(-?\d[\d.]*),(-?\d[\d.]*)/);
  if (!coords) { toast("No coordinates in that link — open the place in Google Maps and copy the full URL (short links won't work)"); return; }
  const name = decodeURIComponent(link.match(/\/place\/([^/@]+)/)?.[1] || "").replace(/\+/g, " ");
  editing.value = { latlng: { lat: +coords[1], lng: +coords[2] }, name, url: link };
}

function Filters() {
  return html`
    <div class="filters">
      <span class="flabel">${only.value ? "Showing one — tap again for all" : "Tap to show only"}</span>
      ${cats.value.map((category) => {
        const count = pins.value.filter((pin) => pin.cat === category.id).length;
        const active = only.value === category.id;
        return html`<span class=${"chip" + (active ? " on" : "") + (only.value && !active ? " off" : "")}
          title="Show only this" onClick=${() => toggleOnly(category.id)}>
          <span class="sw" style=${`background:${category.color}`}></span>${category.name} <span class="cnt">${count}</span></span>`;
      })}
    </div>`;
}

function PinList() {
  const visible = only.value ? pins.value.filter((pin) => pin.cat === only.value) : pins.value;
  if (!visible.length) {
    return html`<div class="pinlist"><div class="empty">No pins to show. Add one, or grab some from the Ideas tab.</div></div>`;
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
              <select class="picat" value=${pin.cat} title="Change category"
                onClick=${(event) => event.stopPropagation()}
                onChange=${(event) => savePin({ cat: event.currentTarget.value }, pin)}>
                ${cats.value.map((item) => html`<option value=${item.id}>${item.name}</option>`)}
              </select>
              <span class="x" title="Remove" onClick=${(event) => { event.stopPropagation(); removePin(pin.id); }}>×</span>
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
          <button class="btn primary" title="Paste a Google Maps link to add a pin" onClick=${pinFromLink}>+ Paste Maps link</button>
          ${hasNeighbourhoods ? html`<button class=${"btn" + (areasOn.value ? "" : " ghost")} title="Toggle neighbourhood areas"
            onClick=${() => (areasOn.value = !areasOn.value)}>Areas: ${areasOn.value ? "on" : "off"}</button>` : null}
        </div>
        <${Filters}/>
        <${PinList}/>
      </aside>
    </section>`;
}
