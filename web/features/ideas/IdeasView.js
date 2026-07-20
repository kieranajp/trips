import { html } from "htm/preact";
import { cats, onMap, tab, trip } from "../../state/signals.js";
import { canEdit } from "../../state/auth.js";
import { toggleCatalog } from "../../state/actions.js";

export function IdeasView() {
  const catalog = trip.value.catalog || [];
  return html`
    <section class=${"view" + (tab.value === "ideas" ? " on" : "")} id="view-ideas">
      <div class="ideas-inner">
        <p class="lead">Picks worth a look — deliberately more than you need. Hit <strong>Add</strong> to drop any onto the map; already-placed ones show a tick. Nothing here is locked; recolour or recategorise on the map however you like.</p>
        ${cats.value.map((category) => {
          const items = catalog.filter((item) => item.cat === category.id);
          if (!items.length) return null;
          return html`
            <div class="ideacat"><span class="sw" style=${`background:${category.color}`}></span>${category.name}</div>
            ${items.map((item) => {
              const added = onMap(item.cid);
              return html`
                <div class="idea">
                  <div class="txt"><div class="nm">${item.name}</div><div class="nt">${item.note}</div></div>
                  <div class="act">
                    ${canEdit.value
                      ? html`<button class=${"btn mini " + (added ? "" : "primary")}
                          title=${added ? "Click to remove from map" : ""} onClick=${() => toggleCatalog(item)}>
                          ${added ? "On map ✓" : "Add"}</button>`
                      : added ? html`<span class="idea-tag">On map ✓</span>` : null}
                  </div>
                </div>`;
            })}`;
        })}
      </div>
    </section>`;
}
