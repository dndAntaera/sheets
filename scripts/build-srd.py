"""Build the SRD reference data from Andargor's SRD 3.5 database.

    python scripts/build-srd.py path/to/dnd35.db

The database is the SQLite edition of Andargor's SRD 3.5 XML and MySQL
database (andargor.com, srd35-db-SQLite-v1.3.zip), itself Open Game Content
under the OGL; its Section 15 notice is on the wiki's legal page and in
LEGAL.md. This script writes, under web/data/srd/:

    spells.json    every spell: school, levels by class and domain, the stat block, text
    powers.json    every psionic power: discipline, levels by class, points, augment, text
    feats.json     every feat: type, prerequisites, benefit, normal, special
    classes.json   every class, with its table: attack, saves, specials, slots, spells
                   known, power points, powers known - one row per level
    progression.json  just the level-by-level columns the engine reads - spell
                   slots, spells known, power points, powers known, highest power
                   level, class specials - small enough to load with the app
    domains.json   cleric domains: granted power and a spell per level
    equipment.json weapons, armor, shields and goods

The text is the SRD's own HTML, cut down to a handful of tags with no
attributes, so the app can show it as written and nothing in it can run.
Rerun this after changing it; never edit the JSON by hand.
"""

import json
import re
import sqlite3
import sys
from html import escape
from html.parser import HTMLParser
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'web' / 'data' / 'srd'

ALLOWED = {'p', 'i', 'b', 'em', 'strong', 'br', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h5', 'h6', 'sup', 'sub'}
KEEP_ATTRS = {'colspan', 'rowspan'}
VOID = {'br'}


class Sanitizer(HTMLParser):
    """Keep only ALLOWED tags, and of their attributes only KEEP_ATTRS."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []

    def handle_starttag(self, tag, attrs):
        if tag not in ALLOWED:
            return
        kept = ''.join(f' {k}="{escape(v or "")}"' for k, v in attrs if k in KEEP_ATTRS and re.fullmatch(r'\d{1,2}', v or ''))
        self.out.append(f'<{tag}{kept}>')

    def handle_startendtag(self, tag, attrs):
        if tag in VOID:
            self.out.append(f'<{tag}>')

    def handle_endtag(self, tag):
        if tag in ALLOWED and tag not in VOID:
            self.out.append(f'</{tag}>')

    def handle_data(self, data):
        self.out.append(escape(data, quote=False))


def html(value):
    if not clean(value):
        return None
    s = Sanitizer()
    s.feed(str(value))
    s.close()
    text = re.sub(r'\s+', ' ', ''.join(s.out)).strip()
    text = re.sub(r'<p>\s*</p>', '', text)
    return text or None


def clean(value):
    """The database writes 'None' for an empty field."""
    if value is None:
        return None
    text = str(value).strip()
    return None if text in ('', 'None', '-', '—') else re.sub(r'\s+', ' ', text)


def number(value):
    text = clean(value)
    if text is None:
        return None
    m = re.match(r'^[+]?(-?\d+)', text.replace('—', '-'))
    return int(m.group(1)) if m else None


def levels_of(text, aliases=None):
    """'Sorcerer/Wizard 3, Fire 3' -> {'Sorcerer': 3, 'Wizard': 3, 'Fire': 3}."""
    out = {}
    for part in (clean(text) or '').split(','):
        m = re.match(r'\s*(.+?)\s+(\d)\s*$', part)
        if not m:
            continue
        name, level = m.group(1).strip(), int(m.group(2))
        for who in (aliases or {}).get(name.lower(), [name]):
            out[who] = level
    return out


SPELL_ALIASES = {'sorcerer/wizard': ['Sorcerer', 'Wizard']}
POWER_ALIASES = {
    'psion/wilder': ['Psion', 'Wilder'],
    'psychic warrior': ['Psychic Warrior'],
    'egoist': ['Egoist'], 'kineticist': ['Kineticist'], 'nomad': ['Nomad'],
    'seer': ['Seer'], 'shaper': ['Shaper'], 'telepath': ['Telepath'],
}


def rows(db, sql):
    db.row_factory = sqlite3.Row
    return list(db.execute(sql))


def pruned(d):
    return {k: v for k, v in d.items() if v not in (None, '', [], {})}


def spells(db):
    out = []
    for r in rows(db, 'SELECT * FROM spell ORDER BY name'):
        out.append(pruned({
            'name': clean(r['name']),
            'school': clean(r['school']),
            'subschool': clean(r['subschool']),
            'descriptor': clean(r['descriptor']),
            'levels': levels_of(r['level'], SPELL_ALIASES),
            'components': clean(r['components']),
            'castingTime': clean(r['casting_time']),
            'range': clean(r['range']),
            'target': clean(r['target']),
            'area': clean(r['area']),
            'effect': clean(r['effect']),
            'duration': clean(r['duration']),
            'save': clean(r['saving_throw']),
            'sr': clean(r['spell_resistance']),
            'summary': clean(r['short_description']),
            'material': clean(r['material_components']),
            'focus': clean(r['focus']),
            'xp': clean(r['xp_cost']),
            'text': html(r['description']),
        }))
    return out


def powers(db):
    out = []
    for r in rows(db, 'SELECT * FROM power ORDER BY name'):
        out.append(pruned({
            'name': clean(r['name']),
            'discipline': clean(r['discipline']),
            'subdiscipline': clean(r['subdiscipline']),
            'descriptor': clean(r['descriptor']),
            'levels': levels_of(r['level'], POWER_ALIASES),
            'display': clean(r['display']),
            'manifestingTime': clean(r['manifesting_time']),
            'range': clean(r['range']),
            'target': clean(r['target']),
            'area': clean(r['area']),
            'effect': clean(r['effect']),
            'duration': clean(r['duration']),
            'save': clean(r['saving_throw']),
            'powerPoints': number(r['power_points']),
            'pr': clean(r['power_resistance']),
            'summary': clean(r['short_description']),
            'xp': clean(r['xp_cost']),
            'augment': html(r['augment']),
            'text': html(r['description']),
        }))
    return out


def feats(db):
    out = []
    for r in rows(db, 'SELECT * FROM feat ORDER BY name'):
        types = [t.strip() for t in (clean(r['type']) or '').split(',') if t.strip()]
        if types in (['Type of Feat'], ['Special']):
            continue
        out.append(pruned({
            'name': clean(r['name']),
            'types': types,
            'prerequisite': clean(r['prerequisite']),
            'benefit': html(r['benefit']),
            'normal': html(r['normal']) if clean(r['normal']) else None,
            'special': html(r['special']) if clean(r['special']) else None,
            'multiple': clean(r['multiple']) == 'Yes' or None,
            'stacks': clean(r['stack']) == 'Yes' or None,
            'choice': clean(r['choice']),
        }))
    return out


def classes(db):
    tables = {}
    for r in rows(db, 'SELECT * FROM class_table ORDER BY name, CAST(level AS INTEGER)'):
        slot = [clean(r[f'slots_{i}']) for i in range(10)]
        known = [clean(r[f'spells_known_{i}']) for i in range(10)]
        while slot and slot[-1] is None:
            slot.pop()
        while known and known[-1] is None:
            known.pop()
        tables.setdefault(clean(r['name']), []).append(pruned({
            'level': number(r['level']),
            'bab': clean(r['base_attack_bonus']),
            'fort': number(r['fort_save']),
            'ref': number(r['ref_save']),
            'will': number(r['will_save']),
            'special': clean(r['special']),
            'casterLevel': clean(r['caster_level']),
            'slots': slot,
            'known': known,
            'powerPoints': number(r['points_per_day']),
            'powersKnown': number(r['powers_known']),
            'maxPowerLevel': number(r['power_level']),
            'acBonus': number(r['ac_bonus']),
            'unarmedDamage': clean(r['unarmed_damage']),
            'speedBonus': clean(r['unarmored_speed_bonus']),
            'flurry': clean(r['flurry_of_blows']),
        }))
    out = []
    for r in rows(db, 'SELECT * FROM class ORDER BY name'):
        name = clean(r['name'])
        kinds = [t.strip() for t in (clean(r['type']) or '').split(',')]
        out.append(pruned({
            'name': name,
            'kinds': kinds,
            'alignment': clean(r['alignment']),
            'hitDie': number((clean(r['hit_die']) or '').lstrip('d')),
            'skillPoints': number(r['skill_points']),
            'classSkills': clean(r['class_skills']),
            'spellAbility': clean(r['spell_stat']),
            'spellType': clean(r['spell_type']),
            'proficiencies': clean(r['proficiencies']),
            'requirements': pruned({
                'race': clean(r['req_race']),
                'baseAttack': clean(r['req_base_attack_bonus']),
                'skills': clean(r['req_skill']),
                'feats': clean(r['req_feat']),
                'spells': clean(r['req_spells']),
                'psionics': clean(r['req_psionics']),
                'special': clean(r['req_special']),
            }),
            'table': tables.get(name, []),
            'text': html(r['full_text']),
        }))
    return out


def progression(built_classes):
    """The columns of each class table the engine needs, as parallel arrays by level."""
    out = {}
    for c in built_classes:
        table = c.get('table') or []
        if not table:
            continue
        cols = {
            'slots': [r.get('slots', []) for r in table],
            'known': [r.get('known', []) for r in table],
            'powerPoints': [r.get('powerPoints') for r in table],
            'powersKnown': [r.get('powersKnown') for r in table],
            'maxPowerLevel': [r.get('maxPowerLevel') for r in table],
            'special': [r.get('special') for r in table],
            'casterLevel': [r.get('casterLevel') for r in table],
        }
        entry = {k: v for k, v in cols.items() if any(x not in (None, [], '') for x in v)}
        if entry:
            out[c['name']] = entry
    return out


def domains(db):
    out = []
    for r in rows(db, 'SELECT * FROM domain ORDER BY name'):
        out.append(pruned({
            'name': clean(r['name']),
            'grantedPower': clean(r['granted_powers']),
            'spells': [clean(r[f'spell_{i}']) for i in range(1, 10)],
        }))
    return out


def equipment(db):
    out = []
    for r in rows(db, 'SELECT * FROM equipment ORDER BY family, category, name'):
        out.append(pruned({
            'name': clean(r['name']),
            'family': clean(r['family']),
            'category': clean(r['category']),
            'subcategory': clean(r['subcategory']),
            'cost': clean(r['cost']),
            'weight': clean(r['weight']),
            'damageSmall': clean(r['dmg_s']),
            'damageMedium': clean(r['dmg_m']),
            'critical': clean(r['critical']),
            'range': clean(r['range_increment']),
            'damageType': clean(r['type']),
            'armorBonus': number(r['armor_shield_bonus']),
            'maxDex': number(r['maximum_dex_bonus']),
            'checkPenalty': number(r['armor_check_penalty']),
            'spellFailure': clean(r['arcane_spell_failure_chance']),
            'speed30': clean(r['speed_30']),
            'speed20': clean(r['speed_20']),
            'text': html(r['full_text']),
        }))
    return out


def write(name, entries):
    OUT.mkdir(parents=True, exist_ok=True)
    body = '[\n' + ',\n'.join(json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in entries) + '\n]\n'
    (OUT / name).write_text(body, encoding='utf-8')
    print(f'{name}: {len(entries)} entries, {len(body.encode("utf-8")) // 1024} KB')


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    db = sqlite3.connect(sys.argv[1])
    write('spells.json', spells(db))
    write('powers.json', powers(db))
    write('feats.json', feats(db))
    built = classes(db)
    write('classes.json', built)
    body = json.dumps(progression(built), ensure_ascii=False, separators=(',', ':'))
    (OUT / 'progression.json').write_text(body + chr(10), encoding='utf-8')
    print(f'progression.json: {len(body.encode("utf-8")) // 1024} KB')
    write('domains.json', domains(db))
    write('equipment.json', equipment(db))


if __name__ == '__main__':
    main()
