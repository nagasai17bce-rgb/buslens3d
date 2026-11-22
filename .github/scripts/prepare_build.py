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
  updateSelectedSeat();
  if (viewer) void loadViewerModel(config);
  else if (activeView === "inspect" && viewerFailure) {
    viewerFailure = false;
    void startViewer();
  }
}
'''
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
    '    this.paintSelection();\n    this.container.dataset.viewMode = this.mode;\n    this.container.dataset.deck = this.deck;\n  }\n  setMode(mode) { this.mode = mode; this.applyMode(); }\n  setDeck(deck) { this.deck = deck; this.applyMode(); }\n  select(id) { this.selected = id; this.renderer.domElement.dataset.selectedSeat = id; this.paintSelection(); }', 1)
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
