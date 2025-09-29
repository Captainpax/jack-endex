import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Games, StoryLogs } from "../../api";
import useBattleLogger from "../../hooks/useBattleLogger";
import RealtimeContext from "../../contexts/RealtimeContext";
import DemonImage from "../DemonImage";
import { MAP_DEFAULT_SETTINGS, mapReadBoolean, describePlayerName } from "./mapShared";

const MAP_BRUSH_COLORS = ['#f97316', '#38bdf8', '#a855f7', '#22c55e', '#f472b6'];
const MAP_BRUSH_STORAGE_KEY = 'battlemap.brushPalette';
const MAP_TOKEN_TOOLTIP_PREF_KEY = 'battlemap.tokenTooltips';
const MAP_UNDO_STACK_LIMIT = 5;

function isHexColor(value) {
    if (typeof value !== 'string') return false;
    const normalized = value.trim();
    return /^#[0-9a-f]{6}$/i.test(normalized);
}

export default MapTab;

function normalizeBrushPalette(palette) {
    const defaults = [...MAP_BRUSH_COLORS];
    if (!Array.isArray(palette)) return defaults;
    return defaults.map((fallback, index) => {
        const value = palette[index];
        if (!isHexColor(value)) return fallback;
        return value.trim().toLowerCase();
    });
}

function loadStoredBrushPalette() {
    if (typeof window === 'undefined') {
        return [...MAP_BRUSH_COLORS];
    }
    try {
        const raw = window.localStorage.getItem(MAP_BRUSH_STORAGE_KEY);
        if (!raw) {
            return [...MAP_BRUSH_COLORS];
        }
        const parsed = JSON.parse(raw);
        return normalizeBrushPalette(parsed);
    } catch (err) {
        console.warn('Failed to load stored brush palette', err);
        return [...MAP_BRUSH_COLORS];
    }
}

function loadStoredTokenTooltipPreference() {
    if (typeof window === 'undefined') {
        return true;
    }
    try {
        const raw = window.localStorage.getItem(MAP_TOKEN_TOOLTIP_PREF_KEY);
        if (raw === 'false') return false;
        if (raw === 'true') return true;
        return true;
    } catch (err) {
        console.warn('Failed to load token tooltip preference', err);
        return true;
    }
}
const MAP_ENEMY_DEFAULT_COLOR = '#ef4444';
const MAP_MAX_POINTS_PER_STROKE = 600;
const MAP_DEFAULT_BACKGROUND = Object.freeze({
    url: '',
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    opacity: 1,
    color: '#0f172a',
});
const MAP_DEFAULT_DRAWER = Object.freeze({ userId: null, assignedAt: null });
const MAP_SHAPE_TYPES = ['rectangle', 'circle', 'line', 'diamond', 'triangle', 'cone', 'image'];
const MAP_STANDARD_SHAPE_TYPES = MAP_SHAPE_TYPES.filter((type) => type !== 'image');
const MAP_SHAPE_LABELS = {
    rectangle: 'Rectangle',
    circle: 'Circle',
    line: 'Line',
    diamond: 'Diamond',
    triangle: 'Triangle',
    cone: 'Cone',
    image: 'Image overlay',
};
const ENEMY_TOOLTIP_PREFIX = '__enemy__v1:';
const ENEMY_TOOLTIP_MAX_LENGTH = 480;
const TOKEN_TOOLTIP_PREFIX = '__token__v1:';
const TOKEN_TOOLTIP_MAX_LENGTH = 460;
const MAP_SIDEBAR_TABS = [
    { key: 'tokens', label: 'Tokens', description: 'Manage player, demon, and enemy markers.' },
    { key: 'overlays', label: 'Overlays', description: 'Add images and fog layers to the board.' },
    { key: 'shapes', label: 'Shapes', description: 'Create tactical shapes and zones.' },
    { key: 'library', label: 'Library', description: 'Save and load prepared battle maps.' },
];
const MAP_BATTLE_LOG_TAB = {
    key: 'log',
    label: 'Battle Log',
    description: 'Review realtime battle map activity and automation.',
};
const MAP_BATTLE_LOG_LIMIT = 200;

function mapClamp01(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    if (num <= 0) return 0;
    if (num >= 1) return 1;
    return num;
}

function clamp(value, min, max, fallback = min) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    if (num <= min) return min;
    if (num >= max) return max;
    return num;
}

function normalizeClientMapPoint(point) {
    if (!point) return null;
    if (Array.isArray(point)) {
        return { x: mapClamp01(point[0]), y: mapClamp01(point[1]) };
    }
    if (typeof point === 'object') {
        return { x: mapClamp01(point.x), y: mapClamp01(point.y) };
    }
    return null;
}

function normalizeClientMapStroke(stroke) {
    if (!stroke || typeof stroke !== 'object') return null;
    const color = typeof stroke.color === 'string' && stroke.color ? stroke.color : MAP_BRUSH_COLORS[0];
    const widthRaw = Number(stroke.size);
    const size = Number.isFinite(widthRaw) ? Math.min(32, Math.max(1, widthRaw)) : 3;
    const modeRaw = typeof stroke.mode === 'string' ? stroke.mode.toLowerCase() : 'draw';
    const mode = modeRaw === 'erase' ? 'erase' : 'draw';
    const source = Array.isArray(stroke.points) ? stroke.points : [];
    const points = [];
    for (const point of source) {
        const normalized = normalizeClientMapPoint(point);
        if (!normalized) continue;
        points.push(normalized);
        if (points.length >= MAP_MAX_POINTS_PER_STROKE) break;
    }
    if (points.length < 2) return null;
    return {
        id: stroke.id || `stroke-${Math.random().toString(36).slice(2, 10)}`,
        color,
        size,
        points,
        createdAt: typeof stroke.createdAt === 'string' ? stroke.createdAt : null,
        createdBy: typeof stroke.createdBy === 'string' ? stroke.createdBy : null,
        mode,
    };
}

function clampText(value, max = 200) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, max).trim();
}

function encodeTokenTooltip(meta) {
    if (!meta || typeof meta !== 'object') return '';
    const base = { ...meta, version: 1 };
    const attempt = (payload) => {
        try {
            return JSON.stringify(payload);
        } catch {
            return '';
        }
    };
    let json = attempt(base);
    if (!json) return '';
    if (json.length > TOKEN_TOOLTIP_MAX_LENGTH) {
        const slim = { ...base };
        if (slim.notes) delete slim.notes;
        json = attempt(slim);
        if (!json || json.length > TOKEN_TOOLTIP_MAX_LENGTH) {
            if (Array.isArray(slim.items)) {
                slim.items = slim.items.slice(0, 6);
                json = attempt(slim);
            }
        }
        if (!json || json.length > TOKEN_TOOLTIP_MAX_LENGTH) {
            if (slim.text) slim.text = clampText(slim.text, 240);
            json = attempt(slim);
        }
        if (!json || json.length > TOKEN_TOOLTIP_MAX_LENGTH) {
            json = attempt({ kind: slim.kind, text: clampText(slim.text || '', 200), version: slim.version });
        }
    }
    if (!json) return '';
    if (json.length > TOKEN_TOOLTIP_MAX_LENGTH) {
        json = json.slice(0, TOKEN_TOOLTIP_MAX_LENGTH);
        const lastBrace = json.lastIndexOf('}');
        if (lastBrace > -1) {
            json = json.slice(0, lastBrace + 1);
        }
    }
    return `${TOKEN_TOOLTIP_PREFIX}${json}`;
}

function decodeTokenTooltip(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed.startsWith(TOKEN_TOOLTIP_PREFIX)) return null;
    try {
        const payload = JSON.parse(trimmed.slice(TOKEN_TOOLTIP_PREFIX.length));
        if (!payload || typeof payload !== 'object') return null;
        return payload;
    } catch {
        return null;
    }
}

function normalizeNpcItems(items, { allowCost = false, allowTrade = false } = {}) {
    const list = [];
    const source = Array.isArray(items) ? items : [];
    for (const entry of source) {
        if (!entry || typeof entry !== 'object') continue;
        const name = clampText(entry.name, 80);
        const description = clampText(entry.description || entry.notes, 160);
        const idRaw = typeof entry.id === 'string' ? entry.id : '';
        const id = clampText(idRaw, 40) || `npc-item-${Math.random().toString(36).slice(2, 10)}`;
        const cost = allowCost ? clampText(entry.cost, 40) : '';
        const trade = allowTrade ? clampText(entry.trade, 80) : '';
        if (!name && !description) continue;
        const normalized = { id, name };
        if (description) normalized.description = description;
        if (allowCost && cost) normalized.cost = cost;
        if (allowTrade && trade) normalized.trade = trade;
        list.push(normalized);
        if (list.length >= 12) break;
    }
    return list;
}

function normalizeTokenMeta(meta, { fallbackKind = '', fallbackLabel = '' } = {}) {
    if (!meta || typeof meta !== 'object') return null;
    const version = Number(meta.version) || 1;
    const kind = typeof meta.kind === 'string' ? meta.kind : fallbackKind;
    const text = clampText(typeof meta.text === 'string' ? meta.text : meta.tooltip || '', 420);
    const image = clampText(meta.image, 280);
    const showTooltip = meta.showTooltip === undefined ? undefined : !!meta.showTooltip;
    const lines = text
        ? text
              .split(/\n+/)
              .map((line) => clampText(line, 120))
              .filter(Boolean)
        : [];
    const base = {
        version,
        kind,
        text,
        lines,
        image,
        showTooltip,
    };
    if (kind === 'player') {
        base.playerId = clampText(meta.playerId, 160);
        base.label = clampText(meta.label || fallbackLabel, 80);
        base.includePortrait = meta.includePortrait !== false && !!image;
        base.fields = {
            class: meta.fields ? !!meta.fields.class : true,
            level: meta.fields ? !!meta.fields.level : true,
            hp: meta.fields ? !!meta.fields.hp : true,
            notes: meta.fields ? !!meta.fields.notes : false,
        };
        base.notes = clampText(meta.notes, 280);
    } else if (kind === 'demon-ally') {
        base.demonId = clampText(meta.demonId, 160);
        base.label = clampText(meta.label || fallbackLabel, 80);
        base.fields = {
            arcana: meta.fields ? !!meta.fields.arcana : true,
            alignment: meta.fields ? !!meta.fields.alignment : true,
            level: meta.fields ? !!meta.fields.level : true,
            notes: meta.fields ? !!meta.fields.notes : false,
        };
        base.notes = clampText(meta.notes, 240);
    } else if (kind === 'demon-enemy') {
        base.label = clampText(meta.label || fallbackLabel, 80);
        base.allowAddToPool = meta.allowAddToPool !== false;
    } else if (kind === 'npc-shop' || kind === 'npc-loot' || kind === 'npc-misc') {
        const [, subtype] = kind.split('-');
        const npcType = subtype || 'misc';
        base.npcType = npcType;
        base.label = clampText(meta.label || fallbackLabel, 80);
        base.notes = clampText(meta.notes, 280);
        const allowCost = npcType === 'shop';
        const allowTrade = npcType === 'shop';
        base.items = normalizeNpcItems(meta.items, { allowCost, allowTrade });
        base.openButton = meta.openButton !== false;
        base.requireApproval = npcType === 'shop' ? meta.requireApproval !== false : false;
        base.autoClaim = npcType === 'loot' ? meta.autoClaim !== false : false;
        base.shopId = clampText(meta.shopId, 80) || null;
    } else if (kind === 'npc') {
        base.npcType = 'misc';
        base.label = clampText(meta.label || fallbackLabel, 80);
        base.notes = clampText(meta.notes, 280);
        base.items = normalizeNpcItems(meta.items);
        base.openButton = meta.openButton !== false;
        base.shopId = clampText(meta.shopId, 80) || null;
    }
    return base;
}

function normalizeEnemyStats(value, { maxLines = 6, maxLength = 100 } = {}) {
    const lines = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(/\r?\n/)
            : [];
    const out = [];
    for (const line of lines) {
        const normalized = clampText(line, maxLength);
        if (!normalized) continue;
        out.push(normalized);
        if (out.length >= maxLines) break;
    }
    return out;
}

function buildEnemyTooltipText(info) {
    if (!info) return '';
    const parts = [];
    if (info.showName && info.name) parts.push(info.name);
    if (info.showStats && Array.isArray(info.stats) && info.stats.length > 0) {
        parts.push(info.stats.join('\n'));
    }
    if (info.showNotes && info.notes) parts.push(info.notes);
    return parts.join('\n').trim();
}

function enemyHasVisibleContent(info) {
    if (!info) return false;
    return (
        (info.showName && !!info.name) ||
        (info.showStats && Array.isArray(info.stats) && info.stats.length > 0) ||
        (info.showNotes && !!info.notes) ||
        (info.showImage && !!info.image)
    );
}

function decodeEnemyTooltip(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed.startsWith(ENEMY_TOOLTIP_PREFIX)) return null;
    try {
        const payload = JSON.parse(trimmed.slice(ENEMY_TOOLTIP_PREFIX.length));
        if (!payload || typeof payload !== 'object') return null;
        const stats = normalizeEnemyStats(payload.stats);
        const notes = clampText(payload.notes, 280);
        const image = clampText(payload.image, 280);
        const name = clampText(payload.name, 80);
        return {
            name,
            showName: payload.showName !== false && !!name,
            stats,
            showStats: !!payload.showStats && stats.length > 0,
            notes,
            showNotes: !!payload.showNotes && !!notes,
            image,
            showImage: !!payload.showImage && !!image,
            demonId: typeof payload.demonId === 'string' ? payload.demonId : '',
        };
    } catch {
        return null;
    }
}

function encodeEnemyTooltip(info) {
    if (!info || typeof info !== 'object') return '';
    const stats = normalizeEnemyStats(info.stats);
    const name = clampText(info.name, 80);
    const image = clampText(info.image, 280);
    const notes = clampText(info.notes, 280);
    const payload = {
        v: 1,
        name,
        showName: !!info.showName && !!name,
        stats,
        showStats: !!info.showStats && stats.length > 0,
        notes,
        showNotes: !!info.showNotes && !!notes,
        image,
        showImage: !!info.showImage && !!image,
    };
    if (info.demonId) {
        payload.demonId = String(info.demonId).slice(0, 160);
    }
    let json = JSON.stringify(payload);
    if (json.length > ENEMY_TOOLTIP_MAX_LENGTH) {
        payload.notes = '';
        payload.showNotes = false;
        json = JSON.stringify(payload);
    }
    if (json.length > ENEMY_TOOLTIP_MAX_LENGTH) {
        payload.stats = payload.stats.slice(0, 3);
        payload.showStats = payload.stats.length > 0 && payload.showStats;
        json = JSON.stringify(payload);
    }
    if (json.length > ENEMY_TOOLTIP_MAX_LENGTH) {
        payload.image = '';
        payload.showImage = false;
        json = JSON.stringify(payload);
    }
    if (json.length > ENEMY_TOOLTIP_MAX_LENGTH) {
        delete payload.demonId;
        json = JSON.stringify(payload);
    }
    if (json.length > ENEMY_TOOLTIP_MAX_LENGTH && payload.name) {
        const trimBy = json.length - ENEMY_TOOLTIP_MAX_LENGTH;
        payload.name = payload.name.slice(0, Math.max(0, payload.name.length - trimBy));
        json = JSON.stringify(payload);
    }
    if (json.length > ENEMY_TOOLTIP_MAX_LENGTH) {
        json = json.slice(0, ENEMY_TOOLTIP_MAX_LENGTH);
        // Attempt to close JSON if truncated mid-structure
        const lastBrace = json.lastIndexOf('}');
        if (lastBrace > -1) {
            json = json.slice(0, lastBrace + 1);
        }
        try {
            JSON.parse(json);
        } catch {
            return clampText(buildEnemyTooltipText(info), ENEMY_TOOLTIP_MAX_LENGTH);
        }
    }
    return `${ENEMY_TOOLTIP_PREFIX}${json}`;
}

function normalizeEnemyInfo(raw, { fallbackLabel = '' } = {}) {
    if (!raw || typeof raw !== 'object') {
        return {
            name: '',
            showName: false,
            stats: [],
            showStats: false,
            notes: '',
            showNotes: false,
            image: '',
            showImage: false,
            demonId: '',
        };
    }
    const stats = normalizeEnemyStats(raw.stats);
    const name = clampText(raw.name, 80) || clampText(fallbackLabel, 80);
    const image = clampText(raw.image, 280);
    const notes = clampText(raw.notes, 280);
    return {
        name,
        showName: raw.showName !== false && !!name,
        stats,
        showStats: !!raw.showStats && stats.length > 0,
        notes,
        showNotes: !!raw.showNotes && !!notes,
        image,
        showImage: !!raw.showImage && !!image,
        demonId: typeof raw.demonId === 'string' ? raw.demonId : '',
    };
}

function createEnemyDetails() {
    return {
        demonId: '',
        name: '',
        image: '',
        stats: '',
        notes: '',
        showName: true,
        showImage: false,
        showStats: true,
        showNotes: false,
    };
}

function createEnemyFormState() {
    return {
        id: null,
        label: '',
        color: MAP_ENEMY_DEFAULT_COLOR,
        showTooltip: true,
        details: createEnemyDetails(),
    };
}

function createPlayerTokenConfig(overrides = {}) {
    return {
        showClass: overrides.showClass !== undefined ? !!overrides.showClass : true,
        showLevel: overrides.showLevel !== undefined ? !!overrides.showLevel : true,
        showHp: overrides.showHp !== undefined ? !!overrides.showHp : true,
        showNotes: overrides.showNotes !== undefined ? !!overrides.showNotes : false,
        notes: typeof overrides.notes === 'string' ? overrides.notes : '',
        includePortrait: overrides.includePortrait !== undefined ? !!overrides.includePortrait : true,
        showTooltip: overrides.showTooltip !== undefined ? !!overrides.showTooltip : true,
        label: typeof overrides.label === 'string' ? overrides.label : '',
    };
}

function buildPlayerTokenMeta(player, config = {}) {
    if (!player) return null;
    const settings = createPlayerTokenConfig(config);
    const character = player.character || {};
    const profile = character.profile || {};
    const resources = character.resources || {};
    const lines = [];
    if (settings.showClass && profile.class) lines.push(clampText(profile.class, 80));
    if (settings.showLevel && resources.level !== undefined && resources.level !== null && resources.level !== '') {
        lines.push(`Level ${clampText(String(resources.level), 12)}`);
    }
    if (settings.showHp && resources.hp !== undefined && resources.maxHP !== undefined && resources.maxHP !== '') {
        lines.push(`HP ${resources.hp}/${resources.maxHP}`);
    }
    const text = lines.join('\n').trim();
    const notes = settings.showNotes ? clampText(settings.notes, 280) : '';
    const portrait = typeof profile.portrait === 'string' ? profile.portrait.trim() : '';
    const image = settings.includePortrait && portrait ? portrait : '';
    const label = clampText(settings.label || describePlayerName(player), 80);
    const hasTooltipContent = !!text || !!image || !!notes;
    return {
        kind: 'player',
        playerId: player.userId || '',
        label,
        text,
        image,
        fields: {
            class: settings.showClass,
            level: settings.showLevel,
            hp: settings.showHp,
            notes: settings.showNotes,
        },
        notes,
        includePortrait: settings.includePortrait && !!image,
        showTooltip: settings.showTooltip && hasTooltipContent,
    };
}

function createDemonTokenConfig(overrides = {}) {
    return {
        showArcana: overrides.showArcana !== undefined ? !!overrides.showArcana : true,
        showAlignment: overrides.showAlignment !== undefined ? !!overrides.showAlignment : true,
        showLevel: overrides.showLevel !== undefined ? !!overrides.showLevel : true,
        showNotes: overrides.showNotes !== undefined ? !!overrides.showNotes : false,
        notes: typeof overrides.notes === 'string' ? overrides.notes : '',
        includePortrait: overrides.includePortrait !== undefined ? !!overrides.includePortrait : true,
        showTooltip: overrides.showTooltip !== undefined ? !!overrides.showTooltip : true,
        label: typeof overrides.label === 'string' ? overrides.label : '',
    };
}

function buildDemonAllyMeta(demon, config = {}) {
    if (!demon) return null;
    const settings = createDemonTokenConfig(config);
    const lines = [];
    if (settings.showArcana && demon.arcana) lines.push(clampText(demon.arcana, 80));
    if (settings.showAlignment && demon.alignment) lines.push(clampText(demon.alignment, 80));
    if (settings.showLevel && demon.level !== undefined && demon.level !== null && demon.level !== '') {
        lines.push(`Level ${clampText(String(demon.level), 12)}`);
    }
    const text = lines.join('\n').trim();
    const notes = settings.showNotes ? clampText(settings.notes, 240) : '';
    const rawImage = typeof demon.image === 'string' ? demon.image.trim() : '';
    const image = settings.includePortrait && rawImage ? rawImage : '';
    const demonId = demon.id || demon.slug || demon.query || '';
    const label = clampText(settings.label || demon.name || 'Demon', 80);
    const hasTooltipContent = !!text || !!image || !!notes;
    return {
        kind: 'demon-ally',
        demonId: demonId || '',
        label,
        text,
        image,
        fields: {
            arcana: settings.showArcana,
            alignment: settings.showAlignment,
            level: settings.showLevel,
            notes: settings.showNotes,
        },
        notes,
        showTooltip: settings.showTooltip && hasTooltipContent,
    };
}

function createNpcTokenState(overrides = {}) {
    const allowedTypes = new Set(['shop', 'loot', 'misc']);
    const type = typeof overrides.type === 'string' && allowedTypes.has(overrides.type) ? overrides.type : 'shop';
    return {
        label: typeof overrides.label === 'string' ? overrides.label : '',
        type,
        color: overrides.color || '#10b981',
        showTooltip: overrides.showTooltip !== undefined ? !!overrides.showTooltip : true,
        image: typeof overrides.image === 'string' ? overrides.image : '',
        notes: typeof overrides.notes === 'string' ? overrides.notes : '',
        items: Array.isArray(overrides.items) ? overrides.items : [],
        requireApproval: overrides.requireApproval !== undefined ? !!overrides.requireApproval : true,
        allowAutoClaim: overrides.allowAutoClaim !== undefined ? !!overrides.allowAutoClaim : true,
        openButton: overrides.openButton !== undefined ? !!overrides.openButton : true,
        shopId: typeof overrides.shopId === 'string' ? overrides.shopId : '',
    };
}

function buildNpcTokenMeta(form) {
    const state = createNpcTokenState(form);
    const labelFallback = state.type === 'shop' ? 'Shopkeeper' : state.type === 'loot' ? 'Treasure Cache' : 'NPC';
    const label = clampText(state.label || labelFallback, 80);
    const items = normalizeNpcItems(state.items, {
        allowCost: state.type === 'shop',
        allowTrade: state.type === 'shop',
    });
    const summaryParts = [];
    if (state.type === 'shop') {
        summaryParts.push(`${items.length} item${items.length === 1 ? '' : 's'} for sale`);
    } else if (state.type === 'loot') {
        summaryParts.push(`${items.length} reward${items.length === 1 ? '' : 's'} available`);
    }
    const text = summaryParts.join('\n').trim();
    const image = clampText(state.image, 280);
    const kind = `npc-${state.type}`;
    const shopId = clampText(state.shopId, 80) || `shop-${Math.random().toString(36).slice(2, 9)}`;
    const notes = clampText(state.notes, 280);
    const hasTooltipContent = !!text || !!notes || !!image || items.length > 0;
    return {
        kind,
        label,
        text,
        image,
        notes,
        items,
        openButton: !!state.openButton,
        requireApproval: state.type === 'shop' ? !!state.requireApproval : false,
        autoClaim: state.type === 'loot' ? !!state.allowAutoClaim : false,
        shopId,
        showTooltip: !!state.showTooltip && hasTooltipContent,
    };
}

function createNpcItem() {
    return {
        id: `npc-item-${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        cost: '',
        trade: '',
        description: '',
    };
}

function detailsFromEnemyInfo(info, { fallbackLabel = '' } = {}) {
    const normalized = normalizeEnemyInfo(info || {}, { fallbackLabel });
    return {
        demonId: normalized.demonId || '',
        name: clampText(normalized.name, 80),
        image: normalized.image || '',
        stats: (normalized.stats || []).join('\n'),
        notes: normalized.notes || '',
        showName: normalized.showName,
        showImage: normalized.showImage,
        showStats: normalized.showStats,
        showNotes: normalized.showNotes,
    };
}

function buildEnemyInfoFromDetails(details, { fallbackLabel = '' } = {}) {
    const stats = normalizeEnemyStats(details?.stats);
    const name = clampText(details?.name, 80) || clampText(fallbackLabel, 80);
    const image = clampText(details?.image, 280);
    const notes = clampText(details?.notes, 280);
    return {
        name,
        showName: !!details?.showName && !!name,
        stats,
        showStats: !!details?.showStats && stats.length > 0,
        notes,
        showNotes: !!details?.showNotes && !!notes,
        image,
        showImage: !!details?.showImage && !!image,
        demonId: typeof details?.demonId === 'string' ? details.demonId : '',
    };
}

function describeDemonEnemyStats(demon) {
    if (!demon || typeof demon !== 'object') return '';
    const lines = [];
    if (demon.arcana) lines.push(`Arcana: ${demon.arcana}`);
    if (demon.alignment) lines.push(`Alignment: ${demon.alignment}`);
    const levelRaw = Number(demon.level);
    if (Number.isFinite(levelRaw) && levelRaw > 0) lines.push(`Level ${levelRaw}`);
    const abilities = demon.stats || {};
    const abilityOrder = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
    const abilityLine = abilityOrder
        .map((key) => {
            const value = Number(abilities?.[key]);
            return `${key} ${Number.isFinite(value) ? value : '-'}`;
        })
        .join(' · ');
    if (abilityLine.trim()) {
        lines.push(abilityLine);
    }
    return lines.join('\n');
}

function MapAccordionSection({ title, description, children, defaultOpen = true }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className={`map-accordion${open ? ' is-open' : ''}`}>
            <button type="button" className="map-accordion__header" onClick={() => setOpen((prev) => !prev)}>
                <span>{title}</span>
                <span className="map-accordion__icon">{open ? '▾' : '▸'}</span>
            </button>
            {description && <p className="map-accordion__description">{description}</p>}
            {open && <div className="map-accordion__body">{children}</div>}
        </section>
    );
}

function PlayerTooltipCard({ meta, label }) {
    if (!meta) return null;
    const displayLabel = meta.label || label;
    const lines = Array.isArray(meta.lines) ? meta.lines.filter(Boolean) : [];
    const notes = meta.notes || '';
    const hasImage = !!(meta.includePortrait && meta.image);
    if (!displayLabel && lines.length === 0 && !notes && !hasImage) {
        return null;
    }
    return (
        <div className="map-token__tooltip-card map-token__tooltip-card--player">
            {hasImage && (
                <div className="map-token__tooltip-image">
                    <img src={meta.image} alt={displayLabel || 'Player portrait'} />
                </div>
            )}
            <div className="map-token__tooltip-body">
                {displayLabel && <div className="map-token__tooltip-name">{displayLabel}</div>}
                {lines.length > 0 && (
                    <div className="map-token__tooltip-stats">
                        {lines.map((line, idx) => (
                            <span key={idx}>{line}</span>
                        ))}
                    </div>
                )}
                {notes && <div className="map-token__tooltip-notes">{notes}</div>}
            </div>
        </div>
    );
}

function DemonTooltipCard({ meta, label }) {
    if (!meta) return null;
    const displayLabel = meta.label || label;
    const lines = Array.isArray(meta.lines) ? meta.lines.filter(Boolean) : [];
    const notes = meta.notes || '';
    const hasImage = !!meta.image;
    if (!displayLabel && lines.length === 0 && !notes && !hasImage) {
        return null;
    }
    return (
        <div className="map-token__tooltip-card map-token__tooltip-card--demon">
            {hasImage && (
                <div className="map-token__tooltip-image">
                    <DemonImage
                        src={meta.image}
                        alt={displayLabel || 'Demon portrait'}
                        personaSlug={meta.demonId || undefined}
                    />
                </div>
            )}
            <div className="map-token__tooltip-body">
                {displayLabel && <div className="map-token__tooltip-name">{displayLabel}</div>}
                {lines.length > 0 && (
                    <div className="map-token__tooltip-stats">
                        {lines.map((line, idx) => (
                            <span key={idx}>{line}</span>
                        ))}
                    </div>
                )}
                {notes && <div className="map-token__tooltip-notes">{notes}</div>}
            </div>
        </div>
    );
}

function NpcTooltipCard({ meta, label, onOpen, isDM }) {
    if (!meta) return null;
    const displayLabel = meta.label || label;
    const image = meta.image;
    const summary = meta.text && meta.text !== meta.notes ? meta.text : '';
    const notes = meta.notes || '';
    const items = Array.isArray(meta.items) ? meta.items : [];
    const hasItems = items.length > 0;
    const type = meta.npcType || 'misc';
    const showOpenButton = typeof onOpen === 'function' && (isDM || meta.openButton);
    const openLabel =
        type === 'shop' ? 'Open shop' : type === 'loot' ? 'View loot' : meta.openButton ? 'View details' : 'Open details';
    if (!displayLabel && !summary && !notes && !image && !hasItems && !showOpenButton) {
        return null;
    }
    const limitedItems = hasItems ? items.slice(0, 3) : [];
    const remainingCount = hasItems ? Math.max(0, items.length - limitedItems.length) : 0;
    return (
        <div className={`map-token__tooltip-card map-token__tooltip-card--npc map-token__tooltip-card--npc-${type}`}>
            {image && (
                <div className="map-token__tooltip-image">
                    <img src={image} alt={displayLabel || 'NPC portrait'} />
                </div>
            )}
            <div className="map-token__tooltip-body">
                {displayLabel && <div className="map-token__tooltip-name">{displayLabel}</div>}
                {summary && <div className="map-token__tooltip-summary">{summary}</div>}
                {hasItems && (
                    <ul className="map-token__tooltip-items">
                        {limitedItems.map((item) => (
                            <li key={item.id || item.name} className="map-token__tooltip-item">
                                <span className="map-token__tooltip-item-name">{item.name}</span>
                                {type === 'shop' && (item.cost || item.trade) && (
                                    <span className="map-token__tooltip-item-meta">
                                        {[item.cost, item.trade ? `Trade: ${item.trade}` : '']
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </span>
                                )}
                                {item.description && (
                                    <span className="map-token__tooltip-item-notes">{item.description}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {remainingCount > 0 && (
                    <div className="map-token__tooltip-more text-small text-muted">
                        +{remainingCount} more item{remainingCount === 1 ? '' : 's'}
                    </div>
                )}
                {notes && <div className="map-token__tooltip-notes">{notes}</div>}
                {showOpenButton && (
                    <div className="map-token__tooltip-actions">
                        <button
                            type="button"
                            className="btn btn-small"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onOpen();
                            }}
                        >
                            {openLabel}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function EnemyTooltipCard({ info, label, actions = null }) {
    if (!info) return null;
    const hasName = info.showName && info.name;
    const hasStats = info.showStats && Array.isArray(info.stats) && info.stats.length > 0;
    const hasNotes = info.showNotes && info.notes;
    const hasImage = info.showImage && info.image;
    const hasActions = !!actions;
    if (!hasName && !hasStats && !hasNotes && !hasImage && !hasActions) {
        return null;
    }
    return (
        <div className="map-token__tooltip-card">
            {hasImage && (
                <div className="map-token__tooltip-image">
                    <DemonImage src={info.image} alt={info.name || label} personaSlug={info.demonId || undefined} />
                </div>
            )}
            <div className="map-token__tooltip-body">
                {hasName && <div className="map-token__tooltip-name">{info.name}</div>}
                {hasStats && (
                    <div className="map-token__tooltip-stats">
                        {info.stats.map((line, idx) => (
                            <span key={idx}>{line}</span>
                        ))}
                    </div>
                )}
                {hasNotes && <div className="map-token__tooltip-notes">{info.notes}</div>}
                {hasActions && <div className="map-token__tooltip-actions">{actions}</div>}
            </div>
        </div>
    );
}

function NpcOverlay({ token, onClose, isDM }) {
    if (!token || !token.meta) return null;
    const meta = token.meta;
    const title = meta.label || token.label || 'NPC';
    const type = meta.npcType || (meta.kind === 'npc-shop' ? 'shop' : meta.kind === 'npc-loot' ? 'loot' : 'misc');
    const typeLabel = type === 'shop' ? 'Shopkeeper' : type === 'loot' ? 'Loot cache' : 'NPC details';
    const summary = meta.text && meta.text !== meta.notes ? meta.text : '';
    const notes = meta.notes || '';
    const items = Array.isArray(meta.items) ? meta.items : [];
    const requireApproval = !!meta.requireApproval;
    const autoClaim = !!meta.autoClaim;
    const showItems = items.length > 0;
    const sectionHeading = type === 'shop' ? 'Shop inventory' : type === 'loot' ? 'Loot rewards' : 'Information';
    return (
        <div className="map-npc-overlay" role="dialog" aria-modal="true" aria-label={`${title} details`}>
            <div className="map-npc-overlay__backdrop" onClick={onClose} />
            <div className="map-npc-overlay__panel">
                <div className="map-npc-overlay__header">
                    <div>
                        <h3>{title}</h3>
                        <p className="text-small text-muted">{typeLabel}</p>
                    </div>
                    <button type="button" className="btn ghost btn-small" onClick={onClose}>
                        Close
                    </button>
                </div>
                {meta.image && (
                    <div className="map-npc-overlay__image">
                        <img src={meta.image} alt={title} />
                    </div>
                )}
                {summary && <p className="map-npc-overlay__summary">{summary}</p>}
                {notes && <p className="map-npc-overlay__notes">{notes}</p>}
                {showItems && (
                    <div className="map-npc-overlay__section">
                        <h4>{sectionHeading}</h4>
                        <ul className="map-npc-overlay__items">
                            {items.map((item) => (
                                <li key={item.id || item.name} className="map-npc-overlay__item">
                                    <div className="map-npc-overlay__item-header">
                                        <span className="map-npc-overlay__item-name">{item.name}</span>
                                        {type === 'shop' && (item.cost || item.trade) && (
                                            <span className="map-npc-overlay__item-meta">
                                                {[item.cost, item.trade ? `Trade: ${item.trade}` : '']
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </span>
                                        )}
                                    </div>
                                    {item.description && (
                                        <p className="map-npc-overlay__item-notes">{item.description}</p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {type === 'shop' && (
                    <p className="map-npc-overlay__hint text-small text-muted">
                        {requireApproval
                            ? 'Purchases require the DM to approve each trade request.'
                            : 'Players can propose trades; the DM will confirm each sale.'}
                    </p>
                )}
                {type === 'loot' && (
                    <p className="map-npc-overlay__hint text-small text-muted">
                        {autoClaim
                            ? 'Players can claim items automatically when they interact with this loot.'
                            : 'Coordinate with the DM to distribute these rewards.'}
                    </p>
                )}
                {isDM && meta.shopId && (
                    <p className="map-npc-overlay__hint text-small text-muted">
                        Shop ID: <code>{meta.shopId}</code>
                    </p>
                )}
            </div>
        </div>
    );
}

function EnemyTokenWorkshop({
    enemyForm,
    setEnemyForm,
    enemyFormValid,
    enemyFormHasVisibleTooltip,
    enemyDetailsInfo,
    enemyDemonChoice,
    setEnemyDemonChoice,
    enemyDemonOptions,
    enemyQuery,
    setEnemyQuery,
    handleImportEnemyDemon,
    handleSubmitEnemyToken,
    resetEnemyForm,
}) {
    return (
        <form
            className="map-enemy-form"
            onSubmit={(event) => {
                event.preventDefault();
                handleSubmitEnemyToken();
            }}
        >
            <fieldset className="map-enemy-form__section">
                <legend>Token</legend>
                <label className="text-small" htmlFor="map-enemy-label">
                    Enemy label
                </label>
                <input
                    id="map-enemy-label"
                    type="text"
                    value={enemyForm.label}
                    onChange={(event) =>
                        setEnemyForm((prev) => ({
                            ...prev,
                            label: event.target.value,
                        }))
                    }
                    placeholder="e.g. Shadow Trooper"
                />
                <div className="map-enemy-form__controls">
                    <label className="color-input" htmlFor="map-enemy-color">
                        <span className="text-small">Token color</span>
                        <input
                            id="map-enemy-color"
                            type="color"
                            value={enemyForm.color}
                            style={{ backgroundColor: enemyForm.color }}
                            onChange={(event) =>
                                setEnemyForm((prev) => ({
                                    ...prev,
                                    color: event.target.value || MAP_ENEMY_DEFAULT_COLOR,
                                }))
                            }
                        />
                        <span className="text-muted text-small">
                            {(enemyForm.color || MAP_ENEMY_DEFAULT_COLOR).toUpperCase()}
                        </span>
                    </label>
                    <label className="perm-toggle">
                        <input
                            type="checkbox"
                            checked={enemyForm.showTooltip}
                            onChange={(event) =>
                                setEnemyForm((prev) => ({
                                    ...prev,
                                    showTooltip: event.target.checked,
                                }))
                            }
                        />
                        <span className="perm-toggle__text">Tooltip on hover</span>
                    </label>
                </div>
            </fieldset>
            <fieldset className="map-enemy-form__section">
                <legend>Import from codex</legend>
                <p className="text-small text-muted">
                    Prefill details from demons saved in this campaign.
                </p>
                <div className="map-enemy-form__controls map-enemy-form__controls--wrap">
                    <input
                        type="text"
                        value={enemyQuery}
                        onChange={(event) => setEnemyQuery(event.target.value)}
                        placeholder="Search demon name…"
                    />
                    <select
                        value={enemyDemonChoice}
                        onChange={(event) => setEnemyDemonChoice(event.target.value)}
                    >
                        <option value="">Select a demon…</option>
                        {enemyDemonOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className="btn btn-small"
                        onClick={handleImportEnemyDemon}
                        disabled={!enemyDemonChoice}
                    >
                        Import
                    </button>
                </div>
            </fieldset>
            <fieldset className="map-enemy-form__section">
                <legend>Tooltip details</legend>
                <div className="map-enemy-form__detail">
                    <div className="map-enemy-form__detail-header">
                        <label htmlFor="map-enemy-name">Display name</label>
                        <label className="perm-toggle">
                            <input
                                type="checkbox"
                                checked={enemyForm.details.showName}
                                onChange={(event) =>
                                    setEnemyForm((prev) => ({
                                        ...prev,
                                        details: {
                                            ...prev.details,
                                            showName: event.target.checked,
                                        },
                                    }))
                                }
                            />
                            <span className="perm-toggle__text">Visible</span>
                        </label>
                    </div>
                    <input
                        id="map-enemy-name"
                        type="text"
                        value={enemyForm.details.name}
                        onChange={(event) =>
                            setEnemyForm((prev) => ({
                                ...prev,
                                details: {
                                    ...prev.details,
                                    name: event.target.value,
                                },
                            }))
                        }
                        placeholder="Optional override name"
                    />
                </div>
                <div className="map-enemy-form__detail">
                    <div className="map-enemy-form__detail-header">
                        <label htmlFor="map-enemy-image">Image URL</label>
                        <label className="perm-toggle">
                            <input
                                type="checkbox"
                                checked={enemyForm.details.showImage}
                                onChange={(event) =>
                                    setEnemyForm((prev) => ({
                                        ...prev,
                                        details: {
                                            ...prev.details,
                                            showImage: event.target.checked,
                                        },
                                    }))
                                }
                            />
                            <span className="perm-toggle__text">Visible</span>
                        </label>
                    </div>
                    <input
                        id="map-enemy-image"
                        type="text"
                        value={enemyForm.details.image}
                        onChange={(event) =>
                            setEnemyForm((prev) => ({
                                ...prev,
                                details: {
                                    ...prev.details,
                                    image: event.target.value,
                                },
                            }))
                        }
                        placeholder="https://example.com/enemy.png"
                    />
                    <p className="text-small text-muted">
                        Hotlinks are proxied automatically for supported demon wikis.
                    </p>
                </div>
                <div className="map-enemy-form__detail">
                    <div className="map-enemy-form__detail-header">
                        <label htmlFor="map-enemy-stats">Stats</label>
                        <label className="perm-toggle">
                            <input
                                type="checkbox"
                                checked={enemyForm.details.showStats}
                                onChange={(event) =>
                                    setEnemyForm((prev) => ({
                                        ...prev,
                                        details: {
                                            ...prev.details,
                                            showStats: event.target.checked,
                                        },
                                    }))
                                }
                            />
                            <span className="perm-toggle__text">Visible</span>
                        </label>
                    </div>
                    <textarea
                        id="map-enemy-stats"
                        rows={3}
                        value={enemyForm.details.stats}
                        onChange={(event) =>
                            setEnemyForm((prev) => ({
                                ...prev,
                                details: {
                                    ...prev.details,
                                    stats: event.target.value,
                                },
                            }))
                        }
                        placeholder={'HP 45 / 45\nWeak: Bless · Resists: Gun'}
                    />
                </div>
                <div className="map-enemy-form__detail">
                    <div className="map-enemy-form__detail-header">
                        <label htmlFor="map-enemy-notes">Notes</label>
                        <label className="perm-toggle">
                            <input
                                type="checkbox"
                                checked={enemyForm.details.showNotes}
                                onChange={(event) =>
                                    setEnemyForm((prev) => ({
                                        ...prev,
                                        details: {
                                            ...prev.details,
                                            showNotes: event.target.checked,
                                        },
                                    }))
                                }
                            />
                            <span className="perm-toggle__text">Visible</span>
                        </label>
                    </div>
                    <textarea
                        id="map-enemy-notes"
                        rows={3}
                        value={enemyForm.details.notes}
                        onChange={(event) =>
                            setEnemyForm((prev) => ({
                                ...prev,
                                details: {
                                    ...prev.details,
                                    notes: event.target.value,
                                },
                            }))
                        }
                        placeholder="Tactical reminders, conditions, or lore."
                    />
                </div>
                <EnemyTooltipCard info={enemyDetailsInfo} label={enemyForm.label || 'Enemy'} />
                <p className="text-small text-muted">
                    {enemyForm.showTooltip && enemyFormHasVisibleTooltip
                        ? 'Players will see the selected fields on hover.'
                        : 'Tooltip hidden from players.'}
                </p>
            </fieldset>
            <div className="map-enemy-form__actions">
                {enemyForm.id && (
                    <button type="button" className="btn ghost btn-small" onClick={resetEnemyForm}>
                        Cancel edit
                    </button>
                )}
                <button type="submit" className="btn btn-small" disabled={!enemyFormValid}>
                    {enemyForm.id ? 'Save enemy' : 'Place enemy'}
                </button>
            </div>
        </form>
    );
}

function normalizeClientMapToken(token) {
    if (!token || typeof token !== 'object') return null;
    const kind = typeof token.kind === 'string' ? token.kind : 'custom';
    const labelRaw = typeof token.label === 'string' ? token.label : '';
    const label =
        labelRaw.trim() ||
        (kind === 'player' ? 'Player' : kind === 'demon' ? 'Demon' : kind === 'enemy' ? 'Enemy' : 'Marker');
    const tooltipSource = typeof token.tooltip === 'string' ? token.tooltip : '';
    let tooltipTrimmed = tooltipSource.trim();
    let tooltip = tooltipTrimmed || label;
    let showTooltip = token.showTooltip !== false && !!tooltipTrimmed;
    let meta = null;
    let image = '';
    let enemyInfo = null;
    let color = typeof token.color === 'string' && token.color ? token.color : '#a855f7';
    if (!token.color) {
        if (kind === 'player') color = '#38bdf8';
        else if (kind === 'demon') color = '#f97316';
        else if (kind === 'enemy') color = MAP_ENEMY_DEFAULT_COLOR;
        else if (kind === 'npc') color = '#10b981';
    }
    if (tooltipSource.trim().startsWith(TOKEN_TOOLTIP_PREFIX)) {
        const decodedMeta = decodeTokenTooltip(tooltipSource);
        const normalizedMeta = normalizeTokenMeta(decodedMeta, { fallbackKind: kind, fallbackLabel: label });
        if (normalizedMeta) {
            meta = normalizedMeta;
            const metaText = normalizedMeta.text || '';
            if (metaText) {
                tooltip = metaText;
                tooltipTrimmed = metaText.trim();
            } else if (Array.isArray(normalizedMeta.lines) && normalizedMeta.lines.length > 0) {
                tooltip = normalizedMeta.lines.join('\n');
                tooltipTrimmed = tooltip.trim();
            }
            if (normalizedMeta.image) {
                image = normalizedMeta.image;
            }
            if (normalizedMeta.notes) {
                const merged = [tooltipTrimmed, normalizedMeta.notes].filter(Boolean).join('\n');
                tooltip = merged || tooltip;
                tooltipTrimmed = merged.trim();
            }
            if (normalizedMeta.showTooltip !== undefined) {
                showTooltip = normalizedMeta.showTooltip && (!!tooltipTrimmed || !!image);
            } else {
                showTooltip = token.showTooltip !== false && (!!tooltipTrimmed || !!image);
            }
        }
    }
    if (kind === 'enemy') {
        const decoded = decodeEnemyTooltip(tooltipSource);
        if (decoded) {
            enemyInfo = normalizeEnemyInfo(decoded, { fallbackLabel: label });
            tooltip = buildEnemyTooltipText(enemyInfo);
            tooltipTrimmed = tooltip.trim();
            showTooltip = token.showTooltip !== false && enemyHasVisibleContent(enemyInfo);
        } else {
            enemyInfo = normalizeEnemyInfo(
                {
                    name: label,
                    showName: true,
                    notes: tooltipTrimmed && tooltipTrimmed !== label ? tooltipTrimmed : '',
                    showNotes: !!tooltipTrimmed && tooltipTrimmed !== label,
                },
                { fallbackLabel: label },
            );
            tooltip = tooltipTrimmed || label;
            tooltipTrimmed = tooltip.trim();
            showTooltip = token.showTooltip !== false && !!tooltipTrimmed;
        }
    }
    return {
        id: token.id || `token-${Math.random().toString(36).slice(2, 10)}`,
        kind,
        refId: typeof token.refId === 'string' ? token.refId : null,
        label,
        tooltip,
        rawTooltip: tooltipTrimmed,
        tooltipSource: tooltipSource.trim(),
        showTooltip,
        color,
        x: mapClamp01(token.x),
        y: mapClamp01(token.y),
        ownerId: typeof token.ownerId === 'string' ? token.ownerId : null,
        image,
        ...(meta ? { meta } : {}),
        ...(enemyInfo ? { enemyInfo } : {}),
    };
}

function normalizeClientMapShape(shape) {
    if (!shape || typeof shape !== 'object') return null;
    const typeRaw = typeof shape.type === 'string' ? shape.type.toLowerCase() : 'rectangle';
    const type = MAP_SHAPE_TYPES.includes(typeRaw) ? typeRaw : 'rectangle';
    const id = typeof shape.id === 'string' && shape.id ? shape.id : `shape-${Math.random().toString(36).slice(2, 10)}`;
    const x = mapClamp01(Object.prototype.hasOwnProperty.call(shape, 'x') ? shape.x : 0.5);
    const y = mapClamp01(Object.prototype.hasOwnProperty.call(shape, 'y') ? shape.y : 0.5);
    const defaultSize = type === 'image' ? 0.4 : 0.25;
    const width = clamp(shape.width, 0.02, 1, defaultSize);
    let height = clamp(shape.height, 0.02, 1, type === 'line' ? 0.05 : defaultSize);
    if (type === 'circle' || type === 'diamond') {
        height = width;
    }
    const rotationRaw = Number(shape.rotation);
    const rotation = Number.isFinite(rotationRaw) ? ((rotationRaw % 360) + 360) % 360 : 0;
    const fill =
        type === 'image'
            ? 'transparent'
            : typeof shape.fill === 'string' && shape.fill
                ? shape.fill
                : '#1e293b';
    const stroke = typeof shape.stroke === 'string' && shape.stroke ? shape.stroke : '#f8fafc';
    const strokeWidth = clamp(shape.strokeWidth, 0, 20, 2);
    const opacity = clamp(shape.opacity, 0.05, 1, type === 'image' ? 1 : 0.6);
    const createdAt = typeof shape.createdAt === 'string' ? shape.createdAt : null;
    const updatedAt = typeof shape.updatedAt === 'string' ? shape.updatedAt : createdAt;
    const url = type === 'image' && typeof shape.url === 'string' ? shape.url.trim() : '';
    return {
        id,
        type,
        x,
        y,
        width,
        height,
        rotation,
        fill,
        stroke,
        strokeWidth,
        opacity,
        createdAt,
        updatedAt,
        ...(type === 'image' ? { url } : {}),
    };
}

function normalizeClientMapBackground(background) {
    if (!background || typeof background !== 'object') {
        return { ...MAP_DEFAULT_BACKGROUND };
    }
    const url = typeof background.url === 'string' ? background.url.trim() : '';
    const xSource = Object.prototype.hasOwnProperty.call(background, 'x') ? background.x : MAP_DEFAULT_BACKGROUND.x;
    const ySource = Object.prototype.hasOwnProperty.call(background, 'y') ? background.y : MAP_DEFAULT_BACKGROUND.y;
    const x = mapClamp01(xSource);
    const y = mapClamp01(ySource);
    const scale = clamp(background.scale, 0.2, 8, MAP_DEFAULT_BACKGROUND.scale);
    const rotationRaw = Number(background.rotation);
    const rotation = Number.isFinite(rotationRaw) ? ((rotationRaw % 360) + 360) % 360 : MAP_DEFAULT_BACKGROUND.rotation;
    const opacity = clamp(background.opacity, 0.05, 1, MAP_DEFAULT_BACKGROUND.opacity);
    const color = isHexColor(background.color) ? background.color.trim().toLowerCase() : MAP_DEFAULT_BACKGROUND.color;
    return { url, x, y, scale, rotation, opacity, color };
}

function normalizeMapLibraryEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' && entry.id ? entry.id : null;
    if (!id) return null;
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Saved map';
    const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : null;
    const updatedAt = typeof entry.updatedAt === 'string' ? entry.updatedAt : createdAt;
    const previewUrl = typeof entry.previewUrl === 'string' ? entry.previewUrl : '';
    return { id, name, createdAt, updatedAt, previewUrl };
}

function normalizeMapLibrary(list) {
    if (!Array.isArray(list)) return [];
    return list.map((entry) => normalizeMapLibraryEntry(entry)).filter(Boolean);
}

const DEFAULT_CLIENT_COMBAT = {
    active: false,
    order: [],
    turn: 0,
    round: 0,
    lastUpdatedAt: null,
};

function CombatTimeline({ entries, ariaLabel = 'Turn order timeline' }) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    return (
        <div className="map-combat-timeline" role="list" aria-label={ariaLabel}>
            {entries.map((entry) => {
                const className = [
                    'map-combat-timeline__entry',
                    entry.isCurrent ? 'is-current' : '',
                    entry.isComplete ? 'is-complete' : '',
                ]
                    .filter(Boolean)
                    .join(' ');
                return (
                    <div key={entry.id} role="listitem" className={className}>
                        <span className="map-combat-timeline__step">{entry.position}</span>
                        <span className="map-combat-timeline__label">{entry.label}</span>
                    </div>
                );
            })}
        </div>
    );
}

function resolveBattleLogActorName(actorId, playerMap, me, dmId) {
    if (!actorId) return 'System';
    if (me?.id && actorId === me.id) return 'You';
    if (dmId && actorId === dmId) return dmId === me?.id ? 'You (DM)' : 'Dungeon Master';
    if (playerMap && typeof playerMap.get === 'function') {
        const player = playerMap.get(actorId);
        if (player) {
            const name = describePlayerName(player);
            if (actorId === me?.id) {
                return `${name} (you)`;
            }
            return name;
        }
    }
    return `User ${actorId.slice(0, 8)}`;
}

function formatBattleLogTimestamp(value) {
    if (typeof value !== 'string') return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function BattleLogPanel({ entries, playerMap, me, dmId }) {
    const hasEntries = Array.isArray(entries) && entries.length > 0;
    const ordered = hasEntries ? entries.slice().reverse() : [];

    return (
        <section className="map-battle-log" aria-label="Battle log">
            <header className="map-battle-log__header">
                <h3>Battle Log</h3>
                <p className="text-muted">Detailed DM-only diagnostics for battle map activity.</p>
            </header>
            <div className="map-battle-log__scroller" role="log" aria-live="polite">
                {hasEntries ? (
                    ordered.map((entry) => {
                        const actor = resolveBattleLogActorName(entry.actorId, playerMap, me, dmId);
                        const timestamp = formatBattleLogTimestamp(entry.createdAt);
                        return (
                            <article key={entry.id} className="map-battle-log__entry">
                                <div className="map-battle-log__meta">
                                    <span className="map-battle-log__time">{timestamp}</span>
                                    <span className="map-battle-log__actor">{actor}</span>
                                </div>
                                <div className="map-battle-log__message">
                                    {entry.message || entry.action}
                                </div>
                                <div className="map-battle-log__action" aria-label="Log action">
                                    <code>{entry.action}</code>
                                </div>
                                {entry.details !== null && entry.details !== undefined && (
                                    <details className="map-battle-log__details">
                                        <summary>Details</summary>
                                        <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                                    </details>
                                )}
                            </article>
                        );
                    })
                ) : (
                    <p className="map-battle-log__empty text-muted">No battle log entries yet.</p>
                )}
            </div>
        </section>
    );
}

function normalizeClientCombatState(state) {
    if (!state || typeof state !== 'object') {
        return { ...DEFAULT_CLIENT_COMBAT };
    }
    const active = !!state.active;
    const order = Array.isArray(state.order)
        ? state.order
              .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
              .filter(Boolean)
              .slice(0, 32)
        : [];
    const turnRaw = Number(state.turn);
    const roundRaw = Number(state.round);
    const turn = Number.isFinite(turnRaw) && turnRaw > 0 ? Math.round(turnRaw) : active ? 1 : 0;
    const round = Number.isFinite(roundRaw) && roundRaw > 0 ? Math.round(roundRaw) : active ? 1 : 0;
    const lastUpdatedAt = typeof state.lastUpdatedAt === 'string' ? state.lastUpdatedAt : null;
    if (!active) {
        return { ...DEFAULT_CLIENT_COMBAT, order };
    }
    return { active: true, order, turn, round, lastUpdatedAt };
}

function normalizeClientBattleLogEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' && entry.id ? entry.id : null;
    if (!id) return null;
    const action = typeof entry.action === 'string' && entry.action.trim() ? entry.action.trim() : 'event';
    const message = typeof entry.message === 'string' ? entry.message : '';
    const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString();
    const actorId = typeof entry.actorId === 'string' ? entry.actorId : null;
    let details = null;
    if (entry.details !== undefined) {
        try {
            details = JSON.parse(JSON.stringify(entry.details));
        } catch {
            details = null;
        }
    }
    return { id, action, message, createdAt, actorId, details };
}

function normalizeClientBattleLog(list) {
    if (!Array.isArray(list)) return [];
    const entries = list.map((entry) => normalizeClientBattleLogEntry(entry)).filter(Boolean);
    if (entries.length <= MAP_BATTLE_LOG_LIMIT) {
        return entries;
    }
    return entries.slice(entries.length - MAP_BATTLE_LOG_LIMIT);
}

function normalizeClientMapState(map) {
    if (!map || typeof map !== 'object') {
        return {
            strokes: [],
            tokens: [],
            shapes: [],
            settings: { ...MAP_DEFAULT_SETTINGS },
            paused: false,
            background: { ...MAP_DEFAULT_BACKGROUND },
            updatedAt: null,
            drawer: { ...MAP_DEFAULT_DRAWER },
            combat: { ...DEFAULT_CLIENT_COMBAT },
            battleLog: [],
        };
    }
    const strokes = Array.isArray(map.strokes)
        ? map.strokes.map((stroke) => normalizeClientMapStroke(stroke)).filter(Boolean)
        : [];
    const tokens = Array.isArray(map.tokens)
        ? map.tokens.map((token) => normalizeClientMapToken(token)).filter(Boolean)
        : [];
    const shapes = Array.isArray(map.shapes)
        ? map.shapes.map((shape) => normalizeClientMapShape(shape)).filter(Boolean)
        : [];
    const drawer = (() => {
        if (!map.drawer || typeof map.drawer !== 'object') return { ...MAP_DEFAULT_DRAWER };
        const userId = typeof map.drawer.userId === 'string' ? map.drawer.userId : null;
        const assignedAt = typeof map.drawer.assignedAt === 'string' ? map.drawer.assignedAt : null;
        return {
            userId,
            assignedAt: userId ? assignedAt : null,
        };
    })();
    return {
        strokes,
        tokens,
        shapes,
        settings: {
            allowPlayerDrawing: mapReadBoolean(
                map.settings?.allowPlayerDrawing,
                MAP_DEFAULT_SETTINGS.allowPlayerDrawing,
            ),
            allowPlayerTokenMoves: mapReadBoolean(
                map.settings?.allowPlayerTokenMoves,
                MAP_DEFAULT_SETTINGS.allowPlayerTokenMoves,
            ),
        },
        paused: mapReadBoolean(map.paused),
        background: normalizeClientMapBackground(map.background),
        updatedAt: typeof map.updatedAt === 'string' ? map.updatedAt : null,
        drawer,
        combat: normalizeClientCombatState(map.combat),
        battleLog: normalizeClientBattleLog(map.battleLog),
    };
}

function describePlayerTooltip(player) {
    if (!player) return '';
    const parts = [];
    if (player.username) parts.push(`@${player.username}`);
    const character = player.character || {};
    if (character.profile?.class) parts.push(character.profile.class);
    if (character.resources?.level) parts.push(`Level ${character.resources.level}`);
    if (
        character.resources?.hp !== undefined &&
        character.resources?.maxHP !== undefined &&
        character.resources.maxHP !== ''
    ) {
        parts.push(`HP ${character.resources.hp}/${character.resources.maxHP}`);
    }
    return parts.join(' · ');
}

function describeDemonTooltip(demon) {
    if (!demon) return '';
    const parts = [];
    if (demon.arcana) parts.push(demon.arcana);
    if (demon.alignment) parts.push(demon.alignment);
    if (demon.level) parts.push(`Level ${demon.level}`);
    return parts.join(' · ');
}

function MapTab({ game, me }) {
    const isDM = game.dmId === me.id;
    const realtime = useContext(RealtimeContext);
    const logBattle = useBattleLogger(game.id);
    const sidebarTabs = useMemo(
        () => (isDM ? MAP_SIDEBAR_TABS.concat(MAP_BATTLE_LOG_TAB) : MAP_SIDEBAR_TABS),
        [isDM],
    );
    const [mapState, setMapState] = useState(() => normalizeClientMapState(game?.map));
    const [mapLibrary, setMapLibrary] = useState(() => normalizeMapLibrary(game?.mapLibrary));
    const [tokenTooltipsEnabled, setTokenTooltipsEnabled] = useState(
        () => loadStoredTokenTooltipPreference(),
    );
    const [backgroundDraft, setBackgroundDraft] = useState(() => mapState.background);
    const backgroundDraftRef = useRef(mapState.background);
    const latestBackgroundRef = useRef(mapState.background);
    const backgroundUpdateTimerRef = useRef(null);
    useEffect(() => {
        setMapState(normalizeClientMapState(game?.map));
    }, [game.id, game?.map]);
    useEffect(() => {
        setMapLibrary(normalizeMapLibrary(game?.mapLibrary));
    }, [game.id, game?.mapLibrary]);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(
                MAP_TOKEN_TOOLTIP_PREF_KEY,
                tokenTooltipsEnabled ? 'true' : 'false',
            );
        } catch (err) {
            console.warn('Failed to store token tooltip preference', err);
        }
    }, [tokenTooltipsEnabled]);
    useEffect(() => {
        setBackgroundDraft(mapState.background);
    }, [mapState.background]);
    useEffect(() => {
        backgroundDraftRef.current = backgroundDraft;
    }, [backgroundDraft]);
    useEffect(() => {
        latestBackgroundRef.current = mapState.background;
    }, [mapState.background]);
    useEffect(() => () => {
        if (backgroundUpdateTimerRef.current) {
            window.clearTimeout(backgroundUpdateTimerRef.current);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return () => {};
        if (!game?.id) return () => {};

        let cancelled = false;
        let timer = null;

        const fetchMap = async () => {
            try {
                const snapshot = await Games.getMap(game.id);
                if (cancelled) return;
                const normalized = normalizeClientMapState(snapshot);
                setMapState((prev) => {
                    if (!prev) return normalized;
                    if (!prev.updatedAt || !normalized.updatedAt) return normalized;
                    if (prev.updatedAt !== normalized.updatedAt) return normalized;
                    if (prev.tokens.length !== normalized.tokens.length) return normalized;
                    if (prev.strokes.length !== normalized.strokes.length) return normalized;
                    if (prev.shapes.length !== normalized.shapes.length) return normalized;
                    const prevBg = prev.background?.url || '';
                    const nextBg = normalized.background?.url || '';
                    if (prevBg !== nextBg) return normalized;
                    return prev;
                });
            } catch (err) {
                if (!cancelled) {
                    console.warn('Map refresh failed', err);
                }
            }
        };

        fetchMap();
        timer = window.setInterval(fetchMap, 5000);

        return () => {
            cancelled = true;
            if (timer) {
                window.clearInterval(timer);
            }
        };
    }, [game?.id]);

    const refreshMapLibrary = useCallback(async () => {
        if (!isDM) return;
        try {
            const maps = await Games.listMapLibrary(game.id);
            setMapLibrary(normalizeMapLibrary(maps));
        } catch (err) {
            console.warn('Failed to load battle map library', err);
        }
    }, [game.id, isDM]);

    useEffect(() => {
        if (!isDM) return () => {};
        let cancelled = false;
        (async () => {
            try {
                const maps = await Games.listMapLibrary(game.id);
                if (!cancelled) {
                    setMapLibrary(normalizeMapLibrary(maps));
                }
            } catch (err) {
                console.warn('Failed to load battle map library', err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [game.id, isDM]);

    useEffect(() => {
        if (!isDM || !realtime?.subscribeBattleLog) return () => {};
        const unsubscribe = realtime.subscribeBattleLog((entry) => {
            const normalized = normalizeClientBattleLogEntry(entry);
            if (!normalized) return;
            setMapState((prev) => {
                if (!prev) return prev;
                const nextLog = (prev.battleLog || []).concat(normalized);
                const trimmed =
                    nextLog.length > MAP_BATTLE_LOG_LIMIT
                        ? nextLog.slice(nextLog.length - MAP_BATTLE_LOG_LIMIT)
                        : nextLog;
                return { ...prev, battleLog: trimmed };
            });
        });
        return unsubscribe;
    }, [isDM, realtime]);

    const [tool, setTool] = useState('select');
    const [brushPalette, setBrushPalette] = useState(() => loadStoredBrushPalette());
    const [selectedBrushSlot, setSelectedBrushSlot] = useState(0);
    const [brushColor, setBrushColor] = useState(() => brushPalette[0] || MAP_BRUSH_COLORS[0]);
    const [brushSize, setBrushSize] = useState(4);
    const [draftStroke, setDraftStroke] = useState(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [clearingMap, setClearingMap] = useState(false);
    const canvasRef = useRef(null);
    const boardRef = useRef(null);
    const [boardSize, setBoardSize] = useState({ width: 0, height: 0 });
    const [dragging, setDragging] = useState(null);
    const [dragPreview, setDragPreview] = useState(null);
    const [selectedShapeId, setSelectedShapeId] = useState(null);
    const [playerChoice, setPlayerChoice] = useState('');
    const [tokenCreationTab, setTokenCreationTab] = useState('player');
    const [playerTokenConfig, setPlayerTokenConfig] = useState(() => createPlayerTokenConfig());
    const [demonCreationMode, setDemonCreationMode] = useState('ally');
    const [demonChoice, setDemonChoice] = useState('');
    const [demonTokenConfig, setDemonTokenConfig] = useState(() => createDemonTokenConfig());
    const [demonQuery, setDemonQuery] = useState('');
    const [enemyForm, setEnemyForm] = useState(createEnemyFormState);
    const [enemyDemonChoice, setEnemyDemonChoice] = useState('');
    const [enemyQuery, setEnemyQuery] = useState('');
    const [npcForm, setNpcForm] = useState(() => createNpcTokenState());
    const [activeNpcOverlayId, setActiveNpcOverlayId] = useState(null);
    const playerMap = useMemo(() => {
        const map = new Map();
        if (Array.isArray(game.players)) {
            for (const player of game.players) {
                if (!player || !player.userId) continue;
                map.set(player.userId, player);
            }
        }
        return map;
    }, [game.players]);
    const [sidebarTab, setSidebarTab] = useState('tokens');
    const [overlayForm, setOverlayForm] = useState({
        url: '',
        width: 0.4,
        height: 0.4,
        opacity: 1,
        rotation: 0,
    });
    const [undoStack, setUndoStack] = useState([]);
    const [undoInFlight, setUndoInFlight] = useState(false);
    const [drawerUpdating, setDrawerUpdating] = useState(false);
    const activeNpcToken = useMemo(() => {
        if (!activeNpcOverlayId) return null;
        return mapState.tokens.find((entry) => entry.id === activeNpcOverlayId) || null;
    }, [activeNpcOverlayId, mapState.tokens]);
    const combatState = mapState.combat || DEFAULT_CLIENT_COMBAT;
    const combatOrderString = combatState.order.join('\n');
    const [combatOrderDraft, setCombatOrderDraft] = useState(() => combatOrderString);
    const [combatRoundDraft, setCombatRoundDraft] = useState(() => (combatState.round || 1).toString());
    const [combatTurnDraft, setCombatTurnDraft] = useState(() => (combatState.turn || 1).toString());
    const [combatBusy, setCombatBusy] = useState(false);
    const [combatNotice, setCombatNotice] = useState(null);
    const resetEnemyForm = useCallback(() => {
        setEnemyForm(createEnemyFormState());
        setEnemyDemonChoice('');
    }, []);

    useEffect(() => {
        if (!sidebarTabs.some((tab) => tab.key === sidebarTab)) {
            setSidebarTab(sidebarTabs[0]?.key || 'tokens');
        }
    }, [sidebarTab, sidebarTabs]);

    useEffect(() => {
        if (!isDM || tool !== 'shape') {
            setSelectedShapeId(null);
        }
    }, [isDM, tool]);

    useEffect(() => {
        if (!selectedShapeId) return;
        const exists = mapState.shapes.some((shape) => shape.id === selectedShapeId);
        if (!exists) {
            setSelectedShapeId(null);
        }
    }, [mapState.shapes, selectedShapeId]);

    useEffect(() => {
        if (!playerChoice) return;
        const player = playerMap.get(playerChoice);
        if (!player) return;
        const defaultLabel = describePlayerName(player);
        setPlayerTokenConfig((prev) => {
            if (prev.label) return prev;
            return { ...prev, label: defaultLabel };
        });
    }, [playerChoice, playerMap]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const normalized = normalizeBrushPalette(brushPalette);
            window.localStorage.setItem(MAP_BRUSH_STORAGE_KEY, JSON.stringify(normalized));
        } catch (err) {
            console.warn('Failed to persist brush palette', err);
        }
    }, [brushPalette]);

    useEffect(() => {
        const board = boardRef.current;
        if (!board || typeof ResizeObserver === 'undefined') {
            return undefined;
        }
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setBoardSize({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height,
                });
            }
        });
        observer.observe(board);
        setBoardSize({ width: board.clientWidth, height: board.clientHeight });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        setCombatOrderDraft(combatOrderString);
    }, [combatOrderString]);

    useEffect(() => {
        setCombatRoundDraft((combatState.round || 1).toString());
    }, [combatState.round]);

    useEffect(() => {
        setCombatTurnDraft((combatState.turn || 1).toString());
    }, [combatState.turn]);

    useEffect(() => {
        if (!combatNotice || typeof window === 'undefined') return undefined;
        const timer = window.setTimeout(() => setCombatNotice(null), 3500);
        return () => window.clearTimeout(timer);
    }, [combatNotice]);

    useEffect(() => {
        if (!activeNpcOverlayId) return undefined;
        if (typeof window === 'undefined') return undefined;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setActiveNpcOverlayId(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeNpcOverlayId]);

    useEffect(() => {
        if (!activeNpcOverlayId) return;
        if (!activeNpcToken || !activeNpcToken.meta) {
            setActiveNpcOverlayId(null);
        }
    }, [activeNpcOverlayId, activeNpcToken]);

    const activeDrawerId = mapState.drawer?.userId || game.dmId || null;
    const isActiveDrawer = activeDrawerId === me.id;
    const canDraw =
        isActiveDrawer && (isDM || (!mapState.paused && mapState.settings.allowPlayerDrawing));
    const isDrawTool = tool === 'draw';
    const isEraserTool = tool === 'erase';
    const isBackgroundTool = tool === 'background';
    const isShapeTool = tool === 'shape';
    const isBucketTool = tool === 'bucket';
    const isFreehandTool = isDrawTool || isEraserTool;
    const canPaint = canDraw && isFreehandTool;
    const tokenLayerPointerEvents =
        canPaint || isBackgroundTool || isBucketTool || (isDM && isShapeTool) ? 'none' : 'auto';
    const shapeLayerPointerEvents = isDM && isShapeTool ? 'auto' : 'none';
    const canvasPointerEvents = isBackgroundTool || isShapeTool ? 'none' : 'auto';
    const combatOrderPreview = combatState.order.join(' → ');
    const combatTimeline = useMemo(() => {
        const order = Array.isArray(combatState.order) ? combatState.order : [];
        if (order.length === 0) return [];
        const activeIndex = combatState.active
            ? Math.max(0, Math.min(order.length - 1, Math.round(combatState.turn || 1) - 1))
            : -1;
        return order.map((rawLabel, index) => {
            const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim() : `Entry ${index + 1}`;
            const safeId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'entry'}-${index}`;
            return {
                id: `active-${safeId}`,
                label,
                position: index + 1,
                isCurrent: activeIndex === index,
                isComplete: activeIndex !== -1 && index < activeIndex,
            };
        });
    }, [combatState.active, combatState.order, combatState.turn]);
    const combatTimelineDraft = useMemo(() => {
        if (!combatOrderDraft) return [];
        const lines = combatOrderDraft
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 32);
        return lines.map((label, index) => {
            const safeId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'entry'}-${index}`;
            return {
                id: `draft-${safeId}`,
                label,
                position: index + 1,
                isCurrent: false,
                isComplete: false,
            };
        });
    }, [combatOrderDraft]);

    useEffect(() => {
        if (!canDraw && (tool === 'draw' || tool === 'erase')) {
            setTool('select');
        } else if (!isDM && tool === 'background') {
            setTool('select');
        }
    }, [canDraw, isDM, tool]);

    useEffect(() => {
        if (activeDrawerId !== me.id) {
            setUndoStack([]);
        }
    }, [activeDrawerId, me.id]);

    useEffect(() => {
        setUndoStack((prev) => {
            const filtered = prev.filter((stroke) =>
                mapState.strokes.some((entry) => entry.id === stroke.id),
            );
            return filtered.length === prev.length ? prev : filtered;
        });
    }, [mapState.strokes]);
    const backgroundDisplay = useMemo(() => {
        const base = mapState.background || MAP_DEFAULT_BACKGROUND;
        if (dragPreview && dragPreview.kind === 'background') {
            return { ...base, x: dragPreview.x, y: dragPreview.y };
        }
        return base;
    }, [dragPreview, mapState.background]);
    const boardStyle = useMemo(
        () => ({ '--map-board-color': mapState.background?.color || MAP_DEFAULT_BACKGROUND.color }),
        [mapState.background?.color]
    );

    const drawerOptions = useMemo(() => {
        const options = [];
        if (game.dmId) {
            options.push({
                id: game.dmId,
                label: `Dungeon Master${game.dmId === me.id ? ' (you)' : ''}`,
            });
        }
        if (Array.isArray(game.players)) {
            for (const player of game.players) {
                if (!player || !player.userId) continue;
                if ((player.role || '').toLowerCase() === 'dm') continue;
                options.push({
                    id: player.userId,
                    label:
                        player.userId === me.id
                            ? `${describePlayerName(player)} (you)`
                            : describePlayerName(player),
                });
            }
        }
        return options;
    }, [game.dmId, game.players, me.id]);

    const activeDrawerLabel = useMemo(() => {
        if (!activeDrawerId || activeDrawerId === game.dmId) {
            return isDM ? 'You (Dungeon Master)' : 'Dungeon Master';
        }
        const drawerPlayer = playerMap.get(activeDrawerId);
        if (drawerPlayer) {
            const name = describePlayerName(drawerPlayer);
            if (activeDrawerId === me.id) {
                return `${name} (you)`;
            }
            return name;
        }
        if (activeDrawerId === me.id) {
            return 'You';
        }
        return 'Guest drawer';
    }, [activeDrawerId, game.dmId, isDM, me.id, playerMap]);

    const canUndo = isActiveDrawer && undoStack.length > 0 && !undoInFlight;
    const drawerSelectValue = activeDrawerId || game.dmId || '';
    const activeSidebarTab = useMemo(
        () => sidebarTabs.find((entry) => entry.key === sidebarTab) || sidebarTabs[0],
        [sidebarTab, sidebarTabs],
    );

    const demonMap = useMemo(() => {
        const map = new Map();
        if (Array.isArray(game.demons)) {
            for (const demon of game.demons) {
                if (!demon) continue;
                const addKey = (value, { allowLowercase = false } = {}) => {
                    const trimmed = typeof value === 'string' ? value.trim() : '';
                    if (!trimmed) return;
                    map.set(trimmed, demon);
                    if (allowLowercase) {
                        map.set(trimmed.toLowerCase(), demon);
                    }
                };
                addKey(demon.id);
                addKey(demon.slug, { allowLowercase: true });
                addKey(demon.query, { allowLowercase: true });
            }
        }
        return map;
    }, [game.demons]);

    const findDemon = useCallback(
        (value) => {
            const raw = typeof value === 'string' ? value.trim() : '';
            if (!raw) return null;
            if (demonMap.has(raw)) return demonMap.get(raw);
            const lower = raw.toLowerCase();
            if (demonMap.has(lower)) return demonMap.get(lower);
            if (!Array.isArray(game.demons)) return null;
            for (const demon of game.demons) {
                if (!demon) continue;
                const id = typeof demon.id === 'string' ? demon.id.trim() : '';
                if (id && id === raw) return demon;
                const slug = typeof demon.slug === 'string' ? demon.slug.trim().toLowerCase() : '';
                if (slug && slug === lower) return demon;
                const query = typeof demon.query === 'string' ? demon.query.trim().toLowerCase() : '';
                if (query && query === lower) return demon;
                const name = typeof demon.name === 'string' ? demon.name.trim().toLowerCase() : '';
                if (name && name === lower) return demon;
            }
            return null;
        },
        [demonMap, game.demons],
    );

    useEffect(() => {
        if (!demonChoice) return;
        const demon = findDemon(demonChoice);
        if (!demon) return;
        const defaultLabel = demon.name || 'Demon';
        setDemonTokenConfig((prev) => {
            if (prev.label) return prev;
            return { ...prev, label: defaultLabel };
        });
    }, [demonChoice, findDemon]);

    const playerTokens = useMemo(
        () => mapState.tokens.filter((token) => token.kind === 'player'),
        [mapState.tokens]
    );
    const demonTokens = useMemo(
        () => mapState.tokens.filter((token) => token.kind === 'demon'),
        [mapState.tokens]
    );
    const enemyTokens = useMemo(
        () => mapState.tokens.filter((token) => token.kind === 'enemy'),
        [mapState.tokens]
    );
    const imageShapes = useMemo(
        () => mapState.shapes.filter((shape) => shape.type === 'image'),
        [mapState.shapes]
    );
    const areaShapes = useMemo(
        () => mapState.shapes.filter((shape) => shape.type !== 'image'),
        [mapState.shapes]
    );
    const enemyDetailsInfo = useMemo(
        () => buildEnemyInfoFromDetails(enemyForm.details, { fallbackLabel: enemyForm.label || 'Enemy' }),
        [enemyForm.details, enemyForm.label]
    );
    const enemyFormValid = enemyForm.label.trim().length > 0;
    const enemyFormHasVisibleTooltip = enemyHasVisibleContent(enemyDetailsInfo);

    const availablePlayers = useMemo(() => {
        if (!isDM) return [];
        const taken = new Set(playerTokens.map((token) => token.refId));
        return (game.players || [])
            .filter(
                (player) =>
                    player &&
                    player.userId &&
                    (player.role || '').toLowerCase() !== 'dm' &&
                    !taken.has(player.userId)
            )
            .map((player) => ({
                id: player.userId,
                label: describePlayerName(player),
                subtitle: describePlayerTooltip(player),
            }));
    }, [game.players, isDM, playerTokens]);

    const demonOptions = useMemo(() => {
        if (!isDM) return [];
        const term = demonQuery.trim().toLowerCase();
        return (game.demons || [])
            .filter(
                (demon) =>
                    demon &&
                    demon.id &&
                    (!term || (demon.name || '').toLowerCase().includes(term))
            )
            .slice(0, 25)
            .map((demon) => ({
                id: demon.id,
                label: demon.name || 'Demon',
                subtitle: describeDemonTooltip(demon),
            }));
    }, [demonQuery, game.demons, isDM]);

    const enemyDemonOptions = useMemo(() => {
        if (!isDM) return [];
        const term = enemyQuery.trim().toLowerCase();
        return (game.demons || [])
            .filter(
                (demon) =>
                    demon &&
                    demon.id &&
                    (!term || (demon.name || '').toLowerCase().includes(term))
            )
            .slice(0, 25)
            .map((demon) => ({
                id: demon.id,
                label: demon.name || 'Demon',
                subtitle: describeDemonTooltip(demon),
            }));
    }, [enemyQuery, game.demons, isDM]);

    const getPointerPosition = useCallback(
        (event) => {
            const board = boardRef.current;
            if (!board) return { x: 0, y: 0 };
            const rect = board.getBoundingClientRect();
            const clientX = event.clientX ?? (event.touches?.[0]?.clientX ?? 0);
            const clientY = event.clientY ?? (event.touches?.[0]?.clientY ?? 0);
            const x = rect.width ? (clientX - rect.left) / rect.width : 0;
            const y = rect.height ? (clientY - rect.top) / rect.height : 0;
            return { x: mapClamp01(x), y: mapClamp01(y) };
        },
        []
    );

    const handleUpdateBackground = useCallback(
        async (patch) => {
            if (!isDM) return;
            try {
                const response = await Games.updateMapBackground(game.id, patch);
                const normalized = normalizeClientMapBackground(response);
                setMapState((prev) => ({
                    ...prev,
                    background: normalized,
                    updatedAt: new Date().toISOString(),
                }));
                setBackgroundDraft(normalized);
                const keys = Object.keys(patch || {});
                const summary = keys.length > 0 ? keys.join(', ') : 'background';
                logBattle('map:background:update', `Updated background (${summary})`, patch);
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM, logBattle]
    );

    const queueBackgroundUpdate = useCallback(
        (updates) => {
            setBackgroundDraft((prev) => ({ ...prev, ...updates }));
            if (backgroundUpdateTimerRef.current) {
                window.clearTimeout(backgroundUpdateTimerRef.current);
            }
            backgroundUpdateTimerRef.current = window.setTimeout(() => {
                const base = latestBackgroundRef.current || MAP_DEFAULT_BACKGROUND;
                const target = backgroundDraftRef.current || base;
                const patch = {};
                if ((target.url || '') !== (base.url || '')) patch.url = target.url;
                if (Math.abs(target.x - base.x) > 0.0005) patch.x = target.x;
                if (Math.abs(target.y - base.y) > 0.0005) patch.y = target.y;
                if (Math.abs(target.scale - base.scale) > 0.001) patch.scale = target.scale;
                if (Math.abs(target.rotation - base.rotation) > 0.5) patch.rotation = target.rotation;
                if (Math.abs(target.opacity - base.opacity) > 0.01) patch.opacity = target.opacity;
                if ((target.color || '') !== (base.color || '')) patch.color = target.color;
                if (Object.keys(patch).length === 0) return;
                handleUpdateBackground(patch);
            }, 200);
        },
        [handleUpdateBackground]
    );

    const handleClearBackground = useCallback(async () => {
        if (!isDM) return;
        try {
            const response = await Games.clearMapBackground(game.id);
            const normalized = response?.background
                ? normalizeClientMapBackground(response.background)
                : { ...MAP_DEFAULT_BACKGROUND };
            setMapState((prev) => ({
                ...prev,
                background: normalized,
                updatedAt: new Date().toISOString(),
            }));
            setBackgroundDraft(normalized);
            logBattle('map:background:clear', 'Cleared battle map background');
        } catch (err) {
            alert(err.message);
        }
    }, [game.id, isDM, logBattle]);

    const handleBackgroundPointerDown = useCallback(
        (event) => {
            if (!isDM || !isBackgroundTool) return;
            event.preventDefault();
            const { x, y } = getPointerPosition(event);
            const base = mapState.background || MAP_DEFAULT_BACKGROUND;
            const offsetX = x - base.x;
            const offsetY = y - base.y;
            const target = event.currentTarget;
            if (target?.setPointerCapture) {
                try {
                    target.setPointerCapture(event.pointerId);
                } catch {
                    // ignore capture errors
                }
            }
            setDragging({ kind: 'background', pointerId: event.pointerId, offsetX, offsetY });
            setDragPreview({ kind: 'background', x: mapClamp01(x - offsetX), y: mapClamp01(y - offsetY) });
        },
        [getPointerPosition, isBackgroundTool, isDM, mapState.background]
    );

    const handleBackgroundPointerMove = useCallback(
        (event) => {
            if (!dragging || dragging.kind !== 'background') return;
            const { x, y } = getPointerPosition(event);
            setDragPreview({
                kind: 'background',
                x: mapClamp01(x - dragging.offsetX),
                y: mapClamp01(y - dragging.offsetY),
            });
        },
        [dragging, getPointerPosition]
    );

    const handleBackgroundPointerUp = useCallback(
        (event) => {
            if (!dragging || dragging.kind !== 'background') return;
            const target = event.currentTarget;
            if (target?.releasePointerCapture) {
                try {
                    target.releasePointerCapture(dragging.pointerId);
                } catch {
                    // ignore release errors
                }
            }
            const coords =
                dragPreview && dragPreview.kind === 'background'
                    ? { x: dragPreview.x, y: dragPreview.y }
                    : { x: mapState.background?.x ?? 0.5, y: mapState.background?.y ?? 0.5 };
            setDragging(null);
            setDragPreview(null);
            setMapState((prev) => ({
                ...prev,
                background: { ...prev.background, ...coords },
            }));
            queueBackgroundUpdate(coords);
        },
        [dragPreview, dragging, mapState.background?.x, mapState.background?.y, queueBackgroundUpdate]
    );

    const sendStroke = useCallback(
        async (strokePayload) => {
            try {
                const response = await Games.addMapStroke(game.id, strokePayload);
                const normalized = normalizeClientMapStroke(response);
                if (normalized) {
                    setMapState((prev) => ({
                        ...prev,
                        strokes: prev.strokes.concat(normalized),
                        updatedAt: normalized.createdAt || response?.createdAt || prev.updatedAt,
                    }));
                    if (normalized.createdBy === me.id) {
                        setUndoStack((prev) => {
                            const next = prev.concat(normalized);
                            return next.length > MAP_UNDO_STACK_LIMIT
                                ? next.slice(next.length - MAP_UNDO_STACK_LIMIT)
                                : next;
                        });
                    }
                    const pointCount = Array.isArray(normalized.points) ? normalized.points.length : 0;
                    const modeLabel = normalized.mode === 'erase' ? 'eraser' : 'brush';
                    logBattle('map:stroke:add', `Added ${modeLabel} stroke (${pointCount} points)`, {
                        strokeId: normalized.id,
                        mode: normalized.mode,
                        size: normalized.size,
                        color: normalized.color,
                        points: pointCount,
                    });
                }
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, logBattle, me.id]
    );

    const completeStroke = useCallback(() => {
        setDraftStroke((current) => {
            if (!current || current.points.length < 2) {
                setIsDrawing(false);
                return null;
            }
            sendStroke({
                color: current.color,
                size: current.size,
                points: current.points,
                mode: current.mode || 'draw',
            });
            setIsDrawing(false);
            return null;
        });
    }, [sendStroke]);

    const handleUndo = useCallback(async () => {
        if (!isActiveDrawer || undoStack.length === 0 || undoInFlight) return;
        const target = undoStack[undoStack.length - 1];
        setUndoInFlight(true);
        try {
            await Games.deleteMapStroke(game.id, target.id);
            setMapState((prev) => ({
                ...prev,
                strokes: prev.strokes.filter((stroke) => stroke.id !== target.id),
            }));
            setUndoStack((prev) => prev.slice(0, -1));
            logBattle('map:stroke:undo', `Undid stroke ${target.id}`, { strokeId: target.id });
        } catch (err) {
            alert(err.message);
        } finally {
            setUndoInFlight(false);
        }
    }, [game.id, isActiveDrawer, logBattle, undoInFlight, undoStack]);

    const handleCanvasPointerDown = useCallback(
        (event) => {
            if (isBucketTool) {
                if (!isDM) return;
                event.preventDefault();
                const normalized = isHexColor(brushColor)
                    ? brushColor.trim().toLowerCase()
                    : MAP_DEFAULT_BACKGROUND.color;
                setMapState((prev) => {
                    const previousBackground = prev.background || MAP_DEFAULT_BACKGROUND;
                    return {
                        ...prev,
                        background: { ...previousBackground, color: normalized },
                    };
                });
                setBackgroundDraft((prev) => ({
                    ...(prev || MAP_DEFAULT_BACKGROUND),
                    color: normalized,
                }));
                handleUpdateBackground({ color: normalized });
                return;
            }
            if (!canPaint) return;
            event.preventDefault();
            const { x, y } = getPointerPosition(event);
            setDraftStroke({
                id: `draft-${Date.now()}`,
                color: isEraserTool ? '#000000' : brushColor,
                size: brushSize,
                points: [{ x, y }],
                mode: isEraserTool ? 'erase' : 'draw',
            });
            setIsDrawing(true);
            const canvas = canvasRef.current;
            if (canvas?.setPointerCapture) {
                try {
                    canvas.setPointerCapture(event.pointerId);
                } catch {
                    // ignore capture errors
                }
            }
        },
        [
            brushColor,
            brushSize,
            canPaint,
            getPointerPosition,
            handleUpdateBackground,
            isBucketTool,
            isDM,
            isEraserTool,
        ]
    );

    const handleCanvasPointerMove = useCallback(
        (event) => {
            if (!isDrawing) return;
            const { x, y } = getPointerPosition(event);
            setDraftStroke((prev) => {
                if (!prev) return prev;
                if (prev.points.length >= MAP_MAX_POINTS_PER_STROKE) return prev;
                const last = prev.points[prev.points.length - 1];
                if (last && Math.abs(last.x - x) < 0.002 && Math.abs(last.y - y) < 0.002) {
                    return prev;
                }
                return { ...prev, points: prev.points.concat({ x, y }) };
            });
        },
        [getPointerPosition, isDrawing]
    );

    const handleCanvasPointerFinish = useCallback(
        (event) => {
            if (isBucketTool) return;
            if (canvasRef.current?.releasePointerCapture) {
                try {
                    canvasRef.current.releasePointerCapture(event.pointerId);
                } catch {
                    // ignore release errors
                }
            }
            if (isDrawing || draftStroke) {
                completeStroke();
            }
        },
        [completeStroke, draftStroke, isBucketTool, isDrawing]
    );

    useEffect(() => {
        const canvas = canvasRef.current;
        const board = boardRef.current;
        if (!canvas || !board) return;
        const width = boardSize.width || board.clientWidth;
        const height = boardSize.height || board.clientHeight;
        if (!width || !height) return;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);
        const strokes = [...mapState.strokes];
        if (draftStroke) strokes.push(draftStroke);
        for (const stroke of strokes) {
            if (!stroke || stroke.points.length < 2) continue;
            ctx.beginPath();
            if (stroke.mode === 'erase') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = stroke.color || MAP_BRUSH_COLORS[0];
            }
            ctx.lineWidth = stroke.size || 3;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            const first = stroke.points[0];
            ctx.moveTo(first.x * width, first.y * height);
            for (let i = 1; i < stroke.points.length; i += 1) {
                const point = stroke.points[i];
                ctx.lineTo(point.x * width, point.y * height);
            }
            ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
    }, [boardSize.height, boardSize.width, draftStroke, mapState.strokes]);

    const canMoveToken = useCallback(
        (token) => {
            if (!token) return false;
            if (isDM) return true;
            if (mapState.paused) return false;
            if (!mapState.settings.allowPlayerTokenMoves) return false;
            return token.ownerId === me.id;
        },
        [isDM, mapState.paused, mapState.settings.allowPlayerTokenMoves, me.id]
    );

    const handleTokenPointerDown = useCallback(
        (token, event) => {
            if (!canMoveToken(token)) return;
            event.preventDefault();
            event.stopPropagation();
            const target = event.currentTarget;
            if (target?.setPointerCapture) {
                try {
                    target.setPointerCapture(event.pointerId);
                } catch {
                    // ignore capture errors
                }
            }
            const { x, y } = getPointerPosition(event);
            setDragging({ kind: 'token', id: token.id, pointerId: event.pointerId });
            setDragPreview({ kind: 'token', id: token.id, x, y });
        },
        [canMoveToken, getPointerPosition]
    );

    const handleTokenPointerMove = useCallback(
        (token, event) => {
            if (!dragging || dragging.kind !== 'token' || dragging.id !== token.id) return;
            const { x, y } = getPointerPosition(event);
            setDragPreview({ kind: 'token', id: token.id, x, y });
        },
        [dragging, getPointerPosition]
    );

    const handleTokenPointerUp = useCallback(
        (token, event) => {
            if (!dragging || dragging.kind !== 'token' || dragging.id !== token.id) return;
            const target = event.currentTarget;
            if (target?.releasePointerCapture) {
                try {
                    target.releasePointerCapture(dragging.pointerId);
                } catch {
                    // ignore release errors
                }
            }
            const coords =
                dragPreview && dragPreview.kind === 'token' && dragPreview.id === token.id
                    ? { x: dragPreview.x, y: dragPreview.y }
                    : { x: token.x, y: token.y };
            setDragging(null);
            setDragPreview(null);
            (async () => {
                try {
                    const response = await Games.updateMapToken(game.id, token.id, coords);
                    const normalized = normalizeClientMapToken(response);
                    setMapState((prev) => ({
                        ...prev,
                        tokens: prev.tokens.map((entry) =>
                            entry.id === token.id
                                ? normalized || { ...entry, x: coords.x, y: coords.y }
                                : entry
                        ),
                        updatedAt: response?.updatedAt || prev.updatedAt,
                    }));
                    const label = normalized?.label || token.label || token.id;
                    const targetCoords = normalized ? { x: normalized.x, y: normalized.y } : coords;
                    logBattle('map:token:update', `Moved token ${label}`, {
                        tokenId: token.id,
                        x: targetCoords.x,
                        y: targetCoords.y,
                    });
                } catch (err) {
                    alert(err.message);
                }
            })();
        },
        [dragPreview, dragging, game.id, logBattle]
    );

    const handleToggleTooltip = useCallback(
        async (token, nextValue) => {
            try {
                const response = await Games.updateMapToken(game.id, token.id, {
                    showTooltip: nextValue,
                });
                const normalized = normalizeClientMapToken(response);
                if (normalized) {
                    setMapState((prev) => ({
                        ...prev,
                        tokens: prev.tokens.map((entry) =>
                            entry.id === normalized.id ? normalized : entry
                        ),
                        updatedAt: response?.updatedAt || prev.updatedAt,
                    }));
                    const label = normalized.label || token.label || token.id;
                    logBattle(
                        'map:token:update',
                        `${nextValue ? 'Enabled' : 'Disabled'} tooltip for ${label}`,
                        { tokenId: normalized.id, showTooltip: normalized.showTooltip },
                    );
                }
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, logBattle]
    );

    const handleRemoveToken = useCallback(
        async (token) => {
            if (!isDM) return;
            if (!confirm('Remove this token from the map?')) return;
            try {
                await Games.deleteMapToken(game.id, token.id);
                setMapState((prev) => ({
                    ...prev,
                    tokens: prev.tokens.filter((entry) => entry.id !== token.id),
                    updatedAt: new Date().toISOString(),
                }));
                logBattle('map:token:remove', `Removed token ${token.label || token.id}`, {
                    tokenId: token.id,
                    kind: token.kind,
                });
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM, logBattle]
    );

    const handleAddPlayerToken = useCallback(async () => {
        if (!playerChoice) return;
        const player = playerMap.get(playerChoice);
        if (!player) {
            alert('Select a valid party member.');
            return;
        }
        const metaPayload = buildPlayerTokenMeta(player, playerTokenConfig);
        if (!metaPayload) return;
        const tooltipPayload = encodeTokenTooltip(metaPayload);
        try {
            const response = await Games.addMapToken(game.id, {
                kind: 'player',
                refId: playerChoice,
                label: metaPayload.label || undefined,
                tooltip: tooltipPayload,
                showTooltip: metaPayload.showTooltip,
            });
            const normalized = normalizeClientMapToken(response);
            if (normalized) {
                setMapState((prev) => ({
                    ...prev,
                    tokens: prev.tokens.concat(normalized),
                    updatedAt: response?.updatedAt || prev.updatedAt,
                }));
                const playerMeta = playerMap.get(normalized.refId);
                const label = playerMeta ? describePlayerName(playerMeta) : normalized.label || 'Player token';
                logBattle('map:token:add', `Placed player token for ${label}`, {
                    tokenId: normalized.id,
                    kind: normalized.kind,
                    refId: normalized.refId || null,
                });
            }
            setPlayerChoice('');
            setPlayerTokenConfig(createPlayerTokenConfig());
        } catch (err) {
            alert(err.message);
        }
    }, [game.id, logBattle, playerChoice, playerMap, playerTokenConfig]);

    const handleAddDemonToken = useCallback(async () => {
        if (demonCreationMode !== 'ally') return;
        if (!demonChoice) return;
        const demon = findDemon(demonChoice);
        if (!demon) {
            alert('Select a demon from the codex.');
            return;
        }
        const metaPayload = buildDemonAllyMeta(demon, demonTokenConfig);
        if (!metaPayload) return;
        const tooltipPayload = encodeTokenTooltip(metaPayload);
        try {
            const response = await Games.addMapToken(game.id, {
                kind: 'demon',
                refId: demonChoice,
                label: metaPayload.label || undefined,
                tooltip: tooltipPayload,
                showTooltip: metaPayload.showTooltip,
            });
            const normalized = normalizeClientMapToken(response);
            if (normalized) {
                setMapState((prev) => ({
                    ...prev,
                    tokens: prev.tokens.concat(normalized),
                    updatedAt: response?.updatedAt || prev.updatedAt,
                }));
                const demonInfo = findDemon(normalized.refId);
                const label = demonInfo?.name || normalized.label || 'Demon token';
                logBattle('map:token:add', `Placed demon token for ${label}`, {
                    tokenId: normalized.id,
                    kind: normalized.kind,
                    refId: normalized.refId || null,
                });
            }
            setDemonChoice('');
            setDemonTokenConfig(createDemonTokenConfig());
        } catch (err) {
            alert(err.message);
        }
    }, [demonChoice, demonCreationMode, demonTokenConfig, findDemon, game.id, logBattle]);

    const handleSubmitEnemyToken = useCallback(async () => {
        const name = enemyForm.label.trim();
        if (!name) return;
        try {
            const info = buildEnemyInfoFromDetails(enemyForm.details, { fallbackLabel: name });
            const payload = {
                kind: 'enemy',
                label: name,
                color: enemyForm.color || MAP_ENEMY_DEFAULT_COLOR,
                showTooltip: !!enemyForm.showTooltip && enemyHasVisibleContent(info),
            };
            if (enemyHasVisibleContent(info) || info.demonId) {
                const encoded = encodeEnemyTooltip(info);
                if (encoded) {
                    payload.tooltip = encoded;
                }
            }
            if (enemyForm.id) {
                const response = await Games.updateMapToken(game.id, enemyForm.id, {
                    ...payload,
                    tooltip: payload.tooltip ?? '',
                });
                const normalized = normalizeClientMapToken(response);
                if (normalized) {
                    setMapState((prev) => ({
                        ...prev,
                        tokens: prev.tokens.map((entry) => (entry.id === normalized.id ? normalized : entry)),
                        updatedAt: response?.updatedAt || prev.updatedAt,
                    }));
                    const label = normalized.label || name;
                    logBattle('map:token:update', `Updated enemy token ${label}`, {
                        tokenId: normalized.id,
                        kind: normalized.kind,
                    });
                }
            } else {
                const response = await Games.addMapToken(game.id, payload);
                const normalized = normalizeClientMapToken(response);
                if (normalized) {
                    setMapState((prev) => ({
                        ...prev,
                        tokens: prev.tokens.concat(normalized),
                        updatedAt: response?.updatedAt || prev.updatedAt,
                    }));
                    const label = normalized.label || name;
                    logBattle('map:token:add', `Placed enemy token ${label}`, {
                        tokenId: normalized.id,
                        kind: normalized.kind,
                    });
                }
            }
            resetEnemyForm();
        } catch (err) {
            alert(err.message);
        }
    }, [enemyForm, game.id, logBattle, resetEnemyForm]);

    const handleSubmitNpcToken = useCallback(async () => {
        const metaPayload = buildNpcTokenMeta(npcForm);
        if (!metaPayload) return;
        try {
            const payload = {
                kind: 'npc',
                label: metaPayload.label || undefined,
                color: npcForm.color || '#10b981',
                tooltip: encodeTokenTooltip(metaPayload),
                showTooltip: metaPayload.showTooltip,
            };
            const response = await Games.addMapToken(game.id, payload);
            const normalized = normalizeClientMapToken(response);
            if (normalized) {
                setMapState((prev) => ({
                    ...prev,
                    tokens: prev.tokens.concat(normalized),
                    updatedAt: response?.updatedAt || prev.updatedAt,
                }));
                const label = normalized.label || metaPayload.label || 'NPC';
                logBattle('map:token:add', `Placed NPC token ${label}`, {
                    tokenId: normalized.id,
                    kind: normalized.kind,
                });
            }
            setNpcForm((prev) => createNpcTokenState({ type: prev.type }));
        } catch (err) {
            alert(err.message);
        }
    }, [game.id, logBattle, npcForm]);

    const handleAddShape = useCallback(
        async (type, extras = {}) => {
            if (!isDM) return;
            try {
                const response = await Games.addMapShape(game.id, { type, ...extras });
                const normalized = normalizeClientMapShape(response);
                if (normalized) {
                    setMapState((prev) => ({
                        ...prev,
                        shapes: prev.shapes.concat(normalized),
                        updatedAt: response?.updatedAt || prev.updatedAt,
                    }));
                    const label = MAP_SHAPE_LABELS[normalized.type] || normalized.type;
                    logBattle('map:shape:add', `Added ${label} shape`, {
                        shapeId: normalized.id,
                        type: normalized.type,
                    });
                }
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM, logBattle]
    );

    const handleUpdateShape = useCallback(
        async (shapeId, patch) => {
            if (!isDM) return;
            try {
                const response = await Games.updateMapShape(game.id, shapeId, patch);
                const normalized = normalizeClientMapShape(response);
                if (normalized) {
                    setMapState((prev) => ({
                        ...prev,
                        shapes: prev.shapes.map((shape) => (shape.id === shapeId ? normalized : shape)),
                        updatedAt: response?.updatedAt || prev.updatedAt,
                    }));
                    const label = MAP_SHAPE_LABELS[normalized.type] || normalized.type;
                    logBattle('map:shape:update', `Updated ${label} shape`, {
                        shapeId: normalized.id,
                        type: normalized.type,
                        patch,
                    });
                }
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM, logBattle]
    );

    const handleRemoveShape = useCallback(
        async (shapeId) => {
            if (!isDM) return;
            if (!shapeId) return;
            if (!window.confirm('Remove this shape from the map?')) return;
            const targetShape = mapState.shapes.find((shape) => shape.id === shapeId);
            try {
                await Games.deleteMapShape(game.id, shapeId);
                setMapState((prev) => ({
                    ...prev,
                    shapes: prev.shapes.filter((shape) => shape.id !== shapeId),
                    updatedAt: new Date().toISOString(),
                }));
                const label = targetShape ? MAP_SHAPE_LABELS[targetShape.type] || targetShape.type : 'shape';
                logBattle('map:shape:remove', `Removed ${label}`, { shapeId });
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM, logBattle, mapState.shapes]
    );

    const handleShapePointerDown = useCallback(
        (shape, event) => {
            if (!shape || !isDM || tool !== 'shape') return;
            event.preventDefault();
            event.stopPropagation();
            setSelectedShapeId(shape.id);
            const { x, y } = getPointerPosition(event);
            const offsetX = x - shape.x;
            const offsetY = y - shape.y;
            const target = event.currentTarget;
            if (target?.setPointerCapture) {
                try {
                    target.setPointerCapture(event.pointerId);
                } catch {
                    // ignore capture errors
                }
            }
            setDragging({ kind: 'shape', id: shape.id, pointerId: event.pointerId, offsetX, offsetY });
            setDragPreview({ kind: 'shape', id: shape.id, x: mapClamp01(x - offsetX), y: mapClamp01(y - offsetY) });
        },
        [getPointerPosition, isDM, tool]
    );

    const handleShapePointerMove = useCallback(
        (shape, event) => {
            if (!shape || !dragging || dragging.kind !== 'shape' || dragging.id !== shape.id) return;
            const { x, y } = getPointerPosition(event);
            setDragPreview({
                kind: 'shape',
                id: shape.id,
                x: mapClamp01(x - dragging.offsetX),
                y: mapClamp01(y - dragging.offsetY),
            });
        },
        [dragging, getPointerPosition]
    );

    const handleShapePointerUp = useCallback(
        (shape, event) => {
            if (!shape || !dragging || dragging.kind !== 'shape' || dragging.id !== shape.id) return;
            const target = event.currentTarget;
            if (target?.releasePointerCapture) {
                try {
                    target.releasePointerCapture(dragging.pointerId);
                } catch {
                    // ignore release errors
                }
            }
            const coords =
                dragPreview && dragPreview.kind === 'shape' && dragPreview.id === shape.id
                    ? { x: dragPreview.x, y: dragPreview.y }
                    : { x: shape.x, y: shape.y };
            setDragging(null);
            setDragPreview(null);
            setMapState((prev) => ({
                ...prev,
                shapes: prev.shapes.map((entry) => (entry.id === shape.id ? { ...entry, ...coords } : entry)),
            }));
            handleUpdateShape(shape.id, coords);
        },
        [dragPreview, dragging, handleUpdateShape]
    );

    const handleShapeHandlePointerDown = useCallback(
        (shape, mode, event) => {
            if (!shape || !isDM || tool !== 'shape') return;
            event.preventDefault();
            event.stopPropagation();
            setSelectedShapeId(shape.id);
            const pointer = getPointerPosition(event);
            const target = event.currentTarget;
            if (target?.setPointerCapture) {
                try {
                    target.setPointerCapture(event.pointerId);
                } catch {
                    // ignore capture errors
                }
            }
            setDragging({
                kind: 'shape-handle',
                id: shape.id,
                mode,
                pointerId: event.pointerId,
                origin: {
                    pointerX: pointer.x,
                    pointerY: pointer.y,
                    x: shape.x,
                    y: shape.y,
                    width: shape.width,
                    height: shape.height,
                    rotation: shape.rotation,
                    ratio: shape.height === 0 ? 1 : shape.width / shape.height,
                },
                draft: {
                    width: shape.width,
                    height: shape.height,
                    rotation: shape.rotation,
                },
            });
        },
        [getPointerPosition, isDM, tool]
    );

    const handleShapeHandlePointerMove = useCallback(
        (shape, event) => {
            if (!shape || !dragging || dragging.kind !== 'shape-handle' || dragging.id !== shape.id) return;
            const pointer = getPointerPosition(event);
            if (dragging.mode === 'scale') {
                const centerX = shape.x;
                const centerY = shape.y;
                const width = clamp(Math.abs(pointer.x - centerX) * 2, 0.1, 1, dragging.origin.width);
                const height = clamp(Math.abs(pointer.y - centerY) * 2, 0.1, 1, dragging.origin.height);
                let nextWidth = width;
                let nextHeight = height;
                if (event.shiftKey) {
                    const ratio = dragging.origin.ratio || 1;
                    if (ratio > 0) {
                        if (width / height > ratio) {
                            nextWidth = clamp(height * ratio, 0.1, 1, dragging.origin.width);
                            nextHeight = clamp(nextWidth / ratio, 0.1, 1, dragging.origin.height);
                        } else {
                            nextHeight = clamp(width / ratio, 0.1, 1, dragging.origin.height);
                            nextWidth = clamp(nextHeight * ratio, 0.1, 1, dragging.origin.width);
                        }
                    }
                }
                setDragging((prev) => {
                    if (!prev || prev.kind !== 'shape-handle' || prev.id !== shape.id) return prev;
                    return {
                        ...prev,
                        draft: {
                            ...prev.draft,
                            width: nextWidth,
                            height: nextHeight,
                        },
                    };
                });
                setMapState((prev) => ({
                    ...prev,
                    shapes: prev.shapes.map((entry) =>
                        entry.id === shape.id
                            ? {
                                  ...entry,
                                  width: nextWidth,
                                  height: nextHeight,
                              }
                            : entry
                    ),
                }));
            } else if (dragging.mode === 'rotate') {
                const angleRadians = Math.atan2(pointer.y - shape.y, pointer.x - shape.x);
                let angle = (angleRadians * 180) / Math.PI + 90;
                angle = ((angle % 360) + 360) % 360;
                setDragging((prev) => {
                    if (!prev || prev.kind !== 'shape-handle' || prev.id !== shape.id) return prev;
                    return {
                        ...prev,
                        draft: {
                            ...prev.draft,
                            rotation: angle,
                        },
                    };
                });
                setMapState((prev) => ({
                    ...prev,
                    shapes: prev.shapes.map((entry) =>
                        entry.id === shape.id
                            ? {
                                  ...entry,
                                  rotation: angle,
                              }
                            : entry
                    ),
                }));
            }
        },
        [dragging, getPointerPosition]
    );

    const handleShapeHandlePointerUp = useCallback(
        (shape, event) => {
            if (!shape || !dragging || dragging.kind !== 'shape-handle' || dragging.id !== shape.id) return;
            const target = event.currentTarget;
            if (target?.releasePointerCapture) {
                try {
                    target.releasePointerCapture(dragging.pointerId);
                } catch {
                    // ignore release errors
                }
            }
            const patch = {};
            if (dragging.mode === 'scale' && dragging.draft) {
                patch.width = dragging.draft.width;
                patch.height = dragging.draft.height;
            }
            if (dragging.mode === 'rotate' && dragging.draft) {
                patch.rotation = dragging.draft.rotation;
            }
            setDragging(null);
            if (Object.keys(patch).length > 0) {
                handleUpdateShape(shape.id, patch);
            }
        },
        [dragging, handleUpdateShape]
    );

    const storyConfigured = !!game.story?.webhookConfigured;

    const handleEditEnemyToken = useCallback(
        (token) => {
            if (!isDM || !token) return;
            const details = detailsFromEnemyInfo(token.enemyInfo || {}, { fallbackLabel: token.label || 'Enemy' });
            setEnemyForm({
                id: token.id,
                label: token.label || '',
                color: token.color || MAP_ENEMY_DEFAULT_COLOR,
                showTooltip: token.showTooltip,
                details,
            });
            setEnemyDemonChoice(details.demonId || '');
            setSidebarTab('tokens');
            setTokenCreationTab('demon');
            setDemonCreationMode('enemy');
        },
        [isDM]
    );

    const handleImportEnemyDemon = useCallback(() => {
        if (!isDM) return;
        const slug = (enemyDemonChoice || '').trim();
        if (!slug) return;
        const demon = findDemon(slug);
        if (!demon) return;
        const statsText = describeDemonEnemyStats(demon);
        const description = clampText(demon.description, 280);
        setEnemyForm((prev) => {
            const nextName = demon.name || prev.details.name || prev.label || 'Enemy';
            const nextStats = statsText || prev.details.stats;
            const nextNotes = prev.details.notes || description;
            return {
                ...prev,
                label: prev.id ? prev.label : prev.label || demon.name || 'Enemy',
                details: {
                    ...prev.details,
                    demonId: demon.id || prev.details.demonId || '',
                    name: nextName,
                    image: demon.image || prev.details.image || '',
                    stats: nextStats,
                    notes: nextNotes,
                    showName: true,
                    showImage: !!(demon.image || prev.details.image),
                    showStats: !!nextStats,
                    showNotes: !!nextNotes,
                },
            };
        });
        setEnemyDemonChoice('');
    }, [enemyDemonChoice, findDemon, isDM]);

    const handleShareMapToStory = useCallback(
        async () => {
            if (!isDM) return;
            if (!storyConfigured) {
                alert('Connect a story log webhook in Campaign Settings to share battle maps.');
                return;
            }
            const lines = ['Battle map update from the DM board.'];
            if (mapState.background?.url) {
                lines.push(mapState.background.url);
            }
            const tokenSummary = mapState.tokens.map((token) => token.label).filter(Boolean).join(', ');
            if (tokenSummary) {
                lines.push(`Tokens in play: ${tokenSummary}`);
            }
            try {
                await StoryLogs.post(game.id, { persona: 'dm', content: lines.join('\n') });
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM, mapState.background?.url, mapState.tokens, storyConfigured]
    );

    const handleSaveMap = useCallback(async () => {
        if (!isDM) return;
        const defaultName = `Battle Map ${mapLibrary.length + 1}`;
        const name = typeof window !== 'undefined' ? window.prompt('Name this battle map', defaultName) : defaultName;
        if (name === null) return;
        try {
            const response = await Games.saveMapLibrary(game.id, name);
            if (Array.isArray(response?.maps)) {
                setMapLibrary(normalizeMapLibrary(response.maps));
            } else if (response?.entry) {
                setMapLibrary((prev) => normalizeMapLibrary(prev.concat(response.entry)));
            } else {
                await refreshMapLibrary();
            }
            const label = typeof name === 'string' && name.trim() ? name.trim() : defaultName;
            logBattle('map:library:save', `Saved map "${label}"`, {
                entryId: response?.entry?.id || null,
            });
        } catch (err) {
            alert(err.message);
        }
    }, [game.id, isDM, logBattle, mapLibrary.length, refreshMapLibrary]);

    const handleLoadSavedMap = useCallback(
        async (entry) => {
            if (!isDM || !entry?.id) return;
            if (typeof window !== 'undefined') {
                const confirmed = window.confirm(`Load "${entry.name}" and replace the current battle map?`);
                if (!confirmed) return;
            }
            try {
                const response = await Games.loadMapLibrary(game.id, entry.id);
                if (response?.map) {
                    setMapState(normalizeClientMapState(response.map));
                }
                if (Array.isArray(response?.maps)) {
                    setMapLibrary(normalizeMapLibrary(response.maps));
                } else if (response?.entry) {
                    setMapLibrary((prev) =>
                        normalizeMapLibrary(prev.map((item) => (item.id === response.entry.id ? response.entry : item)))
                    );
                } else {
                    await refreshMapLibrary();
                }
                logBattle('map:library:load', `Loaded saved map "${entry.name}"`, { entryId: entry.id });
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM, logBattle, refreshMapLibrary]
    );

    const handleDeleteSavedMap = useCallback(
        async (entry) => {
            if (!isDM || !entry?.id) return;
            if (typeof window !== 'undefined') {
                const confirmed = window.confirm(`Delete "${entry.name}" from your saved battle maps?`);
                if (!confirmed) return;
            }
            try {
                const response = await Games.deleteMapLibrary(game.id, entry.id);
                if (Array.isArray(response?.maps)) {
                    setMapLibrary(normalizeMapLibrary(response.maps));
                } else {
                    setMapLibrary((prev) => prev.filter((item) => item.id !== entry.id));
                }
                logBattle('map:library:delete', `Deleted saved map "${entry.name}"`, { entryId: entry.id });
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM, logBattle]
    );

    const handleTogglePause = useCallback(async () => {
        try {
            const updated = await Games.updateMapSettings(game.id, { paused: !mapState.paused });
            setMapState(normalizeClientMapState(updated));
            logBattle(
                'map:settings:pause',
                updated.paused ? 'Paused battle map updates' : 'Resumed battle map updates',
                { paused: !!updated.paused },
            );
        } catch (err) {
            alert(err.message);
        }
    }, [game.id, logBattle, mapState.paused]);

    const handleDrawerChange = useCallback(
        async (nextUserId) => {
            if (!isDM) return;
            const desired = nextUserId || game.dmId || '';
            const current = mapState.drawer?.userId || game.dmId || '';
            if (desired === current) return;
            setDrawerUpdating(true);
            try {
                const updated = await Games.updateMapSettings(game.id, { drawerUserId: desired });
                setMapState(normalizeClientMapState(updated));
                const actorId = desired || game.dmId || '';
                const drawerLabel = actorId
                    ? resolveBattleLogActorName(actorId, playerMap, me, game.dmId)
                    : 'Drawer';
                logBattle('map:settings:drawer', `Assigned drawing control to ${drawerLabel}`, {
                    drawerUserId: desired || null,
                });
            } catch (err) {
                alert(err.message);
            } finally {
                setDrawerUpdating(false);
            }
        },
        [game.dmId, game.id, isDM, logBattle, mapState.drawer?.userId, me, playerMap],
    );

    const handleSidebarTabKeyDown = useCallback(
        (event, index) => {
            const total = sidebarTabs.length;
            if (total === 0) return;
            let nextIndex = index;
            switch (event.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                    nextIndex = (index + 1) % total;
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                    nextIndex = (index - 1 + total) % total;
                    break;
                case 'Home':
                    nextIndex = 0;
                    break;
                case 'End':
                    nextIndex = total - 1;
                    break;
                default:
                    return;
            }
            event.preventDefault();
            const nextTab = sidebarTabs[nextIndex];
            if (nextTab) {
                setSidebarTab(nextTab.key);
            }
        },
        [setSidebarTab, sidebarTabs],
    );

    const handleSaveBrushColor = useCallback(() => {
        const colorToSave = typeof brushColor === 'string' ? brushColor.trim().toLowerCase() : '';
        if (!isHexColor(colorToSave)) {
            alert('Pick a color before saving to a slot.');
            return;
        }
        setBrushPalette((prev) => {
            const base = Array.isArray(prev) && prev.length === MAP_BRUSH_COLORS.length
                ? [...prev]
                : normalizeBrushPalette(prev);
            const index = Math.min(Math.max(selectedBrushSlot, 0), base.length - 1);
            base[index] = colorToSave;
            return normalizeBrushPalette(base);
        });
        setBrushColor(colorToSave);
    }, [brushColor, selectedBrushSlot]);

    const handleClearMap = useCallback(async () => {
        if (!isDM) return;
        const confirmed = confirm(
            'Clear the entire battle map? This removes the background, drawings, shapes, and tokens.',
        );
        if (!confirmed) return;
        try {
            setClearingMap(true);
            const response = await Games.clearMap(game.id);
            if (response && typeof response === 'object') {
                setMapState(normalizeClientMapState(response));
                logBattle('map:clear', 'Cleared the entire battle map');
            }
        } catch (err) {
            alert(err.message);
        } finally {
            setClearingMap(false);
        }
    }, [game.id, isDM, logBattle]);

    const parseCombatOrderInput = useCallback((value) => {
        return (value || '')
            .split(/\r?\n|,/)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 32);
    }, []);

    const handleStartCombat = useCallback(async () => {
        if (!isDM) return;
        const order = parseCombatOrderInput(combatOrderDraft);
        if (order.length === 0) {
            setCombatNotice({ type: 'error', message: 'Add at least one combatant to start combat.' });
            return;
        }
        const roundValue = Math.max(1, Math.round(Number(combatRoundDraft) || 1));
        const turnValueRaw = Math.max(1, Math.round(Number(combatTurnDraft) || 1));
        const turnValue = Math.min(turnValueRaw, order.length);
        try {
            setCombatBusy(true);
            setCombatNotice(null);
            const response = await Games.startCombat(game.id, {
                order,
                round: roundValue,
                turn: turnValue,
            });
            setMapState((prev) => ({ ...prev, combat: normalizeClientCombatState(response) }));
            setCombatNotice({ type: 'success', message: 'Combat started.' });
            logBattle('map:combat:start', `Started combat (round ${roundValue}, turn ${turnValue})`, {
                round: roundValue,
                turn: turnValue,
                order,
            });
        } catch (err) {
            setCombatNotice({ type: 'error', message: err.message || 'Failed to start combat.' });
        } finally {
            setCombatBusy(false);
        }
    }, [combatOrderDraft, combatRoundDraft, combatTurnDraft, game.id, isDM, logBattle, parseCombatOrderInput]);

    const handleNextCombatTurn = useCallback(async () => {
        if (!isDM || !combatState.active) return;
        try {
            setCombatBusy(true);
            setCombatNotice(null);
            const response = await Games.nextCombatTurn(game.id, { order: combatState.order });
            const nextState = normalizeClientCombatState(response);
            setMapState((prev) => ({ ...prev, combat: nextState }));
            setCombatNotice({ type: 'success', message: 'Advanced to next turn.' });
            logBattle(
                'map:combat:advance',
                `Advanced to round ${nextState.round}, turn ${nextState.turn}.`,
                {
                    round: nextState.round,
                    turn: nextState.turn,
                    order: nextState.order,
                },
            );
        } catch (err) {
            setCombatNotice({ type: 'error', message: err.message || 'Failed to advance turn.' });
        } finally {
            setCombatBusy(false);
        }
    }, [combatState.active, combatState.order, game.id, isDM, logBattle]);

    const handleEndCombat = useCallback(async () => {
        if (!isDM || !combatState.active) return;
        try {
            setCombatBusy(true);
            setCombatNotice(null);
            const response = await Games.endCombat(game.id);
            const nextState = normalizeClientCombatState(response);
            setMapState((prev) => ({ ...prev, combat: nextState }));
            setCombatNotice({ type: 'success', message: 'Combat ended.' });
            logBattle('map:combat:end', 'Ended combat encounter.', {
                previousRound: combatState.round,
                previousTurn: combatState.turn,
                order: combatState.order,
            });
        } catch (err) {
            setCombatNotice({ type: 'error', message: err.message || 'Failed to end combat.' });
        } finally {
            setCombatBusy(false);
        }
    }, [combatState.active, combatState.order, combatState.round, combatState.turn, game.id, isDM, logBattle]);

    return (
        <div className="map-tab">
            <div className="map-toolbar card">
                <div className="map-toolbar__row">
                    <div className="map-toolbar__tools">
                        <span className="text-small">Tool</span>
                        <div className="map-toolbar__buttons">
                            <button
                                type="button"
                                className={`btn btn-small${tool === 'select' ? ' is-active' : ' secondary'}`}
                                onClick={() => setTool('select')}
                            >
                                Select
                            </button>
                            <button
                                type="button"
                                className={`btn btn-small${tool === 'draw' ? ' is-active' : ' secondary'}`}
                                onClick={() => setTool('draw')}
                                disabled={!canDraw}
                            >
                                Draw
                            </button>
                            <button
                                type="button"
                                className={`btn btn-small${tool === 'erase' ? ' is-active' : ' secondary'}`}
                                onClick={() => setTool('erase')}
                                disabled={!canDraw}
                            >
                                Eraser
                            </button>
                            {isDM && (
                                <button
                                    type="button"
                                    className={`btn btn-small${tool === 'bucket' ? ' is-active' : ' secondary'}`}
                                    onClick={() => setTool('bucket')}
                                >
                                    Bucket
                                </button>
                            )}
                            {isDM && (
                                <button
                                    type="button"
                                    className={`btn btn-small${tool === 'background' ? ' is-active' : ' secondary'}`}
                                    onClick={() => setTool('background')}
                                >
                                    Background
                                </button>
                            )}
                            {isDM && (
                                <button
                                    type="button"
                                    className={`btn btn-small${tool === 'shape' ? ' is-active' : ' secondary'}`}
                                    onClick={() => setTool('shape')}
                                >
                                    Shapes
                                </button>
                            )}
                        </div>
                        <div className="map-toolbar__utilities">
                            <button
                                type="button"
                                className="btn btn-small ghost"
                                onClick={handleUndo}
                                disabled={!canUndo}
                                title="Undo the most recent stroke (stores up to five)."
                            >
                                {undoInFlight ? 'Undoing…' : 'Undo'}
                            </button>
                        </div>
                    </div>
                    <div className="map-toolbar__drawer">
                        {isDM ? (
                            <>
                                <label className="text-small" htmlFor="map-drawer-control">
                                    Active drawer
                                </label>
                                <select
                                    id="map-drawer-control"
                                    value={drawerSelectValue}
                                    onChange={(event) => handleDrawerChange(event.target.value)}
                                    disabled={drawerUpdating}
                                    aria-busy={drawerUpdating}
                                >
                                    {drawerOptions.map((option) => (
                                        <option key={option.id || 'dm'} value={option.id || ''}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <span className="text-muted text-small">
                                    {drawerUpdating
                                        ? 'Assigning drawer…'
                                        : 'Only the selected user can sketch freehand.'}
                                </span>
                            </>
                        ) : (
                            <>
                                <span className="text-small">Active drawer</span>
                                <div className="map-toolbar__drawer-status" role="status" aria-live="polite">
                                    <span className="map-toolbar__drawer-name">{activeDrawerLabel}</span>
                                    <span className={`pill ${isActiveDrawer ? 'success' : 'light'}`}>
                                        {isActiveDrawer ? 'You can draw' : 'View only'}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                    <div className="map-toolbar__status">
                        <span className={`pill ${mapState.paused ? 'warn' : 'success'}`}>
                            {mapState.paused ? 'Updates paused' : 'Live updates'}
                        </span>
                        <label className="perm-toggle" title="Show or hide token tooltip popovers on the map.">
                            <input
                                type="checkbox"
                                checked={tokenTooltipsEnabled}
                                onChange={(event) => setTokenTooltipsEnabled(event.target.checked)}
                            />
                            <span className="perm-toggle__text">Token tooltips</span>
                        </label>
                        {isDM && (
                            <button type="button" className="btn btn-small" onClick={handleTogglePause}>
                                {mapState.paused ? 'Resume sharing' : 'Pause updates'}
                            </button>
                        )}
                        {isDM && (
                            <button
                                type="button"
                                className="btn btn-small secondary"
                                onClick={handleShareMapToStory}
                                disabled={!storyConfigured}
                                title={
                                    storyConfigured
                                        ? 'Post the current map background and token summary to the story log.'
                                        : 'Connect a story log webhook in Campaign Settings to share battle maps.'
                                }
                            >
                                Share to story log
                            </button>
                        )}
                        {isDM && (
                            <button
                                type="button"
                                className="btn btn-small warn"
                                onClick={handleClearMap}
                                disabled={clearingMap}
                            >
                                {clearingMap ? 'Clearing…' : 'Clear map'}
                            </button>
                        )}
                    </div>
                </div>
                {(isDM || combatState.active) && (
                    <div className="map-toolbar__row map-toolbar__combat">
                        {isDM ? (
                            <div className="map-combat-card">
                                <div className="map-combat-card__summary">
                                    {combatState.active ? (
                                        <>
                                            <span className="pill success">Combat active</span>
                                            <span className="text-small">
                                                Round {combatState.round} · Turn {combatState.turn}
                                            </span>
                                            {combatOrderPreview && (
                                                <span className="text-small map-combat-card__order">
                                                    {combatOrderPreview}
                                                </span>
                                            )}
                                        </>
                                    ) : (
                                        <span className="text-small">
                                            Plan initiative order and start combat.
                                        </span>
                                    )}
                                </div>
                                {combatState.active && combatTimeline.length > 0 && (
                                    <CombatTimeline
                                        entries={combatTimeline}
                                        ariaLabel="Active turn order"
                                    />
                                )}
                                {!combatState.active && combatTimelineDraft.length > 0 && (
                                    <CombatTimeline
                                        entries={combatTimelineDraft}
                                        ariaLabel="Planned turn order"
                                    />
                                )}
                                <div className="map-combat-card__form">
                                    {!combatState.active ? (
                                        <>
                                            <label className="field" style={{ width: '100%' }}>
                                                <span className="field__label">Initiative order</span>
                                                <textarea
                                                    rows={3}
                                                    value={combatOrderDraft}
                                                    onChange={(event) => setCombatOrderDraft(event.target.value)}
                                                    placeholder={'One combatant per line'}
                                                    disabled={combatBusy}
                                                />
                                            </label>
                                            <div className="map-combat-card__inputs">
                                                <label className="field" style={{ width: 120 }}>
                                                    <span className="field__label">Round</span>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={combatRoundDraft}
                                                        onChange={(event) => setCombatRoundDraft(event.target.value)}
                                                        disabled={combatBusy}
                                                    />
                                                </label>
                                                <label className="field" style={{ width: 120 }}>
                                                    <span className="field__label">Turn</span>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={combatTurnDraft}
                                                        onChange={(event) => setCombatTurnDraft(event.target.value)}
                                                        disabled={combatBusy}
                                                    />
                                                </label>
                                            </div>
                                            <button
                                                type="button"
                                                className="btn btn-small"
                                                onClick={handleStartCombat}
                                                disabled={combatBusy}
                                            >
                                                {combatBusy ? 'Starting…' : 'Start Combat'}
                                            </button>
                                        </>
                                    ) : (
                                        <div className="map-combat-card__actions">
                                            <button
                                                type="button"
                                                className="btn btn-small"
                                                onClick={handleNextCombatTurn}
                                                disabled={combatBusy}
                                            >
                                                {combatBusy ? 'Processing…' : 'Next Turn'}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-small secondary"
                                                onClick={handleEndCombat}
                                                disabled={combatBusy}
                                            >
                                                End Combat
                                            </button>
                                        </div>
                                    )}
                                    {combatNotice && (
                                        <div
                                            className={`map-combat-card__notice${
                                                combatNotice.type === 'error' ? ' text-error' : ' text-muted'
                                            }`}
                                        >
                                            {combatNotice.message}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : combatState.active ? (
                            <div className="map-combat-card map-combat-card--readonly">
                                <span className="pill success">Combat active</span>
                                <span className="text-small">
                                    Round {combatState.round} · Turn {combatState.turn}
                                </span>
                                {combatOrderPreview && (
                                    <span className="text-small map-combat-card__order">{combatOrderPreview}</span>
                                )}
                                {combatTimeline.length > 0 && (
                                    <CombatTimeline
                                        entries={combatTimeline}
                                        ariaLabel="Active turn order"
                                    />
                                )}
                            </div>
                        ) : null}
                    </div>
                )}
                {canDraw && (
                    <div className="map-toolbar__row map-toolbar__brush">
                        <div>
                            <span className="text-small">Brush color</span>
                            <div className="map-toolbar__colors">
                                {brushPalette.map((color, index) => (
                                    <button
                                        key={`${color}-${index}`}
                                        type="button"
                                        className={`map-color${brushColor === color ? ' is-active' : ''}`}
                                        style={{ background: color }}
                                        onClick={() => {
                                            setBrushColor(color);
                                            setSelectedBrushSlot(index);
                                        }}
                                    />
                                ))}
                            </div>
                            <label className="map-color-picker">
                                <span className="text-small">Custom color</span>
                                <div className="color-input">
                                    <input
                                        type="color"
                                        value={brushColor}
                                        style={{ backgroundColor: brushColor }}
                                        onChange={(event) => {
                                            const value = event.target.value || brushColor;
                                            setBrushColor(
                                                typeof value === 'string' ? value.toLowerCase() : brushColor,
                                            );
                                        }}
                                    />
                                    <span className="text-muted text-small">{brushColor.toUpperCase()}</span>
                                </div>
                            </label>
                            <div className="map-brush-save">
                                <label className="text-small" htmlFor="map-brush-slot">
                                    Save color to slot
                                </label>
                                <select
                                    id="map-brush-slot"
                                    value={selectedBrushSlot}
                                    onChange={(event) => {
                                        const raw = Number(event.target.value);
                                        const maxIndex = brushPalette.length - 1;
                                        const index = Number.isFinite(raw)
                                            ? Math.min(Math.max(raw, 0), maxIndex)
                                            : 0;
                                        setSelectedBrushSlot(index);
                                        const nextColor = brushPalette[index];
                                        if (isHexColor(nextColor)) {
                                            setBrushColor(nextColor);
                                        }
                                    }}
                                >
                                    {brushPalette.map((color, index) => (
                                        <option key={`slot-${index}`} value={index}>
                                            {`Slot ${index + 1} — ${color.toUpperCase()}`}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    className="btn btn-small secondary"
                                    onClick={handleSaveBrushColor}
                                >
                                    Save color
                                </button>
                            </div>
                        </div>
                        <label className="map-brush-size">
                            <span className="text-small">Brush size</span>
                            <input
                                type="range"
                                min="2"
                                max="18"
                                value={brushSize}
                                onChange={(event) => setBrushSize(Number(event.target.value) || 4)}
                            />
                        </label>
                    </div>
                )}
            </div>
            <div className="map-layout">
                <div className="map-board card" ref={boardRef} style={boardStyle}>
                    <div
                        className="map-board__background"
                        style={{ pointerEvents: isDM && isBackgroundTool ? 'auto' : 'none' }}
                    >
                        {backgroundDisplay.url && (
                            <img
                                src={backgroundDisplay.url}
                                alt=""
                                className="map-board__background-image"
                                style={{
                                    left: `${backgroundDisplay.x * 100}%`,
                                    top: `${backgroundDisplay.y * 100}%`,
                                    width: `${backgroundDisplay.scale * 100}%`,
                                    opacity: backgroundDisplay.opacity,
                                    transform: `translate(-50%, -50%) rotate(${backgroundDisplay.rotation}deg)`,
                                }}
                                draggable={false}
                                onPointerDown={handleBackgroundPointerDown}
                                onPointerMove={handleBackgroundPointerMove}
                                onPointerUp={handleBackgroundPointerUp}
                                onPointerCancel={handleBackgroundPointerUp}
                            />
                        )}
                    </div>
                    <canvas
                        ref={canvasRef}
                        className="map-board__canvas"
                        style={{ pointerEvents: canvasPointerEvents }}
                        onPointerDown={handleCanvasPointerDown}
                        onPointerMove={handleCanvasPointerMove}
                        onPointerUp={handleCanvasPointerFinish}
                        onPointerCancel={handleCanvasPointerFinish}
                        onPointerLeave={handleCanvasPointerFinish}
                    />
                    <div
                        className="map-board__shapes"
                        style={{ pointerEvents: shapeLayerPointerEvents }}
                        onPointerDown={(event) => {
                            if (event.target === event.currentTarget) {
                                setSelectedShapeId(null);
                            }
                        }}
                    >
                        {mapState.shapes.map((shape) => {
                            const display =
                                dragPreview && dragPreview.kind === 'shape' && dragPreview.id === shape.id
                                    ? { ...shape, x: dragPreview.x, y: dragPreview.y }
                                    : shape;
                            const widthPercent = Math.max(display.width * 100, 1);
                            const heightPercent = Math.max(display.height * 100, 1);
                            const baseStyle = {
                                left: `${display.x * 100}%`,
                                top: `${display.y * 100}%`,
                                width: `${widthPercent}%`,
                                height: `${heightPercent}%`,
                                transform: `translate(-50%, -50%) rotate(${display.rotation}deg)`,
                            };
                            const isSelected = isDM && tool === 'shape' && selectedShapeId === shape.id;
                            const className = [
                                'map-shape',
                                `map-shape--${display.type}`,
                                isDM && tool === 'shape' ? 'is-editing' : '',
                                isSelected ? 'is-selected' : '',
                            ]
                                .filter(Boolean)
                                .join(' ');
                            if (display.type === 'image') {
                                return (
                                    <div
                                        key={shape.id}
                                        className={className}
                                        style={baseStyle}
                                        onPointerDown={(event) => handleShapePointerDown(shape, event)}
                                        onPointerMove={(event) => handleShapePointerMove(shape, event)}
                                        onPointerUp={(event) => handleShapePointerUp(shape, event)}
                                        onPointerCancel={(event) => handleShapePointerUp(shape, event)}
                                    >
                                        {display.url ? (
                                            <img
                                                src={display.url}
                                                alt=""
                                                className="map-shape__image"
                                                draggable={false}
                                            />
                                        ) : (
                                            <span className="map-shape__empty">Set image URL</span>
                                        )}
                                        {isSelected && (
                                            <>
                                                <div
                                                    className="map-shape__handle map-shape__handle--scale"
                                                    role="presentation"
                                                    onPointerDown={(event) =>
                                                        handleShapeHandlePointerDown(shape, 'scale', event)
                                                    }
                                                    onPointerMove={(event) => handleShapeHandlePointerMove(shape, event)}
                                                    onPointerUp={(event) => handleShapeHandlePointerUp(shape, event)}
                                                    onPointerCancel={(event) =>
                                                        handleShapeHandlePointerUp(shape, event)
                                                    }
                                                />
                                                <div
                                                    className="map-shape__handle map-shape__handle--rotate"
                                                    role="presentation"
                                                    onPointerDown={(event) =>
                                                        handleShapeHandlePointerDown(shape, 'rotate', event)
                                                    }
                                                    onPointerMove={(event) => handleShapeHandlePointerMove(shape, event)}
                                                    onPointerUp={(event) => handleShapeHandlePointerUp(shape, event)}
                                                    onPointerCancel={(event) =>
                                                        handleShapeHandlePointerUp(shape, event)
                                                    }
                                                />
                                            </>
                                        )}
                                    </div>
                                );
                            }
                            const surfaceStyle = {
                                background: display.type === 'line' ? display.stroke : display.fill,
                                opacity: display.opacity,
                                borderColor: display.stroke,
                                borderWidth: display.type === 'line' ? 0 : `${display.strokeWidth}px`,
                                borderStyle: display.type === 'line' ? 'none' : 'solid',
                                boxShadow:
                                    display.type === 'line' || display.strokeWidth <= 0
                                        ? 'none'
                                        : `0 0 0 ${display.strokeWidth}px ${display.stroke}`,
                            };
                            return (
                                <div
                                    key={shape.id}
                                    className={className}
                                    style={baseStyle}
                                    onPointerDown={(event) => handleShapePointerDown(shape, event)}
                                    onPointerMove={(event) => handleShapePointerMove(shape, event)}
                                    onPointerUp={(event) => handleShapePointerUp(shape, event)}
                                    onPointerCancel={(event) => handleShapePointerUp(shape, event)}
                                >
                                    <div className="map-shape__surface" style={surfaceStyle} />
                                </div>
                            );
                        })}
                    </div>
                    <div className="map-board__tokens" style={{ pointerEvents: tokenLayerPointerEvents }}>
                        {mapState.tokens.map((token) => {
                            const player = token.kind === 'player' ? playerMap.get(token.refId) : null;
                            const demon = token.kind === 'demon' ? findDemon(token.refId) : null;
                            const display =
                                dragPreview && dragPreview.kind === 'token' && dragPreview.id === token.id
                                    ? { ...token, x: dragPreview.x, y: dragPreview.y }
                                    : token;
                            const canDrag = canMoveToken(token);
                            const label = token.label || (player ? describePlayerName(player) : demon ? demon.name : 'Marker');
                            const meta = token.meta || null;
                            const tokenImage = meta?.image || token.image || '';
                            const hasPortrait = !!tokenImage;
                            let tooltipContent = null;
                            let tooltipIsCard = false;
                            if (token.kind === 'enemy' && token.enemyInfo && token.showTooltip) {
                                tooltipContent = <EnemyTooltipCard info={token.enemyInfo} label={label} />;
                                tooltipIsCard = true;
                            } else if (meta && token.showTooltip) {
                                if (meta.kind === 'player') {
                                    tooltipContent = <PlayerTooltipCard meta={meta} label={label} />;
                                    tooltipIsCard = true;
                                } else if (meta.kind === 'demon-ally') {
                                    tooltipContent = <DemonTooltipCard meta={meta} label={label} />;
                                    tooltipIsCard = true;
                                } else if (meta.kind === 'npc-shop' || meta.kind === 'npc-loot' || meta.kind === 'npc-misc' || meta.kind === 'npc') {
                                    tooltipContent = (
                                        <NpcTooltipCard
                                            meta={meta}
                                            label={label}
                                            isDM={isDM}
                                            onOpen={() => setActiveNpcOverlayId(token.id)}
                                        />
                                    );
                                    tooltipIsCard = true;
                                } else if (meta.kind === 'demon-enemy' && token.enemyInfo) {
                                    tooltipContent = <EnemyTooltipCard info={token.enemyInfo} label={label} />;
                                    tooltipIsCard = true;
                                } else if (token.tooltip) {
                                    tooltipContent = token.tooltip;
                                }
                            } else if (token.showTooltip && token.tooltip) {
                                tooltipContent = token.tooltip;
                            }
                            const showTooltip = tokenTooltipsEnabled && !!tooltipContent;
                            const tooltipClass = `map-token__tooltip${tooltipIsCard ? ' map-token__tooltip--card' : ''}`;
                            const initials = label.slice(0, 2).toUpperCase();
                            return (
                                <button
                                    key={token.id}
                                    type="button"
                                    className={`map-token map-token--${token.kind}${hasPortrait ? ' map-token--has-portrait' : ''}${
                                        canDrag ? ' is-draggable' : ''
                                    }`}
                                    style={{ left: `${display.x * 100}%`, top: `${display.y * 100}%`, background: token.color }}
                                    onPointerDown={(event) => handleTokenPointerDown(token, event)}
                                    onPointerMove={(event) => handleTokenPointerMove(token, event)}
                                    onPointerUp={(event) => handleTokenPointerUp(token, event)}
                                    onPointerCancel={(event) => handleTokenPointerUp(token, event)}
                                >
                                    <span className="map-token__inner">
                                        {hasPortrait && (
                                            <span className="map-token__portrait" aria-hidden="true">
                                                <img src={tokenImage} alt="" />
                                            </span>
                                        )}
                                        <span className="map-token__label">{initials}</span>
                                    </span>
                                    {showTooltip && <span className={tooltipClass}>{tooltipContent}</span>}
                                </button>
                            );
                        })}
                    </div>
                    {mapState.paused && !isDM && (
                        <div className="map-board__overlay">
                            <div className="map-board__overlay-content">
                                <span className="pill warn">Updates paused</span>
                                <p>The DM is preparing the battlefield. Drawings and token moves will appear once play resumes.</p>
                            </div>
                        </div>
                    )}
                    {activeNpcToken && activeNpcToken.meta && (
                        <NpcOverlay
                            token={activeNpcToken}
                            isDM={isDM}
                            onClose={() => setActiveNpcOverlayId(null)}
                        />
                    )}
                </div>
                <aside className="map-sidebar">
                    <div className="map-sidebar__tabs" role="tablist" aria-label="Battle map sections">
                        {sidebarTabs.map((tab, index) => {
                            const tabId = `map-tab-${tab.key}`;
                            const panelId = `map-tabpanel-${tab.key}`;
                            const isSelected = sidebarTab === tab.key;
                            return (
                                <button
                                    key={tab.key}
                                    type="button"
                                    id={tabId}
                                    role="tab"
                                    aria-selected={isSelected}
                                    aria-controls={panelId}
                                    tabIndex={isSelected ? 0 : -1}
                                    className={`map-sidebar__tab${isSelected ? ' is-active' : ''}`}
                                    onClick={() => setSidebarTab(tab.key)}
                                    onKeyDown={(event) => handleSidebarTabKeyDown(event, index)}
                                    title={tab.description}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                    <div
                        className="map-sidebar__content"
                        role="tabpanel"
                        id={`map-tabpanel-${activeSidebarTab.key}`}
                        aria-labelledby={`map-tab-${activeSidebarTab.key}`}
                    >
                        {sidebarTab === 'tokens' && (
                            <div className="stack">
                                <MapAccordionSection
                                    title="Token workshop"
                                    description="Choose what kind of token to place on the encounter map."
                                >
                                    {isDM ? (
                                        <div className="map-token-workshop">
                                            <div
                                                className="map-token-workshop__tabs"
                                                role="tablist"
                                                aria-label="Token categories"
                                            >
                                                <button
                                                    type="button"
                                                    className={`map-token-workshop__tab${tokenCreationTab === 'player' ? ' is-active' : ''}`}
                                                    onClick={() => setTokenCreationTab('player')}
                                                >
                                                    Player
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`map-token-workshop__tab${tokenCreationTab === 'demon' ? ' is-active' : ''}`}
                                                    onClick={() => setTokenCreationTab('demon')}
                                                >
                                                    Demon
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`map-token-workshop__tab${tokenCreationTab === 'npc' ? ' is-active' : ''}`}
                                                    onClick={() => setTokenCreationTab('npc')}
                                                >
                                                    NPC
                                                </button>
                                            </div>
                                            {tokenCreationTab === 'player' && (
                                                <form
                                                    className="map-token-workshop__panel"
                                                    onSubmit={(event) => {
                                                        event.preventDefault();
                                                        handleAddPlayerToken();
                                                    }}
                                                >
                                                    {availablePlayers.length > 0 ? (
                                                        <>
                                                            <label className="field">
                                                                <span className="field__label">Party member</span>
                                                                <select
                                                                    value={playerChoice}
                                                                    onChange={(event) => setPlayerChoice(event.target.value)}
                                                                >
                                                                    <option value="">Select a player…</option>
                                                                    {availablePlayers.map((player) => (
                                                                        <option key={player.id} value={player.id}>
                                                                            {player.label}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </label>
                                                            <div className="map-token-workshop__options">
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={playerTokenConfig.showClass}
                                                                        onChange={(event) =>
                                                                            setPlayerTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                showClass: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Show class</span>
                                                                </label>
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={playerTokenConfig.showLevel}
                                                                        onChange={(event) =>
                                                                            setPlayerTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                showLevel: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Show level</span>
                                                                </label>
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={playerTokenConfig.showHp}
                                                                        onChange={(event) =>
                                                                            setPlayerTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                showHp: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Show HP</span>
                                                                </label>
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={playerTokenConfig.showNotes}
                                                                        onChange={(event) =>
                                                                            setPlayerTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                showNotes: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Extra notes</span>
                                                                </label>
                                                            </div>
                                                            {playerTokenConfig.showNotes && (
                                                                <label className="field">
                                                                    <span className="field__label">Tooltip notes</span>
                                                                    <textarea
                                                                        rows={2}
                                                                        value={playerTokenConfig.notes}
                                                                        onChange={(event) =>
                                                                            setPlayerTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                notes: event.target.value,
                                                                            }))
                                                                        }
                                                                        placeholder="Short reminders, conditions, or RP details"
                                                                    />
                                                                </label>
                                                            )}
                                                            <label className="field">
                                                                <span className="field__label">Token label</span>
                                                                <input
                                                                    type="text"
                                                                    value={playerTokenConfig.label}
                                                                    onChange={(event) =>
                                                                        setPlayerTokenConfig((prev) => ({
                                                                            ...prev,
                                                                            label: event.target.value,
                                                                        }))
                                                                    }
                                                                    placeholder="Defaults to the character name"
                                                                />
                                                            </label>
                                                            <div className="map-token-workshop__options">
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={playerTokenConfig.includePortrait}
                                                                        onChange={(event) =>
                                                                            setPlayerTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                includePortrait: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Use character art</span>
                                                                </label>
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={playerTokenConfig.showTooltip}
                                                                        onChange={(event) =>
                                                                            setPlayerTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                showTooltip: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Tooltip on hover</span>
                                                                </label>
                                                            </div>
                                                            <button type="submit" className="btn btn-small" disabled={!playerChoice}>
                                                                Place player token
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <p className="text-small text-muted">
                                                            Every party member already has a token on the board.
                                                        </p>
                                                    )}
                                                </form>
                                            )}
                                            {tokenCreationTab === 'demon' && (
                                                <div className="map-token-workshop__panel">
                                                    <div
                                                        className="map-token-workshop__tabs map-token-workshop__tabs--nested"
                                                        role="tablist"
                                                        aria-label="Demon token modes"
                                                    >
                                                        <button
                                                            type="button"
                                                            className={`map-token-workshop__tab${demonCreationMode === 'ally' ? ' is-active' : ''}`}
                                                            onClick={() => setDemonCreationMode('ally')}
                                                        >
                                                            Ally demon
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={`map-token-workshop__tab${demonCreationMode === 'enemy' ? ' is-active' : ''}`}
                                                            onClick={() => setDemonCreationMode('enemy')}
                                                        >
                                                            Enemy demon
                                                        </button>
                                                    </div>
                                                    {demonCreationMode === 'ally' ? (
                                                        <form
                                                            className="map-token-workshop__panel-inner"
                                                            onSubmit={(event) => {
                                                                event.preventDefault();
                                                                handleAddDemonToken();
                                                            }}
                                                        >
                                                            <label className="field">
                                                                <span className="field__label">Search codex</span>
                                                                <input
                                                                    type="text"
                                                                    value={demonQuery}
                                                                    onChange={(event) => setDemonQuery(event.target.value)}
                                                                    placeholder="Filter demons…"
                                                                />
                                                            </label>
                                                            <label className="field">
                                                                <span className="field__label">Demon</span>
                                                                <select
                                                                    value={demonChoice}
                                                                    onChange={(event) => setDemonChoice(event.target.value)}
                                                                >
                                                                    <option value="">Select a demon…</option>
                                                                    {demonOptions.map((option) => (
                                                                        <option key={option.id} value={option.id}>
                                                                            {option.label}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </label>
                                                            <div className="map-token-workshop__options">
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={demonTokenConfig.showArcana}
                                                                        onChange={(event) =>
                                                                            setDemonTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                showArcana: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Show arcana</span>
                                                                </label>
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={demonTokenConfig.showAlignment}
                                                                        onChange={(event) =>
                                                                            setDemonTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                showAlignment: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Show alignment</span>
                                                                </label>
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={demonTokenConfig.showLevel}
                                                                        onChange={(event) =>
                                                                            setDemonTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                showLevel: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Show level</span>
                                                                </label>
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={demonTokenConfig.showNotes}
                                                                        onChange={(event) =>
                                                                            setDemonTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                showNotes: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Extra notes</span>
                                                                </label>
                                                            </div>
                                                            {demonTokenConfig.showNotes && (
                                                                <label className="field">
                                                                    <span className="field__label">Tooltip notes</span>
                                                                    <textarea
                                                                        rows={2}
                                                                        value={demonTokenConfig.notes}
                                                                        onChange={(event) =>
                                                                            setDemonTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                notes: event.target.value,
                                                                            }))
                                                                        }
                                                                        placeholder="Summoning notes or tactics"
                                                                    />
                                                                </label>
                                                            )}
                                                            <label className="field">
                                                                <span className="field__label">Token label</span>
                                                                <input
                                                                    type="text"
                                                                    value={demonTokenConfig.label}
                                                                    onChange={(event) =>
                                                                        setDemonTokenConfig((prev) => ({
                                                                            ...prev,
                                                                            label: event.target.value,
                                                                        }))
                                                                    }
                                                                    placeholder="Defaults to the demon name"
                                                                />
                                                            </label>
                                                            <div className="map-token-workshop__options">
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={demonTokenConfig.includePortrait}
                                                                        onChange={(event) =>
                                                                            setDemonTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                includePortrait: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Use codex art</span>
                                                                </label>
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={demonTokenConfig.showTooltip}
                                                                        onChange={(event) =>
                                                                            setDemonTokenConfig((prev) => ({
                                                                                ...prev,
                                                                                showTooltip: event.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Tooltip on hover</span>
                                                                </label>
                                                            </div>
                                                            <button type="submit" className="btn btn-small" disabled={!demonChoice}>
                                                                Place ally demon
                                                            </button>
                                                        </form>
                                                    ) : (
                                                        <EnemyTokenWorkshop
                                                            enemyForm={enemyForm}
                                                            setEnemyForm={setEnemyForm}
                                                            enemyFormValid={enemyFormValid}
                                                            enemyFormHasVisibleTooltip={enemyFormHasVisibleTooltip}
                                                            enemyDetailsInfo={enemyDetailsInfo}
                                                            enemyDemonChoice={enemyDemonChoice}
                                                            setEnemyDemonChoice={setEnemyDemonChoice}
                                                            enemyDemonOptions={enemyDemonOptions}
                                                            enemyQuery={enemyQuery}
                                                            setEnemyQuery={setEnemyQuery}
                                                            handleImportEnemyDemon={handleImportEnemyDemon}
                                                            handleSubmitEnemyToken={handleSubmitEnemyToken}
                                                            resetEnemyForm={resetEnemyForm}
                                                        />
                                                    )}
                                                </div>
                                            )}
                                            {tokenCreationTab === 'npc' && (
                                                <form
                                                    className="map-token-workshop__panel"
                                                    onSubmit={(event) => {
                                                        event.preventDefault();
                                                        handleSubmitNpcToken();
                                                    }}
                                                >
                                                    <div className="map-token-workshop__options">
                                                        <button
                                                            type="button"
                                                            className={`map-token-workshop__chip${npcForm.type === 'shop' ? ' is-active' : ''}`}
                                                            onClick={() => setNpcForm((prev) => ({ ...prev, type: 'shop' }))}
                                                        >
                                                            Shop
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={`map-token-workshop__chip${npcForm.type === 'loot' ? ' is-active' : ''}`}
                                                            onClick={() => setNpcForm((prev) => ({ ...prev, type: 'loot' }))}
                                                        >
                                                            Loot
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={`map-token-workshop__chip${npcForm.type === 'misc' ? ' is-active' : ''}`}
                                                            onClick={() => setNpcForm((prev) => ({ ...prev, type: 'misc' }))}
                                                        >
                                                            Misc
                                                        </button>
                                                    </div>
                                                    <label className="field">
                                                        <span className="field__label">Token label</span>
                                                        <input
                                                            type="text"
                                                            value={npcForm.label}
                                                            onChange={(event) =>
                                                                setNpcForm((prev) => ({
                                                                    ...prev,
                                                                    label: event.target.value,
                                                                }))
                                                            }
                                                            placeholder={
                                                                npcForm.type === 'shop'
                                                                    ? 'e.g. Akihabara Vendor'
                                                                    : npcForm.type === 'loot'
                                                                        ? 'Treasure cache name'
                                                                        : 'NPC display name'
                                                            }
                                                        />
                                                    </label>
                                                    <label className="field">
                                                        <span className="field__label">Image URL</span>
                                                        <input
                                                            type="text"
                                                            value={npcForm.image}
                                                            onChange={(event) =>
                                                                setNpcForm((prev) => ({
                                                                    ...prev,
                                                                    image: event.target.value,
                                                                }))
                                                            }
                                                            placeholder="https://example.com/token.png"
                                                        />
                                                    </label>
                                                    <label className="field">
                                                        <span className="field__label">Notes</span>
                                                        <textarea
                                                            rows={npcForm.type === 'misc' ? 4 : 2}
                                                            value={npcForm.notes}
                                                            onChange={(event) =>
                                                                setNpcForm((prev) => ({
                                                                    ...prev,
                                                                    notes: event.target.value,
                                                                }))
                                                            }
                                                            placeholder={
                                                                npcForm.type === 'misc'
                                                                    ? 'Flavor text or instructions'
                                                                    : 'Optional tooltip notes'
                                                            }
                                                        />
                                                    </label>
                                                    <label className="field map-token-workshop__color">
                                                        <span className="field__label">Token color</span>
                                                        <input
                                                            type="color"
                                                            value={npcForm.color || '#10b981'}
                                                            onChange={(event) =>
                                                                setNpcForm((prev) => ({
                                                                    ...prev,
                                                                    color: event.target.value || '#10b981',
                                                                }))
                                                            }
                                                        />
                                                        <span className="text-small text-muted">
                                                            {(npcForm.color || '#10b981').toUpperCase()}
                                                        </span>
                                                    </label>
                                                    <div className="map-token-workshop__items">
                                                        <div className="map-token-workshop__items-header">
                                                            <span className="text-small">
                                                                {npcForm.type === 'shop'
                                                                    ? 'Shop inventory'
                                                                    : npcForm.type === 'loot'
                                                                        ? 'Loot rewards'
                                                                        : 'Additional details'}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                className="btn ghost btn-small"
                                                                onClick={() =>
                                                                    setNpcForm((prev) => ({
                                                                        ...prev,
                                                                        items: prev.items.concat(createNpcItem()),
                                                                    }))
                                                                }
                                                            >
                                                                Add item
                                                            </button>
                                                        </div>
                                                        {npcForm.items.length === 0 ? (
                                                            <p className="text-small text-muted">
                                                                {npcForm.type === 'misc'
                                                                    ? 'Add notes or information about this NPC.'
                                                                    : 'Add entries so players can see what is available.'}
                                                            </p>
                                                        ) : (
                                                            <div className="map-token-workshop__item-list">
                                                                {npcForm.items.map((item, index) => (
                                                                    <div key={item.id || index} className="map-token-workshop__item">
                                                                        <input
                                                                            type="text"
                                                                            value={item.name}
                                                                            onChange={(event) =>
                                                                                setNpcForm((prev) => ({
                                                                                    ...prev,
                                                                                    items: prev.items.map((entry, idx) =>
                                                                                        idx === index
                                                                                            ? { ...entry, name: event.target.value }
                                                                                            : entry
                                                                                    ),
                                                                                }))
                                                                            }
                                                                            placeholder="Name"
                                                                        />
                                                                        {npcForm.type === 'shop' && (
                                                                            <div className="map-token-workshop__item-costs">
                                                                                <input
                                                                                    type="text"
                                                                                    value={item.cost || ''}
                                                                                    onChange={(event) =>
                                                                                        setNpcForm((prev) => ({
                                                                                            ...prev,
                                                                                            items: prev.items.map((entry, idx) =>
                                                                                                idx === index
                                                                                                    ? { ...entry, cost: event.target.value }
                                                                                                    : entry
                                                                                            ),
                                                                                        }))
                                                                                    }
                                                                                    placeholder="Cost"
                                                                                />
                                                                                <input
                                                                                    type="text"
                                                                                    value={item.trade || ''}
                                                                                    onChange={(event) =>
                                                                                        setNpcForm((prev) => ({
                                                                                            ...prev,
                                                                                            items: prev.items.map((entry, idx) =>
                                                                                                idx === index
                                                                                                    ? { ...entry, trade: event.target.value }
                                                                                                    : entry
                                                                                            ),
                                                                                        }))
                                                                                    }
                                                                                    placeholder="Trade req."
                                                                                />
                                                                            </div>
                                                                        )}
                                                                        <textarea
                                                                            rows={2}
                                                                            value={item.description || ''}
                                                                            onChange={(event) =>
                                                                                setNpcForm((prev) => ({
                                                                                    ...prev,
                                                                                    items: prev.items.map((entry, idx) =>
                                                                                        idx === index
                                                                                            ? { ...entry, description: event.target.value }
                                                                                            : entry
                                                                                    ),
                                                                                }))
                                                                            }
                                                                            placeholder="Notes or effects"
                                                                        />
                                                                        <button
                                                                            type="button"
                                                                            className="btn ghost btn-small"
                                                                            onClick={() =>
                                                                                setNpcForm((prev) => ({
                                                                                    ...prev,
                                                                                    items: prev.items.filter((_, idx) => idx !== index),
                                                                                }))
                                                                            }
                                                                        >
                                                                            Remove
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="map-token-workshop__options">
                                                        {npcForm.type === 'shop' && (
                                                            <label className="perm-toggle">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={npcForm.requireApproval}
                                                                    onChange={(event) =>
                                                                        setNpcForm((prev) => ({
                                                                            ...prev,
                                                                            requireApproval: event.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                                <span className="perm-toggle__text">DM approves purchases</span>
                                                            </label>
                                                        )}
                                                        {npcForm.type === 'loot' && (
                                                            <label className="perm-toggle">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={npcForm.allowAutoClaim}
                                                                    onChange={(event) =>
                                                                        setNpcForm((prev) => ({
                                                                            ...prev,
                                                                            allowAutoClaim: event.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                                <span className="perm-toggle__text">Allow instant claims</span>
                                                            </label>
                                                        )}
                                                        <label className="perm-toggle">
                                                            <input
                                                                type="checkbox"
                                                                checked={npcForm.openButton}
                                                                onChange={(event) =>
                                                                    setNpcForm((prev) => ({
                                                                        ...prev,
                                                                        openButton: event.target.checked,
                                                                    }))
                                                                }
                                                            />
                                                            <span className="perm-toggle__text">Show open button</span>
                                                        </label>
                                                        <label className="perm-toggle">
                                                            <input
                                                                type="checkbox"
                                                                checked={npcForm.showTooltip}
                                                                onChange={(event) =>
                                                                    setNpcForm((prev) => ({
                                                                        ...prev,
                                                                        showTooltip: event.target.checked,
                                                                    }))
                                                                }
                                                            />
                                                            <span className="perm-toggle__text">Tooltip on hover</span>
                                                        </label>
                                                    </div>
                                                    <button type="submit" className="btn btn-small">
                                                        Place NPC token
                                                    </button>
                                                </form>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-small text-muted">Only the DM can place new tokens.</p>
                                    )}
                                </MapAccordionSection>
                                <MapAccordionSection
                                    title="Player tokens"
                                    description="Manage party members on the encounter map."
                                >
                                    {playerTokens.length === 0 ? (
                                        <p className="map-empty text-muted">No party members on the board yet.</p>
                                    ) : (
                                        <ul className="map-token-list">
                                            {playerTokens.map((token) => {
                                                const player = playerMap.get(token.refId);
                                                const label = token.label || describePlayerName(player);
                                                const subtitle = describePlayerTooltip(player);
                                                return (
                                                    <li key={token.id} className="map-token-list__item">
                                                        <div className="map-token-list__info">
                                                            <strong>{label}</strong>
                                                            {subtitle && (
                                                                <span className="text-muted text-small">{subtitle}</span>
                                                            )}
                                                        </div>
                                                        {isDM && (
                                                            <div className="map-token-list__actions">
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={token.showTooltip}
                                                                        onChange={(event) =>
                                                                            handleToggleTooltip(token, event.target.checked)
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Tooltip</span>
                                                                </label>
                                                                <button
                                                                    type="button"
                                                                    className="btn ghost btn-small"
                                                                    onClick={() => handleRemoveToken(token)}
                                                                >
                                                                    Remove
                                                                </button>
                                                            </div>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </MapAccordionSection>
                                <MapAccordionSection
                                    title="Companion tokens"
                                    description="Summon demons or allies from your codex."
                                >
                                    {demonTokens.length === 0 ? (
                                        <p className="map-empty text-muted">No companions placed.</p>
                                    ) : (
                                        <ul className="map-token-list">
                                            {demonTokens.map((token) => {
                                                const demon = findDemon(token.refId);
                                                const label = token.label || demon?.name || 'Demon';
                                                const subtitle = describeDemonTooltip(demon);
                                                return (
                                                    <li key={token.id} className="map-token-list__item">
                                                        <div className="map-token-list__info">
                                                            <strong>{label}</strong>
                                                            {subtitle && (
                                                                <span className="text-muted text-small">{subtitle}</span>
                                                            )}
                                                        </div>
                                                        {isDM && (
                                                            <div className="map-token-list__actions">
                                                                <label className="perm-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={token.showTooltip}
                                                                        onChange={(event) =>
                                                                            handleToggleTooltip(token, event.target.checked)
                                                                        }
                                                                    />
                                                                    <span className="perm-toggle__text">Tooltip</span>
                                                                </label>
                                                                <button
                                                                    type="button"
                                                                    className="btn ghost btn-small"
                                                                    onClick={() => handleRemoveToken(token)}
                                                                >
                                                                    Remove
                                                                </button>
                                                            </div>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </MapAccordionSection>
                                <MapAccordionSection
                                    title="Enemy tokens"
                                    description="Create foes with detailed tooltips, including art and stats."
                                >
                                    {enemyTokens.length === 0 ? (
                                        <p className="map-empty text-muted">No enemies placed.</p>
                                    ) : (
                                        <ul className="map-token-list">
                                            {enemyTokens.map((token) => (
                                                <li key={token.id} className="map-token-list__item">
                                                    <div className="map-token-list__info">
                                                        <strong>{token.label}</strong>
                                                        {token.rawTooltip && (
                                                            <span className="text-muted text-small">{token.rawTooltip}</span>
                                                        )}
                                                        {isDM && token.enemyInfo && (
                                                            <EnemyTooltipCard info={token.enemyInfo} label={token.label} />
                                                        )}
                                                    </div>
                                                    {isDM && (
                                                        <div className="map-token-list__actions">
                                                            <label className="perm-toggle">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={token.showTooltip}
                                                                    onChange={(event) =>
                                                                        handleToggleTooltip(token, event.target.checked)
                                                                    }
                                                                />
                                                                <span className="perm-toggle__text">Tooltip</span>
                                                            </label>
                                                            <button
                                                                type="button"
                                                                className="btn btn-small"
                                                                onClick={() => handleEditEnemyToken(token)}
                                                            >
                                                                Edit
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn ghost btn-small"
                                                                onClick={() => handleRemoveToken(token)}
                                                            >
                                                                Remove
                                                            </button>
                                                        </div>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </MapAccordionSection>
                            </div>
                        )}
                        {sidebarTab === 'overlays' && (
                            <div className="stack">
                                {isDM && (
                                    <MapAccordionSection
                                        title="Add overlay image"
                                        description="Layer supplemental art, grids, or handouts on top of the battlefield with on-map controls."
                                    >
                                        <form
                                            className="map-overlay-form"
                                            onSubmit={async (event) => {
                                                event.preventDefault();
                                                const trimmed = (overlayForm.url || '').trim();
                                                if (!trimmed) return;
                                                await handleAddShape('image', {
                                                    url: trimmed,
                                                    width: overlayForm.width,
                                                    height: overlayForm.height,
                                                    opacity: overlayForm.opacity,
                                                    rotation: overlayForm.rotation,
                                                });
                                                setOverlayForm({
                                                    url: '',
                                                    width: 0.4,
                                                    height: 0.4,
                                                    opacity: 1,
                                                    rotation: 0,
                                                });
                                            }}
                                        >
                                            <label className="text-small" htmlFor="map-overlay-url">
                                                Image URL
                                            </label>
                                            <input
                                                id="map-overlay-url"
                                                type="text"
                                                value={overlayForm.url}
                                                onChange={(event) =>
                                                    setOverlayForm((prev) => ({ ...prev, url: event.target.value }))
                                                }
                                                placeholder="https://example.com/reference.png"
                                            />
                                            <p className="text-small text-muted map-overlay-form__hint">
                                                PNGs or WEBPs with transparent backgrounds work best for overlays.
                                            </p>
                                            <div className="map-overlay-form__grid">
                                                <label className="map-overlay-form__control">
                                                    <span className="text-small">Width</span>
                                                    <div className="map-overlay-form__control-inputs">
                                                        <input
                                                            type="range"
                                                            min="10"
                                                            max="100"
                                                            value={Math.round(overlayForm.width * 100)}
                                                            onChange={(event) =>
                                                                setOverlayForm((prev) => ({
                                                                    ...prev,
                                                                    width: clamp(
                                                                        Number(event.target.value) / 100,
                                                                        0.1,
                                                                        1,
                                                                        prev.width
                                                                    ),
                                                                }))
                                                            }
                                                        />
                                                        <input
                                                            type="number"
                                                            min="10"
                                                            max="100"
                                                            step="1"
                                                            value={Math.round(overlayForm.width * 100)}
                                                            onChange={(event) => {
                                                                const raw = event.target.value;
                                                                if (raw === '') return;
                                                                setOverlayForm((prev) => ({
                                                                    ...prev,
                                                                    width: clamp(
                                                                        Number(raw) / 100,
                                                                        0.1,
                                                                        1,
                                                                        prev.width
                                                                    ),
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                </label>
                                                <label className="map-overlay-form__control">
                                                    <span className="text-small">Height</span>
                                                    <div className="map-overlay-form__control-inputs">
                                                        <input
                                                            type="range"
                                                            min="10"
                                                            max="100"
                                                            value={Math.round(overlayForm.height * 100)}
                                                            onChange={(event) =>
                                                                setOverlayForm((prev) => ({
                                                                    ...prev,
                                                                    height: clamp(
                                                                        Number(event.target.value) / 100,
                                                                        0.1,
                                                                        1,
                                                                        prev.height
                                                                    ),
                                                                }))
                                                            }
                                                        />
                                                        <input
                                                            type="number"
                                                            min="10"
                                                            max="100"
                                                            step="1"
                                                            value={Math.round(overlayForm.height * 100)}
                                                            onChange={(event) => {
                                                                const raw = event.target.value;
                                                                if (raw === '') return;
                                                                setOverlayForm((prev) => ({
                                                                    ...prev,
                                                                    height: clamp(
                                                                        Number(raw) / 100,
                                                                        0.1,
                                                                        1,
                                                                        prev.height
                                                                    ),
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                </label>
                                                <label className="map-overlay-form__control">
                                                    <span className="text-small">Opacity</span>
                                                    <div className="map-overlay-form__control-inputs">
                                                        <input
                                                            type="range"
                                                            min="10"
                                                            max="100"
                                                            value={Math.round(overlayForm.opacity * 100)}
                                                            onChange={(event) =>
                                                                setOverlayForm((prev) => ({
                                                                    ...prev,
                                                                    opacity: clamp(
                                                                        Number(event.target.value) / 100,
                                                                        0.1,
                                                                        1,
                                                                        prev.opacity
                                                                    ),
                                                                }))
                                                            }
                                                        />
                                                        <input
                                                            type="number"
                                                            min="10"
                                                            max="100"
                                                            step="1"
                                                            value={Math.round(overlayForm.opacity * 100)}
                                                            onChange={(event) => {
                                                                const raw = event.target.value;
                                                                if (raw === '') return;
                                                                setOverlayForm((prev) => ({
                                                                    ...prev,
                                                                    opacity: clamp(
                                                                        Number(raw) / 100,
                                                                        0.1,
                                                                        1,
                                                                        prev.opacity
                                                                    ),
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                </label>
                                                <label className="map-overlay-form__control">
                                                    <span className="text-small">Rotation</span>
                                                    <div className="map-overlay-form__control-inputs">
                                                        <input
                                                            type="range"
                                                            min="0"
                                                            max="360"
                                                            value={Math.round(overlayForm.rotation)}
                                                            onChange={(event) =>
                                                                setOverlayForm((prev) => ({
                                                                    ...prev,
                                                                    rotation: clamp(
                                                                        Number(event.target.value),
                                                                        0,
                                                                        360,
                                                                        prev.rotation
                                                                    ),
                                                                }))
                                                            }
                                                        />
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="360"
                                                            step="1"
                                                            value={Math.round(overlayForm.rotation)}
                                                            onChange={(event) => {
                                                                const raw = event.target.value;
                                                                if (raw === '') return;
                                                                setOverlayForm((prev) => ({
                                                                    ...prev,
                                                                    rotation: clamp(
                                                                        Number(raw),
                                                                        0,
                                                                        360,
                                                                        prev.rotation
                                                                    ),
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                </label>
                                            </div>
                                            <div className="map-overlay-form__actions">
                                                <button type="submit" className="btn btn-small" disabled={!overlayForm.url.trim()}>
                                                    Add overlay
                                                </button>
                                                <p className="text-small text-muted">
                                                    Select the Shapes tool, then click an overlay to drag it, resize with the
                                                    corner handle, or rotate with the halo handle. Hold Shift while resizing to
                                                    lock the aspect ratio.
                                                </p>
                                            </div>
                                        </form>
                                    </MapAccordionSection>
                                )}
                                <MapAccordionSection
                                    title="Overlay images"
                                    description="Manage existing overlays. Select one on the map to drag, resize, or rotate."
                                    defaultOpen={imageShapes.length > 0}
                                >
                                    {imageShapes.length === 0 ? (
                                        <p className="map-empty text-muted">No overlays on the board.</p>
                                    ) : (
                                        <div className="map-shape-list">
                                            {imageShapes.map((shape) => (
                                                <div key={shape.id} className="map-shape-card">
                                                    <div className="map-shape-card__preview">
                                                        {shape.url ? (
                                                            <img src={shape.url} alt="" className="map-shape-card__image" />
                                                        ) : (
                                                            <span className="text-muted text-small">Set image URL</span>
                                                        )}
                                                    </div>
                                                    {(() => {
                                                        const updateOverlayShape = (patch) => {
                                                            setMapState((prev) => ({
                                                                ...prev,
                                                                shapes: prev.shapes.map((entry) =>
                                                                    entry.id === shape.id ? { ...entry, ...patch } : entry
                                                                ),
                                                            }));
                                                            handleUpdateShape(shape.id, patch);
                                                        };

                                                        return (
                                                            <div className="map-shape-card__body">
                                                                <label className="text-small" htmlFor={`map-overlay-url-${shape.id}`}>
                                                                    Image URL
                                                                </label>
                                                                <input
                                                                    id={`map-overlay-url-${shape.id}`}
                                                                    type="text"
                                                                    value={shape.url}
                                                                    onChange={(event) => {
                                                                        const value = event.target.value;
                                                                        setMapState((prev) => ({
                                                                            ...prev,
                                                                            shapes: prev.shapes.map((entry) =>
                                                                                entry.id === shape.id ? { ...entry, url: value } : entry
                                                                            ),
                                                                        }));
                                                                    }}
                                                                    onBlur={(event) => {
                                                                        const trimmed = event.target.value.trim();
                                                                        setMapState((prev) => ({
                                                                            ...prev,
                                                                            shapes: prev.shapes.map((entry) =>
                                                                                entry.id === shape.id ? { ...entry, url: trimmed } : entry
                                                                            ),
                                                                        }));
                                                                        handleUpdateShape(shape.id, { url: trimmed });
                                                                    }}
                                                                />
                                                                <p className="map-shape-card__hint text-small text-muted">
                                                                    Drag the overlay directly on the board or use the corner and rotation handles
                                                                    for precision edits.
                                                                </p>
                                                                <div className="map-shape-card__controls">
                                                                    <div className="map-shape-card__control">
                                                                        <span className="text-small">Width</span>
                                                                        <div className="map-shape-card__control-inputs">
                                                                            <input
                                                                                type="range"
                                                                                min="10"
                                                                                max="100"
                                                                                value={Math.round(shape.width * 100)}
                                                                                onChange={(event) => {
                                                                                    const value = clamp(
                                                                                        Number(event.target.value) / 100,
                                                                                        0.1,
                                                                                        1,
                                                                                        shape.width,
                                                                                    );
                                                                                    updateOverlayShape({ width: value });
                                                                                }}
                                                                            />
                                                                            <input
                                                                                type="number"
                                                                                min="10"
                                                                                max="100"
                                                                                step="1"
                                                                                value={Math.round(shape.width * 100)}
                                                                                onChange={(event) => {
                                                                                    const raw = event.target.value;
                                                                                    if (raw === '') return;
                                                                                    const value = clamp(
                                                                                        Number(raw) / 100,
                                                                                        0.1,
                                                                                        1,
                                                                                        shape.width,
                                                                                    );
                                                                                    updateOverlayShape({ width: value });
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    <div className="map-shape-card__control">
                                                                        <span className="text-small">Height</span>
                                                                        <div className="map-shape-card__control-inputs">
                                                                            <input
                                                                                type="range"
                                                                                min="10"
                                                                                max="100"
                                                                                value={Math.round(shape.height * 100)}
                                                                                onChange={(event) => {
                                                                                    const value = clamp(
                                                                                        Number(event.target.value) / 100,
                                                                                        0.1,
                                                                                        1,
                                                                                        shape.height,
                                                                                    );
                                                                                    updateOverlayShape({ height: value });
                                                                                }}
                                                                            />
                                                                            <input
                                                                                type="number"
                                                                                min="10"
                                                                                max="100"
                                                                                step="1"
                                                                                value={Math.round(shape.height * 100)}
                                                                                onChange={(event) => {
                                                                                    const raw = event.target.value;
                                                                                    if (raw === '') return;
                                                                                    const value = clamp(
                                                                                        Number(raw) / 100,
                                                                                        0.1,
                                                                                        1,
                                                                                        shape.height,
                                                                                    );
                                                                                    updateOverlayShape({ height: value });
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    <div className="map-shape-card__control">
                                                                        <span className="text-small">Rotation</span>
                                                                        <div className="map-shape-card__control-inputs">
                                                                            <input
                                                                                type="range"
                                                                                min="0"
                                                                                max="360"
                                                                                value={Math.round(shape.rotation)}
                                                                                onChange={(event) => {
                                                                                    const value = clamp(
                                                                                        Number(event.target.value),
                                                                                        0,
                                                                                        360,
                                                                                        shape.rotation,
                                                                                    );
                                                                                    updateOverlayShape({ rotation: value });
                                                                                }}
                                                                            />
                                                                            <input
                                                                                type="number"
                                                                                min="0"
                                                                                max="360"
                                                                                step="1"
                                                                                value={Math.round(shape.rotation)}
                                                                                onChange={(event) => {
                                                                                    const raw = event.target.value;
                                                                                    if (raw === '') return;
                                                                                    const value = clamp(
                                                                                        Number(raw),
                                                                                        0,
                                                                                        360,
                                                                                        shape.rotation,
                                                                                    );
                                                                                    updateOverlayShape({ rotation: value });
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    <div className="map-shape-card__control">
                                                                        <span className="text-small">Opacity</span>
                                                                        <div className="map-shape-card__control-inputs">
                                                                            <input
                                                                                type="range"
                                                                                min="10"
                                                                                max="100"
                                                                                value={Math.round(shape.opacity * 100)}
                                                                                onChange={(event) => {
                                                                                    const value = clamp(
                                                                                        Number(event.target.value) / 100,
                                                                                        0.1,
                                                                                        1,
                                                                                        shape.opacity,
                                                                                    );
                                                                                    updateOverlayShape({ opacity: value });
                                                                                }}
                                                                            />
                                                                            <input
                                                                                type="number"
                                                                                min="10"
                                                                                max="100"
                                                                                step="1"
                                                                                value={Math.round(shape.opacity * 100)}
                                                                                onChange={(event) => {
                                                                                    const raw = event.target.value;
                                                                                    if (raw === '') return;
                                                                                    const value = clamp(
                                                                                        Number(raw) / 100,
                                                                                        0.1,
                                                                                        1,
                                                                                        shape.opacity,
                                                                                    );
                                                                                    updateOverlayShape({ opacity: value });
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="map-shape-card__actions">
                                                                    <button
                                                                        type="button"
                                                                        className="btn ghost btn-small"
                                                                        onClick={() => handleRemoveShape(shape.id)}
                                                                    >
                                                                        Remove overlay
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </MapAccordionSection>
                                {isDM && (
                                    <MapAccordionSection
                                        title="Board background"
                                        description="Set the primary image that appears behind the battle grid."
                                    >
                                        <label className="text-small" htmlFor="map-background-url">
                                            Image URL
                                        </label>
                                        <input
                                            id="map-background-url"
                                            type="text"
                                            value={backgroundDraft.url}
                                            onChange={(event) =>
                                                setBackgroundDraft((prev) => ({ ...prev, url: event.target.value || '' }))
                                            }
                                            placeholder="https://example.com/map.png"
                                        />
                                        <div className="map-overlay-form__actions">
                                            <button
                                                type="button"
                                                className="btn btn-small"
                                                onClick={() => {
                                                    const trimmed = (backgroundDraft.url || '').trim();
                                                    if (!trimmed) return;
                                                    handleUpdateBackground({ url: trimmed });
                                                }}
                                                disabled={!backgroundDraft.url || !backgroundDraft.url.trim()}
                                            >
                                                Apply URL
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-small ghost"
                                                onClick={handleClearBackground}
                                                disabled={!mapState.background?.url}
                                            >
                                                Clear
                                            </button>
                                        </div>
                                        <div className="map-background-controls">
                                            <label className="map-background-slider">
                                                <span className="text-small">Horizontal</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    value={Math.round((backgroundDraft.x ?? 0.5) * 100)}
                                                    onChange={(event) => {
                                                        const value = clamp(
                                                            Number(event.target.value) / 100,
                                                            0,
                                                            1,
                                                            backgroundDraft.x ?? 0.5,
                                                        );
                                                        queueBackgroundUpdate({ x: value });
                                                    }}
                                                />
                                            </label>
                                            <label className="map-background-slider">
                                                <span className="text-small">Vertical</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    value={Math.round((backgroundDraft.y ?? 0.5) * 100)}
                                                    onChange={(event) => {
                                                        const value = clamp(
                                                            Number(event.target.value) / 100,
                                                            0,
                                                            1,
                                                            backgroundDraft.y ?? 0.5,
                                                        );
                                                        queueBackgroundUpdate({ y: value });
                                                    }}
                                                />
                                            </label>
                                            <label className="map-background-slider">
                                                <span className="text-small">
                                                    Scale ({backgroundDraft.scale.toFixed(2)}x)
                                                </span>
                                                <input
                                                    type="range"
                                                    min="20"
                                                    max="400"
                                                    value={Math.round((backgroundDraft.scale ?? 1) * 100)}
                                                    onChange={(event) => {
                                                        const value = clamp(
                                                            Number(event.target.value) / 100,
                                                            0.2,
                                                            4,
                                                            backgroundDraft.scale ?? 1,
                                                        );
                                                        queueBackgroundUpdate({ scale: value });
                                                    }}
                                                />
                                            </label>
                                            <label className="map-background-slider">
                                                <span className="text-small">
                                                    Rotation ({Math.round(backgroundDraft.rotation)}°)
                                                </span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="360"
                                                    value={Math.round(backgroundDraft.rotation)}
                                                    onChange={(event) => {
                                                        const value = clamp(
                                                            Number(event.target.value),
                                                            0,
                                                            360,
                                                            backgroundDraft.rotation,
                                                        );
                                                        queueBackgroundUpdate({ rotation: value });
                                                    }}
                                                />
                                            </label>
                                            <label className="map-background-slider">
                                                <span className="text-small">
                                                    Opacity ({Math.round(backgroundDraft.opacity * 100)}%)
                                                </span>
                                                <input
                                                    type="range"
                                                    min="10"
                                                    max="100"
                                                    value={Math.round((backgroundDraft.opacity ?? 1) * 100)}
                                                    onChange={(event) => {
                                                        const value = clamp(
                                                            Number(event.target.value) / 100,
                                                            0.1,
                                                            1,
                                                            backgroundDraft.opacity ?? 1,
                                                        );
                                                        queueBackgroundUpdate({ opacity: value });
                                                    }}
                                                />
                                            </label>
                                        </div>
                                    </MapAccordionSection>
                                )}
                            </div>
                        )}
                        {sidebarTab === 'shapes' && (
                            <div className="stack">
                                {isDM && (
                                    <MapAccordionSection
                                        title="Add shapes"
                                        description="Drop areas of effect, cones, and zones for players to reference."
                                    >
                                        <div className="map-shape-buttons">
                                            {MAP_STANDARD_SHAPE_TYPES.map((type) => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    className="btn btn-small"
                                                    onClick={() => handleAddShape(type)}
                                                >
                                                    {MAP_SHAPE_LABELS[type]}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="text-small text-muted">
                                            Switch to the Shapes tool to drag or rotate templates directly on the board.
                                        </p>
                                    </MapAccordionSection>
                                )}
                                <MapAccordionSection
                                    title="Shape templates"
                                    description="Adjust colors and sizes for existing area markers."
                                    defaultOpen={areaShapes.length > 0}
                                >
                                    {areaShapes.length === 0 ? (
                                        <p className="map-empty text-muted">No shapes placed.</p>
                                    ) : (
                                        <div className="map-shape-list">
                                            {areaShapes.map((shape) => (
                                                <div key={shape.id} className="map-shape-card">
                                                    <div className="map-shape-card__header">
                                                        <strong>{MAP_SHAPE_LABELS[shape.type] || 'Shape'}</strong>
                                                        <span className="text-muted text-small">
                                                            Rotation {Math.round(shape.rotation)}°
                                                        </span>
                                                    </div>
                                                    <div className="map-shape-card__body">
                                                        <div className="map-shape-card__colors">
                                                            <label className="color-input">
                                                                <span className="text-small">Fill</span>
                                                                <input
                                                                    type="color"
                                                                    value={shape.fill}
                                                                    style={{ backgroundColor: shape.fill }}
                                                                    onChange={(event) => {
                                                                        const value = event.target.value || shape.fill;
                                                                        setMapState((prev) => ({
                                                                            ...prev,
                                                                            shapes: prev.shapes.map((entry) =>
                                                                                entry.id === shape.id
                                                                                    ? { ...entry, fill: value }
                                                                                    : entry
                                                                            ),
                                                                        }));
                                                                        handleUpdateShape(shape.id, { fill: value });
                                                                    }}
                                                                    disabled={shape.type === 'line'}
                                                                />
                                                                <span className="text-muted text-small">
                                                                    {shape.fill.toUpperCase()}
                                                                </span>
                                                            </label>
                                                            <label className="color-input">
                                                                <span className="text-small">
                                                                    {shape.type === 'line' ? 'Line color' : 'Border'}
                                                                </span>
                                                                <input
                                                                    type="color"
                                                                    value={shape.stroke}
                                                                    style={{ backgroundColor: shape.stroke }}
                                                                    onChange={(event) => {
                                                                        const value = event.target.value || shape.stroke;
                                                                        setMapState((prev) => ({
                                                                            ...prev,
                                                                            shapes: prev.shapes.map((entry) =>
                                                                                entry.id === shape.id
                                                                                    ? { ...entry, stroke: value }
                                                                                    : entry
                                                                            ),
                                                                        }));
                                                                        handleUpdateShape(shape.id, { stroke: value });
                                                                    }}
                                                                />
                                                                <span className="text-muted text-small">
                                                                    {shape.stroke.toUpperCase()}
                                                                </span>
                                                            </label>
                                                        </div>
                                                        <div className="map-shape-card__sliders">
                                                            <label>
                                                                <span className="text-small">
                                                                    Width ({Math.round(shape.width * 100)}%)
                                                                </span>
                                                            <input
                                                                type="range"
                                                                min="5"
                                                                max="100"
                                                                value={Math.round(shape.width * 100)}
                                                                onChange={(event) => {
                                                                    const value = clamp(
                                                                        Number(event.target.value) / 100,
                                                                        0.05,
                                                                        1,
                                                                        shape.width,
                                                                    );
                                                                    setMapState((prev) => ({
                                                                        ...prev,
                                                                        shapes: prev.shapes.map((entry) =>
                                                                            entry.id === shape.id
                                                                                ? {
                                                                                      ...entry,
                                                                                      width: value,
                                                                                      ...(entry.type === 'circle' || entry.type === 'diamond'
                                                                                          ? { height: value }
                                                                                          : {}),
                                                                                  }
                                                                                : entry
                                                                        ),
                                                                    }));
                                                                    handleUpdateShape(shape.id, {
                                                                        width: value,
                                                                        ...(shape.type === 'circle' || shape.type === 'diamond'
                                                                            ? { height: value }
                                                                            : {}),
                                                                    });
                                                                }}
                                                            />
                                                            </label>
                                                            {shape.type !== 'circle' && shape.type !== 'diamond' && (
                                                                <label>
                                                                    <span className="text-small">
                                                                        Height ({Math.round(shape.height * 100)}%)
                                                                    </span>
                                                                    <input
                                                                        type="range"
                                                                        min="5"
                                                                        max="100"
                                                                        value={Math.round(shape.height * 100)}
                                                                        onChange={(event) => {
                                                                            const value = clamp(
                                                                                Number(event.target.value) / 100,
                                                                                0.05,
                                                                                1,
                                                                                shape.height,
                                                                            );
                                                                            setMapState((prev) => ({
                                                                                ...prev,
                                                                                shapes: prev.shapes.map((entry) =>
                                                                                    entry.id === shape.id
                                                                                        ? { ...entry, height: value }
                                                                                        : entry
                                                                                ),
                                                                            }));
                                                                            handleUpdateShape(shape.id, { height: value });
                                                                        }}
                                                                    />
                                                                </label>
                                                            )}
                                                            <label>
                                                                <span className="text-small">
                                                                    Border ({Math.round(shape.strokeWidth)}px)
                                                                </span>
                                                                <input
                                                                    type="range"
                                                                    min="0"
                                                                    max="20"
                                                                    value={Math.round(shape.strokeWidth)}
                                                                    onChange={(event) => {
                                                                        const value = clamp(
                                                                            Number(event.target.value),
                                                                            0,
                                                                            20,
                                                                            shape.strokeWidth,
                                                                        );
                                                                        setMapState((prev) => ({
                                                                            ...prev,
                                                                            shapes: prev.shapes.map((entry) =>
                                                                                entry.id === shape.id
                                                                                    ? { ...entry, strokeWidth: value }
                                                                                    : entry
                                                                            ),
                                                                        }));
                                                                        handleUpdateShape(shape.id, { strokeWidth: value });
                                                                    }}
                                                                />
                                                            </label>
                                                            <label>
                                                                <span className="text-small">
                                                                    Opacity ({Math.round(shape.opacity * 100)}%)
                                                                </span>
                                                                <input
                                                                    type="range"
                                                                    min="10"
                                                                    max="100"
                                                                    value={Math.round(shape.opacity * 100)}
                                                                    onChange={(event) => {
                                                                        const value = clamp(
                                                                            Number(event.target.value) / 100,
                                                                            0.1,
                                                                            1,
                                                                            shape.opacity,
                                                                        );
                                                                        setMapState((prev) => ({
                                                                            ...prev,
                                                                            shapes: prev.shapes.map((entry) =>
                                                                                entry.id === shape.id
                                                                                    ? { ...entry, opacity: value }
                                                                                    : entry
                                                                            ),
                                                                        }));
                                                                        handleUpdateShape(shape.id, { opacity: value });
                                                                    }}
                                                                />
                                                            </label>
                                                            <label>
                                                                <span className="text-small">
                                                                    Rotation ({Math.round(shape.rotation)}°)
                                                                </span>
                                                                <input
                                                                    type="range"
                                                                    min="0"
                                                                    max="360"
                                                                    value={Math.round(shape.rotation)}
                                                                    onChange={(event) => {
                                                                        const value = clamp(
                                                                            Number(event.target.value),
                                                                            0,
                                                                            360,
                                                                            shape.rotation,
                                                                        );
                                                                        setMapState((prev) => ({
                                                                            ...prev,
                                                                            shapes: prev.shapes.map((entry) =>
                                                                                entry.id === shape.id
                                                                                    ? { ...entry, rotation: value }
                                                                                    : entry
                                                                            ),
                                                                        }));
                                                                        handleUpdateShape(shape.id, { rotation: value });
                                                                    }}
                                                                />
                                                            </label>
                                                        </div>
                                                        <div className="map-shape-card__actions">
                                                            <button
                                                                type="button"
                                                                className="btn ghost btn-small"
                                                                onClick={() => handleRemoveShape(shape.id)}
                                                            >
                                                                Remove shape
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </MapAccordionSection>
                            </div>
                        )}
                        {sidebarTab === 'library' && (
                            <div className="stack">
                                <MapAccordionSection
                                    title="Saved battle maps"
                                    description="Store and recall complex encounters instantly."
                                    defaultOpen
                                >
                                    {isDM ? (
                                        <>
                                            <div className="map-library-actions">
                                                <button type="button" className="btn btn-small" onClick={handleSaveMap}>
                                                    Save current map
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-small secondary"
                                                    onClick={refreshMapLibrary}
                                                >
                                                    Refresh
                                                </button>
                                            </div>
                                            {mapLibrary.length === 0 ? (
                                                <p className="map-empty text-muted">No saved maps yet.</p>
                                            ) : (
                                                <div className="map-library-list">
                                                    {mapLibrary.map((entry) => {
                                                        const updatedLabel = entry.updatedAt || entry.createdAt;
                                                        return (
                                                            <div key={entry.id} className="map-library-row">
                                                                <div className="map-library-row__info">
                                                                    <strong>{entry.name}</strong>
                                                                    {updatedLabel && (
                                                                        <div className="text-muted text-small">
                                                                            Updated {new Date(updatedLabel).toLocaleString()}
                                                                        </div>
                                                                    )}
                                                                    {entry.previewUrl && (
                                                                        <div className="map-library-row__preview text-small text-muted">
                                                                            {entry.previewUrl}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="map-library-row__actions">
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-small"
                                                                        onClick={() => handleLoadSavedMap(entry)}
                                                                    >
                                                                        Load
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-small ghost"
                                                                        onClick={() => handleDeleteSavedMap(entry)}
                                                                    >
                                                                        Delete
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </>
                                    ) : mapLibrary.length === 0 ? (
                                        <p className="map-empty text-muted">The DM hasn’t shared any saved maps yet.</p>
                                    ) : (
                                        <div className="map-library-list">
                                            {mapLibrary.map((entry) => (
                                                <div key={entry.id} className="map-library-row">
                                                    <div className="map-library-row__info">
                                                        <strong>{entry.name}</strong>
                                                        {entry.updatedAt && (
                                                            <div className="text-muted text-small">
                                                                Updated {new Date(entry.updatedAt).toLocaleString()}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </MapAccordionSection>
                            </div>
                        )}
                        {sidebarTab === 'log' && isDM && (
                            <BattleLogPanel
                                entries={mapState.battleLog}
                                playerMap={playerMap}
                                me={me}
                                dmId={game.dmId}
                            />
                        )}
                    </div>
                </aside>
            </div>
        </div>
    );
}

