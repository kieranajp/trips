import { useEffect, useRef, useState } from "preact/hooks";
import { html } from "htm/preact";
import { editingLog, trip } from "../../state/signals.js";
import { removeFlight, removeStay, saveFlight, saveStay, toast } from "../../state/actions.js";
import { MAPS_LINK_HINT, parseMapsLink } from "../../lib/maps.js";

// Field specs per kind: [key, label, inputType, placeholder]. The order here
// is the order they render, so adding a logistics type is just a new list.
const FIELDS = {
  flight: {
    title: "flight",
    rows: [
      [["airline", "Airline", "text", "e.g. easyJet"], ["number", "Flight no.", "text", "e.g. EZY8459"]],
      [["from", "From", "text", "e.g. LGW"], ["to", "To", "text", "e.g. BIO"]],
      [["depart", "Departs", "datetime-local", ""], ["arrive", "Arrives", "datetime-local", ""]],
    ],
    full: [
      ["confirmation", "Booking reference", "text", "e.g. X7K2PQ"],
      ["note", "Note", "textarea", "Terminal, seats, bags…"],
    ],
    required: ["from", "to"],
    requiredMsg: "Give it a from and to",
    save: saveFlight,
    remove: removeFlight,
  },
  stay: {
    title: "stay",
    rows: [
      [["checkIn", "Check-in", "datetime-local", ""], ["checkOut", "Check-out", "datetime-local", ""]],
    ],
    full: [
      ["name", "Name", "text", "e.g. Hotel Hesperia Bilbao"],
      ["address", "Address", "text", "Street, area"],
      ["coords", "Location (lat, lng)", "text", "43.2678, -2.9281 — optional, drops it on the map"],
      ["confirmation", "Booking reference", "text", "e.g. HB-4471902"],
      ["url", "Booking link", "url", "https://…"],
      ["note", "Note", "textarea", "Breakfast, parking, key collection…"],
    ],
    fullFirst: ["name", "address", "coords"],
    required: ["name"],
    requiredMsg: "Give it a name",
    // "coords" is a "lat, lng" text field parsed into numeric lat/lng on save.
    coords: true,
    // Autofill name/coords/link by pasting a Google Maps link, like pins.
    mapsLink: true,
    save: saveStay,
    remove: removeStay,
  },
};

function Field({ spec, value, onInput }) {
  const [key, label, type, placeholder] = spec;
  const common = { value, placeholder, onInput: (event) => onInput(key, event.target.value) };
  return html`
    <div class="fld">
      <label>${label}</label>
      ${type === "textarea"
        ? html`<textarea ...${common}></textarea>`
        : html`<input type=${type} ...${common}/>`}
    </div>`;
}

// Boarding passes attach to a flight: the blob lives in the /files store, and
// the flight carries lightweight refs ({id,name,type}) in its state. Uploads
// hit /files immediately (need auth), so cancelling a new flight can orphan a
// blob — harmless, gated, tiny. ponytail: leave orphans, sweep only if it bites.
function BoardingPassTab({ passes, setPasses }) {
  const fileRef = useRef();
  const [big, setBig] = useState(null);
  const tripId = trip.value.id;
  const url = (pass) => `/files?trip=${tripId}&id=${pass.id}`;
  const isImg = (pass) => (pass.type || "").startsWith("image/");

  async function upload(list) {
    const added = [];
    for (const file of list) {
      const res = await fetch(`/files?trip=${tripId}&name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (res.ok) added.push({ id: (await res.json()).id, name: file.name, type: file.type || "" });
    }
    if (added.length) setPasses([...passes, ...added]);
  }

  async function remove(pass) {
    if (!confirm(`Remove “${pass.name}”?`)) return;
    await fetch(url(pass), { method: "DELETE" });
    setPasses(passes.filter((item) => item.id !== pass.id));
  }

  return html`
    <div>
      <div class="maps-fill">
        <button class="btn" onClick=${() => fileRef.current.click()}>⬆ Upload boarding pass</button>
        <span class="hint">Image or PDF. Tap a pass to enlarge it.</span>
      </div>
      <input ref=${fileRef} type="file" accept="image/*,application/pdf,.pdf" multiple hidden
        onChange=${(event) => { if (event.target.files.length) upload([...event.target.files]); event.target.value = ""; }}/>
      ${passes.length ? html`
        <div class="pass-list">
          ${passes.map((pass) => html`
            <div class="pass-row" key=${pass.id}>
              <button class="pass-open" onClick=${() => setBig(pass)}>
                ${isImg(pass) ? html`<img src=${url(pass)} alt=${pass.name}/>` : html`<span class="pass-ico">📄</span>`}
                <span class="pass-name">${pass.name || "boarding pass"}</span>
              </button>
              <span class="logi-x" title="Remove" onClick=${() => remove(pass)}>×</span>
            </div>`)}
        </div>`
        : html`<div class="empty">No boarding pass yet.</div>`}
      ${big ? html`
        <div class="lightbox" onClick=${(event) => { if (event.target.classList.contains("lightbox")) setBig(null); }}>
          <span class="lightbox-x" onClick=${() => setBig(null)}>×</span>
          ${isImg(big)
            ? html`<img src=${url(big)} alt=${big.name}/>`
            : html`<iframe src=${url(big)} title=${big.name}></iframe>`}
        </div>` : null}
    </div>`;
}

function LogisticsForm({ edit }) {
  const config = FIELDS[edit.kind];
  const item = edit.item;
  const isFlight = edit.kind === "flight";
  const [values, setValues] = useState({});
  const [passes, setPasses] = useState([]);
  const [pane, setPane] = useState("details");
  useEffect(() => {
    const initial = { ...(item || {}) };
    if (config.coords && item && item.lat != null && item.lng != null) {
      initial.coords = `${item.lat}, ${item.lng}`;
    }
    setValues(initial);
    setPasses((item && item.passes) || []);
    setPane("details");
  }, [edit]);
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const get = (key) => values[key] || "";

  const fromMapsLink = () => {
    const link = prompt("Paste a Google Maps link for where you're staying");
    if (!link) return;
    const place = parseMapsLink(link);
    if (!place) { toast(MAPS_LINK_HINT); return; }
    setValues((current) => ({
      ...current,
      name: current.name || place.name,
      coords: `${place.lat}, ${place.lng}`,
      url: place.url,
    }));
  };

  const close = () => (editingLog.value = null);
  const submit = () => {
    if (config.required.some((key) => !get(key).trim())) { toast(config.requiredMsg); return; }
    const fields = {};
    const allKeys = [...(config.fullFirst || []), ...config.rows.flat().map((s) => s[0]), ...config.full.map((s) => s[0])];
    allKeys.forEach((key) => { fields[key] = get(key).trim(); });
    if (config.coords) {
      const raw = (fields.coords || "").trim();
      delete fields.coords;
      if (raw) {
        const parts = raw.split(",").map((value) => parseFloat(value.trim()));
        if (parts.length !== 2 || parts.some(Number.isNaN)) { toast("Coordinates need to be: lat, lng"); return; }
        [fields.lat, fields.lng] = parts;
      } else {
        fields.lat = null;
        fields.lng = null;
      }
    }
    if (isFlight) fields.passes = passes;
    config.save(fields, item);
    close();
  };

  const firstSpecs = (config.fullFirst || []).map((key) => config.full.find((s) => s[0] === key));
  const restFull = config.full.filter((s) => !(config.fullFirst || []).includes(s[0]));

  return html`
    <div class="modal">
      <h3>${item ? "Edit " + config.title : "Add " + config.title}</h3>
      ${isFlight ? html`
        <div class="tabs">
          <button class=${"tab" + (pane === "details" ? " on" : "")} onClick=${() => setPane("details")}>Details</button>
          <button class=${"tab" + (pane === "pass" ? " on" : "")} onClick=${() => setPane("pass")}>Boarding pass${passes.length ? ` (${passes.length})` : ""}</button>
        </div>` : null}
      ${isFlight && pane === "pass"
        ? html`<${BoardingPassTab} passes=${passes} setPasses=${setPasses}/>`
        : html`<div>
            ${config.mapsLink ? html`
              <div class="maps-fill">
                <button class="btn" onClick=${fromMapsLink}>📍 Fill from Google Maps link</button>
                <span class="hint">Paste a place link — pulls in the name, location and map pin. Then add your dates below.</span>
              </div>` : null}
            ${firstSpecs.map((spec) => html`<${Field} key=${spec[0]} spec=${spec} value=${get(spec[0])} onInput=${set}/>`)}
            ${config.rows.map((row, index) => html`
              <div class="fld-row" key=${index}>
                ${row.map((spec) => html`<${Field} key=${spec[0]} spec=${spec} value=${get(spec[0])} onInput=${set}/>`)}
              </div>`)}
            ${restFull.map((spec) => html`<${Field} key=${spec[0]} spec=${spec} value=${get(spec[0])} onInput=${set}/>`)}
          </div>`}
      <div class="modal-act">
        ${item ? html`<button class="btn ghost del" style="color:#a3341f" onClick=${() => { config.remove(item.id); close(); }}>Delete</button>` : null}
        <span class="spacer"></span>
        <button class="btn" onClick=${close}>Cancel</button>
        <button class="btn primary" onClick=${submit}>Save</button>
      </div>
    </div>`;
}

export function LogisticsModal() {
  const edit = editingLog.value;
  if (!edit) return null;
  return html`
    <div class="scrim on" onClick=${(event) => {
      if (event.target.classList.contains("scrim")) editingLog.value = null;
    }}>
      <${LogisticsForm} key=${(edit.kind || "") + "_" + (edit.item?.id || "new")} edit=${edit}/>
    </div>`;
}
