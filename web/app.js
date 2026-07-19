import { render } from "preact";
import { html } from "htm/preact";
import { App } from "./components/App.js";
import { trip } from "./state/signals.js";
import { initSync } from "./state/persistence.js";
import { boot } from "./state/trips.js";

await boot();
render(html`<${App}/>`, document.getElementById("app"));
if (trip.value) initSync();
