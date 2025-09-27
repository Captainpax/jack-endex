import fs from "node:fs/promises";
import path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const rootDir = path.resolve(__dirname, "..");
const inputPath = path.join(rootDir, "shared", "data", "combatSkillGlossary.txt");
const outputPath = path.join(rootDir, "shared", "combatSkills.js");

const SECTION_META = {
    Strike: { ability: "STR", category: "physical" },
    Slash: { ability: "STR", category: "physical" },
    Pierce: { ability: "STR", category: "physical" },
    Gun: { ability: "DEX", category: "gun" },
    Fire: { ability: "INT", category: "spell" },
    Ice: { ability: "INT", category: "spell" },
    Electricity: { ability: "INT", category: "spell" },
    Wind: { ability: "INT", category: "spell" },
    Psychic: { ability: "INT", category: "spell" },
    Nuclear: { ability: "INT", category: "spell" },
    Earth: { ability: "INT", category: "spell" },
    Gravity: { ability: "INT", category: "spell" },
    Force: { ability: "INT", category: "spell" },
    Bless: { ability: "INT", category: "spell" },
    Curse: { ability: "INT", category: "spell" },
    Light: { ability: "INT", category: "spell" },
    Dark: { ability: "INT", category: "spell" },
    Almighty: { ability: "INT", category: "spell" },
    "Healing and Revives": { ability: "WIS", category: "support" },
    "Buffs and Debuffs": { ability: "WIS", category: "support" },
    "Ailments and Cures": { ability: "WIS", category: "support" },
    Passives: { ability: "WIS", category: "support" },
    "Misc.": { ability: "WIS", category: "support" },
};

const GROUP_META = {
    "Physical Skills": { ability: "STR", category: "physical" },
    "Magical Spells": { ability: "INT", category: "spell" },
    "Heals and Support": { ability: "WIS", category: "support" },
    "Passives and Misc": { ability: "WIS", category: "support" },
};

function slugify(label) {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function formatCost(value) {
    const raw = value.trim();
    if (!raw) return "";
    const upper = raw.toUpperCase();
    if (/^\d+(MP|HP|TP)$/.test(upper)) {
        return upper.replace(/(\d+)([A-Z]+)/, "$1 $2");
    }
    if (/^\d+\s*(MP|HP|TP)$/i.test(raw)) {
        return raw.replace(/\s+/g, " ").toUpperCase();
    }
    return raw.replace(/\s+/g, " ");
}

function inferTier(description) {
    const match = description.match(/\b(Weak|Medium|Heavy|Severe)\b/i);
    if (!match) return "WEAK";
    return match[1].toUpperCase();
}

function mergeNotes(...parts) {
    return parts
        .map((part) => (part || "").trim())
        .filter(Boolean)
        .join(" ");
}

function normalizeDescription(text) {
    return text.replace(/\s+/g, " ").trim();
}

async function main() {
    const raw = await fs.readFile(inputPath, "utf8");
    const lines = raw.split(/\r?\n/);

    let currentGroup = null;
    let groupBuffer = [];
    let groupNotes = "";
    let currentSection = null;
    let sectionBuffer = [];
    let sectionNotes = "";
    const entries = [];
    const seenIds = new Set();

    function resolveMeta() {
        const sectionMeta = SECTION_META[currentSection] || {};
        const groupMeta = GROUP_META[currentGroup] || {};
        const ability = sectionMeta.ability || groupMeta.ability || "STR";
        const category = sectionMeta.category || groupMeta.category || "physical";
        return { ability, category };
    }

    function finalizeGroupNotes() {
        if (groupNotes) return;
        if (groupBuffer.length === 0) return;
        groupNotes = normalizeDescription(groupBuffer.join(" "));
        groupBuffer = [];
    }

    function finalizeSectionNotes() {
        if (sectionBuffer.length === 0) {
            if (!sectionNotes) {
                sectionNotes = mergeNotes(groupNotes);
            }
            return;
        }
        const text = normalizeDescription(sectionBuffer.join(" "));
        sectionNotes = mergeNotes(groupNotes, text);
        sectionBuffer = [];
    }

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        if (/^\+[-+]+\+$/.test(trimmed)) {
            continue;
        }
        const groupMatch = /^\|\s*(.+?)\s*\|$/.exec(trimmed);
        if (groupMatch) {
            currentGroup = groupMatch[1];
            groupBuffer = [];
            groupNotes = "";
            currentSection = null;
            sectionBuffer = [];
            sectionNotes = "";
            continue;
        }
        const sectionMatch = /[-=]+>[-=]*([^<>=-]+?)[-=]*<[-=]+/.exec(trimmed);
        if (sectionMatch) {
            finalizeGroupNotes();
            currentSection = sectionMatch[1].trim();
            sectionBuffer = [];
            sectionNotes = "";
            continue;
        }
        if (
            trimmed.includes("NAME") &&
            trimmed.includes("DESCRIPTION") &&
            trimmed.includes("|")
        ) {
            finalizeGroupNotes();
            finalizeSectionNotes();
            continue;
        }
        if (/^[\s-]+\|[\s-]+/.test(trimmed)) {
            continue;
        }
        if (trimmed.includes("|")) {
            const parts = line.split("|").map((part) => part.trim());
            const filtered = parts.filter((part) => part.length > 0);
            if (filtered.length === 0) continue;
            if (filtered.every((part) => /^-+$/.test(part))) {
                continue;
            }
            if (filtered.length === 1) {
                sectionBuffer.push(filtered[0]);
                continue;
            }
            if (filtered[0].toUpperCase() === "NAME" && filtered.includes("DESCRIPTION")) {
                finalizeSectionNotes();
                continue;
            }
            finalizeGroupNotes();
            finalizeSectionNotes();
            const meta = resolveMeta();
            let name = parts[0].trim();
            if (!name) continue;
            let cost = "";
            let description = "";
            if (parts.length >= 3) {
                cost = parts[1].trim();
                description = parts.slice(2).join(" ").trim();
            } else if (parts.length === 2) {
                description = parts[1].trim();
            } else {
                description = filtered.slice(1).join(" ");
            }
            cost = formatCost(cost || "");
            description = normalizeDescription(description);
            const tier = inferTier(description);
            const notes = mergeNotes(description, sectionNotes);
            let idBase = slugify(name);
            if (!idBase) {
                idBase = `skill-${Math.random().toString(36).slice(2, 8)}`;
            }
            let id = idBase;
            let attempt = 1;
            while (seenIds.has(id)) {
                attempt += 1;
                id = `${idBase}-${attempt}`;
            }
            seenIds.add(id);
            entries.push({
                id,
                label: name,
                ability: meta.ability,
                tier,
                category: meta.category,
                cost,
                notes,
                source: {
                    group: currentGroup,
                    section: currentSection,
                },
            });
            continue;
        }
        if (currentSection) {
            sectionBuffer.push(trimmed);
        } else if (currentGroup) {
            groupBuffer.push(trimmed);
        }
    }

    const sorted = entries.sort((a, b) => a.label.localeCompare(b.label));

    const fileContents = `// Auto-generated by scripts/buildCombatSkillLibrary.mjs\nexport const COMBAT_SKILL_LIBRARY = ${JSON.stringify(sorted, null, 4)};\n\nconst COMBAT_SKILL_ID_LOOKUP = new Map(COMBAT_SKILL_LIBRARY.map((entry) => [entry.id, entry]));\n\nexport function findCombatSkillByName(name) {\n    if (!name || typeof name !== \"string\") return null;\n    const lower = name.trim().toLowerCase();\n    return COMBAT_SKILL_LIBRARY.find((entry) => entry.label.toLowerCase() === lower) || null;\n}\n\nexport function findCombatSkillById(id) {\n    if (!id || typeof id !== \"string\") return null;\n    return COMBAT_SKILL_ID_LOOKUP.get(id.trim()) || null;\n}\n`;

    await fs.writeFile(outputPath, fileContents);
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
