"""Build the engine's compact feat rules from the SRD reference.

    python scripts/build-feat-rules.py

Reads web/data/srd/feats.json (written by build-srd.py) and writes
web/data/srd/feat-rules.json: for each feat, only what the sheet needs to decide
whether a character may take it - its types, its prerequisites as written,
whether it can be taken more than once and on what, and which class bonus feat
lists it is on. The full text stays in feats.json, loaded when it is shown.

Rerun after build-srd.py; never edit the output by hand.
"""

import json
import re
from pathlib import Path

SRD = Path(__file__).resolve().parent.parent / 'web' / 'data' / 'srd'

# Choices a feat is taken "on", in the words the sheet's pickers understand.
CHOICE_KINDS = {
    'Exotic Weapon Proficiency': 'exoticWeapon',
    'Martial Weapon Proficiency': 'martialWeapon',
    'Weapon Focus': 'weapon',
    'Weapon Specialization': 'weapon',
    'Greater Weapon Focus': 'weapon',
    'Greater Weapon Specialization': 'weapon',
    'Improved Critical': 'weapon',
    'Power Critical': 'weapon',
    'Rapid Reload': 'crossbow',
    'Skill Focus': 'skill',
    'Spell Focus': 'school',
    'Greater Spell Focus': 'school',
    'Energy Substitution': 'energy',
    'Aligned Attack': 'alignmentComponent',
    'Expanded Knowledge': 'power',
}

# The feat a choice must already have been made for: Weapon Specialization
# (longsword) needs Weapon Focus (longsword).
CHOICE_FROM = {
    'Weapon Specialization': 'Weapon Focus',
    'Greater Weapon Focus': 'Weapon Focus',
    'Greater Weapon Specialization': 'Weapon Specialization',
    'Greater Spell Focus': 'Spell Focus',
}


# Fighter bonus feats the SRD's feat text does not say are.
ALSO_FIGHTER = {'Improved Feint'}


def plain(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html or '')).strip()


def build():
    """The feat rules as they should be written. The housekeeping sweep compares them with the file."""
    feats = json.loads((SRD / 'feats.json').read_text(encoding='utf-8'))
    out = []
    for f in feats:
        special = plain(f.get('special', ''))
        entry = {'name': f['name'], 'types': f['types']}
        prereq = (f.get('prerequisite') or '').strip()
        if prereq and prereq.lower().rstrip('.') != 'none':
            entry['prerequisite'] = prereq
        if f.get('multiple'):
            entry['multiple'] = True
        if f['name'] in CHOICE_KINDS:
            entry['choice'] = CHOICE_KINDS[f['name']]
        if f['name'] in CHOICE_FROM:
            entry['choiceFrom'] = CHOICE_FROM[f['name']]
        if f['name'] in ALSO_FIGHTER or 'Fighter' in f['types'] or re.search(r'fighter may select .* as one of his fighter bonus feats', special, re.I):
            entry['fighterBonus'] = True
        out.append(entry)
    return out


def main():
    out = build()
    path = SRD / 'feat-rules.json'
    path.write_text('[\n' + ',\n'.join(json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in out) + '\n]\n', encoding='utf-8')
    print(f'{len(out)} feats, {sum(1 for e in out if e.get("fighterBonus"))} fighter bonus feats -> {path}')


if __name__ == '__main__':
    main()
