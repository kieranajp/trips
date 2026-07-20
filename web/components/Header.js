import { html } from "htm/preact";
import { tab, trip } from "../state/signals.js";
import { authReady, authUser, login, logout } from "../state/auth.js";
import { invalidate } from "../features/map/leaflet.js";

const TABS = [["map", "Map"], ["trip", "Trip"], ["ideas", "Ideas"], ["setup", "Setup"]];

function AuthControl() {
  if (!authReady.value) return null;
  if (authUser.value) {
    return html`<span class="auth">
      <span class="auth-who" title=${authUser.value.user || ""}>${authUser.value.user || "Signed in"}</span>
      <button class="btn mini ghost" onClick=${logout}>Log out</button>
    </span>`;
  }
  return html`<span class="auth">
    <button class="btn mini" title="Log in to edit" onClick=${login}>Log in</button>
  </span>`;
}

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
      <${AuthControl}/>
    </header>`;
}
