export const DEFAULT_WORLD_SKILL_DEFS = Object.freeze([
    Object.freeze({
        key: 'appraise',
        label: 'Appraise',
        ability: 'INT',
        summary: 'Evaluate an item’s value, craftsmanship, or authenticity.',
    }),
    Object.freeze({
        key: 'balance',
        label: 'Balance',
        ability: 'DEX',
        summary: 'Stay upright on ledges, tightropes, or other treacherous footing.',
    }),
    Object.freeze({
        key: 'bluff',
        label: 'Bluff',
        ability: 'CHA',
        summary: 'Tell convincing lies, feint in combat, or mislead suspicious minds.',
    }),
    Object.freeze({
        key: 'climb',
        label: 'Climb',
        ability: 'STR',
        summary: 'Scale walls, cling to sheer surfaces, or haul yourself up ropes.',
    }),
    Object.freeze({
        key: 'concentration',
        label: 'Concentration',
        ability: 'CON',
        summary: 'Maintain focus when casting, enduring pain, or working under duress.',
    }),
    Object.freeze({
        key: 'craft1',
        label: 'Craft —',
        ability: 'INT',
        summary: 'Create specialised goods; rename this entry to note the chosen trade.',
    }),
    Object.freeze({
        key: 'craft2',
        label: 'Craft —',
        ability: 'INT',
        summary: 'Create specialised goods; rename this entry to note the chosen trade.',
    }),
    Object.freeze({
        key: 'craft3',
        label: 'Craft —',
        ability: 'INT',
        summary: 'Create specialised goods; rename this entry to note the chosen trade.',
    }),
    Object.freeze({
        key: 'diplomacy',
        label: 'Diplomacy',
        ability: 'CHA',
        summary: 'Negotiate deals, broker peace, or smooth over tense social scenes.',
    }),
    Object.freeze({
        key: 'disguise',
        label: 'Disguise',
        ability: 'CHA',
        summary: 'Adopt false identities, impersonate others, or conceal your appearance.',
    }),
    Object.freeze({
        key: 'forgery',
        label: 'Forgery',
        ability: 'INT',
        summary: 'Produce convincing documents, signatures, and official seals.',
    }),
    Object.freeze({
        key: 'escapeArtist',
        label: 'Escape Artist',
        ability: 'DEX',
        summary: 'Slip free from restraints, squeeze through gaps, or wriggle out of bonds.',
    }),
    Object.freeze({
        key: 'gatherInformation',
        label: 'Gather Information',
        ability: 'CHA',
        summary: 'Work a crowd, pick up rumours, or coax secrets from reluctant sources.',
    }),
    Object.freeze({
        key: 'hide',
        label: 'Hide',
        ability: 'DEX',
        summary: 'Blend into cover, avoid detection, or remain unseen in plain sight.',
    }),
    Object.freeze({
        key: 'intimidate',
        label: 'Intimidate',
        ability: 'CHA',
        summary: 'Bully foes, extract information, or cow onlookers with sheer presence.',
    }),
    Object.freeze({
        key: 'jump',
        label: 'Jump',
        ability: 'STR',
        summary: 'Leap across gaps, vault obstacles, or clear hazardous terrain.',
    }),
    Object.freeze({
        key: 'listen',
        label: 'Listen',
        ability: 'WIS',
        summary: 'Hear faint noises, eavesdrop on whispers, or detect approaching threats.',
    }),
    Object.freeze({
        key: 'moveSilently',
        label: 'Move Silently',
        ability: 'DEX',
        summary: 'Advance without sound, stalk prey, or infiltrate guarded areas.',
    }),
    Object.freeze({
        key: 'ride',
        label: 'Ride',
        ability: 'DEX',
        summary: 'Control mounts, stay saddled under duress, or perform mounted stunts.',
    }),
    Object.freeze({
        key: 'search',
        label: 'Search',
        ability: 'INT',
        summary: 'Detect hidden compartments, find traps, or locate small clues.',
    }),
    Object.freeze({
        key: 'senseMotive',
        label: 'Sense Motive',
        ability: 'WIS',
        summary: 'Read intentions, detect lies, or gauge a creature’s true feelings.',
    }),
    Object.freeze({
        key: 'spot',
        label: 'Spot',
        ability: 'WIS',
        summary: 'Notice distant movement, small details, or concealed hazards.',
    }),
    Object.freeze({
        key: 'swim',
        label: 'Swim',
        ability: 'STR',
        summary: 'Navigate water, fight currents, or stay afloat in dangerous conditions.',
    }),
    Object.freeze({
        key: 'useRope',
        label: 'Use Rope',
        ability: 'DEX',
        summary: 'Tie knots, secure gear, or swing across gaps with practiced ease.',
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
