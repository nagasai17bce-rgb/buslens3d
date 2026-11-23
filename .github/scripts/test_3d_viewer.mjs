import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const base = process.env.BUSLENS_BASE_URL;
if (!base) throw new Error("BUSLENS_BASE_URL must point to the deployed Pages site.");
const models = [
  "rep-sleeper-2x1-12m-ac", "rep-sleeper-2x1-12m-nonac",
  "rep-sleeper-2x1-14_5m-multiaxle-ac", "rep-seater-2x2-12m-pushback-ac",
  "rep-semisleeper-2x2-12m-ac", "rep-seater-2x1-13_5m-premium-ac",
  "rep-seater-sleeper-12m-ac",
];
const output = path.resolve("artifacts/3d-viewer");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const consoleErrors = [], pageErrors = [], networkErrors = [];
const glbStatuses = new Map();
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("requestfailed", (request) => networkErrors.push(`${request.url()} :: ${request.failure()?.errorText ?? "failed"}`));
page.on("response", (response) => {
  const match = response.url().match(/\/assets\/models\/([^/]+\.glb)(?:\?.*)?$/);
  if (match) glbStatuses.set(match[1].replace(/\.glb$/, ""), response.status());
  if (response.status() >= 400) networkErrors.push(`${response.status()} ${response.url()}`);
});
function screenshotHasGeometry(buffer, name) {
  const image = PNG.sync.read(buffer), data = image.data;
  const bg = [data[0], data[1], data[2]], colors = new Set();
  let foreground = 0;
  for (let y = 0; y < image.height; y += 6) for (let x = 0; x < image.width; x += 6) {
    const i = (y * image.width + x) * 4, rgb = [data[i], data[i + 1], data[i + 2]];
    colors.add(rgb.map((v) => Math.floor(v / 12)).join(","));
    if (Math.abs(rgb[0] - bg[0]) + Math.abs(rgb[1] - bg[1]) + Math.abs(rgb[2] - bg[2]) > 30) foreground++;
  }
  assert.ok(colors.size > 12 && foreground > 40, `${name}: rendered screenshot appears blank.`);
}
async function waitForModel(target, id) {
  await target.waitForFunction((modelId) => {
    const host = document.querySelector("#bus-viewer"), canvas = host?.querySelector("canvas");
    return host?.dataset.modelLoaded === modelId && Number(host.dataset.geometryCount) > 0 &&
      canvas?.dataset.webglReady === "true" && Number(canvas.dataset.renderTriangles) > 0 && !host.dataset.loading;
  }, id, { timeout: 30000 });
}
try {
  const url = new URL(base);
  url.searchParams.set("e2e", "1");
  await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('[data-view="inspect"]').click();
  const selector = page.locator("#model-select");
  await selector.waitFor();
  assert.deepEqual(await selector.locator("option").evaluateAll((opts) => opts.map((o) => o.value)), models);

  for (const id of models) {
    await selector.selectOption(id);
    await waitForModel(page, id);
    assert.equal(glbStatuses.get(id), 200, `${id}: GLB request must succeed.`);
    const size = await page.locator("#bus-viewer canvas").evaluate((c) => ({ w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, webgl: c.dataset.webglVersion, triangles: +c.dataset.renderTriangles }));
    assert.ok(size.w > 0 && size.h > 0 && size.cw > 100 && size.ch > 100, `${id}: canvas has non-zero dimensions.`);
    assert.ok(["1", "2"].includes(size.webgl) && size.triangles > 0, `${id}: WebGL geometry is rendered.`);
    screenshotHasGeometry(await page.locator("#bus-viewer canvas").screenshot({ path: path.join(output, `${id}.png`) }), id);
    console.log(`PASS model ${id}: GLB 200, WebGL ${size.webgl}, ${size.triangles} triangles, non-blank screenshot.`);
  }

  await selector.selectOption(models[0]);
  await waitForModel(page, models[0]);
  const fittings = await page.evaluate(() => {
    const names=[];window.__BUSLENS_TEST_VIEWER__.model.traverse((node)=>names.push(node.name));
    return Object.fromEntries(["curtain_","luggage_rack_","ac_vent_","cabin_light_","entry_door_glass","luggage_bay_","window_","wheel_"].map((prefix)=>[prefix,names.some((name)=>name.startsWith(prefix))]));
  });
  assert.ok(Object.values(fittings).every(Boolean), "Representative geometry must include cabin fittings and exterior doors, windows, wheels, and luggage bays.");
  console.log("PASS representative interiors and exterior fittings are present.");
  for (const mode of ["inside", "outside", "cutaway"]) {
    await page.locator(`button.segment[data-mode="${mode}"]`).click();
    await page.waitForFunction((value) => document.querySelector("#bus-viewer")?.dataset.viewMode === value, mode);
    screenshotHasGeometry(await page.locator("#bus-viewer canvas").screenshot({ path: path.join(output, `mode-${mode}.png`) }), `mode ${mode}`);
    console.log(`PASS mode ${mode}.`);
  }
  for (const deck of ["upper", "lower", "both"]) {
    await page.locator(`button.segment[data-deck="${deck}"]`).click();
    await page.waitForFunction((value) => document.querySelector("#bus-viewer")?.dataset.deck === value, deck);
    screenshotHasGeometry(await page.locator("#bus-viewer canvas").screenshot({ path: path.join(output, `deck-${deck}.png`) }), `deck ${deck}`);
    console.log(`PASS deck ${deck}.`);
  }

  await page.locator('button.segment[data-deck="2d"]').click();
  const seatMap = page.locator("#seat-map-2d");
  await seatMap.waitFor({ state: "visible" });
  const seat = seatMap.locator(".seat-map-seat[data-seat-id]").first();
  const seatId = await seat.getAttribute("data-seat-id");
  await seat.click();
  await page.waitForFunction((id) => document.querySelector("#bus-viewer canvas")?.dataset.selectedSeat === id, seatId);
  assert.equal(await seat.getAttribute("aria-pressed"), "true");
  assert.match(await page.locator("#inventory-detail").textContent(), /No authorised live seat feed/i);
  await seatMap.screenshot({ path: path.join(output, "seat-map-selected.png") });
  console.log("PASS 2D seat selection and synchronization with the 3D viewer.");

  await page.getByRole("button", { name: "Look from this position" }).click();
  await page.waitForFunction((id) => document.querySelector("#bus-viewer")?.dataset.cameraSeat === id, seatId);
  const pov = await page.evaluate((id) => {
    const viewer = window.__BUSLENS_TEST_VIEWER__;
    const object = viewer.seats.get(id);
    const expected = object.getWorldPosition(viewer.camera.position.clone());
    expected.y += object.userData.kind === "berth" ? .38 : .78;
    return { expected: expected.toArray(), actual: viewer.camera.position.toArray(), yaw: viewer.camera.rotation.y,
      deck: viewer.container.dataset.cameraDeck, kind: viewer.container.dataset.cameraKind };
  }, seatId);
  assert.ok(pov.expected.every((v, i) => Math.abs(v - pov.actual[i]) < .002), "POV camera must use the selected seat's world position plus its eye-height offset.");
  assert.ok(Math.abs(pov.yaw - Math.PI / 2) < .02, "POV camera must face the bus front along the seat orientation.");
  console.log(`PASS per-seat POV uses exact model coordinates (${pov.deck} ${pov.kind}).`);
  await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.exitSeatPOV());

  const upperSeat = seatMap.locator('.seat-map-seat[data-seat-id^="UPPER-"]').first();
  const upperId = await upperSeat.getAttribute("data-seat-id");
  assert.ok(upperId, "The representative sleeper layout must expose an upper berth.");
  await page.locator("#compare-add-button").click();
  await upperSeat.click();
  await page.locator("#compare-add-button").click();
  assert.equal(await page.locator("#seat-compare-list .compare-row").count(), 2, "Two positions can be compared.");
  await page.locator(`[data-compare-view="${upperId}"]`).click();
  await page.waitForFunction((id) => document.querySelector("#bus-viewer")?.dataset.cameraSeat === id, upperId);
  assert.equal(await page.locator("#bus-viewer").getAttribute("data-camera-deck"), "upper");
  console.log("PASS lower/upper berth comparison switches to the corresponding seat camera.");
  await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.exitSeatPOV());

  await page.locator('button.segment[data-deck="both"]').click();
  await page.locator('button.segment[data-mode="inside"]').click();
  const target = await page.evaluate((selected) => {
    const viewer = window.__BUSLENS_TEST_VIEWER__;
    if (!viewer) throw new Error("Test viewer hook missing.");
    viewer.setMode("inside"); viewer.setDeck("both");
    const canvas = viewer.renderer.domElement, rect = canvas.getBoundingClientRect();
    for (const [id, object] of viewer.seats.entries()) {
      if (id === selected || !object.visible) continue;
      const p = object.getWorldPosition(viewer.camera.position.clone()).project(viewer.camera);
      const x = rect.left + ((p.x + 1) / 2) * rect.width, y = rect.top + ((1 - p.y) / 2) * rect.height;
      if (p.z > -1 && p.z < 1 && x > rect.left + 5 && x < rect.right - 5 && y > rect.top + 5 && y < rect.bottom - 5) return { id, x, y };
    }
    throw new Error("No selectable seat projects inside the 3D canvas.");
  }, seatId);
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction((id) => document.querySelector("#bus-viewer canvas")?.dataset.selectedSeat === id, target.id);
  assert.match(await page.locator("#selected-seat-title").textContent(), /Seat selected|Berth selected/);
  console.log(`PASS 3D seat raycast and highlight (${target.id}).`);

  const camera = await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.camera.position.toArray());
  const box = await page.locator("#bus-viewer canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 95, box.y + box.height / 2 + 28, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  const rotated = await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.camera.position.toArray());
  assert.ok(rotated.some((v, i) => Math.abs(v - camera[i]) > 0.05), "Drag must orbit the camera.");
  await page.mouse.wheel(0, -450);
  await page.waitForTimeout(250);
  const zoomed = await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.camera.position.toArray());
  assert.ok(zoomed.some((v, i) => Math.abs(v - rotated[i]) > 0.05), "Wheel must zoom the camera.");
  const targetBeforePan = await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.controls.target.toArray());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + box.width / 2 + 65, box.y + box.height / 2 + 22, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(300);
  const targetAfterPan = await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.controls.target.toArray());
  assert.ok(targetAfterPan.some((v, i) => Math.abs(v - targetBeforePan[i]) > 0.01), "Right-drag must pan the model.");
  await page.locator("#reset-camera").click();
  await page.waitForTimeout(350);
  const reset = await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.camera.position.toArray());
  assert.ok(reset.every((v, i) => Math.abs(v - camera[i]) < 0.25), "Reset must restore camera framing.");
  console.log("PASS orbit, zoom, pan, and reset.");

  await page.locator('button.segment[data-deck="2d"]').click();
  await page.locator(`[data-seat-id="${seatId}"]`).click();
  const simulation = await page.evaluate(async (selectedId) => {
    const inventory = window.__BUSLENS_TEST_INVENTORY__;
    const ids = [...document.querySelectorAll("#seat-map-2d .seat-map-seat[data-seat-id]")].map((node) => node.dataset.seatId);
    const otherId = ids.find((id) => id !== selectedId);
    inventory.adapter = {
      getInventory: async () => ({ authorized: true, feedAvailable: true, seats: [
        { seatId: selectedId, status: "available" }, { seatId: otherId, status: "available" },
      ] }),
      revalidate: async (_service, seatId) => ({ authorized: true, feedAvailable: true, seatId, status: "unavailable" }),
    };
    await inventory.openService({ providerId: "test-only-mock", routeId: "simulation", date: "2030-01-01" });
    return { otherId };
  }, seatId);
  assert.match(await page.locator("#inventory-detail").textContent(), /Provider inventory is separate/i);
  await page.waitForFunction((id) => document.querySelector(`[data-seat-id="${id}"]`)?.dataset.status === "selected", seatId);
  assert.equal(await page.locator(`[data-seat-id="${simulation.otherId}"]`).getAttribute("data-status"), "available");
  assert.equal(await page.evaluate((id) => window.__BUSLENS_TEST_VIEWER__.availability.get(id), simulation.otherId), "available");
  await page.evaluate(async (id) => window.__BUSLENS_TEST_INVENTORY__.revalidate({ routeId: "simulation" }, id), seatId);
  await page.waitForFunction((id) => document.querySelector(`[data-seat-id="${id}"]`)?.dataset.status === "unavailable", seatId);
  assert.equal(await page.evaluate((id) => window.__BUSLENS_TEST_VIEWER__.availability.get(id), seatId), "unavailable");
  assert.equal(await page.evaluate(() => window.__BUSLENS_TEST_INVENTORY__.canHandoff), false);
  console.log("PASS test-only mock simulation syncs 2D/3D status and blocks a confirmed conflict; this is not live provider data.");
  await page.evaluate(async () => {
    const inventory = window.__BUSLENS_TEST_INVENTORY__;
    inventory.adapter = null;
    await inventory.openService({ routeId: "no-feed" });
  });
  await page.locator('button.segment[data-deck="both"]').click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const resized = await page.locator("#bus-viewer canvas").evaluate((c) => ({ w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight }));
  assert.ok(resized.w > 0 && resized.h > 0 && resized.cw > 100 && resized.ch > 100, "Canvas resizes to mobile viewport.");
  await page.locator("#bus-viewer canvas").screenshot({ path: path.join(output, "mobile-resize.png") });
  console.log("PASS responsive resize to 390x844.");

  const retryPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let failOnce = true;
  await retryPage.route("**/assets/models/rep-sleeper-2x1-12m-ac.glb", async (route) => {
    if (failOnce) { failOnce = false; await route.abort(); } else await route.continue();
  });
  await retryPage.goto(url.toString(), { waitUntil: "networkidle", timeout: 60000 });
  await retryPage.locator('[data-view="inspect"]').click();
  await retryPage.locator("[data-retry-viewer]").waitFor({ state: "visible", timeout: 30000 });
  await retryPage.getByRole("button", { name: "Retry 3D" }).click();
  await waitForModel(retryPage, models[0]);
  console.log("PASS failed-GLB retry clears loading state and renders.");
  await retryPage.close();

  assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join(" | ")}`);
  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(networkErrors, [], `Network failures: ${networkErrors.join(" | ")}`);
  console.log("PASS production network and console: no failed requests or critical errors.");
} finally {
  await browser.close();
}
