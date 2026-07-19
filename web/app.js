import { render } from "preact";
import { useRef, useEffect, useState } from "preact/hooks";
import { html } from "htm/preact";
import {
  trips, trip, cats, pins, only, tab, areasOn, placing, editing, toastMsg,
  boot, initSync, toast, onMap,
  savePin, removePin, toggleCatalog, toggleOnly,
  updateCat, addCat, deleteCat, reset, exportJson, importFile,
} from "./state.js";
import { trim } from "./util.js";
import { mountMap, invalidate, getCenter, flyTo } from "./map.js";

const TABS = [["map", "Map"], ["ideas", "Ideas"], ["setup", "Setup"]];

function TripPicker() {
  return html`
    <div class="picker">
      <div class="picker-inner">
        <div class="brand">Trips</div>
        <p class="picker-lead">Pick a trip to open its map.</p>
        <div class="trip-cards">
          ${trips.value.map((t) => html`
            <a class="trip-card" href=${`?trip=${t.id}`} style=${t.accent ? `--accent:${t.accent}` : ""}>
              <div class="tc-title">${t.title} ${t.subtitle ? html`<em>${t.subtitle}</em>` : null}</div>
              ${t.blurb ? html`<div class="tc-blurb">${t.blurb}</div>` : null}
            </a>`)}
          ${!trips.value.length ? html`<div class="empty">No trips defined yet.</div>` : null}
        </div>
      </div>
    </div>`;
}

function Header() {
  const t = trip.value;
  return html`
    <header>
      <a class="backlink" href="/" title="All trips">←</a>
      <div class="brand">${t.title} ${t.subtitle ? html`<em>${t.subtitle}</em>` : null}</div>
      <div class="tabs">
        ${TABS.map(([id, label]) => html`
          <button class=${"tab" + (tab.value === id ? " on" : "")} onClick=${() => { tab.value = id; if (id === "map") invalidate(); }}>${label}</button>`)}
      </div>
    </header>`;
}

function Filters() {
  return html`
    <div class="filters">
      <span class="flabel">${only.value ? "Showing one — tap again for all" : "Tap to show only"}</span>
      ${cats.value.map((c) => {
        const n = pins.value.filter((p) => p.cat === c.id).length;
        const active = only.value === c.id;
        return html`<span class=${"chip" + (active ? " on" : "") + (only.value && !active ? " off" : "")}
          title="Show only this" onClick=${() => toggleOnly(c.id)}>
          <span class="sw" style=${`background:${c.color}`}></span>${c.name} <span class="cnt">${n}</span></span>`;
      })}
    </div>`;
}

function PinList() {
  const visible = only.value ? pins.value.filter((p) => p.cat === only.value) : pins.value;
  if (!visible.length)
    return html`<div class="pinlist"><div class="empty">No pins to show. Add one, or grab some from the Ideas tab.</div></div>`;
  return html`
    <div class="pinlist">
      ${cats.value.map((c) => {
        const ps = visible.filter((p) => p.cat === c.id);
        if (!ps.length) return null;
        return html`
          <div class="pl-cat"><span class="sw" style=${`background:${c.color}`}></span>${c.name}</div>
          ${ps.map((p) => html`
            <div class="pi" style=${`border-left-color:${c.color}`}>
              <div class="txt" onClick=${() => flyTo(p)}>
                <div class="nm">${p.name}</div>
                ${p.note ? html`<div class="nt">${trim(p.note, 90)}</div>` : null}
              </div>
              <select class="picat" value=${p.cat} title="Change category"
                onClick=${(e) => e.stopPropagation()}
                onChange=${(e) => savePin({ cat: e.currentTarget.value }, p)}>
                ${cats.value.map((cc) => html`<option value=${cc.id}>${cc.name}</option>`)}
              </select>
              <span class="x" title="Remove" onClick=${(e) => { e.stopPropagation(); removePin(p.id); }}>×</span>
            </div>`)}`;
      })}
    </div>`;
}

function MapView() {
  const ref = useRef();
  useEffect(() => { mountMap(ref.current); }, []);
  useEffect(() => { if (tab.value === "map") invalidate(); }, [tab.value]);
  const hasHoods = trip.value.neighbourhoods?.length;
  return html`
    <section class=${"view" + (tab.value === "map" ? " on" : "")} id="view-map">
      <div id="map" ref=${ref}></div>
      <aside class="side">
        <h2>Your pins</h2>
        <div class="subtle">Tap a pin in the list to fly to it; tap a category below to show only that.</div>
        <div class="actionbar">
          <button class=${"btn primary" + (placing.value ? " armed" : "")}
            onClick=${() => (placing.value = !placing.value)}>${placing.value ? "Click the map…" : "+ Add pin"}</button>
          <button class="btn" title="Add at map centre" onClick=${() => (editing.value = { latlng: getCenter() })}>Add at centre</button>
          ${hasHoods ? html`<button class=${"btn" + (areasOn.value ? "" : " ghost")} title="Toggle neighbourhood areas"
            onClick=${() => (areasOn.value = !areasOn.value)}>Areas: ${areasOn.value ? "on" : "off"}</button>` : null}
        </div>
        <${Filters}/>
        <${PinList}/>
      </aside>
    </section>`;
}

function IdeasView() {
  const catalog = trip.value.catalog || [];
  return html`
    <section class=${"view" + (tab.value === "ideas" ? " on" : "")} id="view-ideas">
      <div class="ideas-inner">
        <p class="lead">Picks worth a look — deliberately more than you need. Hit <strong>Add</strong> to drop any onto the map; already-placed ones show a tick. Nothing here is locked; recolour or recategorise on the map however you like.</p>
        ${cats.value.map((c) => {
          const items = catalog.filter((x) => x.cat === c.id);
          if (!items.length) return null;
          return html`
            <div class="ideacat"><span class="sw" style=${`background:${c.color}`}></span>${c.name}</div>
            ${items.map((x) => {
              const added = onMap(x.cid);
              return html`
                <div class="idea">
                  <div class="txt"><div class="nm">${x.name}</div><div class="nt">${x.note}</div></div>
                  <div class="act">
                    <button class=${"btn mini " + (added ? "" : "primary")} title=${added ? "Click to remove from map" : ""}
                      onClick=${() => toggleCatalog(x)}>${added ? "On map ✓" : "Add"}</button>
                  </div>
                </div>`;
            })}`;
        })}
      </div>
    </section>`;
}

function SetupView() {
  const fileRef = useRef();
  return html`
    <section class=${"view" + (tab.value === "setup" ? " on" : "")} id="view-setup">
      <div class="setup-inner">
        <h3>Categories &amp; colours</h3>
        <p class="hint">Rename, recolour or add categories. Changes recolour every pin instantly. You can't delete the last one, and deleting a used category moves its pins to the next one along.</p>
        <div>
          ${cats.value.map((c) => {
            const n = pins.value.filter((p) => p.cat === c.id).length;
            return html`
              <div class="catrow">
                <input type="color" value=${c.color} onInput=${(e) => updateCat(c.id, { color: e.target.value })}/>
                <input type="text" value=${c.name} onChange=${(e) => updateCat(c.id, { name: e.target.value.trim() || c.name })}/>
                <span class="count">${n} pin${n === 1 ? "" : "s"}</span>
                <button class="btn mini ghost" style="color:#a3341f" onClick=${() => deleteCat(c.id)}>✕</button>
              </div>`;
          })}
        </div>
        <div style="margin-top:12px"><button class="btn" onClick=${addCat}>+ New category</button></div>

        <h3>Save &amp; move between devices</h3>
        <p class="hint">This trip's pins live in your browser and sync to the server. To carry it elsewhere: export here, and import on the other device.</p>
        <div class="io">
          <button class="btn primary" onClick=${exportJson}>Export JSON</button>
          <button class="btn" onClick=${() => fileRef.current.click()}>Import JSON / CSV</button>
          <input ref=${fileRef} type="file" accept=".json,.csv,text/csv,application/json" hidden
            onChange=${(e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; }}/>
        </div>
        <p class="hint" style="margin-top:10px"><strong>Google Takeout saves:</strong> export a Saved list's CSV and import it here. The CSV has no coordinates, so each place is geocoded by name (one per second) and lands in the “Saved” category — anything that mislocates, just drag it. (Our own JSON export round-trips everything, categories included.)</p>

        <h3>Reset</h3>
        <p class="hint">Wipes this trip's pins and categories back to the seeded set.</p>
        <button class="btn ghost" style="color:#a3341f;border-color:rgba(163,52,31,.4)" onClick=${reset}>Reset everything</button>
      </div>
    </section>`;
}

function Modal() {
  const e = editing.value;
  if (!e) return null;
  const pin = e.pin;
  const ll = pin ? { lat: pin.lat, lng: pin.lng } : e.latlng;
  const [name, setName] = useState(pin ? pin.name : "");
  const [cat, setCat] = useState(pin ? pin.cat : cats.value[0].id);
  const [note, setNote] = useState(pin ? pin.note || "" : "");
  const [coords, setCoords] = useState(ll ? `${(+ll.lat).toFixed(6)}, ${(+ll.lng).toFixed(6)}` : "");
  const close = () => (editing.value = null);
  const submit = () => {
    if (!name.trim()) { toast("Give it a name"); return; }
    const c = coords.split(",").map((s) => parseFloat(s.trim()));
    if (c.length !== 2 || isNaN(c[0]) || isNaN(c[1])) { toast("Coordinates need to be: lat, lng"); return; }
    savePin({ name: name.trim(), cat, note: note.trim(), lat: c[0], lng: c[1] }, pin);
    close();
  };
  return html`
    <div class="scrim on" onClick=${(ev) => { if (ev.target.classList.contains("scrim")) close(); }}>
      <div class="modal">
        <h3>${pin ? "Edit pin" : "Add pin"}</h3>
        <div class="fld"><label>Name</label><input type="text" placeholder="e.g. That bar Edele found"
          value=${name} onInput=${(ev) => setName(ev.target.value)} autofocus/></div>
        <div class="fld"><label>Category</label>
          <select value=${cat} onChange=${(ev) => setCat(ev.target.value)}>
            ${cats.value.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
          </select></div>
        <div class="fld"><label>Note</label><textarea placeholder="Why it's worth it, opening quirks…"
          value=${note} onInput=${(ev) => setNote(ev.target.value)}></textarea></div>
        <div class="fld"><label>Coordinates</label><input type="text" placeholder="lat, lng"
          value=${coords} onInput=${(ev) => setCoords(ev.target.value)}/></div>
        <div class="modal-act">
          ${pin ? html`<button class="btn ghost del" style="color:#a3341f" onClick=${() => { removePin(pin.id); close(); }}>Delete</button>` : null}
          <span class="spacer"></span>
          <button class="btn" onClick=${close}>Cancel</button>
          <button class="btn primary" onClick=${submit}>Save</button>
        </div>
      </div>
    </div>`;
}

function Toast() {
  return html`<div class=${"toast" + (toastMsg.value ? " on" : "")}>${toastMsg.value}</div>`;
}

function App() {
  if (!trip.value) return html`<${TripPicker}/>`;
  return html`
    <${Header}/>
    <main><${MapView}/><${IdeasView}/><${SetupView}/></main>
    <${Modal}/>
    <${Toast}/>`;
}

await boot();
render(html`<${App}/>`, document.getElementById("app"));
if (trip.value) initSync();
