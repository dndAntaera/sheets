# -*- coding: utf-8 -*-
"""Housekeeping sweep: is anything in the sheets broken, stale or off-style?

Run from the repository root:

    python scripts/sweep.py

Every check prints "OK" or lists what is wrong, and the run exits non-zero if
any check fails - the pre-push hook and CI both run it. It needs nothing but
Python, because the machine this repository is kept on has no Node.

This exists because the browser test pages prove the arithmetic, and nothing
more. A module that imports a name another module stopped exporting loads fine
in every file but one, and takes the whole app down; a data file edited by hand
parses and still names a feat that does not exist; a British spelling or a
missing ligature reads fine to whoever wrote it. The checks here look at what
the files actually say and how they fit together.
"""
import glob
import importlib.util
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
DATA = os.path.join(WEB, 'data')

failures = 0
checks = 0


def check(name, bad, note='', limit=12):
    """Report one check. `bad` is a list of things wrong; empty means OK."""
    global failures, checks
    checks += 1
    if not bad:
        print('  OK    %s' % name)
        return
    failures += 1
    print('  FAIL  %s  (%d)' % (name, len(bad)))
    if note:
        print('        %s' % note)
    for b in bad[:limit]:
        print('        - %s' % b)
    if len(bad) > limit:
        print('        ... and %d more' % (len(bad) - limit))


def rel(path):
    return os.path.relpath(path, ROOT).replace('\\', '/')


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def load(path):
    return json.loads(read(path))


def tracked():
    """Files git knows about, so nothing generated or ignored is swept."""
    out = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    return [os.path.join(ROOT, p) for p in out.stdout.splitlines() if p]


# ---------------------------------------------------------------------------
#   The code
# ---------------------------------------------------------------------------

IMPORT = re.compile(r'''^\s*import\s+(?:(?P<names>\{[^}]*\})|(?P<star>\*\s+as\s+\w+)|(?P<default>\w+))?\s*(?:from\s+)?['"](?P<path>\.[^'"]+)['"]''', re.M | re.S)
IMPORT_MULTI = re.compile(r'''import\s*\{(?P<names>[^}]*)\}\s*from\s*['"](?P<path>\.[^'"]+)['"]''', re.S)
REEXPORT_STAR = re.compile(r'''export\s*\*\s*from\s*['"](?P<path>\.[^'"]+)['"]''')
REEXPORT_NAMED = re.compile(r'''export\s*\{(?P<names>[^}]*)\}\s*from\s*['"](?P<path>\.[^'"]+)['"]''', re.S)
EXPORT_DECL = re.compile(r'''^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+(?P<name>[A-Za-z_$][\w$]*)''', re.M)
EXPORT_LIST = re.compile(r'''^export\s*\{(?P<names>[^}]*)\}\s*;?\s*$''', re.M)
DYNAMIC = re.compile(r'''import\(\s*['"](?P<path>\.[^'"]+)['"]\s*\)''')

_exports = {}


def names_in(block):
    """'{ a, b as c }' -> [(a, a), (b, c)]: (name in the source, name here)."""
    out = []
    for part in block.strip('{} \n').split(','):
        part = part.strip()
        if not part:
            continue
        bits = re.split(r'\s+as\s+', part)
        out.append((bits[0].strip(), bits[-1].strip()))
    return out


def exports_of(path, seen=None):
    """Every name a module exports, following `export * from` chains."""
    path = os.path.normpath(path)
    if path in _exports:
        return _exports[path]
    seen = seen or set()
    if path in seen or not os.path.exists(path):
        return set()
    seen.add(path)
    text = read(path)
    names = set(m.group('name') for m in EXPORT_DECL.finditer(text))
    for m in EXPORT_LIST.finditer(text):
        names.update(local for _, local in names_in(m.group('names')))
    for m in REEXPORT_NAMED.finditer(text):
        names.update(local for _, local in names_in(m.group('names')))
    for m in REEXPORT_STAR.finditer(text):
        names.update(exports_of(os.path.join(os.path.dirname(path), m.group('path')), seen))
    if re.search(r'^export\s+default\b', text, re.M):
        names.add('default')
    _exports[path] = names
    return names


def js_files():
    return [p for p in tracked() if p.endswith('.js') and (rel(p).startswith('web/') or rel(p).startswith('test/') or rel(p).startswith('worker/src/'))]


def sweep_code():
    print('THE CODE')
    missing_files, missing_names = [], []
    for path in js_files():
        text = read(path)
        here = os.path.dirname(path)
        wanted = []
        for m in IMPORT_MULTI.finditer(text):
            wanted.append((m.group('path'), [src for src, _ in names_in(m.group('names'))]))
        for m in REEXPORT_NAMED.finditer(text):
            wanted.append((m.group('path'), [src for src, _ in names_in(m.group('names'))]))
        for m in IMPORT.finditer(text):
            wanted.append((m.group('path'), ['default'] if m.group('default') else []))
        for m in REEXPORT_STAR.finditer(text):
            wanted.append((m.group('path'), []))
        for m in DYNAMIC.finditer(text):
            wanted.append((m.group('path'), []))
        for target, names in wanted:
            if target.endswith('.json'):
                if not os.path.exists(os.path.normpath(os.path.join(here, target))):
                    missing_files.append('%s imports %s' % (rel(path), target))
                continue
            full = os.path.normpath(os.path.join(here, target))
            if not os.path.exists(full):
                missing_files.append('%s imports %s' % (rel(path), target))
                continue
            have = exports_of(full)
            for name in names:
                if name not in have:
                    missing_names.append('%s imports %s from %s, which does not export it' % (rel(path), name, target))
    check('every import points at a file that exists', missing_files)
    check('every name imported is exported', missing_names,
          'A missing export stops the whole app loading, while every other file looks fine.')

    bad = []
    for path in js_files():
        if not rel(path).startswith('web/'):
            continue
        for i, line in enumerate(read(path).splitlines(), 1):
            if re.search(r'\bdebugger\b|\bconsole\.log\(', line) and not line.strip().startswith('//'):
                bad.append('%s:%d  %s' % (rel(path), i, line.strip()[:80]))
    check('no debugging left in the app', bad)

    # Panels named by the sheet's pages and the creator's steps are panels the app has.
    app = read(os.path.join(WEB, 'app.js'))
    block = re.search(r'const PANELS = \{(.*?)\n\};', app, re.S)
    panels = set(re.findall(r'^\s{2}(\w+):', block.group(1), re.M)) if block else set()
    named = set()
    for f in ('ui/sheet-pages.js', 'ui/wizard.js'):
        for m in re.finditer(r"panels:\s*\[([^\]]*)\]", read(os.path.join(WEB, f))):
            named.update(re.findall(r"'(\w+)'", m.group(1)))
    check('every panel a page or step names exists', sorted(n for n in named if n not in panels))

    # What the installable app points at is there.
    bad = []
    manifest = load(os.path.join(WEB, 'manifest.webmanifest'))
    for icon in manifest.get('icons', []):
        if not os.path.exists(os.path.join(WEB, icon['src'])):
            bad.append('manifest icon %s' % icon['src'])
    sw = read(os.path.join(WEB, 'sw.js'))
    shell = re.search(r'const SHELL = \[(.*?)\];', sw, re.S)
    for item in re.findall(r"'\./([^']*)'", shell.group(1) if shell else ''):
        if item and not os.path.exists(os.path.join(WEB, item)):
            bad.append('service worker shell %s' % item)
    check('the app manifest and offline shell name files that exist', bad)


# ---------------------------------------------------------------------------
#   The data
# ---------------------------------------------------------------------------

def sweep_data():
    print('\nTHE DATA')
    bad = []
    for path in sorted(glob.glob(os.path.join(DATA, '**', '*.json'), recursive=True)) + [os.path.join(WEB, 'manifest.webmanifest')]:
        try:
            load(path)
        except ValueError as err:
            bad.append('%s  %s' % (rel(path), err))
    check('every data file is valid JSON', bad)

    feats = {f['name'] for f in load(os.path.join(DATA, 'srd', 'feats.json'))}
    skills = {s['name'] for s in load(os.path.join(DATA, 'skills.json'))['skills']}
    languages = {l['name'] for l in load(os.path.join(DATA, 'srd', 'languages.json'))}
    classes = load(os.path.join(DATA, 'classes.json'))['classes']
    races = load(os.path.join(DATA, 'races.json'))['races']
    effects_js = read(os.path.join(WEB, 'engine', 'effects.js'))
    targets = set(re.findall(r"^\s+'?([\w.*]+)'?:\s*'", re.search(r'export const TARGETS = \{(.*?)\n\};', effects_js, re.S).group(1), re.M))

    def target_ok(t):
        t = t.replace('{choice}', 'X').replace('{choiceSkill}', 'X')
        if t in targets or re.match(r'^weapon\.(attack|damage)\..', t) or t == 'ability.X':
            return True
        if t.startswith('skill.'):
            name = t[6:].split(' (')[0]
            return name == 'X' or name in skills
        return False

    feat_effects = load(os.path.join(DATA, 'feat-effects.json'))['feats']
    bad = [n for n in feat_effects if n not in feats]
    check('every feat with effects is an SRD feat', bad)

    bad = []
    for name, entry in feat_effects.items():
        bad += ['%s: %s' % (name, e['target']) for e in entry.get('effects', []) if not target_ok(e['target'])]
    for entry in load(os.path.join(DATA, 'srd', 'traits.json')):
        bad += ['%s (%s): %s' % (entry['name'], entry['kind'], e['target']) for e in entry.get('effects', []) if not target_ok(e['target'])]
    for race in races:
        bad += ['%s: %s' % (race['name'], e['target']) for e in race.get('effects', []) if not target_ok(e['target'])]
    check('every effect aims at something the sheet knows', bad,
          'Targets are listed in web/engine/effects.js; skills in web/data/skills.json.')

    seen, bad = set(), []
    for entry in load(os.path.join(DATA, 'srd', 'traits.json')):
        key = (entry['kind'], entry['name'])
        if key in seen:
            bad.append('%s %s' % key)
        seen.add(key)
    check('no trait or flaw is listed twice', bad)

    bad = []
    for c in classes:
        for level, options in (c.get('bonusFeats', {}).get('choices') or {}).items():
            bad += ['%s %s: %s' % (c['name'], level, o) for o in options if o not in feats]
        bad += ['%s grants %s' % (c['name'], g['name']) for g in c.get('grantedFeats', []) if g['name'] not in feats]
        for kind in ('automatic', 'bonus'):
            bad += ['%s speaks %s' % (c['name'], l) for l in (c.get('languages') or {}).get(kind, []) if l not in languages]
    for r in races:
        for kind in ('automatic', 'bonus'):
            spoken = (r.get('languages') or {}).get(kind, [])
            if spoken != 'any':
                bad += ['%s speaks %s' % (r['name'], l) for l in spoken if l not in languages]
    check('classes and races name real feats and languages', bad)

    spec = importlib.util.spec_from_file_location('build_feat_rules', os.path.join(ROOT, 'scripts', 'build-feat-rules.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    stale = module.build() != load(os.path.join(DATA, 'srd', 'feat-rules.json'))
    check('feat-rules.json is what its script builds', ['rerun: python scripts/build-feat-rules.py'] if stale else [])


# ---------------------------------------------------------------------------
#   The words
# ---------------------------------------------------------------------------

BRITISH = re.compile(r'\b(armour\w*|colour\w*|favour\w*|defence|honour\w*|behaviour\w*|centre\w*|licence|grey|catalogue|whilst|programme|\w*(recogni|organi|reali|priori|customi|normali|summari|optimi|categori|authori|finali|initiali|capitali|minimi|maximi|memori|standardi|visuali|utili|apologi)s(e|ed|es|ing|ation)|(label|cancel|travel|model|signal)l(ed|ing)|analys(e|ed|ing))\b', re.I)


def prose_files():
    """What a person reads: the documents, the pages, and the app's own strings."""
    docs = [p for p in tracked() if re.search(r'\.(md|html)$', p) and not rel(p).startswith('test/')]
    return docs + [os.path.join(ROOT, 'package.json')]


def strings_in(path):
    """A JavaScript file's string literals, a line at a time, comments left out."""
    for i, line in enumerate(read(path).splitlines(), 1):
        code = line.strip()
        if code.startswith('//') or code.startswith('*') or code.startswith('/*'):
            continue
        for m in re.finditer(r"'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|\"((?:[^\"\\]|\\.)*)\"", line):
            yield i, next(g for g in m.groups() if g is not None)


def sweep_words():
    print('\nTHE WORDS')
    app_js = [p for p in js_files() if rel(p).startswith('web/')]

    bad = []
    for path in prose_files():
        for i, line in enumerate(read(path).splitlines(), 1):
            for m in BRITISH.finditer(line):
                bad.append('%s:%d  %s' % (rel(path), i, m.group(0)))
    for path in app_js:
        for i, text in strings_in(path):
            for m in BRITISH.finditer(text):
                bad.append('%s:%d  %s' % (rel(path), i, m.group(0)))
    check('3.5 spellings, not British ones', bad, 'Armor, color, favored, defense, honor, center, license, gray, recognized, labeled.')

    bad = []
    ligature = re.compile(r'\bAntaera\b')
    for path in prose_files():
        for i, line in enumerate(read(path).splitlines(), 1):
            if ligature.search(re.sub(r'dndAntaera|antaera[-_]\w*|\bAntaera DM\b|! Antaera Claude', '', line)):
                bad.append('%s:%d' % (rel(path), i))
    for path in app_js:
        for i, text in strings_in(path):
            if ligature.search(text):
                bad.append('%s:%d' % (rel(path), i))
    for path in glob.glob(os.path.join(DATA, 'rulesets', '*.json')):
        for key in ('name', 'shortName', 'wikiName', 'description'):
            value = load(path).get(key)
            if isinstance(value, str) and ligature.search(value):
                bad.append('%s  %s' % (rel(path), key))
    check("the world's name carries its ligature", bad, 'Antæra, in anything a person reads. Identifiers stay antaera.')

    bad = []
    for path in prose_files() + app_js:
        for i, line in enumerate(read(path).splitlines(), 1):
            if re.search(r'Ant(æ|ae)ra wiki\b', line):
                bad.append('%s:%d' % (rel(path), i))
    check('the Antæra Wiki is a proper name', bad)


# ---------------------------------------------------------------------------
#   Safety and the license
# ---------------------------------------------------------------------------

def sweep_safety():
    print('\nSAFETY AND THE LICENSE')
    bad = []
    email = re.compile(r'[\w.+-]+@(gmail|yahoo|outlook|hotmail|icloud|proton)\.\w+', re.I)
    for path in tracked():
        if re.search(r'\.(png|jpg|ico|woff2?)$', path):
            continue
        try:
            text = read(path)
        except (UnicodeDecodeError, OSError):
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if email.search(line):
                bad.append('%s:%d' % (rel(path), i))
    check('no personal email address is committed', bad, 'Admin and GM emails are Worker secrets, never files.')

    toml = read(os.path.join(ROOT, 'worker', 'wrangler.toml'))
    bad = re.findall(r'^\s*(\w*(SECRET|EMAILS)\w*)\s*=', toml, re.M)
    check('no secret is set in wrangler.toml', ['%s' % b[0] for b in bad])

    legal = read(os.path.join(ROOT, 'LEGAL.md'))
    bad = []
    for path in sorted(glob.glob(os.path.join(DATA, '**', '*.json'), recursive=True)):
        r = rel(path)
        folder = os.path.dirname(r) + '/'
        if r in legal or folder in legal or r.startswith('web/data/rulesets/'):
            continue
        bad.append(r)
    check('every data file is accounted for in LEGAL.md', bad, 'Open Game Content must be identified.')


def main():
    os.chdir(ROOT)
    print('\nHOUSEKEEPING SWEEP  -  %d files tracked\n' % len(tracked()))
    sweep_code()
    sweep_data()
    sweep_words()
    sweep_safety()
    print('\n%d checks, %d failing\n' % (checks, failures))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
