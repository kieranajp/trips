import { html } from "htm/preact";
import { trip } from "../state/signals.js";
import { Header } from "./Header.js";
import { PinModal } from "./PinModal.js";
import { Toast } from "./Toast.js";
import { TripPicker } from "./TripPicker.js";
import { MapView } from "../features/map/MapView.js";
import { TripView } from "../features/trip/TripView.js";
import { LogisticsModal } from "../features/trip/LogisticsModal.js";
import { IdeasView } from "../features/ideas/IdeasView.js";
import { SetupView } from "../features/setup/SetupView.js";

export function App() {
  if (!trip.value) return html`<${TripPicker}/>`;
  return html`
    <${Header}/>
    <main><${MapView}/><${TripView}/><${IdeasView}/><${SetupView}/></main>
    <${PinModal}/>
    <${LogisticsModal}/>
    <${Toast}/>
  `;
}
