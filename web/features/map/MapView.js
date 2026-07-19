import { useEffect, useRef } from "preact/hooks";
import { html } from "htm/preact";
import { areasOn, cats, editing, only, pins, placing, tab, trip } from "../../state/signals.js";
import { removePin, savePin, toggleOnly } from "../../state/actions.js";
import { flyTo, getCenter, invalidate, mountMap } from "./leaflet.js";

const truncate = (text, length) => text.length > length ? text.slice(0, length - 1) + "…" : text;

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
          <button class=${"btn primary" + (placing.value ? " armed" : "")}
            onClick=${() => (placing.value = !placing.value)}>${placing.value ? "Click the map…" : "+ Add pin"}</button>
          <button class="btn" title="Add at map centre" onClick=${() => (editing.value = { latlng: getCenter() })}>Add at centre</button>
          ${hasNeighbourhoods ? html`<button class=${"btn" + (areasOn.value ? "" : " ghost")} title="Toggle neighbourhood areas"
            onClick=${() => (areasOn.value = !areasOn.value)}>Areas: ${areasOn.value ? "on" : "off"}</button>` : null}
        </div>
        <${Filters}/>
        <${PinList}/>
      </aside>
    </section>`;
}
