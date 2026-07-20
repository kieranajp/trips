import { useEffect, useState } from "preact/hooks";
import { html } from "htm/preact";
import { editingLog } from "../../state/signals.js";
import { removeFlight, removeStay, saveFlight, saveStay, toast } from "../../state/actions.js";

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

function LogisticsForm({ edit }) {
  const config = FIELDS[edit.kind];
  const item = edit.item;
  const [values, setValues] = useState({});
  useEffect(() => {
    const initial = { ...(item || {}) };
    if (config.coords && item && item.lat != null && item.lng != null) {
      initial.coords = `${item.lat}, ${item.lng}`;
    }
    setValues(initial);
  }, [edit]);
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const get = (key) => values[key] || "";

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
    config.save(fields, item);
    close();
  };

  const firstSpecs = (config.fullFirst || []).map((key) => config.full.find((s) => s[0] === key));
  const restFull = config.full.filter((s) => !(config.fullFirst || []).includes(s[0]));

  return html`
    <div class="modal">
      <h3>${item ? "Edit " + config.title : "Add " + config.title}</h3>
      ${firstSpecs.map((spec) => html`<${Field} key=${spec[0]} spec=${spec} value=${get(spec[0])} onInput=${set}/>`)}
      ${config.rows.map((row, index) => html`
        <div class="fld-row" key=${index}>
          ${row.map((spec) => html`<${Field} key=${spec[0]} spec=${spec} value=${get(spec[0])} onInput=${set}/>`)}
        </div>`)}
      ${restFull.map((spec) => html`<${Field} key=${spec[0]} spec=${spec} value=${get(spec[0])} onInput=${set}/>`)}
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
