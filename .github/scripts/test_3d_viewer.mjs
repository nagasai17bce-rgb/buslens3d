import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const base = process.env.BUSLENS_BASE_URL;
if (!base) throw new Error("BUSLENS_BASE_URL must point to the deployed Pages site.");
const expectedModels = [
  "rep-sleeper-2x1-12m-ac",
  "rep-sleeper-2x1-12m-nonac",
  "rep-sleeper-2x1-14_5m-multiaxle-ac",
  "rep-seater-2x2-12m-pushback-ac",
  "rep-semisleeper-2x2-12m-ac",
  "rep-seater-2x1-13_5m-premium-ac",
  "rep-seater-sleeper-12m-ac",
];
const screenshotDir = path.resolve("artifacts/3d-viewer");
fs.mkdirSync(screenshotDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const consoleErrors = [];
const pageErrors = [];
const networkErrors = [];
const glbStatuses = new Map();
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("requestfailed", (request) => networkErrors.push(`${request.url()} :: ${request.failure()?.errorText ?? "failed"}`));
page.on("response", (response) => {
  const match = response.url().match(/\/assets\/models\/([^/]+\.glb)(?:\?.*)?$/);
  if (match) glbStatuses.set(match[1].replace(/\.glb$/, ""), response.status());
  if (response.status() >= 400) networkErrors.push(`${response.status()} ${response.url()}`);
});

function checkScreenshot(buffer, label) {
  const image = PNG.sync.read(buffer);
  const data = image.data;
  const bg = [data[0], data[1], data[2]];
  const colors = new Set();
  let differentPixels = 0;
  for (let y = 0; y < image.height; y += 6) {
    for (let x = 0; x < image.width; x += 6) {
      const i = (y * image.width + x) * 4;
      const rgb = [data[i], data[i + 1], data[i + 2]];
      colors.add(rgb.map((v) => Math.floor(v / 12)).join(","));
      if (Math.abs(rgb[0] - bg[0]) + Math.abs(rgb[1] - bg[1]) + Math.abs(rgb[2] - bg[2]) > 30) differentPixels += 1;
    }
  }
  assert.ok(colors.size > 12 && differentPixels > 40, `${label}: screenshot appears blank (${colors.size} colors, ${differentPixels} foreground samples)`);
}

async function waitForModel(targetPage, id) {
  await targetPage.waitForFunction((modelId) => {
    const host = document.querySelector("#bus-viewer");
    const canvas = host?.querySelector("canvas");
    return host?.dataset.modelLoaded === modelId && Number(host.dataset.geometryCount) > 0 &&
      canvas?.dataset.webglReady === "true" && Number(canvas.dataset.renderTriangles) > 0 && !host.dataset.loading;
  }, id, { timeout: 30000 });
}

try {
  const url = new URL(base);
  url.searchParams.set("e2e", "1");
  await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('[data-view="inspect"]').click();
  const select = page.locator("#model-select");
  await select.waitFor();
  const ids = await select.locator("option").evaluateAll((options) => options.map((option) => option.value));
  assert.deepEqual(ids, expectedModels, "The seven expected model configurations must be selectable.");

  for (const id of expectedModels) {
    await select.selectOption(id);
    await waitForModel(page, id);
    assert.equal(glbStatuses.get(id), 200, `${id}: GLB request must return HTTP 200.`);
    const metrics = await page.locator("#bus-viewer canvas").evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      webglVersion: canvas.dataset.webglVersion,
      triangles: Number(canvas.dataset.renderTriangles),
    }));
    assert.ok(metrics.width > 0 && metrics.height > 0 && metrics.clientWidth > 100 && metrics.clientHeight > 100, `${id}: canvas must have non-zero rendered dimensions.`);
    assert.ok(["1", "2"].includes(metrics.webglVersion), `${id}: WebGL context must be initialized.`);
    assert.ok(metrics.triangles > 0, `${id}: renderer must draw actual model geometry.`);
    const shot = await page.locator("#bus-viewer canvas").screenshot({ path: path.join(screenshotDir, `${id}.png`) });
    checkScreenshot(shot, id);
    console.log(`PASS model ${id}: GLB 200, WebGL ${metrics.webglVersion}, ${metrics.triangles} triangles, visible screenshot.`);
  }

  const firstModel = expectedModels[0];
  await page.locator("#model-select").selectOption(firstModel);
  await waitForModel(page, firstModel);
  for (const mode of ["inside", "outside", "cutaway"]) {
    await page.locator(`[data-mode="${mode}"]`).click();
    await page.waitForFunction((value) => document.querySelector("#bus-viewer")?.dataset.viewMode === value, mode);
    const shot = await page.locator("#bus-viewer canvas").screenshot({ path: path.join(screenshotDir, `mode-${mode}.png`) });
    checkScreenshot(shot, `mode ${mode}`);
    console.log(`PASS view mode ${mode}: canvas renders visible geometry.`);
  }
  for (const deck of ["upper", "lower", "both"]) {
    await page.locator(`[data-deck="${deck}"]`).click();
    await page.waitForFunction((value) => document.querySelector("#bus-viewer")?.dataset.deck === value, deck);
    const shot = await page.locator("#bus-viewer canvas").screenshot({ path: path.join(screenshotDir, `deck-${deck}.png`) });
    checkScreenshot(shot, `deck ${deck}`);
    console.log(`PASS deck ${deck}: canvas renders visible geometry.`);
  }

  await page.locator('[data-deck="2d"]').click();
  const seatMap = page.locator("#seat-map-2d");
  await assert.doesNotReject(() => seatMap.waitFor({ state: "visible" }));
  const seatButton = seatMap.locator(".seat-map-seat[data-seat-id]").first();
  const selected2d = await seatButton.getAttribute("data-seat-id");
  await seatButton.click();
  await page.waitForFunction((id) => document.querySelector("#bus-viewer canvas")?.dataset.selectedSeat === id, selected2d);
  assert.equal(await seatButton.getAttribute("aria-pressed"), "true", "2D selection must be highlighted and synchronized to 3D.");
  await seatMap.screenshot({ path: path.join(screenshotDir, "seat-map-selected.png") });

  await page.locator('[data-deck="both"]').click();
  await page.locator('[data-mode="inside"]').click();
  const target = await page.evaluate((alreadySelected) => {
    const viewer = window.__BUSLENS_TEST_VIEWER__;
    if (!viewer) throw new Error("Test viewer hook is missing.");
    viewer.setMode("inside");
    viewer.setDeck("both");
    const canvas = viewer.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const candidates = [...viewer.seats.entries()].filter(([id, object]) => id !== alreadySelected && object.visible);
    for (const [id, object] of candidates) {
      const point = object.getWorldPosition(viewer.camera.position.clone()).project(viewer.camera);
      const x = rect.left + ((point.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - point.y) / 2) * rect.height;
      if (point.z > -1 && point.z < 1 && x > rect.left + 5 && x < rect.right - 5 && y > rect.top + 5 && y < rect.bottom - 5) return { id, x, y };
    }
    throw new Error("No visible selectable seat projects inside the 3D canvas.");
  }, selected2d);
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction((id) => document.querySelector("#bus-viewer canvas")?.dataset.selectedSeat === id, target.id);
  assert.match(await page.locator("#selected-seat-title").textContent(), /Seat selected|Berth selected/);
  console.log(`PASS 3D seat raycast: selected ${target.id}; 2D and 3D selection agree.`);

  const camera = page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.camera.position.toArray());
  const box = await page.locator("#bus-viewer canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 95, box.y + box.height / 2 + 28, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  const rotated = await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.camera.position.toArray());
  assert.ok(rotated.some((value, i) => Math.abs(value - camera[i]) > 0.05), "Mouse drag must orbit the camera.");
  await page.mouse.wheel(0, -450);
  await page.waitForTimeout(250);
  const zoomed = await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.camera.position.toArray());
  assert.ok(zoomed.some((value, i) => Math.abs(value - rotated[i]) > 0.05), "Mouse wheel must zoom the camera.");
  await page.locator("#reset-camera").click();
  await page.waitForTimeout(350);
  const reset = await page.evaluate(() => window.__BUSLENS_TEST_VIEWER__.camera.position.toArray());
  assert.ok(reset.every((value, i) => Math.abs(value - camera[i]) < 0.25), "Reset must restore the original camera framing.");
  console.log("PASS orbit, zoom, and reset controls.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const resized = await page.locator("#bus-viewer canvas").evaluate((canvas) => ({ width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight }));
  assert.ok(resized.width > 0 && resized.height > 0 && resized.clientWidth > 100 && resized.clientHeight > 100, "Canvas must resize to the mobile viewport.");
  await page.locator("#bus-viewer canvas").screenshot({ path: path.join(screenshotDir, "mobile-resize.png") });
  console.log("PASS responsive resize to 390x844.");

  const retryPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let failOnce = true;
  await retryPage.route("**/assets/models/rep-sleeper-2x1-12m-ac.glb", async (route) => {
    if (failOnce) { failOnce = false; await route.abort(); }
    else await route.continue();
  });
  const retryUrl = new URL(url);
  retryUrl.searchParams.set("e2e", "1");
  await retryPage.goto(retryUrl.toString(), { waitUntil: "networkidle", timeout: 60000 });
  await retryPage.locator('[data-view="inspect"]').click();
  await retryPage.locator('[data-retry-viewer]').waitFor({ state: "visible", timeout: 30000 });
  await retryPage.getByRole("button", { name: "Retry 3D" }).click();
  await waitForModel(retryPage, firstModel);
  console.log("PASS retry after a failed GLB request; loading state clears and the model renders.");
  await retryPage.close();

  assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join(" | ")}`);
  assert.deepEqual(pageErrors, [], `Uncaught browser errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(networkErrors, [], `Failed or HTTP error requests: ${networkErrors.join(" | ")}`);
  console.log(`PASS clean production network: ${expectedModels.length} GLB requests succeeded; no console errors or failed requests.`);
} finally {
  await browser.close();
}
