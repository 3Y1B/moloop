import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = resolve("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
const destination = resolve("public/maplibre/maplibre-gl-worker.mjs");
const worker = readFileSync(source);

let current = null;
try {
  current = readFileSync(destination);
} catch {
  // The first install has no generated public worker yet.
}

if (!current || !current.equals(worker)) {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, worker);
  console.log("Synced the MapLibre web worker.");
}
