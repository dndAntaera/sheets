"""The local development server.

    python scripts/serve.py [port]

Why not `python -m http.server`: it caches. ES modules are fetched as
subresources, so a browser will happily keep serving an old engine/build.js
after you have edited it - and the query-string trick that busts the entry
point does not reach its imports. Half an hour can go into a bug that was
fixed on disk ten minutes earlier.

So this sends no-store on everything, and names UTF-8 explicitly, which the
standard library's server does not do for .js or .json either.

It serves the repository root rather than web/, because the test runners in
test/ import from outside the deployed folder. What GitHub Pages actually
publishes is web/ alone - see MAINTAINING.md.

It also offers a stand-in for Cloudflare D1, for test/worker.html only: an
in-memory SQLite database built from worker/migrations, reachable at
/__test/d1. D1 is SQLite, so the Worker's real SQL runs against the real
engine. It binds to 127.0.0.1 and holds nothing that survives a restart.
"""

import json
import sqlite3
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "worker" / "migrations"

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
}


class TestDatabase:
    """One in-memory database, rebuilt from the migrations on reset."""

    def __init__(self):
        self.lock = threading.Lock()
        self.connection = None
        self.applied = []

    def reset(self, up_to=None):
        """A fresh database with the migrations applied - all of them, or only
        those up to and including `up_to`, so a test can put old data in place
        and then check that the next migration carries it forward."""
        with self.lock:
            if self.connection:
                self.connection.close()
            self.connection = sqlite3.connect(":memory:", check_same_thread=False)
            self.connection.row_factory = sqlite3.Row
            # D1 enforces foreign keys; so must the stand-in, or a cascade that
            # works here could fail in production.
            self.connection.execute("PRAGMA foreign_keys = ON")
            self.applied = []
            return self._apply(up_to)

    def migrate(self):
        with self.lock:
            return self._apply(None)

    def _apply(self, up_to):
        done = []
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if migration.name in self.applied:
                continue
            if up_to and migration.name[:len(up_to)] > up_to:
                break
            self.connection.executescript(migration.read_text(encoding="utf-8"))
            self.applied.append(migration.name)
            done.append(migration.name)
        self.connection.commit()
        return done

    def run(self, sql, params, mode):
        with self.lock:
            if not self.connection:
                raise RuntimeError("reset the database first")
            cursor = self.connection.execute(sql, params or [])
            if mode == "first":
                row = cursor.fetchone()
                result = dict(row) if row else None
            elif mode == "all":
                result = {"results": [dict(r) for r in cursor.fetchall()], "success": True}
            else:
                result = {"success": True, "meta": {"changes": cursor.rowcount}}
            self.connection.commit()
            return result

    def batch(self, statements):
        with self.lock:
            try:
                results = []
                for statement in statements:
                    cursor = self.connection.execute(statement["sql"], statement.get("params") or [])
                    results.append({"success": True, "meta": {"changes": cursor.rowcount}})
                self.connection.commit()
                return results
            except Exception:
                self.connection.rollback()
                raise


DATABASE = TestDatabase()


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def guess_type(self, path):
        suffix = Path(str(path)).suffix.lower()
        return TYPES.get(suffix) or super().guess_type(path)

    def do_POST(self):
        if not self.path.startswith("/__test/d1"):
            self.send_error(405)
            return
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        try:
            if self.path == "/__test/d1/reset":
                result = {"applied": DATABASE.reset(body.get("upTo"))}
            elif self.path == "/__test/d1/migrate":
                result = {"applied": DATABASE.migrate()}
            elif self.path == "/__test/d1/batch":
                result = DATABASE.batch(body["statements"])
            else:
                result = DATABASE.run(body["sql"], body.get("params"), body.get("mode", "run"))
            payload, status = json.dumps({"ok": True, "result": result}), 200
        except Exception as err:  # the error goes back to the test, not the log
            payload, status = json.dumps({"ok": False, "error": str(err)}), 200
        data = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):  # one tidy line per request
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    print(f"serving {ROOT} at http://localhost:{port}")
    print(f"  sheet   http://localhost:{port}/web/")
    print(f"  engine  http://localhost:{port}/test/browser.html")
    print(f"  server  http://localhost:{port}/test/worker.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
