from pathlib import Path

app = Path("web/js/app.js")
text = app.read_text()
anchor = 'const inventory = new InventoryClient({ adapter: inventoryAdapter });'
hook = 'if (new URLSearchParams(location.search).has("e2e")) window.__BUSLENS_TEST_INVENTORY__ = inventory;'
if anchor not in text:
    raise SystemExit("Inventory client initialization was not found; refusing to build test hook.")
if hook not in text:
    text = text.replace(anchor, anchor + "\n" + hook, 1)
    app.write_text(text)

# Keep the seat camera pinned to the seat while in POV; orbit controls must not move it each frame.
viewer = Path("web/js/viewer/three.js")
v = viewer.read_text()
old = "      this.controls.update();\n      this.renderer.render(this.scene, this.camera);"
new = "      if (this.povState) { this.camera.position.copy(this.povState.position); this.applyPovRotation(); } else this.controls.update();\n      this.renderer.render(this.scene, this.camera);"
if new not in v:
    if old not in v:
        raise SystemExit("Viewer frame loop was not found; refusing to build POV fix.")
    viewer.write_text(v.replace(old, new, 1))
