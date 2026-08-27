import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const readme = await readFile(new URL("./README.md", import.meta.url), "utf8");

assert.match(html, /<canvas id="world"/);
assert.match(html, /const N=180/);
assert.match(html, /function superR\(/);
assert.match(html, /Kuramoto oscillators/);
assert.match(html, /window\.__PELAGIC_OSCILLATOR__/);
assert.match(html, /seed=Number\(query\.get\("seed"\)\)\|\|104729/);
assert.match(html, /SPACE STARTLE/);
assert.match(readme, /No frameworks, models, stock images, external code, or generated media assets/);
assert.doesNotMatch(html, /<script\s+[^>]*src=/i);
assert.doesNotMatch(html, /<link\s+[^>]*href=/i);
assert.doesNotMatch(html, /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/);

console.log("Mathematical Creature static verification passed.");
