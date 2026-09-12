"""The local development server.

    python scripts/serve.py [port]

Why not `python -m http.server`: it caches. ES modules are fetched as
subresources, so a browser will happily keep serving an old engine/build.js
after you have edited it - and the query-string trick that busts the entry
point does not reach its imports. Half an hour can go into a bug that was
fixed on disk ten minutes earlier.

So this sends no-store on everything, and names UTF-8 explicitly, which the
standard library's server does not do for .js or .json either.

It serves the repository root rather than web/, because the test runner at
test/browser.html imports the suite from outside the deployed folder. What
GitHub Pages actually publishes is web/ alone - see MAINTAINING.md.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def guess_type(self, path):
        suffix = Path(str(path)).suffix.lower()
        return TYPES.get(suffix) or super().guess_type(path)

    def log_message(self, fmt, *args):  # one tidy line per request
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    print(f"serving {ROOT} at http://localhost:{port}")
    print(f"  sheet  http://localhost:{port}/web/")
    print(f"  tests  http://localhost:{port}/test/browser.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
