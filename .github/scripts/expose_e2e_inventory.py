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
