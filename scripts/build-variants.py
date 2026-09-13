"""Build the SRD's variant rules (Unearthed Arcana) for the sheet.

    python scripts/build-variants.py path/to/pages/

`pages/` holds the SRD's variant rule pages as HTML, one file each, named as
on d20srd.org (defenseBonus.htm, spellPoints.htm, ...). The text is Open Game
Content from Unearthed Arcana; its Section 15 line is on the Antaera Wiki's
legal page. This script writes:

    web/data/variants.json       every variant: its name, category, what it
                                 does on the sheet, and the tables the engine
                                 reads - small, loaded with the app
    web/data/srd/variants.json   each variant's full rule text, for the
                                 Reference page - fetched when opened

The catalog below - names, categories, what each changes - is this project's
own wording. The tables and rule text are the SRD's. Rerun this after changing
it; never edit the JSON by hand.
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importlib import import_module

build_srd = import_module('build-srd')

ROOT = Path(__file__).resolve().parent.parent
BASE_URL = 'https://www.d20srd.org/srd/variant/'

CATEGORIES = [
    ['races', 'Races'],
    ['classes', 'Classes'],
    ['building', 'Building characters'],
    ['adventuring', 'Adventuring'],
    ['magic', 'Magic'],
    ['campaigns', 'Campaigns'],
]

# id, name, category, page, what it does, how the sheet reflects it
# `sheet` is 'math' (the sheet's numbers change), 'track' (the sheet adds
# something to track), or 'table' (a rule of play, shown for reference).
CATALOG = [
    # Races
    ('environmentalRaces', 'Environmental racial variants', 'races', 'races/environmentalRacialVariants', 'table',
     'Aquatic, arctic, desert and jungle versions of the core races, each with its own adjustments and traits.',
     'Write the variant race under Content with its adjustments, and pick it as your race; the rule text is in the Reference.'),
    ('elementalRaces', 'Elemental racial variants', 'races', 'races/elementalRacialVariants', 'table',
     'Races touched by air, earth, fire or water: air gnomes, earth dwarves, fire elves and others.',
     'Write the variant race under Content with its adjustments, and pick it as your race; the rule text is in the Reference.'),
    ('reducingLA', 'Reducing level adjustments', 'races', 'races/reducingLevelAdjustments', 'math',
     'A race with a level adjustment can pay experience to lower it as its class levels grow.',
     'Shows when your level adjustment can next drop and what it costs; reductions you take lower your ECL.'),
    ('paragonClasses', 'Racial paragon classes', 'races', 'races/racialParagonClasses', 'math',
     'Three-level classes that make a character the very model of their race.',
     'Adds the paragon classes to the class list, with their hit die, attack, saves, skill points and class skills.'),
    ('bloodlines', 'Bloodlines', 'races', 'races/bloodlines', 'track',
     'A trace of an unusual ancestor that grants traits as a character rises, in exchange for bloodline levels.',
     'Records the bloodline and its strength, and warns when a bloodline level is due.'),
    # Classes
    ('classVariants', 'Variant character classes', 'classes', 'classes/variantCharacterClasses', 'math',
     'Alternative versions of the core classes: the totem barbarian, cloistered cleric, battle sorcerer, thug and more.',
     'Choose a variant for a class and its hit die, attack, saves, skill points, class skills and spells change to match.'),
    ('specialistVariants', 'Specialist wizard variants', 'classes', 'classes/specialistWizardVariants', 'table',
     'Class features a specialist wizard can take in place of bonus feats or familiars.',
     'Note the features you take under Feats and abilities; the rule text is in the Reference.'),
    ('spontaneousDivine', 'Spontaneous divine casters', 'classes', 'classes/spontaneousDivineCasters', 'math',
     'Clerics and druids cast spontaneously from a short list of spells known, as a sorcerer does.',
     'Clerics and druids get spells known instead of preparing, and one more spell per day at each level.'),
    ('classFeatureVariants', 'Class feature variants', 'classes', 'classes/classFeatureVariants', 'table',
     'Swaps for single class features: favored environment, whirling frenzy, turning by level check, aspect of nature.',
     'Note the swapped feature under Feats and abilities; the rule text is in the Reference.'),
    ('prestigiousClasses', 'Prestigious character classes', 'classes', 'classes/prestigiousCharacterClasses', 'table',
     'The bard, paladin and ranger rebuilt as prestige classes entered later in a career.',
     'The rule text is in the Reference; enter the prestige class as a homebrew class if you use it.'),
    ('gestalt', 'Gestalt characters', 'classes', 'classes/gestaltCharacters', 'math',
     'Every level takes two classes at once, keeping the better of each.',
     'Each level row takes two classes, and the sheet keeps the better hit die, attack, saves and skills.'),
    ('genericClasses', 'Generic classes', 'classes', 'classes/genericClasses', 'math',
     'Three flexible classes - expert, spellcaster and warrior - that choose their own saves and class skills.',
     'Adds the generic classes to the class list; choose their good saves on the Rules page.'),
    # Building characters
    ('skillsMaxRanks', 'Skills: maximum ranks, limited choices', 'building', 'buildingCharacters/alternativeSkillSystems', 'math',
     'Each skill is known or not; a known skill always has the most ranks it can.',
     'Skills become known or unknown, a known skill takes its maximum ranks, and the sheet counts how many you may know.'),
    ('skillsLevelBased', 'Skills: level-based skills', 'building', 'buildingCharacters/alternativeSkillSystems', 'math',
     'No skill points at all: class skills add your level, cross-class skills add nothing.',
     'Class skills take your character level as their ranks; cross-class skills take none; no points to spend.'),
    ('complexSkills', 'Complex skill checks', 'building', 'buildingCharacters/complexSkillChecks', 'table',
     'Some tasks take several successful checks over time rather than one roll.',
     'A rule of play; the rule text is in the Reference.'),
    ('traitsFlaws', 'Character traits and flaws', 'building', 'buildingCharacters/characterTraits', 'math',
     'Traits give a small bonus and a matching penalty; flaws give a penalty and buy an extra feat.',
     'Adds traits and flaws to the Feats page, and each flaw adds a feat.'),
    ('spelltouchedFeats', 'Spelltouched feats', 'building', 'buildingCharacters/spelltouchedFeats', 'table',
     'Feats gained by surviving particular spells.',
     'Take them as feats; the rule text is in the Reference.'),
    ('weaponGroups', 'Weapon group feats', 'building', 'buildingCharacters/weaponGroupFeats', 'table',
     'Weapon Focus and its kin apply to a group of similar weapons instead of one.',
     'Name the group on the feat; the rule text is in the Reference.'),
    ('craftPoints', 'Craft points', 'building', 'buildingCharacters/craftPoints', 'track',
     'A pool of points, growing with level and item creation feats, spent in place of experience and gold when crafting.',
     'Shows your craft points from level and feats, and tracks what you spend.'),
    ('srdBackground', 'Character background', 'building', 'buildingCharacters/characterBackground', 'table',
     'Tables for working out what a character did at each level before play began.',
     'A way of choosing; note the background under Story. The tables are in the Reference.'),
    # Adventuring
    ('defenseBonus', 'Defense bonus', 'adventuring', 'adventuring/defenseBonus', 'math',
     'A class-based bonus to AC that takes the place of armor when it is higher, and counts against touch attacks.',
     'Your AC uses your defense bonus or your armor bonus, whichever is higher, and touch AC includes the defense bonus.'),
    ('armorAsDR', 'Armor as damage reduction', 'adventuring', 'adventuring/armorAsDamageReduction', 'math',
     'Armor gives up part of its AC bonus for damage reduction; so does natural armor.',
     'Armor and natural armor lower AC by the damage reduction they grant, and the sheet shows the DR.'),
    ('damageConversion', 'Damage conversion', 'adventuring', 'adventuring/damageConversion', 'math',
     'Armor turns lethal damage into nonlethal damage, up to its armor bonus a hit.',
     'Shows how much damage a hit your armor converts, and the nonlethal damage it ignores.'),
    ('injury', 'Injury', 'adventuring', 'adventuring/injury', 'track',
     'No hit points: each hit calls for a Fortitude save, and failures pile up as injuries.',
     'Replaces hit points with a hit counter and condition, and shows the save to resist injury.'),
    ('reservePoints', 'Reserve points', 'adventuring', 'adventuring/reservePoints', 'track',
     'A second pool as large as your hit points that heals you between fights.',
     'Adds reserve points equal to your hit points, and tracks what you use.'),
    ('massiveDamage', 'Massive damage thresholds and results', 'adventuring', 'adventuring/massaveDamageThresholdsAndResults', 'math',
     'A massive damage threshold set by Constitution, Hit Dice or size, and failed saves that leave you dying instead of dead.',
     'Shows your massive damage threshold and what a failed save does, as you choose them.'),
    ('vitalityWounds', 'Vitality and wound points', 'adventuring', 'adventuring/vitalityAndWoundPoints', 'track',
     'Vitality points soak glancing blows; wound points, equal to Constitution, take critical hits and what gets through.',
     'Shows vitality points in place of hit points and wound points equal to Constitution, each tracked.'),
    ('bellCurve', 'Bell curve rolls', 'adventuring', 'adventuring/bellCurveRolls', 'table',
     'Roll 3d6 instead of a d20, for results that cluster around the average.',
     'A rule of play; the sheet notes it and the rule text is in the Reference.'),
    ('playersRollDice', 'Players roll all the dice', 'adventuring', 'adventuring/playersRollAllTheDice', 'math',
     'Players roll to defend and to force saves, instead of the GM rolling against them.',
     'Shows your defense check, magic check and spell resistance check bonuses.'),
    ('deathAndDying', 'Death and dying', 'adventuring', 'adventuring/deathAndDying', 'math',
     'Hit points stop at 0, and a Fortitude save decides whether you are disabled, dying or dead.',
     'Hit points no longer go below 0, and the sheet shows the save you make when they reach it.'),
    ('actionPoints', 'Action points', 'adventuring', 'adventuring/actionPoints', 'track',
     'A small pool of points, renewed each level, that add dice to a roll or power special actions.',
     'Adds action points, the dice one point rolls at your level, and what you have spent.'),
    ('variableModifiers', 'Variable modifiers', 'adventuring', 'adventuring/variableModifiers', 'table',
     'Some bonuses are rolled each time instead of fixed.',
     'A rule of play; the rule text is in the Reference.'),
    ('hexGrid', 'Hex grid', 'adventuring', 'adventuring/hexGrid', 'table',
     'Movement and reach on hexes instead of squares.',
     'A rule of play; the rule text is in the Reference.'),
    ('combatFacing', 'Combat facing', 'adventuring', 'adventuring/combatFacing', 'table',
     'Characters face a direction, and flank and rear attacks matter.',
     'A rule of play; the rule text is in the Reference.'),
    # Magic
    ('magicRating', 'Magic rating', 'magic', 'magic/magicRating', 'math',
     'Every class adds to a magic rating that serves as caster level, so multiclassing casters keep their power.',
     'Your caster level for spells becomes your magic rating, added up from all your classes.'),
    ('summonVariants', 'Summon monster variants', 'magic', 'magic/summonMonsterVariants', 'table',
     'Themed or personal lists for summon monster spells.',
     'A rule of play; the rule text is in the Reference.'),
    ('rechargeMagic', 'Recharge magic', 'magic', 'magic/rechargeMagic', 'track',
     'Spells are not used up; each needs time to recharge before its level can be cast again.',
     'The spell sheet shows recharge times by spell level and marks levels recharging instead of counting slots.'),
    ('metamagicComponents', 'Metamagic components', 'magic', 'magic/metamagicComponents', 'table',
     'Rare components that apply a metamagic effect without a higher slot.',
     'A rule of play; the rule text is in the Reference.'),
    ('spontaneousMetamagic', 'Spontaneous metamagic', 'magic', 'magic/spontaneousMetamagic', 'track',
     'Each metamagic feat can be applied three times a day with no higher slot or longer casting time.',
     'Each metamagic feat gets three uses a day, tracked, and the sheet shows the highest spell it can affect.'),
    ('spellPoints', 'Spell points', 'magic', 'magic/spellPoints', 'track',
     'Casters spend points from a daily pool instead of using up slots.',
     'The spell sheet shows a pool of spell points in place of slots, and what each spell level costs.'),
    ('incantations', 'Incantations', 'magic', 'magic/incantations', 'table',
     'Rituals anyone can attempt, with skill checks, time and risk.',
     'A rule of play; the rule text is in the Reference.'),
    ('legendaryWeapons', 'Legendary weapons', 'magic', 'magic/legendaryWeapons', 'table',
     'Weapons that grow in power with their wielder.',
     'Carry it as an item with its effects; the rule text is in the Reference.'),
    ('itemFamiliars', 'Item familiars', 'magic', 'magic/itemFamiliars', 'table',
     'An intelligent item bonded to its owner, which grows with invested experience.',
     'Carry it as an item; the rule text is in the Reference.'),
    # Campaigns
    ('contacts', 'Contacts', 'campaigns', 'campaigns/contacts', 'track',
     'Friends who provide information, influence or skill, gained as class levels rise.',
     'Counts the contacts your class levels give you and keeps a list of them.'),
    ('reputation', 'Reputation', 'campaigns', 'campaigns/reputation', 'math',
     'A reputation score, from class levels and feats, that decides who knows your name.',
     'Works out your reputation score from your classes, Renown and Low Profile.'),
    ('honor', 'Honor', 'campaigns', 'campaigns/honor', 'track',
     'An honor score, starting from alignment and ancestry, that rises and falls with conduct.',
     'Works out your starting honor from alignment and ancestry, and tracks your current honor.'),
    ('uaTaint', 'Taint', 'campaigns', 'campaigns/taint', 'track',
     'A taint score from contact with evil that eats away at Constitution and Wisdom.',
     'Tracks your taint score, takes it from Constitution and Wisdom, and shows how tainted that makes you.'),
    ('testPrerequisites', 'Test-based prerequisites', 'campaigns', 'campaigns/testBasedPrerequisites', 'table',
     'Prestige classes and some feats demand a test in play before they can be taken.',
     'A rule of play; the rule text is in the Reference.'),
    ('sanity', 'Sanity', 'campaigns', 'campaigns/sanity', 'track',
     'Sanity points lost to horror and forbidden knowledge, and the madness that follows.',
     'Works out starting and maximum Sanity, and tracks your current Sanity.'),
]


def page_file(pages, page):
    return pages / (page.split('/')[-1] + '.htm')


def content(raw):
    m = re.search(r'<div id="content">(.*?)<div id="footer"', raw, re.S)
    return m.group(1) if m else raw


def tables_of(raw):
    """Every table on a page, as rows of cell text, with the heading before it."""
    class P(build_srd.HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.tables, self.stack, self.row, self.cell = [], [], None, None
            self.heading, self.in_heading, self.htext = '', False, []

        def handle_starttag(self, tag, attrs):
            if tag == 'table':
                self.stack.append({'heading': self.heading, 'rows': []})
            elif tag == 'tr' and self.stack:
                self.row = []
            elif tag in ('td', 'th') and self.row is not None:
                self.cell = []
            elif re.fullmatch(r'h\d', tag):
                self.in_heading, self.htext = True, []

        def handle_endtag(self, tag):
            if tag in ('td', 'th') and self.cell is not None and self.row is not None:
                self.row.append(re.sub(r'\s+', ' ', ''.join(self.cell)).strip())
                self.cell = None
            elif tag == 'tr' and self.row is not None and self.stack:
                if any(self.row):
                    self.stack[-1]['rows'].append(self.row)
                self.row = None
            elif tag == 'table' and self.stack:
                t = self.stack.pop()
                if t['rows']:
                    self.tables.append(t)
            elif re.fullmatch(r'h\d', tag):
                self.in_heading = False
                self.heading = re.sub(r'\s+', ' ', ''.join(self.htext)).strip()

        def handle_data(self, data):
            if self.cell is not None:
                self.cell.append(data)
            if self.in_heading:
                self.htext.append(data)

    p = P()
    p.feed(content(raw))
    return p.tables


def ordinal_rows(rows):
    """Rows whose first cell is '1st', '2nd' ... '20th', keyed by level."""
    out = {}
    for r in rows:
        m = re.match(r'^(\d+)(st|nd|rd|th)$', r[0] if r else '')
        if m:
            out[int(m.group(1))] = r[1:]
    return out


def num(text):
    m = re.search(r'[+-]?\d[\d,]*', text or '')
    return int(m.group(0).replace(',', '')) if m else None


def paragon_classes(raw):
    """The paragon classes: each one's table, hit die, skill points and class skills."""
    text = build_srd.html(content(raw)) or ''
    plain = re.sub(r'<[^>]+>', '\n', text)
    tables = [t for t in tables_of(raw) if t['rows'] and 'Base' in ' '.join(t['rows'][0])]
    out = []
    sections = {}
    for name in ['Drow', 'Dwarf', 'Elf', 'Gnome', 'Half-Dragon', 'Half-Elf', 'Half-Orc', 'Halfling', 'Human', 'Orc', 'Tiefling']:
        at = [m.start() for m in re.finditer(re.escape(f'{name} Paragon'), plain)]
        hit = [a for a in at if 'Hit Die' in plain[a:a + 4000]]
        if hit:
            sections[name] = plain[hit[0]:hit[0] + 6000]
    for i, (name, section) in enumerate(sections.items()):
        hd = re.search(r'Hit Die\s*\n\s*d(\d+)', section)
        sp = re.search(r'Skill Points at Each Level\s*\n\s*(\d+)', section)
        cs = re.search(r'class skills \(and the key ability for each skill\) are ([^\n]+?)\.\s*\n', section)
        listed = cs.group(1).replace('Knowledge (all skills, taken individually)', 'Knowledge') if cs else ''
        skills = []
        for part in re.split(r',\s*(?:and\s+)?|\s+and\s+', listed):
            part = re.sub(r'\s*\((Str|Dex|Con|Int|Wis|Cha)\)$', '', part.strip())
            if part:
                skills.append(part[0].upper() + part[1:])
        table = tables[i]['rows'] if i < len(tables) else []
        levels = ordinal_rows(table)
        out.append({
            'name': f'{name} paragon',
            'hd': int(hd.group(1)) if hd else 8,
            'skillPoints': int(sp.group(1)) if sp else 2,
            'classSkills': [s for s in skills if s],
            'maxLevel': 3,
            'table': [{'level': lv, 'bab': num(r[0]), 'fort': num(r[1]), 'ref': num(r[2]), 'will': num(r[3]), 'special': r[4] if len(r) > 4 else ''}
                      for lv, r in sorted(levels.items())],
            'variant': 'paragonClasses',
            **({'chooseSkills': 10} if name == 'Human' else {}),
        })
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pages = Path(sys.argv[1])
    raw = {p.stem: p.read_text(encoding='utf-8', errors='replace') for p in pages.glob('*.htm')}
    T = {k: tables_of(v) for k, v in raw.items()}

    def table(page, heading):
        return next(t['rows'] for t in T[page] if t['heading'].startswith(heading))

    defense = ordinal_rows(table('defenseBonus', 'Defense Bonus'))
    magic_rating = ordinal_rows(table('magicRating', 'Magic Ratings For Standard'))
    spell_points = ordinal_rows(table('spellPoints', 'Spell Points'))
    spell_bonus_rows = table('spellPoints', 'Bonus Spell Points')
    spell_bonus = []
    for r in spell_bonus_rows:
        m = re.match(r'^(\d+)-(\d+)$', r[0])
        if m:
            spell_bonus.append({'from': int(m.group(1)), 'to': int(m.group(2)), 'byMaxLevel': [num(c) or 0 for c in r[1:11]]})
    spont_known = ordinal_rows(table('spontaneousDivineCasters', 'Spontaneous Divine Casters'))
    craft_feats = {r[0]: num(r[2]) for r in table('craftPoints', 'Item Creation Feats')[1:] if len(r) >= 3}
    contacts = ordinal_rows(table('contacts', 'Contacts'))
    reputation = ordinal_rows(table('reputation', 'Calculating Reputation'))
    honor_rows = table('honor', 'Honor')
    honor = {r[0].lower(): num(r[1]) for r in honor_rows if len(r) == 2 and num(r[1]) is not None and not r[0].startswith('Ancestral')}
    recharge = table('rechargeMagic', 'General Recharge Spells')[1:]
    vitality = {r[0]: num(r[2].replace('d', '')) for r in table('vitalityAndWoundPoints', 'Vitality Points')[1:] if len(r) >= 3}
    bell = table('bellCurveRolls', 'Threat Range')
    generic_caster = ordinal_rows(table('genericClasses', 'Spellcaster'))

    catalog = []
    rules_text = []
    for vid, name, category, page, sheet, summary, reflect in CATALOG:
        catalog.append({'id': vid, 'name': name, 'category': category, 'sheet': sheet, 'summary': summary, 'onSheet': reflect, 'url': BASE_URL + page + '.htm'})
        file = page_file(pages, page)
        text = build_srd.html(content(file.read_text(encoding='utf-8', errors='replace'))) if file.exists() else None
        if text:
            text = re.sub(r'^.*?(?=<h\d>)', '', text, count=1, flags=re.S)
        rules_text.append({'name': name, 'id': vid, 'category': dict(CATEGORIES)[category], 'summary': summary, 'onSheet': reflect, 'url': BASE_URL + page + '.htm', 'text': text})

    data = {
        '_comment': [
            'The SRD\'s variant rules, from Unearthed Arcana: which exist, what each does on the',
            'sheet, and the tables the engine reads. Built by scripts/build-variants.py; do not',
            'edit by hand. The rule text itself is data/srd/variants.json, fetched when opened.',
        ],
        'categories': CATEGORIES,
        'variants': catalog,
        'tables': {
            'defenseBonus': {
                'columns': {'A': ['Monk', 'Sorcerer', 'Wizard'], 'B': ['Bard', 'Ranger', 'Rogue'], 'C': ['Barbarian', 'Druid'], 'D': ['Cleric', 'Fighter', 'Paladin']},
                'byArmor': {'none': 'A', 'light': 'B', 'medium': 'C', 'heavy': 'D'},
                'byLevel': {lv: [num(c) for c in r[:4]] for lv, r in defense.items()},
            },
            'magicRating': {
                'columns': {'A': ['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Wizard'], 'B': ['Monk', 'Paladin', 'Ranger'], 'C': ['Barbarian', 'Fighter', 'Rogue']},
                'byLevel': {lv: [num(c) for c in r[:3]] for lv, r in magic_rating.items()},
            },
            'spellPoints': {
                'groups': {'Bard': 0, 'Cleric': 1, 'Druid': 1, 'Wizard': 1, 'Adept': 1, 'Paladin': 2, 'Ranger': 2, 'Sorcerer': 3},
                'byLevel': {lv: [num(c) for c in r[:4]] for lv, r in spell_points.items()},
                'bonus': spell_bonus,
                'cost': [0, 1, 3, 5, 7, 9, 11, 13, 15, 17],
            },
            'spontaneousDivineKnown': {lv: [num(c) for c in r[:10]] for lv, r in spont_known.items()},
            'craftPoints': {'perLevel': 100, 'feats': craft_feats},
            'contacts': {
                'columns': {'A': ['Bard'], 'B': ['Cleric', 'Paladin', 'Rogue'], 'C': ['Fighter', 'Sorcerer'], 'D': ['Barbarian', 'Druid', 'Monk', 'Ranger', 'Wizard']},
                'byLevel': {lv: [num(c) for c in r[:4]] for lv, r in contacts.items()},
            },
            'reputation': {
                'columns': {'A': ['Commoner'], 'B': ['Barbarian', 'Druid', 'Monk', 'Ranger', 'Rogue', 'Warrior'], 'C': ['Cleric', 'Fighter', 'Sorcerer', 'Wizard', 'Adept', 'Expert'], 'D': ['Bard', 'Paladin', 'Aristocrat']},
                'byLevel': {lv: [num(c) for c in r[:4]] for lv, r in reputation.items()},
                'feats': {'Renown': 3, 'Low Profile': -3},
            },
            'honor': {'byAlignment': honor, 'ancestralHero': 2, 'ancestralFailure': -2},
            'rechargeTimes': [[r[1], r[2]] for r in recharge],
            'vitalityDie': vitality,
            'bellCurveThreats': bell,
            'reducingLA': {'1': [3], '2': [6, 9], '3': [9, 15, 18], '4': [12], '5': [15], '6': [18]},
            'bloodlineLevels': {'minor': [12], 'intermediate': [6, 12], 'major': [3, 6, 12]},
            'genericSpellcasterSlots': [[c if num(c) is not None else None for c in r[4:14]] for lv, r in sorted(generic_caster.items())],
            'metamagic': {'Enlarge Spell': 1, 'Extend Spell': 1, 'Silent Spell': 1, 'Still Spell': 1, 'Empower Spell': 2, 'Maximize Spell': 3, 'Widen Spell': 3, 'Quicken Spell': 4},
        },
        'paragonClasses': paragon_classes(raw['racialParagonClasses']),
    }
    (ROOT / 'web/data/variants.json').write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    build_srd.OUT.mkdir(parents=True, exist_ok=True)
    body = '[\n' + ',\n'.join(json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in rules_text) + '\n]\n'
    (build_srd.OUT / 'variants.json').write_text(body, encoding='utf-8')
    print(f"variants.json: {len(catalog)} variants, {len(data['paragonClasses'])} paragon classes")
    print(f"srd/variants.json: {len(body.encode('utf-8')) // 1024} KB")


if __name__ == '__main__':
    main()
