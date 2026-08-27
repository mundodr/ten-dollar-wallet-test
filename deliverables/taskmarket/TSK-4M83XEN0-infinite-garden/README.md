# Lattice Orchard — Infinite Garden

`index.html` is a self-contained WebGL 2 artwork: no build, server, package install, network request, font, image, or external runtime is required.

## Run

Open `index.html` in a current Chromium, Firefox, or Safari browser. A local server is optional:

```bash
python3 -m http.server 8080 --directory .
```

Then open `http://127.0.0.1:8080/index.html`.

## Controls

- Drag: wander through the continuous world.
- Mouse wheel / trackpad: zoom without jumping away from the cursor.
- Click: graft a local flower ring into the current coordinate (up to 12).
- Double-click: center on a point and descend one scale.
- `M`: mutate seed and colour/rule strain.
- `R`: return to the origin.
- `S`: save the current specimen as PNG.
- `H`: hide or restore the instrument panel.

The current seed, strain, coordinates, zoom, and graft count remain visible in the instrument panel. State can also be reproduced with query parameters: `?seed=731941&strain=0&x=0&y=0&zoom=1`.

## Capture state

- Seed: `731941`
- Strain: `0` (`MOSS GLASS`)
- Center: `0, 0`
- Zoom: `1`
- Grafts: `0`

The submitted still is `capture-seed-731941.png`.

## System and tools

The garden is an original fragment-shader system combining domain-warped value noise, multi-scale procedural Voronoi flowers, phyllotactic petal rims, vein interference, pollen points, terrain contours, and cursor-anchored zoom. It does not reproduce a named fractal or attractor. Source was authored with Codex; validation uses Chromium/WebGL 2 and a small static verifier. No image-generation skill, stock asset, or copied shader was used.

## Files

- `index.html` — complete runnable artifact and source.
- `capture-seed-731941.png` — deterministic shareable still.
- `verify.mjs` — offline structural checks.
