const ROLE_DM = "dm";
const ROLE_PLAYER = "player";

const FALLBACK_ROLE_LABEL_ORDER = [ROLE_DM, ROLE_PLAYER, "default"];

const NAV_ITEMS = [
    {
        key: "overview",
        roles: [ROLE_DM],
        label: { [ROLE_DM]: "DM Overview" },
        description: {
            [ROLE_DM]: "Monitor the party at a glance",
        },
    },
    {
        key: "map",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: {
            [ROLE_DM]: "Battle Map",
            [ROLE_PLAYER]: "Battle Map",
        },
        description: {
            [ROLE_DM]: "Sketch encounters and track tokens",
            [ROLE_PLAYER]: "Follow encounters in real time",
        },
    },
    {
        key: "sheet",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: {
            [ROLE_DM]: "Character Sheets",
            [ROLE_PLAYER]: "My Character",
        },
        description: {
            [ROLE_DM]: "Review and update any adventurer",
            [ROLE_PLAYER]: "Update your stats and background",
        },
    },
    {
        key: "party",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: {
            [ROLE_DM]: "Party Roster",
            [ROLE_PLAYER]: "Party View",
        },
        description: {
            [ROLE_DM]: "Health, levels, and quick switches",
            [ROLE_PLAYER]: "See who fights beside you",
        },
    },
    {
        key: "items",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: {
            [ROLE_DM]: "Item Library",
            [ROLE_PLAYER]: "Party Stash",
        },
        description: {
            [ROLE_DM]: "Craft and assign loot",
            [ROLE_PLAYER]: "Shared loot curated for the party",
        },
    },
    {
        key: "gear",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: {
            [ROLE_DM]: "Gear Locker",
            [ROLE_PLAYER]: "My Gear",
        },
        description: {
            [ROLE_DM]: "Track equipped slots",
            [ROLE_PLAYER]: "Weapons, armor, and accessories",
        },
    },
    {
        key: "worldSkills",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: {
            [ROLE_DM]: "World Skills",
            [ROLE_PLAYER]: "World Skills",
        },
        description: {
            [ROLE_DM]: "Review party proficiencies",
            [ROLE_PLAYER]: "Ranks, modifiers, and totals",
        },
    },
    {
        key: "combatSkills",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: {
            [ROLE_DM]: "Combat Skills",
            [ROLE_PLAYER]: "Combat Skills",
        },
        description: {
            [ROLE_DM]: "Build combat formulas and helpers",
            [ROLE_PLAYER]: "Damage calculators and tier references",
        },
    },
    {
        key: "demons",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: {
            [ROLE_DM]: "Demon Codex",
            [ROLE_PLAYER]: "Demon Companions",
        },
        description: {
            [ROLE_DM]: "Summoned allies and spirits",
            [ROLE_PLAYER]: "Track your summoned allies",
        },
    },
    {
        key: "storyLogs",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: {
            [ROLE_DM]: "Story Logs",
            [ROLE_PLAYER]: "Story Logs",
        },
        description: {
            [ROLE_DM]: "Read the shared Discord story log",
            [ROLE_PLAYER]: "Catch up on the Discord channel",
        },
    },
    {
        key: "settings",
        roles: [ROLE_DM],
        label: { [ROLE_DM]: "Campaign Settings" },
        description: {
            [ROLE_DM]: "Permissions and dangerous actions",
        },
    },
    {
        key: "help",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: {
            [ROLE_DM]: "Help & Docs",
            [ROLE_PLAYER]: "Help & Docs",
        },
        description: {
            [ROLE_DM]: "Open quick rules and reference guides",
            [ROLE_PLAYER]: "Open quick rules and reference guides",
        },
    },
    {
        key: "serverManagement",
        roles: [ROLE_DM, ROLE_PLAYER],
        label: { default: "Server Management" },
        description: {
            default: "Administer users, games, demons, and bots",
        },
        requireAdmin: true,
    },
];

function resolveCopy(copy, role) {
    if (!copy) return "";
    if (typeof copy === "string") return copy;
    if (copy[role]) return copy[role];
    for (const fallback of FALLBACK_ROLE_LABEL_ORDER) {
        if (copy[fallback]) return copy[fallback];
    }
    const values = Object.values(copy);
    return values.length > 0 ? values[0] : "";
}

export function buildNavigation({ role, isServerAdmin = false, availableKeys = null }) {
    const normalizedRole = role === ROLE_DM ? ROLE_DM : ROLE_PLAYER;
    const allowedKeys =
        availableKeys && typeof availableKeys[Symbol.iterator] === "function"
            ? new Set(availableKeys)
            : null;

    return NAV_ITEMS.filter((item) => {
        if (!item.roles.includes(normalizedRole)) return false;
        if (item.requireAdmin && !isServerAdmin) return false;
        if (allowedKeys && !allowedKeys.has(item.key)) return false;
        return true;
    }).map((item) => ({
        key: item.key,
        label: resolveCopy(item.label, normalizedRole) || item.key,
        description: resolveCopy(item.description, normalizedRole),
    }));
}

export const NAVIGATION_DEFINITIONS = NAV_ITEMS;
