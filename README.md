# Vacuum Garage

**Will this robot vacuum and dock fit in my cupboard?**

A small static site for checking whether a robot vacuum and its dock fit inside a cupboard, where the robot comes and goes through a gap cut off the bottom of the door.

Live: https://malcmcmreal.github.io/vacuum-garage/

## What it does

- Sliders for the cupboard (internal width, depth, height, gap under the door, opening width), the robot (diameter, height) and the dock (width, depth, height).
- A live 3D view (Three.js) plus top and side outlines, all redrawn as you move a slider.
- Checks: robot height against the door gap (with a safety margin), robot diameter against the opening, dock width and height, depth when the robot is parked, and how much approach space reaches outside the cupboard.
- A table that tests every model in `vacuums.json` against your cupboard.
- The URL saves the current setup, so you can bookmark or share it.

## Adding or correcting a model

Everything is in [`vacuums.json`](vacuums.json). Dimensions are in mm:

```json
{
  "id": "brand-model",
  "brand": "Brand",
  "model": "Model",
  "robot": { "diameter": 353, "height": 79.8 },
  "dock": { "width": 409, "depth": 440, "height": 470, "type": "Self-empty + mop wash" },
  "robotOnDock": true,
  "notes": "Anything worth knowing (retractable LiDAR, etc.)",
  "sources": ["https://link-to-spec-sheet"]
}
```

- `robot.height` means the tallest point in normal use. For robots with a retractable LiDAR turret, note in `notes` whether the figure is retracted or raised.
- `dock.depth` includes any ramp or base plate.
- `robotOnDock` is `true` if the robot parks on the dock's ramp (within the dock depth) and `false` if it parks in front of the dock (small charging docks).
- Use `null` for anything you don't know.

Pull requests are welcome. Please include a source link.

## Running locally

The site has no build step, but it loads `vacuums.json` with `fetch`, so you need a local server rather than opening the file directly:

```sh
python3 -m http.server
# then open http://localhost:8000
```

The fit logic lives in [`fit.js`](fit.js), which is DOM-free so you can test it with Node.

## Licence

MIT

## Deploying changes

GitHub Pages serves files with a short browser cache. After changing `app.js`, `fit.js` or `style.css`, bump the `?v=` number in `index.html` (and on the `fit.js` import in `app.js`) so visitors get the new version immediately. `vacuums.json` is always re-checked.
