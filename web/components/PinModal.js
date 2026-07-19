import { useEffect, useState } from "preact/hooks";
import { html } from "htm/preact";
import { cats, editing } from "../state/signals.js";
import { removePin, savePin, toast } from "../state/actions.js";

function PinForm({ edit }) {
  const pin = edit.pin;
  const location = pin ? { lat: pin.lat, lng: pin.lng } : edit.latlng;
  const [name, setName] = useState(pin?.name || "");
  const [category, setCategory] = useState(pin?.cat || cats.value[0].id);
  const [note, setNote] = useState(pin?.note || "");
  const [coords, setCoords] = useState(location ? `${(+location.lat).toFixed(6)}, ${(+location.lng).toFixed(6)}` : "");
  useEffect(() => {
    setName(pin?.name || "");
    setCategory(pin?.cat || cats.value[0].id);
    setNote(pin?.note || "");
    setCoords(location ? `${(+location.lat).toFixed(6)}, ${(+location.lng).toFixed(6)}` : "");
  }, [edit]);
  const close = () => (editing.value = null);
  const submit = () => {
    if (!name.trim()) { toast("Give it a name"); return; }
    const parsed = coords.split(",").map((value) => parseFloat(value.trim()));
    if (parsed.length !== 2 || parsed.some(Number.isNaN)) {
      toast("Coordinates need to be: lat, lng");
      return;
    }
    savePin({ name: name.trim(), cat: category, note: note.trim(), lat: parsed[0], lng: parsed[1] }, pin);
    close();
  };
  return html`
    <div class="modal">
      <h3>${pin ? "Edit pin" : "Add pin"}</h3>
      <div class="fld"><label>Name</label><input type="text" placeholder="e.g. That bar Edele found"
        value=${name} onInput=${(event) => setName(event.target.value)} autofocus/></div>
      <div class="fld"><label>Category</label>
        <select value=${category} onChange=${(event) => setCategory(event.target.value)}>
          ${cats.value.map((item) => html`<option value=${item.id}>${item.name}</option>`)}
        </select></div>
      <div class="fld"><label>Note</label><textarea placeholder="Why it's worth it, opening quirks…"
        value=${note} onInput=${(event) => setNote(event.target.value)}></textarea></div>
      <div class="fld"><label>Coordinates</label><input type="text" placeholder="lat, lng"
        value=${coords} onInput=${(event) => setCoords(event.target.value)}/></div>
      <div class="modal-act">
        ${pin ? html`<button class="btn ghost del" style="color:#a3341f" onClick=${() => { removePin(pin.id); close(); }}>Delete</button>` : null}
        <span class="spacer"></span>
        <button class="btn" onClick=${close}>Cancel</button>
        <button class="btn primary" onClick=${submit}>Save</button>
      </div>
    </div>`;
}

export function PinModal() {
  const edit = editing.value;
  if (!edit) return null;
  return html`
    <div class="scrim on" onClick=${(event) => {
      if (event.target.classList.contains("scrim")) editing.value = null;
    }}>
      <${PinForm} key=${edit.pin?.id || "new"} edit=${edit}/>
    </div>`;
}
