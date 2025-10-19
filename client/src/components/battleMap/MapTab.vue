<template>
    <section class="map-tab">
        <header class="map-header">
            <div class="map-header__info">
                <h3 class="map-header__title">Battle map</h3>
                <p class="map-header__meta" v-if="updatedAtLabel">
                    Last updated {{ updatedAtLabel }}
                </p>
            </div>
            <div class="map-header__actions">
                <button type="button" class="btn secondary" :disabled="syncBusy" @click="handleManualSync">
                    <span v-if="syncBusy">Syncing…</span>
                    <span v-else>Sync map</span>
                </button>
            </div>
        </header>

        <div class="map-layout">
            <div class="map-board-wrapper">
                <div class="map-board" ref="boardRef" :style="boardStyle">
                    <div class="map-board__background" :style="backgroundSurfaceStyle">
                        <img
                            v-if="hasBackgroundImage"
                            class="map-board__background-image"
                            :src="background.url"
                            alt="Battle map background"
                            draggable="false"
                            :style="backgroundImageStyle"
                        />
                    </div>
                    <canvas class="map-board__canvas" ref="canvasRef"></canvas>
                    <div class="map-board__shapes">
                        <div
                            v-for="shape in mapState.shapes"
                            :key="shape.id"
                            :class="['map-shape', `map-shape--${shape.type}`]"
                            :style="shapeStyle(shape)"
                        >
                            <div class="map-shape__surface" :style="shapeSurfaceStyle(shape)">
                                <template v-if="shape.type === 'image'">
                                    <img
                                        v-if="shape.url"
                                        class="map-shape__image"
                                        :src="shape.url"
                                        alt=""
                                        draggable="false"
                                    />
                                    <div v-else class="map-shape__empty">No image</div>
                                </template>
                            </div>
                        </div>
                    </div>
                    <div class="map-board__tokens">
                        <div
                            v-for="token in mapState.tokens"
                            :key="token.id"
                            :class="['map-token', `map-token--${token.kind}`]"
                            :style="tokenStyle(token)"
                        >
                            <div class="map-token__inner">
                                <span class="map-token__label">{{ token.label || 'Token' }}</span>
                            </div>
                            <div v-if="token.showTooltip && token.tooltip" class="map-token__tooltip">
                                {{ token.tooltip }}
                            </div>
                        </div>
                    </div>
                    <div v-if="boardOverlayMessages.length" class="map-board__overlay">
                        <div class="map-board__overlay-content">
                            <p v-for="message in boardOverlayMessages" :key="message">{{ message }}</p>
                        </div>
                    </div>
                </div>

                <div class="map-status">
                    <span class="map-status__badge" :class="{ 'is-paused': mapState.paused }">
                        {{ mapState.paused ? 'Paused' : 'Live' }}
                    </span>
                    <span class="map-status__item" v-if="drawerName">
                        Drawer:
                        <strong>{{ drawerName }}</strong>
                        <span class="map-status__dot" :class="{ 'is-online': isDrawerOnline }"></span>
                        <span class="map-status__presence">{{ isDrawerOnline ? 'Online' : 'Offline' }}</span>
                    </span>
                    <span class="map-status__item" v-if="drawerAssignedLabel">
                        Assigned {{ drawerAssignedLabel }}
                    </span>
                    <span class="map-status__item">
                        Drawing {{ mapState.settings.allowPlayerDrawing ? 'enabled' : 'disabled' }} ·
                        Token moves {{ mapState.settings.allowPlayerTokenMoves ? 'enabled' : 'disabled' }}
                    </span>
                </div>
            </div>

            <aside class="map-sidebar">
                <section class="map-battle-log">
                    <header class="map-battle-log__header">
                        <h3>Battle log</h3>
                        <p class="map-battle-log__description">
                            Entries appear in real time as encounters unfold.
                        </p>
                    </header>
                    <div class="map-battle-log__scroller">
                        <p v-if="!battleLogEntries.length" class="map-battle-log__empty">
                            No battle log entries yet.
                        </p>
                        <article v-for="entry in battleLogEntries" :key="entry.id" class="map-battle-log__entry">
                            <div class="map-battle-log__meta">
                                <span class="map-battle-log__time">{{ formatLogTime(entry.createdAt) }}</span>
                                <span class="map-battle-log__actor">{{ resolveActorName(entry.actorId) }}</span>
                                <span class="map-battle-log__action"><code>{{ entry.action }}</code></span>
                            </div>
                            <p v-if="entry.message" class="map-battle-log__message">{{ entry.message }}</p>
                            <details v-if="hasLogDetails(entry)" class="map-battle-log__details">
                                <summary>Details</summary>
                                <pre>{{ formatLogDetails(entry.details) }}</pre>
                            </details>
                        </article>
                    </div>
                </section>
            </aside>
        </div>
    </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from 'vue';
import { Games } from '../../api';
import { useBattleLogger } from '../../composables/useBattleLogger';
import { describePlayerName, mapReadBoolean } from './mapShared';
import { idsMatch, normalizeId } from '../../utils/ids';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
    logger: { type: Function, default: null },
    realtime: { type: Object, default: null },
});

const log = props.logger || useBattleLogger(() => props.game?.id);

const DEFAULT_BACKGROUND_COLOR = '#0f172a';
const DEFAULT_SHAPE_FILL = '#1e293b';
const DEFAULT_SHAPE_STROKE = '#f8fafc';
const DEFAULT_SHAPE_OPACITY = 0.6;
const DEFAULT_SHAPE_STROKE_WIDTH = 2;
const DEFAULT_PLAYER_TOKEN_COLOR = '#38bdf8';
const DEFAULT_DEMON_TOKEN_COLOR = '#f97316';
const DEFAULT_CUSTOM_TOKEN_COLOR = '#a855f7';
const DEFAULT_NPC_TOKEN_COLOR = '#10b981';
const DEFAULT_ENEMY_TOKEN_COLOR = '#ef4444';
const BATTLE_LOG_LIMIT = 200;

const boardRef = ref(null);
const canvasRef = ref(null);
const onlineUserIds = ref([]);
const syncBusy = ref(false);

const mapState = reactive(createMapState(props.game?.map));

const boardSize = reactive({ width: 0, height: 0 });
let resizeObserver = null;
let activeSync = null;
let syncQueued = false;
let messageHandler = null;
let subscribedGameId = null;
let drawScheduled = false;

const currentGameId = computed(() => normalizeId(props.game?.id));

watch(
    () => props.game?.map,
    (next) => {
        applyMapState(next);
    },
    { immediate: true, deep: true }
);

watch(
    currentGameId,
    (next, prev) => {
        if (prev && subscribedGameId && idsMatch(prev, subscribedGameId)) {
            sendRealtimeMessage('unsubscribe', prev);
            subscribedGameId = null;
        }
        onlineUserIds.value = [];
        if (!next) {
            applyMapState(null);
            return;
        }
        if (isRealtimeConnected()) {
            subscribeToGame(next);
        }
    },
    { immediate: true }
);

watch(
    () => props.realtime?.connected?.value,
    (connected) => {
        if (!currentGameId.value) return;
        if (connected) {
            subscribeToGame(currentGameId.value);
            requestSync();
        }
    }
);

watch(
    () => props.realtime?.socket?.value,
    (next, prev) => {
        if (prev && messageHandler) {
            prev.removeEventListener('message', messageHandler);
        }
        subscribedGameId = null;
        messageHandler = null;
        if (next) {
            messageHandler = (event) => handleRealtimeEvent(event);
            next.addEventListener('message', messageHandler);
            if (isRealtimeConnected() && currentGameId.value) {
                subscribeToGame(currentGameId.value);
                requestSync();
            }
        }
    },
    { immediate: true }
);

watchEffect(() => {
    // Trigger canvas redraw when strokes or board size changes.
    void mapState.strokes;
    void boardSize.width;
    void boardSize.height;
    scheduleCanvasDraw();
});

onMounted(() => {
    const boardEl = boardRef.value;
    if (boardEl && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target !== boardEl) continue;
                const { width, height } = entry.contentRect;
                boardSize.width = width;
                boardSize.height = height;
            }
        });
        resizeObserver.observe(boardEl);
    } else if (boardEl) {
        const rect = boardEl.getBoundingClientRect();
        boardSize.width = rect.width;
        boardSize.height = rect.height;
    }
    scheduleCanvasDraw();
});

onBeforeUnmount(() => {
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }
    if (props.realtime?.socket?.value && messageHandler) {
        props.realtime.socket.value.removeEventListener('message', messageHandler);
    }
    if (subscribedGameId) {
        sendRealtimeMessage('unsubscribe', subscribedGameId);
    }
});

const background = computed(() => mapState.background);

const hasBackgroundImage = computed(() => {
    return Boolean(background.value.url);
});

const backgroundSurfaceStyle = computed(() => {
    return {
        backgroundColor: background.value.color || DEFAULT_BACKGROUND_COLOR,
        opacity: background.value.opacity ?? 1,
    };
});

const backgroundImageStyle = computed(() => {
    const bg = background.value;
    const positionX = clamp01(bg.x) * 100;
    const positionY = clamp01(bg.y) * 100;
    return {
        left: `${positionX}%`,
        top: `${positionY}%`,
        transform: `translate(-50%, -50%) scale(${bg.scale || 1}) rotate(${bg.rotation || 0}deg)`,
        opacity: bg.opacity ?? 1,
    };
});

const boardStyle = computed(() => ({
    '--map-board-color': background.value.color || DEFAULT_BACKGROUND_COLOR,
}));

const battleLogEntries = computed(() => mapState.battleLog);

const boardOverlayMessages = computed(() => {
    const messages = [];
    const paused = mapState.paused;
    const empty = !hasRenderableContent();
    if (paused) {
        messages.push('Battle map is currently paused by the game master.');
    }
    if (empty) {
        messages.push('No map data yet.');
    }
    if ((paused || empty) && drawerName.value) {
        messages.push(`Active drawer: ${drawerName.value}${isDrawerOnline.value ? ' (online)' : ''}`);
    }
    return messages;
});

const drawerName = computed(() => describeDrawer(mapState.drawer.userId));

const drawerAssignedLabel = computed(() => formatRelativeTime(mapState.drawer.assignedAt));

const updatedAtLabel = computed(() => formatRelativeTime(mapState.updatedAt));

const isDrawerOnline = computed(() => {
    const drawerId = mapState.drawer.userId;
    if (!drawerId) return false;
    return onlineUserIds.value.some((id) => idsMatch(id, drawerId));
});

function handleRealtimeEvent(event) {
    let payload;
    try {
        payload = JSON.parse(event.data);
    } catch {
        return;
    }
    if (!payload || typeof payload !== 'object') return;
    const gameId = normalizeId(payload.gameId);
    if (gameId && !idsMatch(gameId, currentGameId.value)) return;
    switch (payload.type) {
        case 'game:update': {
            if (typeof payload.reason === 'string' && payload.reason.startsWith('map:')) {
                requestSync();
            }
            break;
        }
        case 'map:battleLog': {
            if (payload.entry) appendBattleLogEntry(payload.entry);
            break;
        }
        case 'presence:state': {
            if (Array.isArray(payload.online)) {
                const normalized = payload.online
                    .map((id) => normalizeId(id))
                    .filter(Boolean);
                onlineUserIds.value = normalized;
            }
            break;
        }
        case 'presence:update': {
            const userId = normalizeId(payload.userId);
            if (!userId) break;
            const next = new Set(onlineUserIds.value);
            if (payload.online) {
                next.add(userId);
            } else {
                next.delete(userId);
            }
            onlineUserIds.value = Array.from(next);
            break;
        }
        default:
            break;
    }
}

function subscribeToGame(gameId) {
    if (!gameId) return;
    if (!isRealtimeConnected()) return;
    if (subscribedGameId && idsMatch(subscribedGameId, gameId)) return;
    const success = sendRealtimeMessage('subscribe', gameId);
    if (success) {
        subscribedGameId = gameId;
    }
}

function sendRealtimeMessage(type, gameId) {
    if (!props.realtime || !gameId) return false;
    try {
        props.realtime.send({ type, channel: 'game', gameId });
        return true;
    } catch (err) {
        if (import.meta.env.DEV) {
            console.warn('Failed to send realtime message', err);
        }
        return false;
    }
}

function isRealtimeConnected() {
    return !!props.realtime?.connected?.value;
}

function scheduleCanvasDraw() {
    if (!canvasRef.value) return;
    if (!boardSize.width || !boardSize.height) return;
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(() => {
        drawScheduled = false;
        drawStrokes();
    });
}

function drawStrokes() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const width = boardSize.width;
    const height = boardSize.height;
    if (!width || !height) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    for (const stroke of mapState.strokes) {
        const points = Array.isArray(stroke.points) ? stroke.points : [];
        if (points.length < 2) continue;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = stroke.size;
        if (stroke.mode === 'erase') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = stroke.color || '#5aadff';
        }
        ctx.beginPath();
        ctx.moveTo(points[0].x * width, points[0].y * height);
        for (let i = 1; i < points.length; i += 1) {
            ctx.lineTo(points[i].x * width, points[i].y * height);
        }
        ctx.stroke();
        ctx.restore();
    }

    ctx.restore();
}

function hasRenderableContent() {
    return (
        hasBackgroundImage.value ||
        mapState.tokens.length > 0 ||
        mapState.shapes.length > 0 ||
        mapState.strokes.length > 0
    );
}

function shapeStyle(shape) {
    const width = clamp01(shape.width) * 100;
    const height = clamp01(shape.height) * 100;
    const left = clamp01(shape.x) * 100;
    const top = clamp01(shape.y) * 100;
    return {
        width: `${width}%`,
        height: `${height}%`,
        left: `${left}%`,
        top: `${top}%`,
        opacity: shape.opacity ?? DEFAULT_SHAPE_OPACITY,
        transform: `translate(-50%, -50%) rotate(${shape.rotation || 0}deg)`,
    };
}

function shapeSurfaceStyle(shape) {
    if (shape.type === 'image') {
        return {};
    }
    const strokeWidth = Number.isFinite(shape.strokeWidth) ? Math.max(0, shape.strokeWidth) : DEFAULT_SHAPE_STROKE_WIDTH;
    return {
        background: shape.fill || DEFAULT_SHAPE_FILL,
        border: strokeWidth ? `${strokeWidth}px solid ${shape.stroke || DEFAULT_SHAPE_STROKE}` : 'none',
        opacity: shape.opacity ?? DEFAULT_SHAPE_OPACITY,
    };
}

function tokenStyle(token) {
    const left = clamp01(token.x) * 100;
    const top = clamp01(token.y) * 100;
    const color = token.color || DEFAULT_CUSTOM_TOKEN_COLOR;
    return {
        left: `${left}%`,
        top: `${top}%`,
        background: color,
        borderColor: color,
    };
}

function appendBattleLogEntry(entry) {
    const normalized = normalizeBattleLogEntry(entry);
    if (!normalized) return;
    const list = [...mapState.battleLog, normalized];
    if (list.length > BATTLE_LOG_LIMIT) {
        list.splice(0, list.length - BATTLE_LOG_LIMIT);
    }
    mapState.battleLog = list;
}

function hasLogDetails(entry) {
    return entry && Object.prototype.hasOwnProperty.call(entry, 'details') && entry.details !== undefined;
}

function formatLogDetails(details) {
    if (details === null || details === undefined) return '';
    if (typeof details === 'string') return details;
    if (typeof details === 'number' || typeof details === 'boolean') return String(details);
    try {
        return JSON.stringify(details, null, 2);
    } catch {
        return '';
    }
}

function formatLogTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
}

function resolveActorName(actorId) {
    const normalized = normalizeId(actorId);
    if (!normalized) return 'System';

    const players = Array.isArray(props.game?.players) ? props.game.players : [];
    for (const player of players) {
        if (!player) continue;
        const candidates = [player.userId, player.id, player.user?.id];
        if (candidates.some((id) => idsMatch(id, normalized))) {
            return describePlayerName(player);
        }
    }

    if (idsMatch(props.game?.dmId, normalized)) {
        const dm = props.game?.dm;
        if (dm && typeof dm === 'object') {
            return dm.displayName || dm.username || dm.name || 'Game Master';
        }
        if (typeof props.game?.dm === 'string' && props.game.dm.trim()) {
            return props.game.dm.trim();
        }
        return 'Game Master';
    }

    return `User ${normalized.slice(0, 6)}`;
}

function describeDrawer(userId) {
    const normalized = normalizeId(userId);
    if (!normalized) {
        return props.game?.dm ? resolveDungeonMasterName() : '';
    }
    const players = Array.isArray(props.game?.players) ? props.game.players : [];
    for (const player of players) {
        if (!player) continue;
        const candidates = [player.userId, player.id, player.user?.id];
        if (candidates.some((id) => idsMatch(id, normalized))) {
            return describePlayerName(player);
        }
    }
    if (idsMatch(props.game?.dmId, normalized)) {
        return resolveDungeonMasterName();
    }
    return `User ${normalized.slice(0, 6)}`;
}

function resolveDungeonMasterName() {
    const dm = props.game?.dm;
    if (dm && typeof dm === 'object') {
        return dm.displayName || dm.username || dm.name || 'Game Master';
    }
    if (typeof dm === 'string' && dm.trim()) return dm.trim();
    return 'Game Master';
}

async function performSync(manual = false) {
    const gameId = currentGameId.value;
    if (!gameId) return;
    if (manual) syncBusy.value = true;
    try {
        const snapshot = await Games.getMap(gameId);
        applyMapState(snapshot);
    } catch (err) {
        if (import.meta.env.DEV) {
            console.warn('Failed to sync battle map', err);
        }
    } finally {
        if (manual) syncBusy.value = false;
    }
}

function requestSync(options = {}) {
    const manual = !!options.manual;
    if (activeSync) {
        if (manual) {
            return activeSync.finally(() => requestSync({ manual: true }));
        }
        syncQueued = true;
        return activeSync;
    }
    activeSync = performSync(manual).finally(() => {
        activeSync = null;
        if (syncQueued) {
            syncQueued = false;
            requestSync();
        }
    });
    return activeSync;
}

async function handleManualSync() {
    log('map_refresh', `Viewed map for game ${currentGameId.value}`);
    await requestSync({ manual: true });
}

function formatRelativeTime(value) {
    if (!value) return '';
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return '';
    try {
        const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
        const now = Date.now();
        const diffMs = timestamp - now;
        const diffMinutes = Math.round(diffMs / 60000);
        if (Math.abs(diffMinutes) < 60) {
            return formatter.format(diffMinutes, 'minute');
        }
        const diffHours = Math.round(diffMinutes / 60);
        if (Math.abs(diffHours) < 24) {
            return formatter.format(diffHours, 'hour');
        }
        const diffDays = Math.round(diffHours / 24);
        return formatter.format(diffDays, 'day');
    } catch {
        return new Date(timestamp).toLocaleString();
    }
}

function applyMapState(source) {
    const normalized = createMapState(source);
    mapState.background = normalized.background;
    mapState.strokes = normalized.strokes;
    mapState.tokens = normalized.tokens;
    mapState.shapes = normalized.shapes;
    mapState.paused = normalized.paused;
    mapState.settings = normalized.settings;
    mapState.drawer = normalized.drawer;
    mapState.updatedAt = normalized.updatedAt;
    mapState.battleLog = normalized.battleLog;
    mapState.combat = normalized.combat;
}

function createMapState(raw) {
    const background = normalizeBackground(raw?.background);
    const strokes = Array.isArray(raw?.strokes) ? raw.strokes.map(normalizeStroke).filter(Boolean) : [];
    const tokens = Array.isArray(raw?.tokens) ? raw.tokens.map(normalizeToken).filter(Boolean) : [];
    const shapes = Array.isArray(raw?.shapes) ? raw.shapes.map(normalizeShape).filter(Boolean) : [];
    const battleLog = Array.isArray(raw?.battleLog)
        ? raw.battleLog.map(normalizeBattleLogEntry).filter(Boolean).slice(-BATTLE_LOG_LIMIT)
        : [];
    return {
        background,
        strokes,
        tokens,
        shapes,
        paused: !!raw?.paused,
        settings: {
            allowPlayerDrawing: mapReadBoolean(raw?.settings?.allowPlayerDrawing, true),
            allowPlayerTokenMoves: mapReadBoolean(raw?.settings?.allowPlayerTokenMoves, true),
        },
        drawer: normalizeDrawer(raw?.drawer),
        updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
        combat: raw?.combat && typeof raw.combat === 'object' ? { ...raw.combat } : null,
        battleLog,
    };
}

function normalizeBackground(entry) {
    const background = entry && typeof entry === 'object' ? { ...entry } : {};
    return {
        url: typeof background.url === 'string' ? background.url : '',
        x: clamp01(background.x ?? 0.5),
        y: clamp01(background.y ?? 0.5),
        scale: Number.isFinite(Number(background.scale)) ? Number(background.scale) : 1,
        rotation: Number.isFinite(Number(background.rotation)) ? Number(background.rotation) : 0,
        opacity: clampOpacity(background.opacity, 1),
        color: typeof background.color === 'string' && background.color ? background.color : DEFAULT_BACKGROUND_COLOR,
    };
}

function normalizeStroke(stroke) {
    if (!stroke || typeof stroke !== 'object') return null;
    const points = Array.isArray(stroke.points)
        ? stroke.points.map((point) => normalizePoint(point)).filter(Boolean)
        : [];
    if (points.length < 2) return null;
    const id = typeof stroke.id === 'string' && stroke.id.trim() ? stroke.id : generateId('stroke');
    const sizeRaw = Number(stroke.size);
    const size = Number.isFinite(sizeRaw) ? Math.max(1, Math.min(64, sizeRaw)) : 3;
    const color = typeof stroke.color === 'string' && stroke.color ? stroke.color : '#5aadff';
    const mode = stroke.mode === 'erase' ? 'erase' : 'draw';
    return {
        id,
        size,
        color,
        points,
        mode,
    };
}

function normalizeToken(token) {
    if (!token || typeof token !== 'object') return null;
    const id = typeof token.id === 'string' && token.id.trim() ? token.id : generateId('token');
    const kind = typeof token.kind === 'string' ? token.kind : 'custom';
    const label = typeof token.label === 'string' ? token.label : '';
    const color = resolveTokenColor(token.color, kind);
    const tooltip = typeof token.tooltip === 'string' ? token.tooltip : '';
    return {
        id,
        kind,
        label,
        tooltip,
        showTooltip: token.showTooltip !== undefined ? !!token.showTooltip : true,
        color,
        x: clamp01(token.x),
        y: clamp01(token.y),
        ownerId: typeof token.ownerId === 'string' ? token.ownerId : null,
        refId: typeof token.refId === 'string' ? token.refId : null,
    };
}

function normalizeShape(shape) {
    if (!shape || typeof shape !== 'object') return null;
    const id = typeof shape.id === 'string' && shape.id.trim() ? shape.id : generateId('shape');
    const type = typeof shape.type === 'string' ? shape.type : 'rectangle';
    const width = normalizeDimension(shape.width, 0.25);
    const heightFallback = type === 'line' ? 0.02 : 0.25;
    const height = normalizeDimension(shape.height, heightFallback, type === 'circle' || type === 'diamond' ? width : undefined);
    const rotation = Number.isFinite(Number(shape.rotation)) ? Number(shape.rotation) : 0;
    const fill = type === 'image' ? 'transparent' : shape.fill || DEFAULT_SHAPE_FILL;
    const stroke = shape.stroke || DEFAULT_SHAPE_STROKE;
    const strokeWidth = Number.isFinite(Number(shape.strokeWidth))
        ? Math.max(0, Math.min(20, Number(shape.strokeWidth)))
        : DEFAULT_SHAPE_STROKE_WIDTH;
    const opacity = clampOpacity(shape.opacity, type === 'image' ? 1 : DEFAULT_SHAPE_OPACITY);
    const url = typeof shape.url === 'string' ? shape.url : '';
    return {
        id,
        type,
        x: clamp01(shape.x),
        y: clamp01(shape.y),
        width,
        height,
        rotation,
        fill,
        stroke,
        strokeWidth,
        opacity,
        url,
    };
}

function normalizeDrawer(drawer) {
    if (!drawer || typeof drawer !== 'object') {
        return { userId: null, assignedAt: null };
    }
    return {
        userId: typeof drawer.userId === 'string' ? drawer.userId : null,
        assignedAt: typeof drawer.assignedAt === 'string' ? drawer.assignedAt : null,
    };
}

function normalizeBattleLogEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const action = typeof entry.action === 'string' && entry.action.trim() ? entry.action.trim() : '';
    if (!action) return null;
    const message = typeof entry.message === 'string' ? entry.message : '';
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id : generateId('log');
    const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString();
    const actorId = typeof entry.actorId === 'string' ? entry.actorId : null;
    const payload = { id, action, message, createdAt };
    if (actorId) payload.actorId = actorId;
    if (Object.prototype.hasOwnProperty.call(entry, 'details')) {
        payload.details = entry.details;
    }
    return payload;
}

function normalizePoint(point) {
    if (!point || typeof point !== 'object') return null;
    const x = clamp01(point.x);
    const y = clamp01(point.y);
    return { x, y };
}

function normalizeDimension(value, fallback, forcedValue) {
    if (forcedValue !== undefined) return Math.max(0.01, Math.min(1, forcedValue));
    const raw = Number(value);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(0.01, Math.min(1, raw));
}

function clampOpacity(value, fallback) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(1, Math.max(0.05, raw));
}

function clamp01(value) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return 0;
    if (raw < 0) return 0;
    if (raw > 1) return 1;
    return raw;
}

function generateId(prefix) {
    return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

function resolveTokenColor(color, kind) {
    if (typeof color === 'string' && color) return color;
    switch (kind) {
        case 'player':
            return DEFAULT_PLAYER_TOKEN_COLOR;
        case 'demon':
            return DEFAULT_DEMON_TOKEN_COLOR;
        case 'enemy':
            return DEFAULT_ENEMY_TOKEN_COLOR;
        case 'npc':
            return DEFAULT_NPC_TOKEN_COLOR;
        default:
            return DEFAULT_CUSTOM_TOKEN_COLOR;
    }
}
</script>

<style scoped>
.map-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
}

.map-header__info {
    display: grid;
    gap: 4px;
}

.map-header__title {
    margin: 0;
    font-size: 1.4rem;
}

.map-header__meta {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
}

.map-header__actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.map-status {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    font-size: 0.85rem;
    color: var(--muted);
}

.map-status__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    background: rgba(34, 197, 94, 0.18);
    color: rgba(34, 197, 94, 0.95);
}

.map-status__badge.is-paused {
    background: rgba(248, 113, 113, 0.18);
    color: rgba(248, 113, 113, 0.95);
}

.map-status__item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.map-status__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(148, 163, 184, 0.6);
    display: inline-block;
}

.map-status__dot.is-online {
    background: rgba(74, 222, 128, 0.95);
}

.map-status__presence {
    font-weight: 600;
}

.map-battle-log__description {
    margin: 0;
    font-size: 0.82rem;
    color: var(--muted);
}
</style>
