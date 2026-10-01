import { useRef, useState } from "preact/hooks";
import { html } from "htm/preact";
import { areaErrors, effectiveAreas, syncStatus, trip } from "../../state/signals.js";
import { canEdit } from "../../state/auth.js";
import { previewAreas, previewRestore, applyAreas } from "../../state/areas.js";
import { retrySync } from "../../state/persistence.js";
import { serializeAreas } from "../../lib/areas.js";

export function AreaFiles() {
  const fileRef = useRef();
  const readGeneration = useRef(0);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState([]);
  const editable = canEdit.value;
  const status = syncStatus.value;
  const allErrors = [...errors, ...areaErrors.value];

  function showResult(result) {
    setPreview(result.preview || null);
    setErrors(result.errors || []);
  }

  async function readFile(file) {
    const generation = ++readGeneration.current;
    setPreview(null);
    try {
      if (file.size > 256 * 1024) {
        showResult({ errors: [{ path: "file", code: "size", message: "Area files must be at most 256 KiB." }] });
        return;
      }
      const text = await file.text();
      if (generation !== readGeneration.current) return;
      showResult(previewAreas(text));
    } catch (_) {
      if (generation === readGeneration.current) {
        showResult({ errors: [{ path: "file", code: "read", message: "Could not read this area file. Try selecting it again." }] });
      }
    }
  }

  function exportFile() {
    try {
      const data = serializeAreas(trip.value.id, effectiveAreas.value);
      const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${trip.value.id}-areas.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (_) {
      setErrors([{ path: "file", code: "export", message: "Could not export areas. Try again." }]);
    }
  }

  function restore() {
    readGeneration.current++;
    showResult(previewRestore());
  }

  function apply() {
    const result = applyAreas(preview);
    setErrors(result.errors || []);
    if (result.preview) setPreview(result.preview);
    else if (!result.errors?.length) setPreview(null);
  }

  function cancel() {
    readGeneration.current++;
    setPreview(null);
  }

  return html`
    <section class="area-files" aria-labelledby="areas-heading">
      <h3 id="areas-heading">Areas</h3>
      <p class="hint">Export ${effectiveAreas.value.length} effective area${effectiveAreas.value.length === 1 ? "" : "s"} as an editable JSON file. Import replaces the complete area set; an empty array clears it. Restoring seeds removes custom areas.</p>
      <div class="io">
        <button class="btn primary" onClick=${exportFile}>Export areas</button>
        ${editable ? html`
          <button class="btn" onClick=${() => fileRef.current.click()}>Import areas</button>
          <button class="btn ghost" onClick=${restore}>Restore seeded areas</button>
          <input ref=${fileRef} type="file" accept=".json,application/json" hidden onChange=${(event) => {
            const file = event.target.files[0];
            if (file) readFile(file);
            event.target.value = "";
          }}/>` : null}
      </div>
      ${allErrors.length ? html`
        <div class="area-errors" role="alert">
          <p>Areas could not be updated:</p>
          <ul>${allErrors.slice(0, 20).map((error) => html`<li><strong>${error.path || "Areas"}</strong>: ${error.message}</li>`)}</ul>
          ${allErrors.length > 20 ? html`<p>${allErrors.length - 20} more errors.</p>` : null}
          <button class="btn mini ghost" onClick=${() => { setErrors([]); areaErrors.value = []; }}>Dismiss errors</button>
        </div>` : null}
      ${preview ? html`
        <div class="area-preview" aria-label="Area replacement preview">
          <p><strong>Trip: ${preview.tripId}</strong></p>
          <p>${preview.before.length} current → ${preview.areas.length} proposed areas</p>
          <dl>
            <dt>Added</dt><dd>${preview.added.join(", ") || "None"}</dd>
            <dt>Changed</dt><dd>${preview.changed.join(", ") || "None"}</dd>
            <dt>Removed</dt><dd>${preview.removed.join(", ") || "None"}</dd>
          </dl>
          <div class="io">
            ${editable ? html`<button class="btn primary" onClick=${apply}>Apply replacement</button>` : null}
            <button class="btn" onClick=${cancel}>Cancel</button>
          </div>
        </div>` : null}
      ${status.message ? html`
        <div class="area-sync" role="status">
          <p>${status.message}</p>
          ${editable && status.state === "error" ? html`<button class="btn mini" onClick=${() => retrySync()}>Retry sync</button>` : null}
        </div>` : null}
      <p class="hint area-sync-help">Changes save on this device before syncing. Concurrent edits on different devices can overwrite each other; the last successful server write wins.</p>
    </section>`;
}
