// --- FILE: client/src/constants/referenceContent.js ---
// Reference snippets adapted from the Battlemath and Character Creation txtdocs.
// Provides quick summaries so the UI can surface the table rules without opening the raw files.

import { DEFAULT_WORLD_SKILL_DEFS } from "@shared/worldSkills.js";
import { ABILITY_DEFS } from "./gameData";

const WORLD_SKILL_DISCIPLINES = Object.freeze(
    ABILITY_DEFS.map((ability) => {
        const skills = DEFAULT_WORLD_SKILL_DEFS.filter(
            (skill) => skill.ability === ability.key
        ).map((skill) => ({
            key: skill.key,
            label: skill.label,
            summary: skill.summary,
        }));
        if (skills.length === 0) return null;
        return Object.freeze({
            ability: ability.key,
            label: ability.label,
            summary: ability.summary,
            skills: Object.freeze(skills),
        });
    }).filter(Boolean)
);

export const BATTLE_MATH_REFERENCE = Object.freeze({
    overview:
        "Roll Accuracy → Roll Attack → Add weapon attack or subtract enemy armor → Multiply by affinities and buffs.",
    accuracy: Object.freeze({
        title: "Accuracy checks",
        formula: "1d20 + ACC − EVA",
        notes: [
            "Physical attacks use Accuracy against the target's Evasion.",
            "Magical attacks use Magic Accuracy against Magic Evasion.",
            "Ailments contest the defender's CON modifier instead of Evasion.",
            "A 20 is a critical (+75% damage) and a 1 is a critical miss.",
            "If a skill has a secondary effect, roll 1d20 for it during the accuracy step.",
        ],
    }),
    damage: Object.freeze({
        title: "Damage rolls",
        formula: "(Attack roll + ATK − DEF) × Buff%",
        notes: [
            "Physical attacks rely on ATK versus DEF. Magical attacks use Magic Attack versus Magic Defense.",
            "Apply weapon bonuses before multiplying buffs, weaknesses, and resistances.",
            "Unarmed attacks deal 1d4 + STR strike damage.",
            "Gun skills cost one bullet per hit in addition to MP/TP.",
        ],
    }),
    tiers: Object.freeze([
        { tier: "Weak", example: "Zio", dice: "1d6", modifier: "MOD" },
        { tier: "Medium", example: "Zionga", dice: "2d8", modifier: "MOD × 2" },
        { tier: "Heavy", example: "Ziodyne", dice: "3d12", modifier: "MOD × 3" },
        { tier: "Severe", example: "Ziobarion", dice: "4d20", modifier: "MOD × 4" },
    ]),
    skillNotes: Object.freeze([
        "Skills replace the weapon's basic attack but keep any flat attack and accuracy bonuses.",
        "Multi-hit skills apply the ability modifier on every hit; basic attack multi-hits only add it once.",
        "Criticals multiply the post-roll damage by 1.75. Apply buffs after resolving individual hits.",
        "DM judgement calls the target number; 10 is considered an average difficulty.",
    ]),
});

export const WORLD_SKILL_REFERENCE = Object.freeze({
    summary:
        "Skill Points (SP) fuel world skills. Spend them immediately to train the pink-box disciplines listed on the character sheet.",
    formulas: Object.freeze([
        { label: "HP", formula: "17 + CON + (STR ÷ 2)" },
        { label: "MP", formula: "17 + INT + (WIS ÷ 2)" },
        { label: "TP", formula: "7 + DEX + (CON ÷ 2)" },
        { label: "SP", formula: "((5 + INT) × 2) + CHA" },
    ]),
    guidelines: Object.freeze([
        "Always round up when applying these resource formulas and never let gains drop below 1.",
        "SP must be spent immediately on world skills when gained; they cannot be banked.",
        "Maximum rank equals level × 2 + 2 (minimum 4 at level 1).",
        "Skills below the pink divider are DM-awarded or require in-game training.",
    ]),
    tips: Object.freeze([
        "Keep an eye on ability modifiers—every skill adds its linked ability mod, trained ranks, and miscellaneous bonuses.",
        "DMs can remove ranks with the take-away action if downtime or events strip training.",
    ]),
    disciplines: Object.freeze(WORLD_SKILL_DISCIPLINES),
});
