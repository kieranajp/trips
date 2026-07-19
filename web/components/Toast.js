import { html } from "htm/preact";
import { toastMsg } from "../state/signals.js";

export function Toast() {
  return html`<div class=${"toast" + (toastMsg.value ? " on" : "")}>${toastMsg.value}</div>`;
}
