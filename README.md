# BusLens3D

A 3D-first intercity bus discovery and inspection application for India. The app combines source-linked route snapshots, an expandable operator catalogue, seven category-specific representative vehicle models, individual seat and berth selection, booking-provider handoffs, community feedback, price-watch registration, and an honest live-tracking status screen.

## What the public build does

- Search route snapshots for South Indian corridors and selected pan-India routes; view the linked publisher and retrieval date.
- Inspect separate AC/non-AC sleeper, 2+2 seater, 2+1 seater, semi-sleeper, multi-axle sleeper and mixed seater/sleeper GLB models.
- Orbit the whole coach, switch exterior/cabin/cutaway views and decks, select individual positions in 3D or an accessible seat map, and see layout-based suggestions.
- Hand off to public MakeMyTrip, redBus, AbhiBus, or operator route pages where a route URL has been verified. A handoff does not carry a seat, make a reservation, or confirm a booking.
- Browse the operator and vehicle-platform catalogue, source register, verification labels, and provider connection limitations.
- Save a price watch in this browser when the site is on GitHub Pages. It is not a notification: there is no authorized fare feed.
- Submit unverified community feedback when the Python service is enabled. Published community aggregates are withheld until there are at least five submissions per operator.
- View an explicit “no authorized GPS feed” state rather than a fabricated moving bus.

## Data accuracy and limitations

Every source-backed route or claim carries a source record. The route-page fares, counts and journey durations are time-sensitive snapshots retrieved on 22 Nov 2026; they are not a quote, schedule, or inventory for the date selected in the form. Unknown fare ceilings remain unknown. Operator directory entries do not imply verified routes or fleets.

No operator-specific completed vehicle body, cabin plan, livery, or scan was established by the retained research inputs. The seven GLB assets are procedural, category-specific **representative models**, not scans and not an operator-to-vehicle match. Dimensions, axle positions, seats and berths are clearly labelled estimates unless a field cites a retained manufacturer or route source. Availability is unknown. A selected seat is never described as held.

The 17-page research PDF mentioned in the request was not present among the files available during this build. The prior research handoff was used; source URLs and retrieval dates that were not retained are marked as missing instead of reconstructed or invented. The attached repository README and GitHub Pages deployment workflow were used only to preserve the existing deployment identity.

Live inventory, booking API, seat holds, price notifications, licensed review feeds, and GPS coordinates/ETAs require authorized provider access and credentials. The SeatSeller and eTravelSmart adapter records are intentionally disabled until those requirements are met. MakeMyTrip and AbhiBus links do not accept a preselected seat in the verified public URL patterns.

## Run locally

Requirements: Python 3.10+ and an internet-connected browser. Python uses only the standard library and SQLite. The 3D viewer loads a pinned Three.js module from jsDelivr; if that connection or WebGL is unavailable, the 2D seat map stays available.

```bash
python3 pipeline/generate_assets.py
python3 scripts/build_site.py
HOST=127.0.0.1 PORT=8001 python3 backend/server.py
```

Open <http://127.0.0.1:8001>. SQLite is created at `data/buslens3d.sqlite3` by default; override it with `BUSLENS_DB=/path/to/buslens3d.sqlite3`. The server binds to localhost by default for local use. Set `HOST=0.0.0.0` only when intentionally exposing it behind a suitable HTTPS, access-control and persistent-storage setup.

On the static GitHub Pages site, discovery and booking handoffs work without the Python service. Price watches remain in that browser's local storage and do not send notifications. Feedback submission and server-backed SQLite records require the API service.

## Container run

```bash
docker compose up --build
```

The compose file preserves SQLite in a named volume. Do not expose the unprotected sample service publicly as-is; configure an HTTPS reverse proxy, authentication, durable database backups, and production abuse controls before public use.

## Verify

```bash
python3 pipeline/generate_assets.py
python3 scripts/build_site.py
python3 -m unittest discover -s tests -v
node --check web/js/app.js
node --check web/js/data.js
node --check web/js/viewer/three.js
node tests-js/smoke.js
```

The checks validate seed relationships, every generated GLB container and selectable seat ID, API behavior over HTTP, feedback/alert validation, private alert ownership, and required screen controls. The repository build does not use a browser automation runner; test actual 3D rendering and pointer behavior in a WebGL-enabled browser before treating those interactions as browser-verified.

## Architecture

- `web/`: static interface and GitHub Pages output.
- `backend/server.py`: same-origin Python standard-library HTTP API and SQLite store.
- `data/seed/`: normalized source, operator, vehicle platform, configuration, city, provider and route records.
- `pipeline/generate_assets.py`: reproducible geometry-to-GLB generation, with individual named seat and berth objects.
- `pipeline/blender/export_variant.py`: optional Blender import/inspection/GLB export step.
- `scripts/build_site.py`: copies the curated records into the static build and verifies all GLB files.
- `.github/workflows/deploy.yml`: verifies the source bundle, restores it in the build workspace, tests it, generates the GLB assets, and deploys `web/` to the existing GitHub Pages project.

The canonical release source is stored in `.buslens-source/` as seven base64 segments of a deterministic XZ-compressed tar archive. The Pages workflow verifies its SHA-256 checksum, rejects unsafe archive paths, extracts the source in its build workspace, generates the 3D assets, and runs the Python and JavaScript checks before deploying. It does not write generated files back to `main`.

There is no package manager dependency. SQLite contains the catalogue, snapshots, price-watch registrations and community feedback. The public catalogue is seeded idempotently from the JSON source records on API startup.

## Provider and research records

`data/seed/sources.json` is the provenance register, including entries whose URLs or retrieval dates were not preserved in the earlier handoff. `data/seed/providers.json` records actual handoff capabilities separately from partner-only APIs. The application never scrapes private booking APIs and never fills in a missing source URL, current fare, operator model, rating, inventory status or GPS location.
