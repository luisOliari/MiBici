"""
Sube la version de la app ANTES de publicar (commit + push). Sin esto, los
celulares (sobre todo iPhone) pueden seguir usando archivos viejos guardados.

Actualiza: version.json, los ?v= de index.html (APP_VERSION incluido) y el
nombre del cache del service worker.

Uso:  python tools/bump_version.py
"""

import json
import re
from datetime import date
from pathlib import Path

root = Path(__file__).resolve().parent.parent
old = json.loads((root / "version.json").read_text(encoding="utf-8"))["version"]

today = date.today().strftime("%Y.%m.%d")
n = int(old.split("-")[1]) + 1 if old.startswith(today) else 1
new = f"{today}-{n}"

(root / "version.json").write_text(json.dumps({"version": new}) + "\n", encoding="utf-8")

index = root / "index.html"
index.write_text(index.read_text(encoding="utf-8").replace(old, new), encoding="utf-8")

sw = root / "sw.js"
sw.write_text(
    re.sub(r"mibici-shell-v(\d+)", lambda m: f"mibici-shell-v{int(m.group(1)) + 1}", sw.read_text(encoding="utf-8")),
    encoding="utf-8",
)

print(f"Version {old} -> {new}")
