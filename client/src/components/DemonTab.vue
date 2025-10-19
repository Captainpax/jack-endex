<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">Demon companions</h3>
        </header>
        <p v-if="!demonCards.length" class="panel__placeholder">No demons summoned.</p>
        <div v-else class="demon-grid">
            <article v-for="card in demonCards" :key="card.demon.id || card.demon.name" class="demon-card">
                <DemonImage :src="card.demon.image" :name="card.demon.name" :caption="card.demon.archetype || card.arcana" />
                <div class="demon-card__body">
                    <div class="demon-card__header">
                        <div class="demon-card__title-group">
                            <h4>{{ card.demon.name }}</h4>
                            <div class="demon-card__tags">
                                <span v-if="card.arcana" class="demon-card__tag">{{ card.arcana }}</span>
                                <span v-if="card.alignment" class="demon-card__tag">{{ card.alignment }}</span>
                                <span v-if="card.role" class="demon-card__tag">{{ card.role }}</span>
                            </div>
                        </div>
                        <div v-if="card.level !== null" class="demon-card__level">Lv {{ card.level }}</div>
                    </div>

                    <details v-if="card.description" class="demon-card__section" :open="!card.shouldCollapseDescription">
                        <summary>Description</summary>
                        <p class="demon-card__desc">{{ card.description }}</p>
                    </details>

                    <div v-if="card.abilityMods.length" class="demon-card__mods">
                        <span
                            v-for="mod in card.abilityMods"
                            :key="mod.key"
                            class="mod-chip"
                            :class="{
                                'is-positive': mod.value > 0,
                                'is-negative': mod.value < 0,
                                'is-neutral': mod.value === 0,
                            }"
                        >
                            <span class="mod-chip__label">{{ mod.key }}</span>
                            <span class="mod-chip__value">{{ mod.display }}</span>
                        </span>
                    </div>

                    <details v-if="card.hasResistances" class="demon-card__section" :open="card.autoOpenAffinities">
                        <summary>
                            <span>Affinities</span>
                            <div class="demon-card__affinity-summary">
                                <span
                                    v-for="affinity in card.affinitySummary.slice(0, 4)"
                                    :key="affinity.key"
                                    class="affinity-chip"
                                    :class="affinity.className"
                                >
                                    {{ affinity.label }}
                                </span>
                                <span v-if="card.affinitySummary.length > 4" class="affinity-chip is-more">
                                    +{{ card.affinitySummary.length - 4 }}
                                </span>
                            </div>
                        </summary>
                        <dl class="demon-card__affinity-grid">
                            <div v-for="group in card.affinityEntries" :key="group.key" class="demon-card__affinity-row">
                                <dt>{{ group.label }}</dt>
                                <dd>
                                    <span
                                        v-for="(value, index) in group.values"
                                        :key="`${group.key}-${value}-${index}`"
                                        class="affinity-chip"
                                        :class="group.className"
                                    >
                                        {{ value }}
                                    </span>
                                </dd>
                            </div>
                        </dl>
                    </details>

                    <details v-if="card.skills.length" class="demon-card__section" :open="card.autoOpenSkills">
                        <summary>
                            <span>
                                Skills
                                <span class="demon-card__count">({{ card.skills.length }})</span>
                            </span>
                        </summary>
                        <ul class="demon-card__skill-list">
                            <li v-for="skill in card.skills" :key="skill.key" class="demon-card__skill-item">
                                <div class="demon-card__skill-header">
                                    <span class="demon-card__skill-name">{{ skill.name }}</span>
                                    <span v-if="skill.details.length" class="demon-card__skill-meta">
                                        {{ skill.details.join(' • ') }}
                                    </span>
                                </div>
                                <p v-if="skill.notes" class="demon-card__skill-notes">{{ skill.notes }}</p>
                            </li>
                        </ul>
                    </details>

                    <details v-if="card.notes" class="demon-card__section" :open="!card.shouldCollapseNotes">
                        <summary>Notes</summary>
                        <p class="demon-card__notes">{{ card.notes }}</p>
                    </details>
                </div>
            </article>
        </div>
    </section>
</template>

<script setup>
import { computed } from 'vue';
import DemonImage from './DemonImage.vue';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
});

const abilityKeys = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const resistanceGroups = [
    { key: 'weak', label: 'Weak', className: 'is-weak' },
    { key: 'resist', label: 'Resist', className: 'is-resist' },
    { key: 'block', label: 'Block', className: 'is-block' },
    { key: 'drain', label: 'Drain', className: 'is-drain' },
    { key: 'reflect', label: 'Reflect', className: 'is-reflect' },
];

const demons = computed(() => {
    const list = props.game?.demons;
    if (Array.isArray(list)) return list;
    if (list && typeof list === 'object') return Object.values(list);
    return [];
});

function safeString(value) {
    if (typeof value === 'string') return value.trim();
    return '';
}

function parseFiniteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const num = Number(trimmed);
        if (Number.isFinite(num)) return num;
    }
    return null;
}

function shouldCollapseText(text) {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    return trimmed.length > 160 || trimmed.includes('\n');
}

function toStringArray(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => {
                if (typeof entry === 'string') return entry.trim();
                if (entry === null || entry === undefined) return '';
                return String(entry).trim();
            })
            .filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(/[,/]/)
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    return [];
}

function formatAbilityMods(demon) {
    const mods = demon?.mods || {};
    return abilityKeys
        .map((key) => {
            const raw = mods?.[key];
            if (raw === null || raw === undefined || raw === '') return null;
            const value = Number(raw);
            if (!Number.isFinite(value)) return null;
            return {
                key,
                value,
                display: value > 0 ? `+${value}` : `${value}`,
            };
        })
        .filter(Boolean);
}

function buildResistanceData(demon) {
    const source = demon?.resistances || {};
    const entries = [];
    const summary = [];
    let count = 0;

    resistanceGroups.forEach((group) => {
        const values = toStringArray(source?.[group.key]);
        if (values.length) {
            entries.push({
                key: group.key,
                label: group.label,
                className: group.className,
                values,
            });
            values.forEach((value, index) => {
                summary.push({
                    key: `${group.key}-${value}-${index}`,
                    label: value,
                    className: group.className,
                });
            });
            count += values.length;
        }
    });

    return { entries, summary, count };
}

const skillNameFields = ['name', 'label', 'skill', 'title'];
const skillNotesFields = ['notes', 'note', 'description', 'desc'];
const skillTypeFields = ['type', 'element', 'category', 'kind'];

function formatCost(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && Number.isFinite(value)) return `Cost ${value}`;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed;
    }
    return '';
}

function normalizeSkill(entry, index) {
    if (!entry) return null;
    if (typeof entry === 'string') {
        const name = entry.trim();
        if (!name) return null;
        return {
            key: `skill-${index}-${name}`,
            name,
            details: [],
            notes: '',
        };
    }
    if (typeof entry === 'object') {
        const nameCandidate = skillNameFields
            .map((field) => entry?.[field])
            .find((value) => typeof value === 'string' && value.trim());
        const name = nameCandidate ? nameCandidate.trim() : '';

        const levelCandidate =
            entry.level ?? entry.requiredLevel ?? entry.rank ?? entry.unlock ?? entry.levelRequired ?? entry.minLevel;
        const level = parseFiniteNumber(levelCandidate);

        const costCandidate = entry.cost ?? entry.mp ?? entry.mpCost ?? entry.hpCost ?? entry.tpCost ?? entry.spCost;
        const cost = formatCost(costCandidate);

        const typeCandidate = skillTypeFields
            .map((field) => entry?.[field])
            .find((value) => typeof value === 'string' && value.trim());

        const details = [];
        if (level !== null) details.push(`Lv ${level}`);
        if (cost) details.push(cost);
        if (typeCandidate) details.push(typeCandidate.trim());

        const notesCandidate = skillNotesFields
            .map((field) => entry?.[field])
            .find((value) => typeof value === 'string' && value.trim());

        const keyCandidate =
            entry.id ?? entry.slug ?? entry.key ?? entry.code ?? (name ? `skill-${index}-${name}` : `skill-${index}`);

        return {
            key: String(keyCandidate),
            name: name || `Skill ${index + 1}`,
            details,
            notes: notesCandidate ? notesCandidate.trim() : '',
        };
    }
    return null;
}

function normalizeNotes(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => {
                if (typeof entry === 'string') return entry.trim();
                if (entry === null || entry === undefined) return '';
                return String(entry).trim();
            })
            .filter(Boolean)
            .join('\n');
    }
    if (typeof value === 'string') return value.trim();
    return '';
}

const demonCards = computed(() =>
    demons.value.map((demon) => {
        const abilityMods = formatAbilityMods(demon);
        const { entries: affinityEntries, summary: affinitySummary, count: affinityCount } = buildResistanceData(demon);
        const skills = (Array.isArray(demon?.skills) ? demon.skills : [])
            .map((entry, index) => normalizeSkill(entry, index))
            .filter(Boolean);
        const description = safeString(demon?.description);
        const notes = normalizeNotes(demon?.notes);
        const level = parseFiniteNumber(demon?.level);
        const arcana = safeString(demon?.arcana);
        const alignment = safeString(demon?.alignment);
        const role = safeString(demon?.role);

        return {
            demon,
            arcana,
            alignment,
            role,
            level,
            description,
            notes,
            abilityMods,
            affinityEntries,
            affinitySummary,
            affinityCount,
            hasResistances: affinityEntries.length > 0,
            autoOpenAffinities: affinityCount > 0 && affinityCount <= 4,
            skills,
            autoOpenSkills: skills.length > 0 && skills.length <= 4,
            shouldCollapseDescription: shouldCollapseText(description),
            shouldCollapseNotes: shouldCollapseText(notes),
        };
    }),
);
</script>

<style scoped>
.panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.panel__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.panel__title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
}

.demon-grid {
    display: grid;
    gap: 1.25rem;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.demon-card {
    background: rgba(12, 15, 30, 0.6);
    border-radius: 1rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.demon-card__body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.demon-card__body h4 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
}

.demon-card__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
}

.demon-card__title-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.demon-card__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

.demon-card__tag {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    padding: 0.15rem 0.6rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.75);
}

.demon-card__level {
    background: rgba(250, 204, 21, 0.1);
    color: #facc15;
    border: 1px solid rgba(250, 204, 21, 0.4);
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
}

.demon-card__section {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.75rem;
    padding: 0.75rem;
    background: rgba(18, 24, 45, 0.6);
}

.demon-card__section + .demon-card__section {
    margin-top: -0.25rem;
}

.demon-card__section summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    list-style: none;
    cursor: pointer;
    font-weight: 600;
}

.demon-card__section summary::-webkit-details-marker {
    display: none;
}

.demon-card__section summary::after {
    content: '▾';
    font-size: 0.8rem;
    opacity: 0.6;
    transition: transform 0.2s ease;
}

.demon-card__section[open] summary::after {
    transform: rotate(-180deg);
}

.demon-card__section[open] summary {
    margin-bottom: 0.5rem;
}

.demon-card__desc {
    margin: 0;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.8);
    white-space: pre-wrap;
}

.demon-card__mods {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.mod-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.65rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.85);
}

.mod-chip.is-positive {
    border-color: rgba(74, 222, 128, 0.5);
    background: rgba(34, 197, 94, 0.12);
    color: #4ade80;
}

.mod-chip.is-negative {
    border-color: rgba(248, 113, 113, 0.5);
    background: rgba(248, 113, 113, 0.12);
    color: #f87171;
}

.mod-chip.is-neutral {
    color: rgba(255, 255, 255, 0.6);
}

.mod-chip__label {
    letter-spacing: 0.05em;
}

.mod-chip__value {
    font-variant-numeric: tabular-nums;
}

.demon-card__affinity-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    justify-content: flex-end;
}

.affinity-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid transparent;
}

.affinity-chip.is-weak {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
    color: #f87171;
}

.affinity-chip.is-resist {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.4);
    color: #34d399;
}

.affinity-chip.is-block {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.4);
    color: #60a5fa;
}

.affinity-chip.is-drain {
    background: rgba(147, 51, 234, 0.15);
    border-color: rgba(147, 51, 234, 0.4);
    color: #c084fc;
}

.affinity-chip.is-reflect {
    background: rgba(253, 186, 116, 0.15);
    border-color: rgba(253, 186, 116, 0.4);
    color: #fcd34d;
}

.affinity-chip.is-more {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.75);
}

.demon-card__affinity-grid {
    display: grid;
    gap: 0.5rem;
}

.demon-card__affinity-row {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 0.5rem;
    align-items: center;
}

.demon-card__affinity-row dt {
    margin: 0;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.6);
}

.demon-card__affinity-row dd {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

.demon-card__count {
    margin-left: 0.4rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.65);
}

.demon-card__skill-list {
    margin: 0;
    padding-left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.88rem;
}

.demon-card__skill-item {
    list-style: disc;
}

.demon-card__skill-header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: baseline;
}

.demon-card__skill-name {
    font-weight: 600;
}

.demon-card__skill-meta {
    color: rgba(255, 255, 255, 0.65);
    font-size: 0.78rem;
}

.demon-card__skill-notes {
    margin: 0.35rem 0 0;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.78rem;
    white-space: pre-wrap;
}

.demon-card__notes {
    margin: 0;
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.88rem;
    white-space: pre-wrap;
}

.panel__placeholder {
    color: rgba(255, 255, 255, 0.6);
}
</style>
