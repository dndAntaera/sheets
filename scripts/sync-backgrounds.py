"""Rebuild web/data/rulesets/antaera-backgrounds.json from the wiki's rules/backgrounds.md.

The two repositories are siblings on disk, so this reads across rather than
duplicating the list by hand. Run it after adding a background to the wiki:

    python scripts/sync-backgrounds.py [path-to-wiki]
"""
import json, re, sys
from pathlib import Path

wiki = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "antaera_Wiki"
src = wiki / "docs" / "rules" / "backgrounds.md"
if not src.exists():
    sys.exit(f"no backgrounds.md at {src} - pass the wiki's path as an argument")

category, found = None, []
for line in src.read_text(encoding="utf-8").splitlines():
    m = re.match(r"^(#+)\s+(.*?)\s*$", line)
    if not m:
        continue
    depth, title = len(m.group(1)), m.group(2)
    if depth == 1 and title.endswith("Backgrounds"):
        category = title.replace(" Backgrounds", "") or None
    elif depth >= 2 and category:
        found.append({"name": title[7:] if title.startswith("Guild: ") else title,
                      "category": category})

out = Path(__file__).resolve().parents[1] / "web" / "data" / "rulesets" / "antaera-backgrounds.json"
data = json.loads(out.read_text(encoding="utf-8"))
data["backgrounds"] = found
out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{len(found)} backgrounds -> {out.relative_to(out.parents[2])}")
