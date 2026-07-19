import { html } from "htm/preact";
import { tab, trip } from "../state/signals.js";
import { invalidate } from "../features/map/leaflet.js";

const TABS = [["map", "Map"], ["ideas", "Ideas"], ["setup", "Setup"]];

export function Header() {
  const activeTrip = trip.value;
  return html`
    <header>
      <a class="backlink" href="/" title="All trips">←</a>
      <div class="brand">${activeTrip.title} ${activeTrip.subtitle ? html`<em>${activeTrip.subtitle}</em>` : null}</div>
      <div class="tabs">
        ${TABS.map(([id, label]) => html`
          <button class=${"tab" + (tab.value === id ? " on" : "")} onClick=${() => {
            tab.value = id;
            if (id === "map") invalidate();
          }}>${label}</button>`)}
      </div>
    </header>`;
}
