// Entry point for `npm test` (see package.json): installs the module loader
// below before the test runner imports anything from web/.
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
