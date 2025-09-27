export const FUSION_ARCANA_METADATA = [
    { key: "fool", label: "Fool" },
    { key: "magician", label: "Magician" },
    { key: "priestess", label: "Priestess" },
    { key: "empress", label: "Empress" },
    { key: "emperor", label: "Emperor" },
    { key: "hierophant", label: "Hierophant" },
    { key: "lovers", label: "Lovers" },
    { key: "chariot", label: "Chariot" },
    { key: "justice", label: "Justice" },
    { key: "hermit", label: "Hermit" },
    { key: "fortune", label: "Fortune" },
    { key: "strength", label: "Strength" },
    { key: "hanged", label: "Hanged", aliases: ["hanged man"] },
    { key: "death", label: "Death" },
    { key: "temperance", label: "Temperance" },
    { key: "devil", label: "Devil" },
    { key: "tower", label: "Tower" },
    { key: "star", label: "Star" },
    { key: "moon", label: "Moon" },
    { key: "sun", label: "Sun" },
    { key: "judgement", label: "Judgement", aliases: ["judgment"] },
    { key: "aeon", label: "Aeon" },
    { key: "jester", label: "Jester" },
];

export const FUSE_ARCANA_ORDER = FUSION_ARCANA_METADATA.map((entry) => entry.key);

export const FUSE_ARCANA_LABEL_BY_KEY = new Map(
    FUSION_ARCANA_METADATA.map((entry) => [entry.key, entry.label]),
);

const FUSE_ARCANA_KEY_BY_LABEL_ENTRIES = [];
for (const entry of FUSION_ARCANA_METADATA) {
    const base = entry.label.toLowerCase();
    FUSE_ARCANA_KEY_BY_LABEL_ENTRIES.push([base, entry.key]);
    FUSE_ARCANA_KEY_BY_LABEL_ENTRIES.push([entry.key.toLowerCase(), entry.key]);
    if (Array.isArray(entry.aliases)) {
        for (const alias of entry.aliases) {
            if (!alias) continue;
            FUSE_ARCANA_KEY_BY_LABEL_ENTRIES.push([alias.toLowerCase(), entry.key]);
        }
    }
}

export const FUSE_ARCANA_KEY_BY_LABEL = new Map(FUSE_ARCANA_KEY_BY_LABEL_ENTRIES);

function buildFuseChart() {
    const chart = {};
    for (let row = 0; row < FUSE_ARCANA_ORDER.length; row += 1) {
        const rowKey = FUSE_ARCANA_ORDER[row];
        chart[rowKey] = {};
        for (let col = 0; col < FUSE_ARCANA_ORDER.length; col += 1) {
            const colKey = FUSE_ARCANA_ORDER[col];
            const avgIndex = Math.round((row + col) / 2);
            chart[rowKey][colKey] = FUSE_ARCANA_ORDER[avgIndex];
        }
    }
    return chart;
}

export const FUSE_CHART = buildFuseChart();
