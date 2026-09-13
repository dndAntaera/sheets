"""Format the data files the way they are meant to be read.

    python scripts/format-json.py [files...]

json.dumps with indent puts every array element on its own line, which turns
a nine-row threshold table into a hundred and sixty lines of brackets. This
keeps anything short enough on one line and only breaks what has to break, so
a table still looks like a table.

Run it on any data file after a script has rewritten it.
"""
import json
import sys
from pathlib import Path

WIDTH = 100


def dump(value, indent=0):
    pad = "  " * indent
    inner = "  " * (indent + 1)
    flat = json.dumps(value, ensure_ascii=False, separators=(", ", ": "))
    if not isinstance(value, (dict, list)) or len(flat) + len(pad) <= WIDTH:
        return flat
    if isinstance(value, list):
        return "[\n" + ",\n".join(inner + dump(v, indent + 1) for v in value) + "\n" + pad + "]"
    parts = [f"{inner}{json.dumps(k, ensure_ascii=False)}: {dump(v, indent + 1)}" for k, v in value.items()]
    return "{\n" + ",\n".join(parts) + "\n" + pad + "}"


def main():
    root = Path(__file__).resolve().parents[1]
    files = [Path(f) for f in sys.argv[1:]] or sorted((root / "web" / "data").rglob("*.json"))
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        path.write_text(dump(data) + "\n", encoding="utf-8")
        print(f"formatted {path.relative_to(root) if path.is_absolute() else path}")


if __name__ == "__main__":
    main()
