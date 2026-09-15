"""Build the Unearthed Arcana content that goes straight into the creator's lists.

    python scripts/build-variant-content.py

Some of the SRD's variant rules are not rules of play but more things to choose
from: races (aquatic, arctic, desert, jungle and elemental versions of the core
races), classes (the prestige bard, paladin and ranger), feats (spelltouched and
weapon group feats) and class features (the specialist wizard variants, the
druid's aspect of nature). This writes web/data/srd/variant-content.json, which
the engine adds to the race, class and feat lists and the Class step's choices.

The races are written out below as changes to the core races in
web/data/races.json - what a variant adds, takes away or replaces - because the
SRD states them that way. The prestige classes' tables and class skills are read
from the variant rule text in web/data/srd/variants.json (build-variants.py).
Notes are short restatements; the full text stays in the Reference.

Rerun after build-variants.py or a change to races.json; never edit the output
by hand. The housekeeping sweep checks that the file is what this builds.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'web' / 'data'

ABILITY = {'strength': 'str', 'dexterity': 'dex', 'constitution': 'con', 'intelligence': 'int', 'wisdom': 'wis', 'charisma': 'cha'}


def eff(target, value, kind='racial', condition=None):
    e = {'target': target, 'type': kind, 'value': value}
    if condition:
        e['condition'] = condition
    return e


def skill(name, value=2, condition=None):
    return eff(f'skill.{name}', value, 'racial', condition)


# --------------------------------------------------------------------------
# Races
#
# Each variant names its core race and what changes:
#   abilities   the whole adjustment, replacing the core race's
#   drop        effects removed: (target, words in its condition or None for any)
#   recondition effects kept with a new condition: (target, old words, new condition)
#   add         effects added
#   dropTraits  sentences removed from the traits text (by their opening words)
#   traits      sentences added
#   favored, speed, bonusLanguages
# --------------------------------------------------------------------------

LOW_LIGHT = 'Low-light vision.'
NO_DARKVISION = 'Darkvision'

GROUPS = {
    'aquatic': {
        'variant': 'environmentalRaces',
        'label': 'Aquatic',
        'traits': ['Aquatic subtype: breathes water, and air only if also amphibious.', 'A swim speed, with +8 on Swim checks and always able to take 10 on them.'],
        'add': [],
        'bonusLanguages': ['Aquan'],
    },
    'arctic': {
        'variant': 'environmentalRaces',
        'label': 'Arctic',
        'traits': ['Cold endurance: +4 on Fortitude saves against cold weather and exposure.'],
        'add': [eff('save.fort', 4, 'racial', 'against cold weather and exposure')],
    },
    'desert': {
        'variant': 'environmentalRaces',
        'label': 'Desert',
        'traits': ['Heat endurance: +4 on Fortitude saves against hot weather.'],
        'add': [eff('save.fort', 4, 'racial', 'against hot weather')],
    },
    'jungle': {
        'variant': 'environmentalRaces',
        'label': 'Jungle',
        'traits': [],
        'add': [],
    },
    'air': {
        'variant': 'elementalRaces',
        'label': 'Air',
        'traits': ['The general traits of the races of air; see the Reference.'],
        'add': [],
    },
    'earth': {
        'variant': 'elementalRaces',
        'label': 'Earth',
        'traits': ['Stability: +4 against bull rush and trip while standing on the ground.', '-2 on saves against spells and abilities of the air subtype, or used by air creatures.'],
        'add': [
            eff('attack.all', 1, 'racial', 'against creatures of the air subtype'),
            eff('save.all', -2, 'untyped', 'against spells and abilities of the air subtype or air creatures'),
        ],
    },
    'fire': {
        'variant': 'elementalRaces',
        'label': 'Fire',
        'traits': ['Resistance to fire 5.', '-2 on saves against spells and abilities of the water or cold subtype, or used by water creatures.'],
        'add': [
            eff('attack.all', 1, 'racial', 'against creatures of the water subtype'),
            eff('save.all', -2, 'untyped', 'against spells and abilities of the water or cold subtype or water creatures'),
        ],
    },
    'water': {
        'variant': 'elementalRaces',
        'label': 'Water',
        'traits': ['Natural swimmer: a swim speed equal to base land speed.', '-2 on saves against spells and abilities of the fire subtype, or used by fire creatures.'],
        'add': [
            eff('attack.all', 1, 'racial', 'against creatures of the fire subtype'),
            eff('save.all', -2, 'untyped', 'against spells and abilities of the fire subtype or fire creatures'),
        ],
    },
}

RACES = [
    # --- Aquatic -----------------------------------------------------------
    ('aquatic', 'Dwarf', {'abilities': {'str': 2, 'con': 2, 'dex': -4, 'cha': -2}, 'traits': ['Swim 20 ft.']}),
    ('aquatic', 'Elf', {'traits': ['Swim 40 ft.', 'No gills.']}),
    ('aquatic', 'Gnome', {
        'traits': ['Swim 20 ft.'],
        'add': [skill('Sense Motive'), skill('Gather Information')],
        'recondition': [('attack.all', 'kobolds', 'against goblinoids')],
        'drop': [('skill.Craft', 'alchemy'), ('skill.Listen', None)],
    }),
    ('aquatic', 'Half-Elf', {'traits': ['Swim 40 ft.'], 'add': [skill('Survival')], 'drop': [('skill.Gather Information', None)]}),
    ('aquatic', 'Half-Orc', {'traits': ['Swim 30 ft.'], 'add': [skill('Diplomacy'), skill('Gather Information')]}),
    ('aquatic', 'Halfling', {'traits': ['Swim 20 ft.', 'Low-light vision, seeing four times as far as a human.']}),
    ('aquatic', 'Human', {'traits': ['Swim 30 ft.', 'Low-light vision, seeing four times as far as a human.']}),
    # --- Arctic ------------------------------------------------------------
    ('arctic', 'Dwarf', {
        'abilities': {'str': 2, 'con': 2, 'dex': -4, 'cha': -2},
        'traits': ['Icecunning: stonecunning works on ice as well as stone.'],
        'recondition': [('attack.all', 'orcs', 'against kobolds')],
        'add': [skill('Appraise', 2, 'on items made of ice'), skill('Craft', 2, 'on items made of ice')],
    }),
    ('arctic', 'Elf', {
        'abilities': {'str': -2, 'dex': 2},
        'traits': ['+2 on one Craft skill, chosen at creation.'],
        'dropTraits': ['Notices a secret door'],
        'add': [skill('Survival', 2, 'in arctic environments')],
        'drop': [('skill.Search', None)],
    }),
    ('arctic', 'Gnome', {'add': [skill('Sense Motive')], 'drop': [('skill.Craft', 'alchemy')]}),
    ('arctic', 'Half-Elf', {'add': [skill('Survival')], 'drop': [('skill.Diplomacy', None)]}),
    ('arctic', 'Half-Orc', {'dropTraits': [NO_DARKVISION], 'traits': [LOW_LIGHT], 'add': [skill('Diplomacy')]}),
    ('arctic', 'Halfling', {'favored': 'Ranger', 'add': [skill('Swim')], 'recondition': [('attack.ranged', 'slings', 'with thrown weapons')]}),
    # --- Desert ------------------------------------------------------------
    ('desert', 'Dwarf', {
        'abilities': {'dex': -2, 'con': 2},
        'dropTraits': ['Stonecunning'],
        'drop': [('skill.Search', 'stonework'), ('skill.Craft', None)],
        'recondition': [
            ('attack.all', 'orcs', 'against reptilian humanoids and dragons'),
            ('ac', 'giants', 'against dragons'),
        ],
        'add': [skill('Knowledge (architecture and engineering)'), skill('Knowledge (dungeoneering)'), skill('Profession', 2, 'as a miner')],
    }),
    ('desert', 'Elf', {
        'abilities': {'str': -2, 'dex': 2},
        'traits': ['Martial Weapon Proficiency with the scimitar, rapier and shortbow (composite too) as bonus feats.'],
        'add': [skill('Handle Animal'), skill('Ride')],
        'drop': [('skill.Listen', None)],
    }),
    ('desert', 'Gnome', {'add': [skill('Bluff'), skill('Diplomacy'), skill('Sense Motive')], 'drop': [('skill.Listen', None), ('skill.Craft', 'alchemy')]}),
    ('desert', 'Half-Elf', {'add': [skill('Sense Motive')], 'drop': [('skill.Listen', None)]}),
    ('desert', 'Half-Orc', {
        'abilities': {'con': 2, 'int': -2},
        'dropTraits': [NO_DARKVISION],
        'traits': [LOW_LIGHT, 'Run as a racial bonus feat.'],
    }),
    ('desert', 'Halfling', {'add': [skill('Hide'), skill('Sleight of Hand')], 'drop': [('skill.Climb', None), ('skill.Jump', None)]}),
    # --- Jungle ------------------------------------------------------------
    ('jungle', 'Dwarf', {
        'favored': 'Ranger',
        'dropTraits': [NO_DARKVISION, 'Stonecunning'],
        'traits': [LOW_LIGHT],
        'drop': [('skill.Search', 'stonework'), ('skill.Craft', None)],
        'add': [skill('Heal'), skill('Knowledge (nature)'), skill('Survival'), skill('Spot')],
    }),
    ('jungle', 'Elf', {
        'traits': ['Martial Weapon Proficiency with the handaxe, rapier, short sword and shortbow (composite too) as bonus feats.'],
        'dropTraits': ['Notices a secret door'],
        'add': [skill('Knowledge (history)')],
    }),
    ('jungle', 'Gnome', {
        'recondition': [('attack.all', 'kobolds', 'against goblinoids')],
        'drop': [('ac', 'giants'), ('skill.Listen', None), ('skill.Craft', 'alchemy')],
        'add': [skill('Climb'), skill('Swim'), skill('Craft', 2, 'on shipbuilding'), skill('Use Rope')],
    }),
    ('jungle', 'Half-Elf', {'add': [skill('Bluff'), skill('Sense Motive')], 'drop': [('skill.Diplomacy', None), ('skill.Gather Information', None)]}),
    ('jungle', 'Half-Orc', {'dropTraits': [NO_DARKVISION], 'traits': [LOW_LIGHT], 'add': [skill('Climb'), skill('Jump')]}),
    ('jungle', 'Halfling', {
        'favored': 'Barbarian',
        'traits': ['Martial Weapon Proficiency with the throwing axe, handaxe and shortbow (composite too) as bonus feats.', 'Poison use: never poisons itself applying or using poison.'],
        'dropTraits': ['+1 on all saving throws'],
        'drop': [('save.all', None)],
        'recondition': [('attack.ranged', 'slings', 'with thrown weapons')],
        'add': [eff('save.fort', 2, 'racial', 'against poison')],
    }),
    # --- Elemental ---------------------------------------------------------
    ('air', 'Gnome', {
        'abilities': {'dex': 2, 'str': -2},
        'drop': [('attack.all', 'kobolds')],
        'recondition': [('ac', 'giants', 'against Large or larger creatures of the earth subtype')],
    }),
    ('earth', 'Dwarf', {
        'abilities': {'str': 2, 'con': 2, 'dex': -2, 'cha': -2},
        'drop': [('save.all', 'spells'), ('attack.all', 'orcs'), ('skill.Search', 'stonework'), ('skill.Appraise', None), ('skill.Craft', None)],
        'add': [skill('Search', 4, 'for unusual stonework'), skill('Appraise', 4, 'on stone or metal items'), skill('Craft', 4, 'on stone or metal')],
        'traits': ['Improved stonecunning.'],
    }),
    ('fire', 'Elf', {'abilities': {'dex': 2, 'con': -2, 'int': 2, 'cha': -2}}),
    ('water', 'Halfling', {'abilities': {'str': -2, 'dex': 2, 'con': 2}, 'traits': ['Swim 20 ft.']}),
    ('fire', 'Half-Elf', {
        'group': {'traits': ['-1 on saves against spells and abilities used by water creatures.'], 'add': [
            eff('attack.all', 1, 'racial', 'against water creatures'),
            eff('save.all', -1, 'untyped', 'against spells and abilities used by water creatures'),
        ]},
    }),
    ('water', 'Half-Orc', {
        'group': {'traits': ['-1 on saves against spells and abilities used by fire creatures.'], 'add': [
            eff('attack.all', 1, 'racial', 'against fire creatures'),
            eff('save.all', -1, 'untyped', 'against spells and abilities used by fire creatures'),
        ]},
    }),
]


def sentences(text):
    return [s.strip() for s in re.split(r'(?<=\.)\s+', text or '') if s.strip()]


def build_races(core):
    by_name = {r['name']: r for r in core}
    out = []
    for group_key, base_name, spec in RACES:
        base = by_name[base_name]
        group = {**GROUPS[group_key], **spec.get('group', {})}
        race = json.loads(json.dumps(base))
        race['name'] = f"{group['label']} {base_name}"
        race['base'] = base_name
        race['variant'] = group['variant']
        race['group'] = group_key
        if 'abilities' in spec:
            race['abilityAdjust'] = spec['abilities']
        if 'favored' in spec:
            race['favoredClass'] = spec['favored']

        effects = race.get('effects', [])
        for target, words in spec.get('drop', []):
            effects = [e for e in effects if not (e['target'] == target and (words is None or words in (e.get('condition') or '')))]
        for target, words, condition in spec.get('recondition', []):
            for e in effects:
                if e['target'] == target and words in (e.get('condition') or ''):
                    e['condition'] = condition
        effects += group.get('add', []) + spec.get('add', [])
        race['effects'] = effects

        kept = [s for s in sentences(race.get('traits')) if not any(s.startswith(d) for d in spec.get('dropTraits', []))]
        race['traits'] = ' '.join(kept + group.get('traits', []) + spec.get('traits', []))

        extra = group.get('bonusLanguages', [])
        langs = race.get('languages') or {}
        if extra and isinstance(langs.get('bonus'), list):
            langs['bonus'] = sorted(set(langs['bonus'] + extra))
        race['languages'] = langs
        out.append(race)
    return out


# --------------------------------------------------------------------------
# Prestige classes: read from the variant rule text
# --------------------------------------------------------------------------

def plain(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html or '')).strip()


PRESTIGE = {
    'Prestige Bard': {
        'base': 'Bard',
        'requires': 'Any nonlawful alignment; base attack bonus +3; Knowledge (any) 4 ranks and Perform (any) 8 ranks; able to cast 1st-level arcane spells of divination, enchantment and illusion.',
        'castingType': 'arcane',
    },
    'Prestige Paladin': {
        'base': 'Paladin',
        'requires': 'Lawful good; base attack bonus +4; Knowledge (religion) 2 ranks, Knowledge (nobility and royalty) 2 ranks and Ride 4 ranks; Mounted Combat; able to cast protection from evil as a divine spell; able to turn undead.',
        'castingType': 'divine',
    },
    'Prestige Ranger': {
        'base': 'Ranger',
        'requires': 'Base attack bonus +4; Knowledge (nature) 2 ranks and Survival 4 ranks; Endurance, Track, and Rapid Shot or Two-Weapon Fighting; able to cast calm animals as a divine spell.',
        'castingType': 'divine',
    },
}


def signed(cell):
    m = re.search(r'([+-]?\d+)', cell)
    return int(m.group(1)) if m else 0


def build_prestige(text):
    html = re.sub(r'googletag[^<]*|var _qevents.*', '', text, flags=re.S)
    tables = re.findall(r'<table>(.*?)</table>', html, flags=re.S)
    out = []
    for table in tables:
        title = re.search(r'Table: The (Prestige \w+)', table)
        if not title or title.group(1) not in PRESTIGE:
            continue
        name = title.group(1)
        info = PRESTIGE[name]
        rows = []
        for tr in re.findall(r'<tr>(.*?)</tr>', table, flags=re.S):
            cells = [plain(c) for c in re.findall(r'<td>(.*?)</td>', tr, flags=re.S)]
            if len(cells) < 6 or not re.match(r'\d+', cells[0]):
                continue
            special = cells[5] if re.search(r'[A-Za-z]', cells[5]) else ''
            spells = cells[6] if len(cells) > 6 else ''
            rows.append({
                'level': int(re.match(r'\d+', cells[0]).group(0)),
                'bab': signed(cells[1]), 'fort': signed(cells[2]), 'ref': signed(cells[3]), 'will': signed(cells[4]),
                'special': special,
                'advancesCasting': 'level of existing' in spells,
            })

        # The class's own section of the text runs from the end of the previous table to this one.
        start = html.find(table)
        section = html[:start]
        skills_at = section.rfind('class skills (and the key ability for each skill) are')
        skills_text = plain(section[skills_at:section.find('</p>', skills_at)])
        skills = []
        for m in re.finditer(r'([A-Z][A-Za-z ]+?(?: \((?!Str|Dex|Con|Int|Wis|Cha|None)[^)]*\))?) \((?:Str|Dex|Con|Int|Wis|Cha|None)\)', skills_text):
            label = re.sub(r'^(and|are) ', '', m.group(1).strip())
            if label.startswith('Knowledge (all') or label.startswith('Knowledge (any'):
                label = 'Knowledge'
            skills.append(label)
        points_at = section.rfind('Skill Points at Each Level')
        points = int(re.search(r'(\d+) \+ Int', plain(section[points_at:points_at + 200])).group(1))
        hd_at = section.rfind('Hit Die')
        hd = int(re.search(r'd(\d+)', plain(section[hd_at:hd_at + 60])).group(1))

        out.append({
            'name': name,
            'hd': hd,
            'skillPoints': points,
            'classSkills': sorted(set(skills), key=skills.index),
            'prestige': True,
            'maxLevel': len(rows),
            'table': [{k: v for k, v in r.items() if k != 'advancesCasting'} for r in rows],
            'castingAdvance': {'type': info['castingType'], 'levels': [r['level'] for r in rows if r['advancesCasting']]},
            'requires': info['requires'],
            'note': f"The {info['base'].lower()} as a prestige class. Its spellcasting adds to a {info['castingType']} spellcasting class the character already has.",
            'variant': 'prestigiousClasses',
        })
    return out


# --------------------------------------------------------------------------
# Feats
# --------------------------------------------------------------------------

SPELLTOUCHED = [
    ('Accurate Jaunt', 'greater teleport, plane shift, teleport or shadow walk', 'Better odds of arriving where you mean to when teleporting or traveling between planes.'),
    ('Bladeproof Skin', 'stoneskin or iron body', 'Damage reduction 3/bludgeoning.'),
    ('Breadth of Knowledge', 'legend lore or vision', 'Every Knowledge check counts as trained.'),
    ('Conductivity', 'call lightning, lightning bolt or chain lightning', 'After taking electricity damage, loose a line of electricity at a target within 30 feet.'),
    ('Controlled Immolation', 'fireball or delayed blast fireball', 'No damage from catching fire, and creatures striking you in melee take 1d6 fire damage.'),
    ('Eyes to the Sky', 'scrying or greater scrying', 'You notice any magical scrying sensor within 40 feet.'),
    ('False Pretenses', 'a charm or dominate spell', 'You can make a caster believe you are charmed or dominated.'),
    ('Ineluctable Echo', 'wail of the banshee or any power word spell', 'A caster who targets you with a power word or wail of the banshee is caught by it too.'),
    ('Life Leech', 'the death touch granted power or death knell', 'Dying creatures within 30 feet lose a hit point, which you gain as temporary hit points.'),
    ('Live My Nightmare', 'phantasmal killer', 'A creature that targets you with divination suffers a nightmarish vision.'),
    ('Momentary Alteration', 'alter self', 'Alter self as a spell-like ability, for 1 minute, once a day.'),
    ('Naturalized Denizen', 'dimensional anchor', 'You are never treated as an extraplanar creature.'),
    ('Omniscient Whispers', 'commune or contact other plane', 'One question a week answered as though by commune.'),
    ('Photosynthetic Skin', 'barkskin', '+2 natural armor while outdoors by day.'),
    ('Polar Chill', 'cone of cold or ice storm', 'Create a patch of icy ground that hampers movement.'),
    ('Residual Rebound', 'spell resistance or spell turning', 'A natural 20 on a save against a targeted spell turns it back on its caster.'),
    ('Stench of the Dead', 'ghoul touch or vampiric touch', 'A carrion stench sickens creatures next to you.'),
]

# Weapon group feats: the weapons each covers, and any prerequisite.
WEAPON_GROUPS = [
    ('Axes', ['handaxe', 'battleaxe', 'greataxe', 'dwarven waraxe (two-handed)'], None),
    ('Basic Weapons', ['club', 'dagger', 'quarterstaff'], None),
    ('Bows', ['shortbow', 'longbow', 'composite shortbow', 'composite longbow'], None),
    ('Claw Weapons', ['punching dagger', 'spiked gauntlet'], None),
    ('Crossbows', ['heavy crossbow', 'light crossbow', 'repeating heavy crossbow', 'repeating light crossbow'], None),
    ('Druid Weapons', ['club', 'dagger', 'dart', 'quarterstaff', 'scimitar', 'sickle', 'shortspear', 'sling', 'spear'], None),
    ('Flails and Chains', ['light flail', 'heavy flail'], None),
    ('Heavy Blades', ['longsword', 'greatsword', 'falchion', 'scimitar', 'bastard sword (two-handed)'], None),
    ('Light Blades', ['dagger', 'punching dagger', 'rapier', 'short sword'], None),
    ('Maces and Clubs', ['club', 'light mace', 'heavy mace', 'greatclub', 'quarterstaff', 'sap'], None),
    ('Monk Weapons', ['kama', 'nunchaku', 'quarterstaff', 'sai', 'shuriken', 'siangham'], 'Improved Unarmed Strike.'),
    ('Picks and Hammers', ['light pick', 'heavy pick', 'light hammer', 'warhammer', 'scythe'], None),
]


def weapon_groups_from(text):
    """The groups the rule text lists beyond those above (polearms, slings, spears), read from it."""
    html = plain(re.sub(r'googletag[^<]*|var _qevents.*', '', text, flags=re.S))
    found = []
    for m in re.finditer(r'Weapon Group \(([A-Z][A-Za-z ]+)\) You understand (?:(?!Weapon Group \().)*? Benefit You make attack rolls with the following weapons normally: (.*?)\. Normal', html):
        if m.group(1).startswith('Exotic'):
            continue
        found.append((m.group(1), [w.strip() for w in re.split(r',\s*(?:and\s+)?|\s+and\s+', re.sub(r'\s*\|?\s*[AW]\s*\|?\s*', ' ', m.group(2))) if w.strip()]))
    return found


def build_feats(weapon_text):
    feats = []
    for name, exposure, benefit in SPELLTOUCHED:
        feats.append({
            'name': name,
            'types': ['Spelltouched'],
            'prerequisite': f'Exposure to {exposure}.',
            'benefit': benefit,
            'variant': 'spelltouchedFeats',
        })
    groups = {name: (weapons, pre) for name, weapons, pre in WEAPON_GROUPS}
    for name, weapons in weapon_groups_from(weapon_text):
        if name not in groups:
            groups[name] = (weapons, None)
    for name in sorted(groups):
        weapons, pre = groups[name]
        entry = {
            'name': f'Weapon Group ({name})',
            'types': ['General', 'Fighter'],
            'benefit': f"Proficient with {', '.join(weapons)}.",
            'weapons': weapons,
            'variant': 'weaponGroups',
        }
        if pre:
            entry['prerequisite'] = pre
        feats.append(entry)
    for name, benefit in [
        ('Exotic Weapons', 'Proficient with the exotic weapons of every weapon group you know, and of each group you learn later.'),
        ('Exotic Double Weapons', 'Proficient with the exotic double weapons of every weapon group you know, and of each group you learn later.'),
    ]:
        feats.append({
            'name': f'Weapon Group ({name})',
            'types': ['General', 'Fighter'],
            'prerequisite': 'Base attack bonus +1.',
            'benefit': benefit,
            'variant': 'weaponGroups',
        })
    return feats


# --------------------------------------------------------------------------
# Class feature variants: what each replaces, so the sheet can take it away
# --------------------------------------------------------------------------

# replaces: 'familiar' | 'bonusFeats' (the wizard's 5th, 10th, 15th and 20th) | 'schoolSlot' (the specialist's extra spell a day)
SPECIALIST = {
    'Abjuration': [('resistanceToEnergy', 'Resistance to energy', 'familiar', 1, 'Once a day, grant a touched creature resistance to one energy type.'),
                   ('auraOfProtection', 'Aura of protection', 'bonusFeats', 5, 'Once a day, a deflection bonus to AC and resistance bonus on saves equal to Intelligence modifier.'),
                   ('spontaneousDispelling', 'Spontaneous dispelling', 'schoolSlot', 5, 'Give up prepared spells to cast dispel magic, and later greater dispel magic.')],
    'Conjuration': [('rapidSummoning', 'Rapid summoning', 'familiar', 1, 'Summon monster spells take a standard action to cast.'),
                    ('enhancedSummoning', 'Enhanced summoning', 'bonusFeats', 1, 'Augmented Summoning in place of Scribe Scroll, and summoned creatures that grow tougher with level.'),
                    ('spontaneousSummoning', 'Spontaneous summoning', 'schoolSlot', 1, 'Give up a prepared spell to cast a summon monster spell of a lower level.')],
    'Divination': [('enhancedAwareness', 'Enhanced awareness', 'familiar', 1, 'Sense Motive becomes a class skill, and some divinations work faster and harder to resist.'),
                   ('bonusFeatList', 'Divination bonus feats', 'bonusFeats', 5, 'Bonus feats from a list of perception feats in place of the usual ones.'),
                   ('prescience', 'Prescience', 'schoolSlot', 1, 'A daily pool of insight bonuses to add to d20 rolls.')],
    'Enchantment': [('cohort', 'Cohort', 'familiar', 6, 'A loyal cohort in place of a familiar.'),
                    ('socialProficiency', 'Social proficiency', 'bonusFeats', 1, 'Social skills as class skills, with bonuses that grow with level.'),
                    ('extendedEnchantment', 'Extended enchantment', 'schoolSlot', 1, 'Enchantment spells last longer.')],
    'Evocation': [('energyAffinity', 'Energy affinity', 'familiar', 1, 'Choose an energy type; evocations of it are stronger.'),
                  ('energySubstitution', 'Energy substitution', 'bonusFeats', 5, 'Change an energy spell’s energy type as it is cast.'),
                  ('overcomeResistance', 'Overcome resistance', 'schoolSlot', 1, 'Energy spells ignore some of a target’s resistance.')],
    'Illusion': [('chainsOfDisbelief', 'Chains of disbelief', 'familiar', 1, 'Illusions hold even after others are told they are false.'),
                 ('shadowShaper', 'Shadow shaper', 'bonusFeats', 1, 'Hide becomes a class skill, and shadow powers come with level.'),
                 ('illusionMastery', 'Illusion mastery', 'schoolSlot', 1, 'Two illusion spells added to the spellbook each level.')],
    'Necromancy': [('skeletalMinion', 'Skeletal minion', 'familiar', 1, 'A skeleton servant that grows with level.'),
                   ('undeadApotheosis', 'Undead apotheosis', 'bonusFeats', 5, 'Resistances like the undead’s, gained with level.'),
                   ('enhancedUndead', 'Enhanced undead', 'schoolSlot', 1, 'Undead you create are stronger.')],
    'Transmutation': [('enhanceAttribute', 'Enhance attribute', 'familiar', 1, 'A daily enhancement bonus to an ability score.'),
                      ('spellVersatility', 'Spell versatility', 'bonusFeats', 5, 'Learn spells from prohibited schools as transmutations.'),
                      ('transmutableMemory', 'Transmutable memory', 'schoolSlot', 1, 'Once a day, swap prepared spells for others in the spellbook.')],
}

CLASS_SKILLS_FROM = {'enhancedAwareness': ['Sense Motive'], 'shadowShaper': ['Hide']}

DRUID_ASPECTS = ['Agility (8th)', 'Aquatic', 'Elemental air (16th)', 'Elemental earth (16th)', 'Elemental fire (16th)',
                 'Elemental water (16th)', 'Endurance (8th)', 'Flight', 'Plant', 'Poison', 'Scent', 'Speed', 'Tooth and claw', 'Vigor (8th)']


def build_feature_variants():
    wizard = []
    for school, options in SPECIALIST.items():
        for key, name, replaces, level, note in options:
            entry = {'key': key, 'name': name, 'school': school, 'replaces': replaces, 'level': level, 'note': note}
            if key in CLASS_SKILLS_FROM:
                entry['classSkills'] = CLASS_SKILLS_FROM[key]
            wizard.append(entry)
    return {
        'variant': 'specialistVariants',
        'Wizard': wizard,
        'Druid': [{
            'key': 'aspectOfNature',
            'name': 'Aspect of nature',
            'replaces': 'wildShape',
            'level': 5,
            'note': 'In place of wild shape: take on aspects of animals and elements, one more as the druid rises in level. Aspects: ' + ', '.join(DRUID_ASPECTS) + '.',
            'variant': 'classFeatureVariants',
        }],
    }


def build():
    """The file's contents, as they should be. The housekeeping sweep compares them with the file."""
    races = json.loads((DATA / 'races.json').read_text(encoding='utf-8'))['races']
    texts = {v['id']: v.get('text', '') for v in json.loads((DATA / 'srd' / 'variants.json').read_text(encoding='utf-8'))}
    return {
        '_comment': 'Built by scripts/build-variant-content.py from races.json and the Unearthed Arcana rule text. Do not edit by hand.',
        'races': build_races(races),
        'classes': build_prestige(texts.get('prestigiousClasses', '')),
        'feats': build_feats(texts.get('weaponGroups', '')),
        'featureVariants': build_feature_variants(),
    }


def main():
    out = DATA / 'srd' / 'variant-content.json'
    out.write_text(json.dumps(build(), indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    data = build()
    print(f"wrote {out.relative_to(ROOT)}: {len(data['races'])} races, {len(data['classes'])} classes, {len(data['feats'])} feats")


if __name__ == '__main__':
    main()
