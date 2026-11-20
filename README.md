# BusLens 3D

Interactive proof-of-concept for reconstructing an Indian sleeper-bus seat map as a 3D cabin.

## Run locally

Requires a modern browser with WebGL and an internet connection for the Three.js CDN modules.

```bash
python3 -m http.server 8001
```

Open [http://localhost:8001](http://localhost:8001).

## Features

- Three.js 3D cutaway cabin with orbit, zoom and reset controls.
- Lower deck, upper deck and both-deck views.
- 2D seat-map mode.
- Clickable berths with prices and availability states.
- Responsive layout for desktop and mobile.

## Data and accuracy

The seat positions, prices and statuses are a manually transcribed prototype from a user-provided MakeMyTrip seat-map screenshot. They are not live booking inventory. Bus dimensions, cabin structure, and amenities are illustrative, not verified measurements or a confirmed vehicle-specific 3D scan. The MakeMyTrip button opens the supplied route search page; it does not reserve seats or integrate with its internal APIs.

## Stack

- HTML, CSS, JavaScript modules
- Three.js 0.166.1
- Three.js OrbitControls
