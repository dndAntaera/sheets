"""Write the list of the app's modules into web/index.html.

    python scripts/build-preload.py

A browser learns what app.js imports only once app.js arrives, then what those
import once they arrive, and so on - the app's modules come in waves, one round
trip each. Naming every module in index.html with <link rel="modulepreload">
lets them all download at once.

The list sits between the modulepreload markers in index.html and is every
module app.js reaches, followed through its imports. Rerun this after adding,
removing or renaming a module; the sweep fails while the list is out of step.
"""

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
INDEX = os.path.join(WEB, 'index.html')
START = '<!-- modulepreload: written by scripts/build-preload.py -->'
END = '<!-- /modulepreload -->'

IMPORTS = re.compile(r"""(?:\bimport|\bexport)\s[^;]*?\bfrom\s*['"](\.{1,2}/[^'"]+)['"]|\bimport\s*['"](\.{1,2}/[^'"]+)['"]""", re.S)


def modules(entry='app.js'):
    """Every module reached from `entry`, as paths relative to web/, in the order first reached."""
    seen, order, queue = set(), [], [os.path.normpath(os.path.join(WEB, entry))]
    while queue:
        path = queue.pop(0)
        if path in seen:
            continue
        seen.add(path)
        order.append(path)
        with open(path, encoding='utf-8') as f:
            text = f.read()
        for match in IMPORTS.finditer(text):
            target = os.path.normpath(os.path.join(os.path.dirname(path), match.group(1) or match.group(2)))
            if target.startswith(WEB + os.sep) and os.path.exists(target):
                queue.append(target)
    return [os.path.relpath(p, WEB).replace(os.sep, '/') for p in order]


def build(html):
    """index.html with the list rewritten."""
    if START not in html or END not in html:
        raise SystemExit('index.html has no modulepreload markers')
    before, rest = html.split(START, 1)
    _, after = rest.split(END, 1)
    # app.js itself is the page's script, so it is already on its way.
    links = ''.join('<link rel="modulepreload" href="%s">\n' % m for m in modules()[1:])
    return before + START + '\n' + links + END + after


def main():
    with open(INDEX, encoding='utf-8') as f:
        html = f.read()
    fresh = build(html)
    if fresh != html:
        with open(INDEX, 'w', encoding='utf-8', newline='\n') as f:
            f.write(fresh)
    print('%d modules listed in web/index.html' % (fresh.count('rel="modulepreload"')))


if __name__ == '__main__':
    main()
