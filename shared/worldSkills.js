export const DEFAULT_WORLD_SKILL_DEFS = Object.freeze([
    Object.freeze({
        key: 'athletics',
        label: 'Athletics',
        ability: 'STR',
        summary: 'Climb, vault, swim, or sprint through obstacles with raw muscle.',
    }),
    Object.freeze({
        key: 'bruteForce',
        label: 'Brute Force',
        ability: 'STR',
        summary: 'Smash barriers, force doors, or bend metal with overwhelming strength.',
    }),
    Object.freeze({
        key: 'grapples',
        label: 'Grapples & Holds',
        ability: 'STR',
        summary: 'Tackle foes, restrain targets, or drag allies out of danger.',
    }),
    Object.freeze({
        key: 'powerlifting',
        label: 'Powerlifting',
        ability: 'STR',
        summary: 'Carry heavy loads, brace collapsing structures, or hold gates shut.',
    }),
    Object.freeze({
        key: 'acrobatics',
        label: 'Acrobatics',
        ability: 'DEX',
        summary: 'Keep balance on tight ledges, tumble past hazards, or weave through fire.',
    }),
    Object.freeze({
        key: 'stealth',
        label: 'Stealth',
        ability: 'DEX',
        summary: 'Slip through shadows, tail suspects, or disappear into a crowd.',
    }),
    Object.freeze({
        key: 'larceny',
        label: 'Larceny',
        ability: 'DEX',
        summary: 'Pick locks, disable alarms, or lift an item without being noticed.',
    }),
    Object.freeze({
        key: 'marksmanship',
        label: 'Marksmanship',
        ability: 'DEX',
        summary: 'Line up impossible shots, ricochet bullets, or control suppressive fire.',
    }),
    Object.freeze({
        key: 'endurance',
        label: 'Endurance',
        ability: 'CON',
        summary: 'March for hours, hold your breath, or keep running through exhaustion.',
    }),
    Object.freeze({
        key: 'fortitude',
        label: 'Fortitude',
        ability: 'CON',
        summary: 'Shake off toxins, diseases, or the crushing pressure of deep dives.',
    }),
    Object.freeze({
        key: 'grit',
        label: 'Grit',
        ability: 'CON',
        summary: 'Push through injuries, ignore broken bones, or keep fighting when bleeding out.',
    }),
    Object.freeze({
        key: 'hardiness',
        label: 'Hardiness',
        ability: 'CON',
        summary: 'Endure freezing nights, scorching deserts, or radiation-soaked ruins.',
    }),
    Object.freeze({
        key: 'academics',
        label: 'Academics',
        ability: 'INT',
        summary: 'Recall formal education, decode research papers, or ace complex exams.',
    }),
    Object.freeze({
        key: 'arcana',
        label: 'Arcana',
        ability: 'INT',
        summary: 'Analyse rituals, identify spell formulae, or recall demon lineages.',
    }),
    Object.freeze({
        key: 'engineering',
        label: 'Engineering',
        ability: 'INT',
        summary: 'Build gadgets, jury-rig machinery, or hack together battlefield tools.',
    }),
    Object.freeze({
        key: 'strategy',
        label: 'Strategy',
        ability: 'INT',
        summary: 'Plan assaults, out-think rival tacticians, or solve multi-step puzzles.',
    }),
    Object.freeze({
        key: 'awareness',
        label: 'Awareness',
        ability: 'WIS',
        summary: 'Spot ambushes, hear whispered plots, or sense magical auras.',
    }),
    Object.freeze({
        key: 'insight',
        label: 'Insight',
        ability: 'WIS',
        summary: 'Read motives, detect lies, or intuit a demon’s mood before it speaks.',
    }),
    Object.freeze({
        key: 'medicine',
        label: 'Medicine',
        ability: 'WIS',
        summary: 'Staunch bleeding, perform field surgery, or diagnose occult afflictions.',
    }),
    Object.freeze({
        key: 'survival',
        label: 'Survival',
        ability: 'WIS',
        summary: 'Track prey, forage safe food, or navigate wild lands without maps.',
    }),
    Object.freeze({
        key: 'negotiation',
        label: 'Negotiation',
        ability: 'CHA',
        summary: 'Broker truces, haggle with demons, or charm bureaucrats into helping.',
    }),
    Object.freeze({
        key: 'deception',
        label: 'Deception',
        ability: 'CHA',
        summary: 'Maintain a cover story, forge documents, or bluff through high stakes.',
    }),
    Object.freeze({
        key: 'performance',
        label: 'Performance',
        ability: 'CHA',
        summary: 'Rally crowds, keep morale high, or distract foes with a show.',
    }),
    Object.freeze({
        key: 'streetwise',
        label: 'Streetwise',
        ability: 'CHA',
        summary: 'Leverage contacts, gather rumours, or navigate underworld etiquette.',
    }),
]);

export const DEFAULT_WORLD_SKILLS = Object.freeze(
    DEFAULT_WORLD_SKILL_DEFS.map((skill) =>
        Object.freeze({
            id: skill.key,
            key: skill.key,
            label: skill.label,
            ability: skill.ability,
        })
    )
);
