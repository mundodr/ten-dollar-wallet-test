import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");

assert.match(html, /getContext\("webgl2"/);
assert.match(html, /window\.__LATTICE_ORCHARD__/);
assert.match(html, /u_grafts\[12\]/);
assert.match(html, /DRAG TO WANDER/);
assert.match(html, /seed = Number\(query\.get\("seed"\)\) \|\| 731941/);
assert.doesNotMatch(html, /<script[^>]+src=/i);
assert.doesNotMatch(html, /<link[^>]+href=/i);
assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|WebSocket/);

console.log("Infinite Garden static verification passed.");
