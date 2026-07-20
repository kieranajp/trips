import { useRef, useState, useEffect } from "preact/hooks";
import { html } from "htm/preact";
import { cats, pins, tab, trip } from "../../state/signals.js";
import { canEdit, login } from "../../state/auth.js";
import { addCat, deleteCat, reset, updateCat } from "../../state/actions.js";
import { exportJson, importFile } from "./import-export.js";

function BoardingPasses() {
  const fileRef = useRef();
  const [files, setFiles] = useState([]);
  const id = trip.value.id;
  const load = () =>
    fetch(`/files?trip=${id}`).then((res) => (res.ok ? res.json() : [])).then(setFiles).catch(() => {});
  useEffect(() => { load(); }, [id]);

  async function upload(list) {
    for (const file of list) {
      await fetch(`/files?trip=${id}&name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
    }
    load();
  }

  async function remove(fileId, name) {
    if (!confirm(`Remove “${name}”?`)) return;
    await fetch(`/files?trip=${id}&id=${fileId}`, { method: "DELETE" });
    load();
  }

  return html`
    <h3>Boarding passes & docs</h3>
    <p class="hint">Attach boarding passes, tickets or any trip doc (image or PDF) so it's all in one place. Stored with this trip — up to 10MB each, not parsed.</p>
    <div class="io">
      <button class="btn" onClick=${() => fileRef.current.click()}>Upload file</button>
      <input ref=${fileRef} type="file" accept="image/*,application/pdf,.pdf" multiple hidden
        onChange=${(event) => { if (event.target.files.length) upload([...event.target.files]); event.target.value = ""; }}/>
    </div>
    ${files.length > 0 && html`
      <div style="margin-top:10px">
        ${files.map((file) => html`
          <div class="catrow">
            <a class="btn mini ghost" style="flex:1;text-align:left;text-decoration:none" href=${`/files?trip=${id}&id=${file.id}`} target="_blank" rel="noopener">📄 ${file.name || "file"}</a>
            <button class="btn mini ghost" style="color:#a3341f" onClick=${() => remove(file.id, file.name)}>✕</button>
          </div>`)}
      </div>`}`;
}

export function SetupView() {
  const fileRef = useRef();
  const editable = canEdit.value;
  return html`
    <section class=${"view" + (tab.value === "setup" ? " on" : "")} id="view-setup">
      <div class="setup-inner">
        ${!editable ? html`
          <div class="ro-note">
            <p>You're viewing this trip in read-only mode. <a href="#" onClick=${(event) => { event.preventDefault(); login(); }}>Log in</a> to add pins, edit categories and sync changes.</p>
          </div>` : null}

        <h3>Categories & colours</h3>
        ${editable ? html`
          <p class="hint">Rename, recolour or add categories. Changes recolour every pin instantly. You can't delete the last one, and deleting a used category moves its pins to the next one along.</p>
          <div>
            ${cats.value.map((category) => {
              const count = pins.value.filter((pin) => pin.cat === category.id).length;
              return html`
                <div class="catrow">
                  <input type="color" value=${category.color} onInput=${(event) => updateCat(category.id, { color: event.target.value })}/>
                  <input type="text" value=${category.name} onChange=${(event) => updateCat(category.id, { name: event.target.value.trim() || category.name })}/>
                  <span class="count">${count} pin${count === 1 ? "" : "s"}</span>
                  <button class="btn mini ghost" style="color:#a3341f" onClick=${() => deleteCat(category.id)}>✕</button>
                </div>`;
            })}
          </div>
          <div style="margin-top:12px"><button class="btn" onClick=${addCat}>+ New category</button></div>`
        : html`
          <p class="hint">Categories in this trip:</p>
          <div>
            ${cats.value.map((category) => {
              const count = pins.value.filter((pin) => pin.cat === category.id).length;
              return html`
                <div class="catrow ro">
                  <span class="sw" style=${`background:${category.color}`}></span>
                  <span class="nm">${category.name}</span>
                  <span class="count">${count} pin${count === 1 ? "" : "s"}</span>
                </div>`;
            })}
          </div>`}

        <h3>Save & move between devices</h3>
        <p class="hint">${editable
          ? "This trip's pins live in your browser and sync to the server. To carry it elsewhere: export here, and import on the other device."
          : "Export this trip's pins to carry them elsewhere."}</p>
        <div class="io">
          <button class="btn primary" onClick=${exportJson}>Export JSON</button>
          ${editable ? html`
            <button class="btn" onClick=${() => fileRef.current.click()}>Import JSON / CSV</button>
            <input ref=${fileRef} type="file" accept=".json,.csv,text/csv,application/json" hidden
              onChange=${(event) => {
                if (event.target.files[0]) importFile(event.target.files[0]);
                event.target.value = "";
              }}/>` : null}
        </div>
        ${editable ? html`<p class="hint" style="margin-top:10px"><strong>Google Takeout saves:</strong> export a Saved list's CSV and import it here. The CSV has no coordinates, so each place is geocoded by name (one per second) and lands in the “Saved” category — anything that mislocates, just edit it. (Our own JSON export round-trips everything, categories included.)</p>` : null}

        ${editable ? html`
          <${BoardingPasses}/>

          <h3>Reset</h3>
          <p class="hint">Wipes this trip's pins and categories back to the seeded set.</p>
          <button class="btn ghost" style="color:#a3341f;border-color:rgba(163,52,31,.4)" onClick=${reset}>Reset everything</button>` : null}
      </div>
    </section>`;
}
