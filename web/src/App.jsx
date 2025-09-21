// --- FILE: web/src/App.jsx ---
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Auth, Games, Help, Items, Personas, StoryLogs, onApiActivity } from "./api";

const EMPTY_ARRAY = Object.freeze([]);

const DM_NAV = [
    {
        key: "overview",
        label: "DM Overview",
        description: "Monitor the party at a glance",
    },
    {
        key: "sheet",
        label: "Character Sheets",
        description: "Review and update any adventurer",
    },
    {
        key: "party",
        label: "Party Roster",
        description: "Health, levels, and quick switches",
    },
    {
        key: "items",
        label: "Item Library",
        description: "Craft and assign loot",
    },
    {
        key: "gear",
        label: "Gear Locker",
        description: "Track equipped slots",
    },
    {
        key: "worldSkills",
        label: "World Skills",
        description: "Review party proficiencies",
    },
    {
        key: "demons",
        label: "Demon Codex",
        description: "Summoned allies and spirits",
    },
    {
        key: "storyLogs",
        label: "Story Logs",
        description: "Read the shared Discord story log",
    },
    {
        key: "settings",
        label: "Campaign Settings",
        description: "Permissions and dangerous actions",
    },
    {
        key: "help",
        label: "Help & Docs",
        description: "Open quick rules and reference guides",
    },
];

const PLAYER_NAV = [
    {
        key: "sheet",
        label: "My Character",
        description: "Update your stats and background",
    },
    {
        key: "party",
        label: "Party View",
        description: "See who fights beside you",
    },
    {
        key: "items",
        label: "Shared Items",
        description: "Treasures the party can access",
    },
    {
        key: "gear",
        label: "My Gear",
        description: "Weapons, armor, and accessories",
    },
    {
        key: "worldSkills",
        label: "World Skills",
        description: "Ranks, modifiers, and totals",
    },
    {
        key: "demons",
        label: "Demon Companions",
        description: "Track your summoned allies",
    },
    {
        key: "storyLogs",
        label: "Story Logs",
        description: "Catch up on the Discord channel",
    },
    {
        key: "help",
        label: "Help & Docs",
        description: "Open quick rules and reference guides",
    },
];

const RealtimeContext = createContext(null);

function parseAppLocation(loc) {
    if (!loc) {
        return { joinCode: null, game: null };
    }
    const pathname = typeof loc.pathname === "string" ? loc.pathname : "";
    const search = typeof loc.search === "string" ? loc.search : "";
    const joinMatch = pathname.match(/^\/join\/([^/?#]+)/i);
    if (joinMatch) {
        let code = joinMatch[1];
        try {
            code = decodeURIComponent(code);
        } catch {
            // ignore malformed escape sequences
        }
        return { joinCode: code.toUpperCase(), game: null };
    }
    const gameMatch = pathname.match(/^\/game\/([^/?#]+)/i);
    if (gameMatch) {
        let id = gameMatch[1];
        try {
            id = decodeURIComponent(id);
        } catch {
            // ignore malformed escape sequences
        }
        const params = new URLSearchParams(search);
        const tabParam = params.get("tab");
        const playerParam = params.get("player");
        return {
            joinCode: null,
            game: {
                id,
                tab: tabParam || null,
                player: playerParam || null,
            },
        };
    }
    return { joinCode: null, game: null };
}

function useRealtimeConnection({ gameId, refreshGame, onGameDeleted }) {
    const [connectionState, setConnectionState] = useState("idle");
    const socketRef = useRef(null);
    const retryRef = useRef(null);
    const storyHandlersRef = useRef(new Set());
    const latestStoryRef = useRef(null);
    const pendingPersonaRef = useRef(new Map());
    const [personaPrompts, setPersonaPrompts] = useState([]);
    const [personaStatuses, setPersonaStatuses] = useState({});
    const [tradeSessions, setTradeSessions] = useState({});
    const refreshRef = useRef(refreshGame);
    const refreshPromiseRef = useRef(null);
    const refreshQueuedRef = useRef(false);
    const gameDeletedRef = useRef(onGameDeleted);

    useEffect(() => {
        refreshRef.current = refreshGame;
    }, [refreshGame]);

    useEffect(() => {
        gameDeletedRef.current = onGameDeleted;
    }, [onGameDeleted]);

    const requestGameRefresh = useCallback(() => {
        const execute = () => {
            const fn = refreshRef.current;
            if (typeof fn !== "function") {
                refreshPromiseRef.current = null;
                refreshQueuedRef.current = false;
                return;
            }
            const promise = Promise.resolve()
                .then(() => fn())
                .catch((err) => console.warn("Realtime refresh failed", err))
                .finally(() => {
                    if (refreshQueuedRef.current) {
                        refreshQueuedRef.current = false;
                        execute();
                    } else {
                        refreshPromiseRef.current = null;
                    }
                });
            refreshPromiseRef.current = promise;
        };

        if (refreshPromiseRef.current) {
            refreshQueuedRef.current = true;
            return;
        }
        execute();
    }, []);

    const sendMessage = useCallback((payload) => {
        const ws = socketRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error("not_connected");
        }
        ws.send(JSON.stringify(payload));
    }, []);

    const subscribeStory = useCallback(
        (handler) => {
            if (typeof handler !== "function") return () => {};
            storyHandlersRef.current.add(handler);
            if (latestStoryRef.current) {
                try {
                    handler(latestStoryRef.current);
                } catch (err) {
                    console.error("story handler error", err);
                }
            }
            return () => {
                storyHandlersRef.current.delete(handler);
            };
        },
        []
    );

    const updatePersonaStatus = useCallback((message) => {
        if (!message?.requestId) return;
        setPersonaStatuses((prev) => ({
            ...prev,
            [message.requestId]: message,
        }));
        if (message.status && message.status !== "pending") {
            setPersonaPrompts((prev) => prev.filter((entry) => entry.request.id !== message.requestId));
        }
    }, []);

    const updateTradeSession = useCallback((trade, extras = {}) => {
        if (!trade || !trade.id) return;
        setTradeSessions((prev) => ({
            ...prev,
            [trade.id]: { ...trade, ...extras },
        }));
    }, []);

    const removeTradeSession = useCallback((tradeId) => {
        setTradeSessions((prev) => {
            if (!prev[tradeId]) return prev;
            const next = { ...prev };
            delete next[tradeId];
            return next;
        });
    }, []);

    useEffect(() => {
        if (!gameId || typeof window === "undefined") {
            return () => {};
        }

        let cancelled = false;

        const rejectPendingPersona = (reason) => {
            for (const [, entry] of pendingPersonaRef.current) {
                try {
                    entry.reject(new Error(reason));
                } catch (err) {
                    console.error("persona request reject failed", err);
                }
            }
            pendingPersonaRef.current.clear();
        };

        const handleMessage = (msg) => {
            if (!msg || typeof msg !== "object") return;
            switch (msg.type) {
                case "welcome":
                    setConnectionState("connected");
                    break;
                case "story:update":
                    if (msg.gameId !== gameId) return;
                    latestStoryRef.current = msg.snapshot;
                    for (const handler of storyHandlersRef.current) {
                        try {
                            handler(msg.snapshot);
                        } catch (err) {
                            console.error("story listener error", err);
                        }
                    }
                    break;
                case "story:impersonation_prompt":
                    if (msg.request?.gameId !== gameId) return;
                    setPersonaPrompts((prev) => {
                        const next = prev.filter((entry) => entry.request.id !== msg.request.id);
                        next.push(msg);
                        return next;
                    });
                    break;
                case "story:impersonation_status":
                    if (msg.gameId !== gameId) return;
                    if (msg.nonce && pendingPersonaRef.current.has(msg.nonce)) {
                        const pending = pendingPersonaRef.current.get(msg.nonce);
                        pendingPersonaRef.current.delete(msg.nonce);
                        try {
                            pending.resolve(msg);
                        } catch (err) {
                            console.error("persona resolve error", err);
                        }
                    }
                    updatePersonaStatus(msg);
                    break;
                case "trade:invite":
                case "trade:active":
                case "trade:update":
                    if (msg.trade?.gameId !== gameId) return;
                    updateTradeSession(msg.trade, { lastEvent: msg.type, reason: msg.reason || null, initiatedBy: msg.initiatedBy });
                    break;
                case "trade:cancelled":
                case "trade:completed":
                    if (msg.trade?.gameId !== gameId) return;
                    updateTradeSession(msg.trade, { lastEvent: msg.type, reason: msg.reason || null });
                    if (msg.type === "trade:completed") {
                        const fn = refreshRef.current;
                        if (typeof fn === "function") {
                            fn().catch((err) => console.warn("trade refresh failed", err));
                        }
                    }
                    break;
                case "trade:error":
                    console.warn("Trade error", msg.error);
                    break;
                case "game:update":
                    if (msg.gameId !== gameId) return;
                    requestGameRefresh();
                    break;
                case "game:deleted":
                    if (msg.gameId !== gameId) return;
                    try {
                        const handler = gameDeletedRef.current;
                        if (handler) {
                            Promise.resolve(handler(msg)).catch((err) =>
                                console.warn("onGameDeleted handler failed", err)
                            );
                        }
                    } finally {
                        // no-op
                    }
                    break;
                case "error":
                    console.warn("Realtime error", msg.error);
                    break;
                default:
                    break;
            }
        };

        const connect = () => {
            if (cancelled) return;
            try {
                const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
                const url = `${protocol}//${window.location.host}/ws`;
                const ws = new WebSocket(url);
                socketRef.current = ws;
                setConnectionState("connecting");

                ws.onopen = () => {
                    if (cancelled) return;
                    setConnectionState("connected");
                      try {
                          ws.send(JSON.stringify({ type: "subscribe", channel: "story", gameId }));
                          ws.send(JSON.stringify({ type: "subscribe", channel: "trade", gameId }));
                          ws.send(JSON.stringify({ type: "subscribe", channel: "game", gameId }));
                      } catch (err) {
                          console.error("subscribe failed", err);
                      }
                  };

                ws.onmessage = (event) => {
                    if (cancelled) return;
                    try {
                        const data = JSON.parse(event.data);
                        handleMessage(data);
                    } catch (err) {
                        console.error("Failed to parse realtime message", err);
                    }
                };

                ws.onclose = () => {
                    if (cancelled) return;
                    setConnectionState("disconnected");
                    socketRef.current = null;
                    rejectPendingPersona("connection_closed");
                    retryRef.current = window.setTimeout(connect, 2000);
                };

                ws.onerror = () => {
                    ws.close();
                };
            } catch (err) {
                console.error("Realtime connection failed", err);
                retryRef.current = window.setTimeout(connect, 2000);
            }
        };

        setPersonaPrompts([]);
        setPersonaStatuses({});
        setTradeSessions({});
        latestStoryRef.current = null;
        connect();

        return () => {
            cancelled = true;
            if (retryRef.current) {
                clearTimeout(retryRef.current);
                retryRef.current = null;
            }
            const ws = socketRef.current;
            if (ws) {
                ws.close();
            }
            socketRef.current = null;
            rejectPendingPersona("connection_closed");
            setConnectionState("idle");
            setPersonaPrompts([]);
            setPersonaStatuses({});
            setTradeSessions({});
        };
    }, [gameId, requestGameRefresh, updatePersonaStatus, updateTradeSession]);

    const requestPersona = useCallback(
        (targetUserId, content) =>
            new Promise((resolve, reject) => {
                if (!targetUserId) {
                    reject(new Error("missing_target"));
                    return;
                }
                const ws = socketRef.current;
                if (!ws || ws.readyState !== WebSocket.OPEN) {
                    reject(new Error("not_connected"));
                    return;
                }
                const nonce = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
                pendingPersonaRef.current.set(nonce, { resolve, reject });
                try {
                    sendMessage({
                        type: "story.impersonation.request",
                        gameId,
                        targetUserId,
                        content,
                        nonce,
                    });
                } catch (err) {
                    pendingPersonaRef.current.delete(nonce);
                    reject(err);
                }
            }),
        [gameId, sendMessage]
    );

    const respondPersona = useCallback(
        (requestId, approve) => {
            try {
                sendMessage({ type: "story.impersonation.respond", requestId, approve });
            } catch (err) {
                console.error("Failed to respond to persona request", err);
            }
        },
        [sendMessage]
    );

    const tradeActions = useMemo(
        () => ({
            start(partnerId, note) {
                if (!partnerId) return;
                try {
                    sendMessage({ type: "trade.start", gameId, partnerId, note });
                } catch (err) {
                    console.error("trade.start failed", err);
                }
            },
            respond(tradeId, accept) {
                try {
                    sendMessage({ type: "trade.respond", tradeId, accept });
                } catch (err) {
                    console.error("trade.respond failed", err);
                }
            },
            updateOffer(tradeId, items) {
                try {
                    sendMessage({ type: "trade.update", tradeId, items });
                } catch (err) {
                    console.error("trade.update failed", err);
                }
            },
            confirm(tradeId) {
                try {
                    sendMessage({ type: "trade.confirm", tradeId });
                } catch (err) {
                    console.error("trade.confirm failed", err);
                }
            },
            unconfirm(tradeId) {
                try {
                    sendMessage({ type: "trade.unconfirm", tradeId });
                } catch (err) {
                    console.error("trade.unconfirm failed", err);
                }
            },
            cancel(tradeId) {
                try {
                    sendMessage({ type: "trade.cancel", tradeId });
                } catch (err) {
                    console.error("trade.cancel failed", err);
                }
            },
            dismiss(tradeId) {
                removeTradeSession(tradeId);
            },
        }),
        [gameId, removeTradeSession, sendMessage]
    );

    const tradeList = useMemo(() => Object.values(tradeSessions), [tradeSessions]);

    return {
        status: connectionState,
        connected: connectionState === "connected",
        subscribeStory,
        requestPersona,
        respondPersona,
        personaPrompts,
        personaStatuses,
        tradeSessions: tradeList,
        tradeActions,
    };
}

const ABILITY_DEFS = [
    {
        key: "STR",
        label: "Strength",
        summary: "HP+, melee strikes, physical prowess",
    },
    {
        key: "DEX",
        label: "Dexterity",
        summary: "TP++, guns, reflexes, acting first",
    },
    {
        key: "CON",
        label: "Constitution",
        summary: "HP++, TP+, grit against ailments",
    },
    {
        key: "INT",
        label: "Intelligence",
        summary: "MP++, SP++, offensive spellcraft",
    },
    {
        key: "WIS",
        label: "Wisdom",
        summary: "MP+, restorative and support focus",
    },
    {
        key: "CHA",
        label: "Charisma",
        summary: "SP+, negotiations, social leverage",
    },
];

const ARCANA_DATA = [
    { key: "fool", label: "Fool", bonus: "+1 SP on level", penalty: "No bonus stats on creation" },
    { key: "magician", label: "Magician", bonus: "+2 INT", penalty: "-2 STR" },
    { key: "emperor", label: "Emperor", bonus: "+1 CHA, +1 STR", penalty: "-2 DEX" },
    { key: "empress", label: "Empress", bonus: "+1 CHA, +1 DEX", penalty: "-2 STR" },
    { key: "chariot", label: "Chariot", bonus: "+2 CON", penalty: "-1 DEX, -1 WIS" },
    { key: "hermit", label: "Hermit", bonus: "+2 WIS", penalty: "-2 CON" },
    { key: "fortune", label: "Fortune", bonus: "+1 CHA, +1 DEX", penalty: "-2 WIS" },
    { key: "strength", label: "Strength", bonus: "+2 STR", penalty: "-2 INT" },
    { key: "temperance", label: "Temperance", bonus: "+2 CHA", penalty: "-1 INT, -1 WIS" },
    { key: "tower", label: "Tower", bonus: "+2 WIS", penalty: "-1 STR, -1 DEX" },
    { key: "star", label: "Star", bonus: "+2 DEX", penalty: "-1 INT, -1 CHA" },
    { key: "moon", label: "Moon", bonus: "+1 STR, +1 WIS", penalty: "-2 DEX" },
    { key: "sun", label: "Sun", bonus: "+2 INT", penalty: "-2 WIS" },
    { key: "knight", label: "Knight", bonus: "+1 DEX, +1 STR", penalty: "-1 CHA, -1 CON" },
];

const DEFAULT_WORLD_SKILLS = [
    { key: "balance", label: "Balance", ability: "DEX" },
    { key: "bluff", label: "Bluff", ability: "CHA" },
    { key: "climb", label: "Climb", ability: "STR" },
    { key: "concentration", label: "Concentration", ability: "CON" },
    { key: "craftGeneral", label: "Craft (General)", ability: "INT" },
    { key: "craftKnowledge", label: "Craft (Knowledge)", ability: "INT" },
    { key: "craftMagic", label: "Craft (Magic)", ability: "INT" },
    { key: "diplomacy", label: "Diplomacy", ability: "CHA" },
    { key: "disableDevice", label: "Disable Device", ability: "DEX" },
    { key: "disguise", label: "Disguise", ability: "CHA" },
    { key: "escapeArtist", label: "Escape Artist", ability: "DEX" },
    { key: "gatherInformation", label: "Gather Information", ability: "CHA" },
    { key: "handleAnimal", label: "Handle Animal", ability: "CHA" },
    { key: "heal", label: "Heal", ability: "WIS" },
    { key: "hide", label: "Hide", ability: "DEX" },
    { key: "intimidate", label: "Intimidate", ability: "CHA" },
    { key: "jump", label: "Jump", ability: "STR" },
    { key: "knowledgeArcana", label: "Knowledge (Arcana)", ability: "INT" },
    { key: "knowledgeReligion", label: "Knowledge (Religion)", ability: "INT" },
    { key: "knowledgePlanes", label: "Knowledge (The Planes)", ability: "INT" },
    { key: "listen", label: "Listen", ability: "WIS" },
    { key: "moveSilently", label: "Move Silently", ability: "DEX" },
    { key: "negotiation", label: "Negotiation", ability: "CHA" },
    { key: "perform", label: "Perform", ability: "CHA" },
    { key: "ride", label: "Ride", ability: "DEX" },
    { key: "senseMotive", label: "Sense Motive", ability: "WIS" },
    { key: "sleightOfHand", label: "Sleight of Hand", ability: "DEX" },
    { key: "spellcraft", label: "Spellcraft", ability: "INT" },
    { key: "spot", label: "Spot", ability: "WIS" },
    { key: "survival", label: "Survival", ability: "WIS" },
    { key: "swim", label: "Swim", ability: "STR" },
    { key: "useRope", label: "Use Rope", ability: "DEX" },
];

const ABILITY_KEY_SET = new Set(ABILITY_DEFS.map((ability) => ability.key));

function makeCustomSkillId(label, existing = new Set()) {
    const base = String(label || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const fallback = base ? `custom-${base}` : `custom-${Math.random().toString(36).slice(2, 8)}`;
    let id = fallback;
    let attempt = 1;
    while (existing.has(id)) {
        attempt += 1;
        id = `${fallback}-${attempt}`;
    }
    existing.add(id);
    return id;
}

function normalizeCustomSkills(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const normalized = [];
    for (const entry of source) {
        if (!entry || typeof entry !== 'object') continue;
        const label = typeof entry.label === 'string' ? entry.label.trim() : '';
        if (!label) continue;
        const abilityRaw = typeof entry.ability === 'string' ? entry.ability.trim().toUpperCase() : '';
        const ability = ABILITY_KEY_SET.has(abilityRaw) ? abilityRaw : 'INT';
        const ranks = clampNonNegative(entry.ranks);
        const miscRaw = Number(entry.misc);
        const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
        let id = typeof entry.id === 'string' ? entry.id.trim() : '';
        if (!id || seen.has(id)) {
            id = makeCustomSkillId(label, seen);
        } else {
            seen.add(id);
        }
        normalized.push({ id, label, ability, ranks, misc });
    }
    return normalized;
}

function serializeSkills(map) {
    const out = {};
    if (!map || typeof map !== 'object') return out;
    for (const [key, value] of Object.entries(map)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const ranks = clampNonNegative(value.ranks);
        const miscRaw = Number(value.misc);
        const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
        out[key] = { ranks, misc };
    }
    return out;
}

function serializeCustomSkills(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const normalized = [];
    for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const label = typeof entry.label === 'string' ? entry.label.trim() : '';
        if (!label) continue;
        const abilityRaw = typeof entry.ability === 'string' ? entry.ability.trim().toUpperCase() : '';
        const ability = ABILITY_KEY_SET.has(abilityRaw) ? abilityRaw : 'INT';
        const ranks = clampNonNegative(entry.ranks);
        const miscRaw = Number(entry.misc);
        const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
        let id = typeof entry.id === 'string' ? entry.id.trim() : '';
        if (!id || seen.has(id)) {
            id = makeCustomSkillId(label, seen);
        } else {
            seen.add(id);
        }
        normalized.push({ id, label, ability, ranks, misc });
    }
    return normalized;
}

function createAbilityMap(initial = 0) {
    return ABILITY_DEFS.reduce((acc, ability) => {
        acc[ability.key] = initial;
        return acc;
    }, {});
}

function normalizeAbilityState(source) {
    const map = createAbilityMap(0);
    for (const ability of ABILITY_DEFS) {
        const raw = source?.[ability.key];
        const num = Number(raw);
        map[ability.key] = Number.isFinite(num) ? num : 0;
    }
    return map;
}

function resolveAbilityState(source) {
    if (!source || typeof source !== 'object') {
        return createAbilityMap(0);
    }
    const hasModernKeys = ABILITY_DEFS.every((ability) => source[ability.key] !== undefined);
    if (hasModernKeys) {
        return normalizeAbilityState(source);
    }
    const legacy = {
        STR: source.STR ?? source.strength,
        DEX: source.DEX ?? source.agility,
        CON: source.CON ?? source.endurance,
        INT: source.INT ?? source.magic,
        CHA: source.CHA ?? source.luck,
    };
    const wisGuess =
        source.WIS ??
        source.wisdom ??
        Math.round(((Number(source.magic) || 0) + (Number(source.luck) || 0)) / 2);
    legacy.WIS = wisGuess;
    return normalizeAbilityState(legacy);
}

function formatResistanceList(primary, fallback) {
    const source = primary ?? fallback;
    if (Array.isArray(source)) {
        return source.length > 0 ? source.join(', ') : '—';
    }
    if (typeof source === 'string' && source.trim()) {
        return source;
    }
    return '—';
}

function makeWorldSkillId(label, seen) {
    const base = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const fallback = base || `skill-${Math.random().toString(36).slice(2, 8)}`;
    let id = fallback;
    let attempt = 1;
    while (seen.has(id)) {
        attempt += 1;
        id = `${fallback}-${attempt}`;
    }
    return id;
}

function normalizeWorldSkillDefs(raw) {
    const allowEmpty = Array.isArray(raw);
    const source = allowEmpty ? raw : DEFAULT_WORLD_SKILLS;
    const seen = new Set();
    const normalized = [];
    for (const entry of source || []) {
        if (!entry || typeof entry !== "object") continue;
        const labelValue =
            typeof entry.label === "string"
                ? entry.label.trim()
                : typeof entry.name === "string"
                ? entry.name.trim()
                : "";
        if (!labelValue) continue;
        const abilityRaw =
            typeof entry.ability === "string" ? entry.ability.trim().toUpperCase() : "";
        const ability = ABILITY_KEY_SET.has(abilityRaw) ? abilityRaw : "INT";
        let id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : null;
        if (!id && typeof entry.key === "string" && entry.key.trim()) id = entry.key.trim();
        if (!id) id = makeWorldSkillId(labelValue, seen);
        if (seen.has(id)) {
            id = makeWorldSkillId(`${labelValue}-${Math.random().toString(36).slice(2, 4)}`, seen);
        }
        seen.add(id);
        normalized.push({ id, key: id, label: labelValue, ability });
    }
    if (normalized.length === 0 && !allowEmpty) {
        return DEFAULT_WORLD_SKILLS.map((skill) => ({
            id: skill.key,
            key: skill.key,
            label: skill.label,
            ability: ABILITY_KEY_SET.has(skill.ability) ? skill.ability : "INT",
        }));
    }
    return normalized;
}

const SAVE_DEFS = [
    { key: "fortitude", label: "Fortitude", ability: "CON" },
    { key: "reflex", label: "Reflex", ability: "DEX" },
    { key: "will", label: "Will", ability: "WIS" },
];

const ROLE_ARCHETYPES = [
    {
        key: "tank",
        title: "Tank",
        stats: "CON+++ · STR++ · DEX+",
        pros: "Tough as nails, absorbs punishment",
        cons: "Slow and often simple-minded",
    },
    {
        key: "fighter",
        title: "Fighter",
        stats: "STR+++ · DEX++ · CON+",
        pros: "Versatile weapon expert",
        cons: "Needs support versus magic",
    },
    {
        key: "gunner",
        title: "Gunner",
        stats: "DEX+++ · STR++ · CON+",
        pros: "Dominates from range",
        cons: "Fragile up close",
    },
    {
        key: "mage",
        title: "Mage",
        stats: "INT+++ · WIS++ · CHA+",
        pros: "Devastating spells & AoEs",
        cons: "Low physical defenses",
    },
    {
        key: "healer",
        title: "Healer",
        stats: "WIS+++ · INT++ · CHA+",
        pros: "Sustain & buffs",
        cons: "Lower personal damage",
    },
    {
        key: "negotiator",
        title: "Negotiator",
        stats: "CHA+++ · WIS++ · INT+",
        pros: "Best at demon diplomacy",
        cons: "Weak alone if cornered",
    },
];

function abilityModifier(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return 0;
    return Math.floor((value - 10) / 2);
}

function formatModifier(mod) {
    const value = Number(mod) || 0;
    return value >= 0 ? `+${value}` : String(value);
}

function clampNonNegative(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return num;
}

// ---------- App Root ----------
export default function App() {
    const initialRouteRef = useRef(
        typeof window !== "undefined" ? parseAppLocation(window.location) : { joinCode: null, game: null }
    );
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);
    const [games, setGames] = useState([]);
    const [active, setActive] = useState(null);
    const [tab, setTab] = useState("sheet");
    const [dmSheetPlayerId, setDmSheetPlayerId] = useState(null);
    const [pendingJoinCode, setPendingJoinCode] = useState(initialRouteRef.current.joinCode);
    const [pendingGameLink, setPendingGameLink] = useState(initialRouteRef.current.game);
    const joinInFlight = useRef(false);

    const meId = me?.id;

    useEffect(() => {
        if (!active || active.dmId !== meId) {
            if (dmSheetPlayerId !== null) setDmSheetPlayerId(null);
            return;
        }

        const players = (active.players || []).filter(
            (p) => (p?.role || "").toLowerCase() !== "dm"
        );
        if (players.length === 0) {
            if (dmSheetPlayerId !== null) setDmSheetPlayerId(null);
            return;
        }

        if (dmSheetPlayerId && players.some((p) => p.userId === dmSheetPlayerId)) {
            return;
        }

        setDmSheetPlayerId(players[0].userId);
    }, [active, dmSheetPlayerId, meId]);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const handlePopState = () => {
            const parsed = parseAppLocation(window.location);
            setPendingJoinCode(parsed.joinCode);
            setPendingGameLink(parsed.game);
            if (!parsed.game) {
                setActive(null);
                setDmSheetPlayerId(null);
            }
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [setActive, setDmSheetPlayerId, setPendingGameLink, setPendingJoinCode]);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const m = await Auth.me();
                if (!mounted) return;
                setMe(m);
                setLoading(false);
                if (m) setGames(await Games.list());
            } catch (e) {
                console.error(e);
                if (mounted) setLoading(false);
                alert(e.message || "Failed to load session");
            }
        })();
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        const link = pendingGameLink;
        if (!link) return;
        if (!link.id) {
            setPendingGameLink(null);
            return;
        }
        if (!me) return;

        const applyStateForGame = (gameData) => {
            if (!gameData) return;
            const isDM = gameData.dmId === me.id;
            const nav = isDM ? DM_NAV : PLAYER_NAV;
            const allowedTabs = new Set(nav.map((item) => item.key));
            const fallbackTab = isDM ? "overview" : "sheet";
            const desiredTab = link.tab && allowedTabs.has(link.tab) ? link.tab : fallbackTab;
            setTab((prev) => (prev === desiredTab ? prev : desiredTab));

            if (isDM) {
                let targetPlayerId = null;
                if (link.player && Array.isArray(gameData.players)) {
                    const match = gameData.players.find((p) => p && p.userId === link.player);
                    if (match && match.userId) targetPlayerId = match.userId;
                }
                if (!targetPlayerId && Array.isArray(gameData.players)) {
                    const first = gameData.players.find(
                        (p) => p && (p.role || "").toLowerCase() !== "dm" && p.userId
                    );
                    targetPlayerId = first?.userId || null;
                }
                setDmSheetPlayerId((prev) => (prev === targetPlayerId ? prev : targetPlayerId || null));
            } else {
                setDmSheetPlayerId((prev) => (prev === null ? prev : null));
            }
        };

        if (active?.id === link.id) {
            applyStateForGame(active);
            setPendingGameLink(null);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const full = await Games.get(link.id);
                if (cancelled) return;
                setActive(full);
                applyStateForGame(full);
            } catch (err) {
                console.error(err);
                if (!cancelled) {
                    if (typeof window !== "undefined") {
                        window.history.replaceState({}, "", "/");
                    }
                    setActive(null);
                    setDmSheetPlayerId(null);
                    alert(err.message || "Failed to open game");
                }
            } finally {
                if (!cancelled) {
                    setPendingGameLink(null);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [active, me, pendingGameLink, setActive, setDmSheetPlayerId, setPendingGameLink, setTab]);

    useEffect(() => {
        if (!pendingJoinCode || !me || joinInFlight.current) return;
        joinInFlight.current = true;
        let joinSucceeded = false;
        (async () => {
            try {
                const result = await Games.joinByCode(pendingJoinCode);
                setGames(await Games.list());
                if (result?.gameId) {
                    const full = await Games.get(result.gameId);
                    setActive(full);
                    if (full.dmId === me.id) {
                        const firstPlayer = (full.players || []).find(
                            (p) => (p?.role || "").toLowerCase() !== "dm"
                        );
                        setDmSheetPlayerId(firstPlayer ? firstPlayer.userId : null);
                        setTab("overview");
                    } else {
                        setDmSheetPlayerId(null);
                        setTab("sheet");
                    }
                    joinSucceeded = true;
                }
            } catch (e) {
                console.error(e);
                alert(e.message || "Failed to join game");
            } finally {
                setPendingJoinCode(null);
                joinInFlight.current = false;
                if (typeof window !== "undefined") {
                    if (!joinSucceeded) {
                        window.history.replaceState({}, "", "/");
                    }
                }
            }
        })();
    }, [pendingJoinCode, me]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (active && active.id) return;
        if (pendingGameLink) return;
        if (pendingJoinCode) return;
        const current = `${window.location.pathname}${window.location.search}`;
        if (current !== "/") {
            window.history.replaceState({}, "", "/");
        }
    }, [active, pendingGameLink, pendingJoinCode]);

    if (loading) return <Center>Loading…</Center>;

    if (!me) {
        return (
            <AuthView
                onAuthed={async () => {
                    try {
                        const m = await Auth.me();
                        setMe(m);
                        setGames(await Games.list());
                    } catch (e) {
                        alert(e.message);
                    }
                }}
            />
        );
    }

    return (
        <AuthenticatedApp
            me={me}
            games={games}
            active={active}
            setActive={setActive}
            setGames={setGames}
            tab={tab}
            setTab={setTab}
            dmSheetPlayerId={dmSheetPlayerId}
            setDmSheetPlayerId={setDmSheetPlayerId}
        />
    );
}

// ---------- Small bits ----------
function Center({ children }) {
    return (
        <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
            {children}
        </div>
    );
}

function InviteButton({ gameId }) {
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);

    useEffect(() => {
        if (!feedback) return undefined;
        const timer = setTimeout(() => setFeedback(null), 8000);
        return () => clearTimeout(timer);
    }, [feedback]);

    const copyToClipboard = useCallback(async (text) => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (err) {
            console.warn("Clipboard API failed", err);
        }

        try {
            const area = document.createElement("textarea");
            area.value = text;
            area.setAttribute("readonly", "");
            area.style.position = "absolute";
            area.style.left = "-9999px";
            document.body.appendChild(area);
            area.select();
            document.execCommand("copy");
            document.body.removeChild(area);
            return true;
        } catch (err) {
            console.warn("Fallback clipboard copy failed", err);
            return false;
        }
    }, []);

    return (
        <div className="invite-button">
            <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                    try {
                        setBusy(true);
                        const code = await Games.invite(gameId);
                        const url = `${location.origin}${code.joinUrl}`;
                        const copied = await copyToClipboard(
                            `Join my campaign using invite code ${code.code}: ${url}`
                        );
                        setFeedback({
                            code: code.code,
                            url,
                            copied,
                        });
                    } catch (e) {
                        alert(e.message);
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                {busy ? "…" : "Invite"}
            </button>

            {feedback && (
                <div className="invite-feedback" role="status" aria-live="polite">
                    <strong>
                        {feedback.copied
                            ? "Invite link copied to your clipboard"
                            : "Invite ready to share"}
                    </strong>
                    <div className="invite-feedback__row">
                        <span>Code:</span>
                        <code>{feedback.code}</code>
                    </div>
                    <div className="invite-feedback__row">
                        <span>Link:</span>
                        <code>{feedback.url}</code>
                    </div>
                    {!feedback.copied && (
                        <span className="invite-feedback__note">
                            Copying may be blocked by your browser. You can manually copy the
                            details above.
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------- Auth ----------
function AuthView({ onAuthed }) {
    const [username, setUser] = useState("");
    const [password, setPass] = useState("");
    const [mode, setMode] = useState("login");
    const [busy, setBusy] = useState(false);

    const go = async () => {
        if (!username || !password) return alert("Enter username & password");
        try {
            setBusy(true);
            if (mode === "login") await Auth.login(username, password);
            else await Auth.register(username, password);
            onAuthed();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusy(false);
        }
    };

    const onKey = (e) => e.key === "Enter" && go();

    return (
        <Center>
            <div className="card" style={{ minWidth: 360 }}>
                <h2>{mode === "login" ? "Login" : "Create Account"}</h2>
                <div className="col">
                    <input
                        placeholder="Username"
                        value={username}
                        onChange={(e) => setUser(e.target.value)}
                        onKeyDown={onKey}
                    />
                    <input
                        placeholder="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPass(e.target.value)}
                        onKeyDown={onKey}
                    />
                    <button className="btn" onClick={go} disabled={busy}>
                        {busy ? "…" : mode === "login" ? "Login" : "Register"}
                    </button>
                    <button
                        className="btn"
                        onClick={() => setMode(mode === "login" ? "register" : "login")}
                        disabled={busy}
                    >
                        {mode === "login" ? "Need an account?" : "Have an account?"}
                    </button>
                </div>
            </div>
        </Center>
    );
}

// ---------- Home ----------
function Home({ me, games, onOpen, onCreate, onDelete }) {
    const [name, setName] = useState("My Campaign");
    const [busy, setBusy] = useState(false);

    return (
        <div style={{ padding: 20, display: "grid", gap: 16 }}>
            <header className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <h2>Welcome, {me.username}</h2>
                <button
                    className="btn"
                    onClick={async () => {
                        try {
                            await Auth.logout();
                            location.reload();
                        } catch (e) {
                            alert(e.message);
                        }
                    }}
                >
                    Logout
                </button>
            </header>

            <div className="card">
                <h3>Your Games</h3>
                <div className="list">
                    {games.length === 0 && <div>No games yet.</div>}
                    {games.map((g) => {
                        const isOwner = g.dmId === me.id;
                        return (
                            <div
                                key={g.id}
                                className="row"
                                style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}
                            >
                                <div>
                                    <b>{g.name}</b>{" "}
                                    <span className="pill">{(g.players?.length ?? 0)} members</span>
                                </div>
                                <div className="row" style={{ gap: 8 }}>
                                    <button className="btn" onClick={() => onOpen(g)}>Open</button>
                                    {isOwner && (
                                        <button
                                            className="btn danger"
                                            onClick={() => onDelete?.(g)}
                                        >
                                            Delete
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="card">
                <h3>Start a New Game (DM)</h3>
                <div className="row">
                    <input
                        placeholder="Campaign name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <button
                        className="btn"
                        disabled={!name.trim() || busy}
                        onClick={async () => {
                            try {
                                setBusy(true);
                                await onCreate(name.trim());
                                alert("Game created");
                            } catch (e) {
                                alert(e.message);
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        {busy ? "…" : "Create"}
                    </button>
                </div>
            </div>

            <div className="card">
                <h3>Join by Invite Code</h3>
                <JoinByCode onJoined={() => location.reload()} />
            </div>
        </div>
    );
}

function AuthenticatedApp({
    me,
    games,
    active,
    setActive,
    setGames,
    tab,
    setTab,
    dmSheetPlayerId,
    setDmSheetPlayerId,
}) {
    if (!active) {
        return (
            <Home
                me={me}
                games={games}
                onOpen={async (g) => {
                    const full = await Games.get(g.id);
                    setActive(full);
                    if (full.dmId === me.id) {
                        const firstPlayer = (full.players || []).find(
                            (p) => (p?.role || "").toLowerCase() !== "dm"
                        );
                        setDmSheetPlayerId(firstPlayer ? firstPlayer.userId : null);
                    } else {
                        setDmSheetPlayerId(null);
                    }
                    setTab(full.dmId === me.id ? "overview" : "sheet");
                }}
                onCreate={async (name) => {
                    await Games.create(name);
                    setGames(await Games.list());
                }}
                onDelete={async (game) => {
                    if (!confirm(`Delete the game "${game.name}"? This cannot be undone.`)) return;
                    try {
                        await Games.delete(game.id);
                        setGames(await Games.list());
                        alert("Game deleted");
                    } catch (e) {
                        alert(e.message);
                    }
                }}
            />
        );
    }

    return (
        <GameView
            me={me}
            game={active}
            setActive={setActive}
            setGames={setGames}
            tab={tab}
            setTab={setTab}
            dmSheetPlayerId={dmSheetPlayerId}
            setDmSheetPlayerId={setDmSheetPlayerId}
        />
    );
}

function GameView({
    me,
    game,
    setActive,
    setGames,
    tab,
    setTab,
    dmSheetPlayerId,
    setDmSheetPlayerId,
}) {
    const isDM = game.dmId === me.id;
    const [apiBusy, setApiBusy] = useState(false);
    const [refreshBusy, setRefreshBusy] = useState(false);
    const loadedTabRef = useRef(false);
    const loadedSheetRef = useRef(false);

    useEffect(() => onApiActivity(setApiBusy), []);

    const tabPrefKey = game?.id ? `amz:lastTab:${game.id}` : null;
    const sheetPrefKey = game?.id ? `amz:lastSheet:${game.id}` : null;

    useEffect(() => {
        loadedTabRef.current = false;
    }, [tabPrefKey]);

    useEffect(() => {
        loadedSheetRef.current = false;
    }, [sheetPrefKey]);

    const navItems = useMemo(() => (isDM ? DM_NAV : PLAYER_NAV), [isDM]);

    useEffect(() => {
        if (navItems.length === 0) return;
        if (!navItems.some((item) => item.key === tab)) {
            setTab(navItems[0].key);
        }
    }, [navItems, tab, setTab]);

    useEffect(() => {
        if (!tabPrefKey || loadedTabRef.current) return;
        const stored = typeof window !== "undefined" ? localStorage.getItem(tabPrefKey) : null;
        if (stored && navItems.some((item) => item.key === stored)) {
            setTab(stored);
        }
        loadedTabRef.current = true;
    }, [navItems, setTab, tabPrefKey]);

    useEffect(() => {
        if (!tabPrefKey) return;
        if (typeof window !== "undefined") {
            localStorage.setItem(tabPrefKey, tab);
        }
    }, [tab, tabPrefKey]);

    const activeNav = navItems.find((item) => item.key === tab) || navItems[0] || null;

    const campaignPlayers = useMemo(
        () =>
            (game.players || []).filter(
                (p) => (p?.role || "").toLowerCase() !== "dm"
            ),
        [game.players]
    );

    useEffect(() => {
        if (!sheetPrefKey || !isDM || loadedSheetRef.current) return;
        const stored = typeof window !== "undefined" ? localStorage.getItem(sheetPrefKey) : null;
        if (stored && campaignPlayers.some((p) => p.userId === stored)) {
            setDmSheetPlayerId(stored);
        }
        loadedSheetRef.current = true;
    }, [campaignPlayers, isDM, setDmSheetPlayerId, sheetPrefKey]);

    useEffect(() => {
        if (!sheetPrefKey || !isDM) return;
        if (typeof window !== "undefined") {
            localStorage.setItem(sheetPrefKey, dmSheetPlayerId || "");
        }
    }, [dmSheetPlayerId, isDM, sheetPrefKey]);

    const myEntry = useMemo(
        () => campaignPlayers.find((p) => p.userId === me.id) || null,
        [campaignPlayers, me.id]
    );

    const demonCount = Array.isArray(game.demons) ? game.demons.length : 0;

    const headerPills = useMemo(() => {
        if (isDM) {
            return [
                { label: `Players ${campaignPlayers.length}` },
                { label: `Demons ${demonCount}` },
            ];
        }
        if (!myEntry) return [];
        const hpRaw = Number(myEntry.character?.resources?.hp ?? 0);
        const maxRaw = Number(myEntry.character?.resources?.maxHP ?? 0);
        const hp = Number.isFinite(hpRaw) ? hpRaw : 0;
        const maxHP = Number.isFinite(maxRaw) ? maxRaw : 0;
        const lvlRaw = Number(myEntry.character?.resources?.level);
        const level = Number.isFinite(lvlRaw) ? lvlRaw : null;
        const tone =
            maxHP > 0
                ? hp <= 0
                    ? "danger"
                    : hp / maxHP < 0.35
                    ? "warn"
                    : "success"
                : hp <= 0
                ? "danger"
                : undefined;
        const hpLabel = maxHP > 0 ? `${hp}/${maxHP}` : String(hp);
        const pills = [];
        if (level !== null) pills.push({ label: `Level ${level}` });
        pills.push({
            label: `HP ${hpLabel}`,
            tone,
        });
        return pills;
    }, [campaignPlayers.length, demonCount, isDM, myEntry]);

    const refreshGameData = useCallback(async () => {
        if (!game?.id) return null;
        const full = await Games.get(game.id);
        setActive(full);
        return full;
    }, [game?.id, setActive]);

    const handleRefresh = useCallback(async () => {
        if (!game?.id) return;
        try {
            setRefreshBusy(true);
            await refreshGameData();
        } catch (e) {
            alert(e.message);
        } finally {
            setRefreshBusy(false);
        }
    }, [game?.id, refreshGameData]);

    const handleGameDeleted = useCallback(async () => {
        if (typeof window !== "undefined" && !isDM) {
            alert("This game has been deleted. Returning to your campaigns.");
        }
        setActive(null);
        setDmSheetPlayerId(null);
        try {
            setGames(await Games.list());
        } catch (err) {
            console.warn("Failed to refresh games after deletion", err);
        }
    }, [isDM, setActive, setDmSheetPlayerId, setGames]);

    useEffect(() => {
        if (typeof window === "undefined" || !game?.id) return;
        const params = new URLSearchParams();
        if (tab) params.set("tab", tab);
        if (isDM && dmSheetPlayerId) params.set("player", dmSheetPlayerId);
        const search = params.toString();
        const next = `/game/${encodeURIComponent(game.id)}${search ? `?${search}` : ""}`;
        const current = `${window.location.pathname}${window.location.search}`;
        if (current !== next) {
            window.history.replaceState({}, "", next);
        }
    }, [game?.id, tab, isDM, dmSheetPlayerId]);

    useEffect(() => {
        const handler = (evt) => {
            if (!(evt.ctrlKey && evt.altKey)) return;
            const target = evt.target;
            if (target && target instanceof HTMLElement) {
                const tag = target.tagName.toLowerCase();
                if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
            }
            if (evt.key === "r" || evt.key === "R") {
                evt.preventDefault();
                handleRefresh();
                return;
            }
            const numeric = Number(evt.key);
            if (Number.isInteger(numeric) && numeric > 0 && numeric <= navItems.length) {
                evt.preventDefault();
                setTab(navItems[numeric - 1].key);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [handleRefresh, navItems, setTab]);

    const realtime = useRealtimeConnection({
        gameId: game.id,
        refreshGame: refreshGameData,
        onGameDeleted: handleGameDeleted,
    });

    return (
        <RealtimeContext.Provider value={realtime}>
            <div className="app-root">
                <div className={`app-activity${apiBusy ? " is-active" : ""}`}>
                    <div className="app-activity__bar" />
                </div>
                <div className="app-shell">
            <aside className="app-sidebar">
                <div className="sidebar__header">
                    <span className="sidebar__mode">
                        {isDM ? "Dungeon Master Mode" : "Player Mode"}
                    </span>
                    <h2 className="sidebar__title">{game.name}</h2>
                    <p className="sidebar__summary">
                        {isDM
                            ? "Share quick links, manage characters, and keep your table organized."
                            : "Track your hero, review the party, and stay aligned with your DM."}
                    </p>
                </div>
                <nav className="sidebar__nav">
                    {navItems.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            className={`sidebar__nav-button${tab === item.key ? " is-active" : ""}`}
                            onClick={() => setTab(item.key)}
                        >
                            <span className="sidebar__nav-label">{item.label}</span>
                            <span className="sidebar__nav-desc">{item.description}</span>
                        </button>
                    ))}
                </nav>
                <div className="sidebar__footer">
                    {isDM && <InviteButton gameId={game.id} />}
                    <button
                        type="button"
                        className="btn ghost"
                        onClick={() => {
                            setActive(null);
                            setDmSheetPlayerId(null);
                        }}
                    >
                        Back to games
                    </button>
                </div>
            </aside>
            <main className="app-main">
                <header className="app-main__header">
                    <div>
                        <span className="eyebrow">
                            {isDM ? "Dungeon Master" : "Player"} View
                        </span>
                        <h1>{activeNav?.label || ""}</h1>
                        {activeNav?.description && (
                            <p className="text-muted">{activeNav.description}</p>
                        )}
                    </div>
                    <div className="app-main__header-meta">
                        <div className="header-actions">
                            <button
                                type="button"
                                className="btn ghost btn-small"
                                onClick={handleRefresh}
                                disabled={refreshBusy}
                                title="Ctrl+Alt+R"
                            >
                                {refreshBusy ? "Refreshing…" : "Refresh data"}
                            </button>
                            <span className="text-muted text-small hotkey-hint">
                                Ctrl+Alt+1–{navItems.length} to switch · Ctrl+Alt+R refresh
                            </span>
                        </div>
                        <div className="header-pills">
                            {headerPills.map((pill, idx) => (
                                <span
                                    key={idx}
                                    className={`pill${pill.tone ? ` ${pill.tone}` : ""}`}
                                >
                                    {pill.label}
                                </span>
                            ))}
                        </div>
                        {!isDM && myEntry && (
                            <div className="header-player">
                                <span className="text-muted text-small">Character</span>
                                <strong>{myEntry.character?.name || me.username}</strong>
                            </div>
                        )}
                    </div>
                </header>

                <div className="app-content">
                    {tab === "overview" && isDM && (
                        <DMOverview
                            game={game}
                            onInspectPlayer={(player) => {
                                if (!player?.userId) return;
                                setDmSheetPlayerId(player.userId);
                                setTab("sheet");
                            }}
                        />
                    )}

                    {tab === "sheet" && (
                        <Sheet
                            me={me}
                            game={game}
                            targetUserId={isDM ? dmSheetPlayerId : undefined}
                            onChangePlayer={isDM ? setDmSheetPlayerId : undefined}
                            onSave={async (ch) => {
                                await Games.saveCharacter(game.id, ch);
                                const full = await Games.get(game.id);
                                setActive(full);
                            }}
                        />
                    )}

                    {tab === "party" && (
                        <Party
                            mode={isDM ? "dm" : "player"}
                            game={game}
                            selectedPlayerId={isDM ? dmSheetPlayerId : null}
                            currentUserId={me.id}
                            onSelectPlayer={
                                isDM
                                    ? (player) => {
                                          if (!player?.userId) return;
                                          setDmSheetPlayerId(player.userId);
                                          setTab("sheet");
                                      }
                                    : undefined
                            }
                        />
                    )}

                    {tab === "items" && (
                        <ItemsTab
                            game={game}
                            me={me}
                            onUpdate={async () => {
                                const full = await Games.get(game.id);
                                setActive(full);
                            }}
                        />
                    )}

                    {tab === "gear" && (
                        <GearTab
                            game={game}
                            me={me}
                            onUpdate={async () => {
                                const full = await Games.get(game.id);
                                setActive(full);
                            }}
                        />
                    )}

                    {tab === "worldSkills" && (
                        <WorldSkillsTab
                            game={game}
                            me={me}
                            onUpdate={async () => {
                                const full = await Games.get(game.id);
                                setActive(full);
                            }}
                        />
                    )}

                    {tab === "demons" && (
                        <DemonTab
                            game={game}
                            me={me}
                            onUpdate={async () => {
                                const full = await Games.get(game.id);
                                setActive(full);
                            }}
                        />
                    )}

                    {tab === "storyLogs" && <StoryLogsTab game={game} me={me} />}

                    {tab === "help" && <HelpTab />}

                    {tab === "settings" && isDM && (
                        <SettingsTab
                            game={game}
                            me={me}
                            onUpdate={async (per) => {
                                await Games.setPerms(game.id, per);
                                const full = await Games.get(game.id);
                                setActive(full);
                            }}
                            onGameRefresh={handleRefresh}
                            onKickPlayer={
                                isDM
                                    ? async (playerId) => {
                                          if (!playerId) return;
                                          try {
                                              if (dmSheetPlayerId === playerId) {
                                                  setDmSheetPlayerId(null);
                                              }
                                              await Games.removePlayer(game.id, playerId);
                                              const full = await Games.get(game.id);
                                              setActive(full);
                                              setGames(await Games.list());
                                          } catch (e) {
                                              alert(e.message);
                                          }
                                      }
                                    : undefined
                            }
                            onDelete={
                                isDM
                                    ? async () => {
                                          if (
                                              !confirm(
                                                  `Delete the game "${game.name}"? This cannot be undone.`
                                              )
                                          ) {
                                              return;
                                          }
                                          try {
                                              await Games.delete(game.id);
                                              setActive(null);
                                              setDmSheetPlayerId(null);
                                              setGames(await Games.list());
                                              alert("Game deleted");
                                          } catch (e) {
                                              alert(e.message);
                                          }
                                      }
                                    : undefined
                            }
                        />
                    )}
                </div>
            </main>
                </div>
                <PersonaPromptCenter realtime={realtime} />
                <TradeOverlay game={game} me={me} realtime={realtime} />
            </div>
        </RealtimeContext.Provider>
    );
}

// ---------- DM Overview ----------
function DMOverview({ game, onInspectPlayer }) {
    const players = useMemo(
        () =>
            (game.players || []).filter(
                (p) => (p?.role || "").toLowerCase() !== "dm"
            ),
        [game.players]
    );

    const averageLevel = useMemo(() => {
        if (players.length === 0) return null;
        const total = players.reduce((sum, player) => {
            const lvlRaw = Number(player.character?.resources?.level);
            const lvl = Number.isFinite(lvlRaw) ? lvlRaw : 0;
            return sum + lvl;
        }, 0);
        const avg = total / players.length;
        return Number.isFinite(avg) ? avg : null;
    }, [players]);

    const stabilizedCount = useMemo(
        () =>
            players.filter((player) => {
                const hpRaw = Number(player.character?.resources?.hp ?? 0);
                const hp = Number.isFinite(hpRaw) ? hpRaw : 0;
                return hp > 0;
            }).length,
        [players]
    );

    const demonCount = Array.isArray(game.demons) ? game.demons.length : 0;
    const sharedItemCount = Array.isArray(game.items?.shared)
        ? game.items.shared.length
        : 0;
    const customItemCount = Array.isArray(game.items?.custom)
        ? game.items.custom.length
        : 0;
    const customGearCount = Array.isArray(game.gear?.custom)
        ? game.gear.custom.length
        : 0;

    const metrics = [
        {
            label: "Adventurers",
            value: String(players.length),
            description: "Players currently in your campaign",
        },
        {
            label: "Average level",
            value:
                players.length > 0 && averageLevel !== null
                    ? averageLevel.toFixed(1)
                    : "—",
            description:
                players.length > 0
                    ? "Across all active character sheets"
                    : "Awaiting character data",
        },
        {
            label: "Ready for battle",
            value: `${stabilizedCount}/${players.length || 0}`,
            description: "Members above zero hit points",
        },
        {
            label: "Codex entries",
            value: String(demonCount),
            description: "Demons recorded in the pool",
        },
    ];

    const resourceRows = [
        {
            label: "Shared loot",
            value: sharedItemCount,
            hint: "Items visible to the entire party",
        },
        {
            label: "Custom item templates",
            value: customItemCount,
            hint: "Crafted specifically for this campaign",
        },
        {
            label: "Custom gear templates",
            value: customGearCount,
            hint: "Equipment ready to assign",
        },
        {
            label: "Demons in codex",
            value: demonCount,
            hint: "Summoned allies on standby",
        },
    ];

    const canInspect = typeof onInspectPlayer === "function";

    return (
        <div className="stack-lg dm-overview">
            <section className="overview-metrics">
                {metrics.map((metric) => (
                    <div key={metric.label} className="metric-card">
                        <span className="text-muted text-small">{metric.label}</span>
                        <strong className="metric-card__value">{metric.value}</strong>
                        <span className="text-muted text-small">{metric.description}</span>
                    </div>
                ))}
            </section>

            <section className="card">
                <div className="header">
                    <div>
                        <h3>Party status</h3>
                        <p className="text-muted text-small">
                            {canInspect
                                ? "Select a player to jump directly to their sheet."
                                : "Player information at a glance."}
                        </p>
                    </div>
                </div>
                <div className="list overview-roster">
                    {players.length === 0 ? (
                        <div className="text-muted">No players have joined yet.</div>
                    ) : (
                        players.map((player, index) => {
                            const key = player.userId || `player-${index}`;
                            const name =
                                player.character?.name?.trim() ||
                                player.username ||
                                `Player ${index + 1}`;
                            const subtitleParts = [];
                            if (player.character?.profile?.class) {
                                subtitleParts.push(player.character.profile.class);
                            }
                            const lvlRaw = Number(player.character?.resources?.level);
                            const level = Number.isFinite(lvlRaw) ? lvlRaw : null;
                            if (level !== null) subtitleParts.push(`LV ${level}`);
                            const subtitle = subtitleParts.join(" · ");

                            const hpRaw = Number(player.character?.resources?.hp ?? 0);
                            const hp = Number.isFinite(hpRaw) ? hpRaw : 0;
                            const maxRaw = Number(player.character?.resources?.maxHP ?? 0);
                            const maxHP = Number.isFinite(maxRaw) ? maxRaw : 0;
                            const hpLabel = maxHP > 0 ? `${hp}/${maxHP}` : String(hp);
                            const ratio = maxHP > 0 ? hp / maxHP : hp > 0 ? 1 : 0;
                            let tone = "success";
                            if (hp <= 0) tone = "danger";
                            else if (ratio < 0.35) tone = "warn";

                            const inventoryCount = Array.isArray(player.inventory)
                                ? player.inventory.length
                                : 0;

                            return (
                                <div
                                    key={key}
                                    className={`overview-player${canInspect ? " is-clickable" : ""}`}
                                    role={canInspect ? "button" : undefined}
                                    tabIndex={canInspect ? 0 : undefined}
                                    onClick={() => {
                                        if (!canInspect) return;
                                        onInspectPlayer(player);
                                    }}
                                    onKeyDown={(evt) => {
                                        if (!canInspect) return;
                                        if (evt.key === "Enter" || evt.key === " ") {
                                            evt.preventDefault();
                                            onInspectPlayer(player);
                                        }
                                    }}
                                >
                                    <div className="overview-player__info">
                                        <span className="overview-player__name">{name}</span>
                                        {subtitle && (
                                            <span className="text-muted text-small">
                                                {subtitle}
                                            </span>
                                        )}
                                    </div>
                                    <div className="overview-player__meta">
                                        <span className={`pill ${tone}`}>HP {hpLabel}</span>
                                        <span className="pill">Items {inventoryCount}</span>
                                        {canInspect && (
                                            <button
                                                type="button"
                                                className="btn ghost btn-small"
                                                onClick={(evt) => {
                                                    evt.stopPropagation();
                                                    onInspectPlayer(player);
                                                }}
                                            >
                                                Open sheet
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </section>

            <section className="card overview-resources">
                <div className="header">
                    <div>
                        <h3>Campaign resources</h3>
                        <p className="text-muted text-small">
                            A quick look at shared pools across the table.
                        </p>
                    </div>
                </div>
                <div className="resource-grid">
                    {resourceRows.map((row) => (
                        <div key={row.label} className="resource-chip">
                            <span className="text-muted text-small">{row.label}</span>
                            <strong>{row.value}</strong>
                            <span className="text-muted text-small">{row.hint}</span>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

function JoinByCode({ onJoined }) {
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    return (
        <div className="row">
            <input
                placeholder="CODE"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
                className="btn"
                disabled={!code.trim() || busy}
                onClick={async () => {
                    try {
                        setBusy(true);
                        await Games.joinByCode(code.trim());
                        onJoined();
                    } catch (e) {
                        alert(e.message);
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                {busy ? "…" : "Join"}
            </button>
        </div>
    );
}

function MathField({ label, value, onCommit, className, disabled = false }) {
    const [draft, setDraft] = useState(formatNumber(value));
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!dirty) {
            setDraft(formatNumber(value));
        }
    }, [dirty, value]);

    const reset = useCallback(() => {
        setDraft(formatNumber(value));
        setDirty(false);
        setError(null);
    }, [value]);

    const commit = useCallback(() => {
        if (!dirty) return;
        const raw = draft.trim();
        if (!raw) {
            onCommit?.(0);
            setDraft("0");
            setDirty(false);
            setError(null);
            return;
        }
        const result = evaluateMathExpression(raw);
        if (!result.ok) {
            setError(result.reason || "Invalid expression");
            return;
        }
        onCommit?.(result.value);
        setDraft(formatNumber(result.value));
        setDirty(false);
        setError(null);
    }, [dirty, draft, onCommit]);

    const containerClass = className ? `col ${className}` : "col";

    return (
        <div className={containerClass}>
            <label>{label}</label>
            <input
                type="text"
                value={draft}
                className={error ? "input-error" : undefined}
                onChange={(e) => {
                    setDraft(e.target.value);
                    setDirty(true);
                    if (error) setError(null);
                }}
                onBlur={commit}
                onKeyDown={(evt) => {
                    if (evt.key === "Enter") {
                        evt.preventDefault();
                        commit();
                    } else if (evt.key === "Escape") {
                        evt.preventDefault();
                        reset();
                    }
                }}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                title="Supports +, -, ×, ÷, and parentheses"
                aria-invalid={error ? true : undefined}
                disabled={disabled}
            />
            {error && <span className="text-error text-small">{error}</span>}
        </div>
    );
}

function evaluateMathExpression(input) {
    const sanitized = input.replace(/×/g, "*").replace(/÷/g, "/");
    const stripped = sanitized.replace(/\s+/g, "");
    if (!stripped) {
        return { ok: false, reason: "Enter a value" };
    }
    if (!/^[0-9+\-*/().]+$/.test(stripped)) {
        return { ok: false, reason: "Use numbers and + - × ÷ ()" };
    }
    try {
        const value = Function(`"use strict";return (${stripped});`)();
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return { ok: false, reason: "Calculation failed" };
        }
        return { ok: true, value };
    } catch {
        return { ok: false, reason: "Calculation failed" };
    }
}

function formatNumber(value) {
    if (value === null || value === undefined) return "";
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) return "";
    return String(num);
}

// ---------- Sheet ----------
function Sheet({ me, game, onSave, targetUserId, onChangePlayer }) {
    const isDM = game.dmId === me.id;
    const worldSkills = useMemo(() => normalizeWorldSkillDefs(game.worldSkills), [game.worldSkills]);
    const selectablePlayers = useMemo(
        () => (game.players || []).filter((p) => (p?.role || "").toLowerCase() !== "dm"),
        [game.players]
    );
    const selectedPlayerId = isDM ? targetUserId : me.id;
    const slot = useMemo(
        () =>
            (
                selectedPlayerId
                    ? (game.players || []).find((p) => p.userId === selectedPlayerId)
                    : null
            ) || {},
        [game.players, selectedPlayerId]
    );
    const slotCharacter = slot?.character;
    const [ch, setCh] = useState(() => normalizeCharacter(slotCharacter, worldSkills));
    const [saving, setSaving] = useState(false);
    const [showWizard, setShowWizard] = useState(false);

    useEffect(() => {
        setCh(normalizeCharacter(slotCharacter, worldSkills));
    }, [game.id, selectedPlayerId, slotCharacter, worldSkills]);

    const set = useCallback((path, value) => {
        setCh((prev) => {
            const next = deepClone(prev || {});
            let ref = next;
            const seg = path.split(".");
            for (let i = 0; i < seg.length - 1; i++) {
                const key = seg[i];
                if (ref[key] == null || typeof ref[key] !== "object") {
                    ref[key] = {};
                }
                ref = ref[key];
            }
            ref[seg.at(-1)] = value;
            return normalizeCharacter(next, worldSkills);
        });
    }, [worldSkills]);

    const abilityDefault = ABILITY_DEFS[0]?.key || "INT";
    const [customDraft, setCustomDraft] = useState({ label: "", ability: abilityDefault });

    useEffect(() => {
        setCustomDraft((prev) => ({
            label: prev.label,
            ability: ABILITY_KEY_SET.has(prev.ability) ? prev.ability : abilityDefault,
        }));
    }, [abilityDefault]);

    const hasSelection = !isDM || (!!selectedPlayerId && slot && slot.userId);
    const noPlayers = isDM && selectablePlayers.length === 0;
    const canEditSheet = (isDM && hasSelection) || (!isDM && !!game.permissions?.canEditStats);
    const disableInputs = !canEditSheet;
    const disableSave = saving || !canEditSheet;

    const abilityInfo = useMemo(() => {
        const stats = ch?.stats || {};
        return ABILITY_DEFS.map((entry) => {
            const raw = stats?.[entry.key];
            const modifier = abilityModifier(raw);
            const num = Number(raw);
            const score = raw === undefined || raw === null || raw === ""
                ? ""
                : Number.isFinite(num)
                ? num
                : raw;
            return {
                ...entry,
                score,
                modifier,
            };
        });
    }, [ch?.stats]);

    const abilityMap = useMemo(() => {
        const map = {};
        for (const ability of abilityInfo) map[ability.key] = ability;
        return map;
    }, [abilityInfo]);

    const getMod = useCallback(
        (abilityKey) => abilityMap[abilityKey]?.modifier ?? 0,
        [abilityMap]
    );

    const level = clampNonNegative(get(ch, "resources.level")) || 1;
    const hp = clampNonNegative(get(ch, "resources.hp"));
    const maxHP = clampNonNegative(get(ch, "resources.maxHP"));
    const mp = clampNonNegative(get(ch, "resources.mp"));
    const maxMP = clampNonNegative(get(ch, "resources.maxMP"));
    const tp = clampNonNegative(get(ch, "resources.tp"));
    const spRaw = get(ch, "resources.sp");
    const spValue = clampNonNegative(spRaw);
    const resourceMode = get(ch, "resources.useTP") ? "TP" : "MP";

    const suggestedHP = Math.max(1, Math.ceil(17 + getMod("CON") + getMod("STR") / 2));
    const suggestedMP = Math.max(0, Math.ceil(17 + getMod("INT") + getMod("WIS") / 2));
    const suggestedTP = Math.max(0, Math.ceil(7 + getMod("DEX") + getMod("CON") / 2));
    const suggestedSP = Math.max(0, Math.ceil((5 + getMod("INT")) * 2 + getMod("CHA")));

    const resourceSuggestions = useMemo(() => {
        const rows = [
            {
                key: "hp",
                label: "Suggested HP",
                value: suggestedHP,
                detail: "17 + CON + (STR ÷ 2)",
                actual: hp,
            },
            {
                key: resourceMode === "TP" ? "tp" : "mp",
                label: resourceMode === "TP" ? "Suggested TP" : "Suggested MP",
                value: resourceMode === "TP" ? suggestedTP : suggestedMP,
                detail: resourceMode === "TP" ? "7 + DEX + (CON ÷ 2)" : "17 + INT + (WIS ÷ 2)",
                actual: resourceMode === "TP" ? tp : mp,
            },
            {
                key: "sp",
                label: "Suggested SP",
                value: suggestedSP,
                detail: "((5 + INT) × 2) + CHA",
                actual: spValue,
            },
            {
                key: "rank",
                label: "Max skill rank",
                value: Math.max(4, level * 2 + 2),
                detail: "(Level × 2) + 2",
            },
        ];
        return rows;
    }, [hp, level, mp, resourceMode, spValue, suggestedHP, suggestedMP, suggestedSP, suggestedTP, tp]);

    const skillRows = useMemo(() => {
        const skills = ch?.skills || {};
        return worldSkills.map((skill) => {
            const ranks = clampNonNegative(get(skills, `${skill.key}.ranks`));
            const miscRaw = Number(get(skills, `${skill.key}.misc`));
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            const abilityMod = getMod(skill.ability);
            const total = abilityMod + ranks + misc;
            return { ...skill, ranks, misc, abilityMod, total };
        });
    }, [ch?.skills, getMod, worldSkills]);

    const customSkillRows = useMemo(() => {
        const list = Array.isArray(ch?.customSkills) ? ch.customSkills : [];
        return list.map((entry, index) => {
            const ranks = clampNonNegative(entry.ranks);
            const miscRaw = Number(entry.misc);
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            const ability = ABILITY_KEY_SET.has(entry.ability) ? entry.ability : abilityDefault;
            const abilityMod = getMod(ability);
            const total = abilityMod + ranks + misc;
            return { ...entry, index, ability, ranks, misc, abilityMod, total };
        });
    }, [abilityDefault, ch?.customSkills, getMod]);

    const spentSP = useMemo(() => {
        const base = skillRows.reduce((sum, row) => sum + row.ranks, 0);
        const extras = customSkillRows.reduce((sum, row) => sum + row.ranks, 0);
        return base + extras;
    }, [customSkillRows, skillRows]);
    const availableSP =
        spRaw === undefined || spRaw === null || spRaw === ""
            ? suggestedSP
            : spValue;
    const maxSkillRank = Math.max(4, level * 2 + 2);
    const overSpent = spentSP > availableSP;
    const rankIssues = useMemo(() => {
        const standard = skillRows.filter((row) => row.ranks > maxSkillRank).map((row) => row.label);
        const extras = customSkillRows
            .filter((row) => row.ranks > maxSkillRank)
            .map((row) => row.label);
        return [...standard, ...extras];
    }, [customSkillRows, maxSkillRank, skillRows]);

    const updateCustomSkillField = useCallback(
        (index, field, value) => {
            if (field === 'ranks') {
                const num = Number(value);
                const sanitized = Math.min(clampNonNegative(num), maxSkillRank);
                set(`customSkills.${index}.ranks`, sanitized);
                return;
            }
            if (field === 'misc') {
                const num = Number(value);
                set(`customSkills.${index}.misc`, Number.isFinite(num) ? num : 0);
                return;
            }
            set(`customSkills.${index}.${field}`, value);
        },
        [maxSkillRank, set]
    );

    const removeCustomSkill = useCallback(
        (index) => {
            setCh((prev) => {
                const next = deepClone(prev || {});
                if (!Array.isArray(next.customSkills)) return prev;
                next.customSkills.splice(index, 1);
                return normalizeCharacter(next, worldSkills);
            });
        },
        [setCh, worldSkills]
    );

    const addCustomSkill = useCallback(() => {
        const label = customDraft.label.trim();
        if (!label) return;
        const abilityRaw =
            typeof customDraft.ability === 'string'
                ? customDraft.ability.trim().toUpperCase()
                : abilityDefault;
        const ability = ABILITY_KEY_SET.has(abilityRaw) ? abilityRaw : abilityDefault;
        setCh((prev) => {
            const next = deepClone(prev || {});
            if (!Array.isArray(next.customSkills)) next.customSkills = [];
            const ids = new Set(next.customSkills.map((entry) => entry.id));
            const id = makeCustomSkillId(label, ids);
            next.customSkills.push({ id, label, ability, ranks: 0, misc: 0 });
            return normalizeCharacter(next, worldSkills);
        });
        setCustomDraft({ label: '', ability });
    }, [abilityDefault, customDraft, setCh, worldSkills]);

    const saveRows = useMemo(() => {
        const saves = ch?.resources?.saves || {};
        return SAVE_DEFS.map((save) => {
            const total = clampNonNegative(get(saves, `${save.key}.total`));
            const abilityMod = getMod(save.ability);
            const fallback = abilityMod;
            return {
                ...save,
                abilityMod,
                total: total || total === 0 ? total : fallback,
            };
        });
    }, [ch?.resources?.saves, getMod]);

    const characterName = ch?.name?.trim() || "Unnamed Adventurer";
    const classLabel = ch?.profile?.class?.trim() || "";
    const arcanaLabel = ch?.profile?.arcana?.trim() || "";
    const alignmentLabel = ch?.profile?.alignment?.trim() || "";
    const pronounLabel = ch?.profile?.pronouns?.trim() || "";
    const handlerName = ch?.profile?.player?.trim() || slot?.username || me.username;

    const initiativeValueRaw = get(ch, "resources.initiative");
    const initiativeValue = Number.isFinite(Number(initiativeValueRaw))
        ? Number(initiativeValueRaw)
        : 0;
    const resourceLabel = resourceMode === "TP" ? "TP" : "MP";
    const resourceCurrent = resourceMode === "TP" ? tp : mp;
    const resourceMax = resourceMode === "TP" ? null : maxMP;
    const nextLevelExp = Math.max(1, Number(level) || 1) * 1000;

    const displayValue = (value) => {
        if (value === undefined || value === null || value === "") return "—";
        if (typeof value === "number") {
            return Number.isFinite(value) ? value : "—";
        }
        const num = Number(value);
        return Number.isFinite(num) ? num : value;
    };

    const headlineParts = [classLabel, arcanaLabel, alignmentLabel].filter(Boolean);

    const handleWizardApply = useCallback(
        (payload) => {
            setCh(normalizeCharacter(payload || {}, worldSkills));
            setShowWizard(false);
        },
        [worldSkills]
    );

    const textField = (label, path, props = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <input
                type={props.type || "text"}
                placeholder={props.placeholder || ""}
                value={get(ch, path) ?? ""}
                onChange={(e) => set(path, e.target.value)}
                disabled={disableInputs || props.disabled}
                autoComplete="off"
            />
        </label>
    );

    const selectField = (label, path, options, props = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <select
                value={get(ch, path) ?? ""}
                onChange={(e) => set(path, e.target.value)}
                disabled={disableInputs || props.disabled}
            >
                <option value="">—</option>
                {options.map((opt) => (
                    <option key={opt.key || opt.value || opt.label} value={opt.value ?? opt.key}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </label>
    );

    const textareaField = (label, path, props = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <textarea
                rows={props.rows || 3}
                placeholder={props.placeholder || ""}
                value={get(ch, path) ?? ""}
                onChange={(e) => set(path, e.target.value)}
                disabled={disableInputs || props.disabled}
            />
        </label>
    );

    const updateSkill = useCallback(
        (skillKey, field, value) => {
            const max = field === "ranks" ? maxSkillRank : undefined;
            const raw = Number(value);
            const sanitized =
                field === "misc"
                    ? Number.isFinite(raw)
                        ? raw
                        : 0
                    : clampNonNegative(raw);
            const finalValue = max !== undefined ? Math.min(sanitized, max) : sanitized;
            set(`skills.${skillKey}.${field}`, finalValue);
        },
        [maxSkillRank, set]
    );

    return (
        <div className="card sheet-card">
            <div className="sheet-header">
                <div>
                    <h3>Character sheet</h3>
                    <p className="text-muted text-small">
                        Keep your AntiMatter Zone adventurer organised with modern tools inspired by the old spreadsheets.
                    </p>
                </div>
                <div className="sheet-header__actions">
                    <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setShowWizard(true)}
                        disabled={!hasSelection || disableInputs}
                    >
                        Launch setup wizard
                    </button>
                </div>
            </div>

            {isDM && (
                <div className="sheet-toolbar">
                    <label className="field">
                        <span className="field__label">Player</span>
                        <select
                            value={selectedPlayerId ?? ""}
                            onChange={(e) => onChangePlayer?.(e.target.value || null)}
                            disabled={selectablePlayers.length === 0}
                        >
                            <option value="">Select a player…</option>
                            {selectablePlayers.map((p) => (
                                <option key={p.userId} value={p.userId}>
                                    {p.character?.name || p.username || "Unnamed player"}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            )}

            {noPlayers && (
                <p className="text-muted" style={{ marginTop: 0 }}>
                    Invite players to your campaign to view their character sheets.
                </p>
            )}

            {!hasSelection ? (
                !noPlayers && (
                    <p className="text-muted" style={{ marginTop: 0 }}>
                        Select a player to review and edit their sheet.
                    </p>
                )
            ) : (
                <>
                    <div className="sheet-spotlight">
                        <div className="sheet-spotlight__identity">
                            <h2>{characterName}</h2>
                            {headlineParts.length > 0 && (
                                <p className="sheet-spotlight__meta">{headlineParts.join(" · ")}</p>
                            )}
                            <p className="text-muted text-small">
                                Handler: {handlerName}
                                {pronounLabel ? ` · Pronouns ${pronounLabel}` : ""}
                            </p>
                        </div>
                        <div className="sheet-spotlight__stats">
                            <div className="sheet-spotlight__stat">
                                <span className="sheet-spotlight__stat-label">Level</span>
                                <span className="sheet-spotlight__stat-value">{displayValue(level)}</span>
                                <span className="sheet-spotlight__stat-detail">
                                    Next at {nextLevelExp.toLocaleString()} EXP
                                </span>
                            </div>
                            <div className="sheet-spotlight__stat">
                                <span className="sheet-spotlight__stat-label">HP</span>
                                <span className="sheet-spotlight__stat-value">
                                    {displayValue(hp)}
                                    <span className="sheet-spotlight__stat-extra">/ {displayValue(maxHP)}</span>
                                </span>
                                <span className="sheet-spotlight__stat-detail">Update in combat breaks</span>
                            </div>
                            <div className="sheet-spotlight__stat">
                                <span className="sheet-spotlight__stat-label">{resourceLabel}</span>
                                <span className="sheet-spotlight__stat-value">
                                    {displayValue(resourceCurrent)}
                                    {resourceMax !== null && (
                                        <span className="sheet-spotlight__stat-extra">/ {displayValue(resourceMax)}</span>
                                    )}
                                </span>
                                <span className="sheet-spotlight__stat-detail">
                                    {resourceLabel === "TP"
                                        ? "Regains through actions"
                                        : "Spend on spells & skills"}
                                </span>
                            </div>
                            <div className="sheet-spotlight__stat">
                                <span className="sheet-spotlight__stat-label">SP spent</span>
                                <span className="sheet-spotlight__stat-value">{displayValue(spentSP)}</span>
                                <span className="sheet-spotlight__stat-detail">Pool {displayValue(availableSP)}</span>
                            </div>
                            <div className="sheet-spotlight__stat">
                                <span className="sheet-spotlight__stat-label">Initiative</span>
                                <span className="sheet-spotlight__stat-value">{formatModifier(initiativeValue)}</span>
                                <span className="sheet-spotlight__stat-detail">
                                    Base bonus before gear or situational tweaks
                                </span>
                            </div>
                        </div>
                        <div className="sheet-spotlight__notes text-muted text-small">
                            Use the panels below to record everything else—gear, saves, and world skills. Suggested
                            totals stay pinned on the right for quick reference.
                        </div>
                    </div>

                    <section className="sheet-section">
                        <div className="section-header">
                            <h4>Adventurer profile</h4>
                            <p className="text-muted text-small">
                                Capture the essentials, from pronouns to alignment and arcana.
                            </p>
                        </div>
                        <div className="sheet-grid">
                            {textField("Character name", "name")}
                            {textField("Player / handler", "profile.player", { placeholder: slot?.username || me.username })}
                            {textField("Pronouns", "profile.pronouns")}
                            {textField("Concept / class", "profile.class")}
                            {selectField(
                                "Arcana",
                                "profile.arcana",
                                ARCANA_DATA.map((opt) => ({ ...opt, value: opt.label }))
                            )}
                            {textField("Negotiator title", "profile.negotiator")}
                            {textField("Alignment", "profile.alignment")}
                            {textField("Race / origin", "profile.race")}
                            {textField("Age", "profile.age")}
                            {textField("Gender", "profile.gender")}
                            {textField("Height", "profile.height")}
                            {textField("Weight", "profile.weight")}
                            {textField("Eye colour", "profile.eye")}
                            {textField("Hair", "profile.hair")}
                        </div>
                        <div className="sheet-grid sheet-grid--stretch">
                            {textareaField("Background & hooks", "profile.background", { rows: 3 })}
                            {textareaField("Notes", "profile.notes", { rows: 3 })}
                        </div>
                    </section>

                    <section className="sheet-section">
                        <div className="section-header">
                            <h4>Progress & resources</h4>
                            <p className="text-muted text-small">
                                Base formulas assume modifiers: adjust manually if your table uses variants.
                            </p>
                        </div>
                        <div className="sheet-grid sheet-grid--resources">
                            <MathField
                                label="Level"
                                value={get(ch, "resources.level")}
                                onCommit={(val) => set("resources.level", clampNonNegative(val))}
                                className="math-inline"
                                disabled={disableInputs}
                            />
                            <MathField
                                label="EXP"
                                value={get(ch, "resources.exp")}
                                onCommit={(val) => set("resources.exp", clampNonNegative(val))}
                                className="math-inline"
                                disabled={disableInputs}
                            />
                            <MathField
                                label="HP"
                                value={hp}
                                onCommit={(val) => set("resources.hp", clampNonNegative(val))}
                                className="math-inline"
                                disabled={disableInputs}
                            />
                            <MathField
                                label="Max HP"
                                value={maxHP}
                                onCommit={(val) => set("resources.maxHP", clampNonNegative(val))}
                                className="math-inline"
                                disabled={disableInputs}
                            />
                            <label className="field">
                                <span className="field__label">Resource type</span>
                                <select
                                    value={resourceMode}
                                    onChange={(e) => set("resources.useTP", e.target.value === "TP")}
                                    disabled={disableInputs}
                                >
                                    <option value="MP">MP</option>
                                    <option value="TP">TP</option>
                                </select>
                            </label>
                            {resourceMode === "TP" ? (
                                <MathField
                                    label="TP"
                                    value={tp}
                                    onCommit={(val) => set("resources.tp", clampNonNegative(val))}
                                    className="math-inline"
                                    disabled={disableInputs}
                                />
                            ) : (
                                <>
                                    <MathField
                                        label="MP"
                                        value={mp}
                                        onCommit={(val) => set("resources.mp", clampNonNegative(val))}
                                        className="math-inline"
                                        disabled={disableInputs}
                                    />
                                    <MathField
                                        label="Max MP"
                                        value={maxMP}
                                        onCommit={(val) => set("resources.maxMP", clampNonNegative(val))}
                                        className="math-inline"
                                        disabled={disableInputs}
                                    />
                                </>
                            )}
                            <MathField
                                label="SP (earned)"
                                value={get(ch, "resources.sp")}
                                onCommit={(val) => set("resources.sp", clampNonNegative(val))}
                                className="math-inline"
                                disabled={disableInputs}
                            />
                            <MathField
                                label="Initiative bonus"
                                value={get(ch, "resources.initiative")}
                                onCommit={(val) => set("resources.initiative", Number(val))}
                                className="math-inline"
                                disabled={disableInputs}
                            />
                        </div>
                        <div className="sheet-hints">
                            {resourceSuggestions.map((row) => {
                                const mismatched =
                                    row.actual !== undefined && Number(row.actual) !== row.value;
                                return (
                                    <div
                                        key={row.key}
                                        className={`sheet-hint${mismatched ? " warn" : ""}`}
                                    >
                                        <span className="sheet-hint__label">{row.label}</span>
                                        <span className="sheet-hint__value">{row.value}</span>
                                        <span className="sheet-hint__meta">{row.detail}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="save-grid">
                            {saveRows.map((save) => (
                                <div key={save.key} className="save-card">
                                    <div className="save-card__header">
                                        <span>{save.label}</span>
                                        <span className="pill light">
                                            {save.ability} mod {formatModifier(save.abilityMod)}
                                        </span>
                                    </div>
                                    <MathField
                                        label="Total save"
                                        value={save.total}
                                        onCommit={(val) => set(`resources.saves.${save.key}.total`, Number(val))}
                                        className="math-inline"
                                        disabled={disableInputs}
                                    />
                                    <p className="text-muted text-small">
                                        Add class, gear, and situational bonuses here.
                                    </p>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="sheet-section">
                        <div className="section-header">
                            <h4>Ability scores</h4>
                            <p className="text-muted text-small">
                                Every formula references these modifiers. Even numbers step the modifier.
                            </p>
                        </div>
                        <div className="ability-grid">
                            {abilityInfo.map((ability) => (
                                <div key={ability.key} className="ability-card">
                                    <div className="ability-card__heading">
                                        <span className="ability-card__abbr">{ability.key}</span>
                                        <span className="ability-card__title">{ability.label}</span>
                                    </div>
                                    <MathField
                                        label="Score"
                                        value={ability.score}
                                        onCommit={(val) => set(`stats.${ability.key}`, Number(val))}
                                        disabled={disableInputs}
                                    />
                                    <div className="ability-card__mod">
                                        <span>Modifier</span>
                                        <span className="ability-card__mod-value">
                                            {formatModifier(ability.modifier)}
                                        </span>
                                    </div>
                                    <p className="ability-card__summary">{ability.summary}</p>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="sheet-section">
                        <div className="section-header">
                            <h4>World skills</h4>
                            <p className="text-muted text-small">
                                Spend SP immediately. Max rank at level {level} is {maxSkillRank}.
                            </p>
                        </div>
                        <div className={`sp-summary${overSpent ? " warn" : ""}`}>
                            <span>SP spent: {spentSP}</span>
                            <span>Suggested pool: {availableSP}</span>
                            <span>Max rank: {maxSkillRank}</span>
                            {rankIssues.length > 0 && (
                                <span className="sp-summary__warning">
                                    Over cap: {rankIssues.join(", ")}
                                </span>
                            )}
                        </div>
                        <div className="sheet-table-wrapper">
                            <table className="sheet-table skill-table">
                                <thead>
                                    <tr>
                                        <th>Skill</th>
                                        <th>Ability</th>
                                        <th>Ability mod</th>
                                        <th>Ranks</th>
                                        <th>Misc</th>
                                        <th>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {skillRows.map((row) => (
                                        <tr key={row.key}>
                                            <th scope="row">
                                                <span className="skill-name">{row.label}</span>
                                            </th>
                                            <td>{row.ability}</td>
                                            <td>
                                                <span className="pill light">{formatModifier(row.abilityMod)}</span>
                                            </td>
                                            <td>
                                                <MathField
                                                    label="Ranks"
                                                    value={row.ranks}
                                                    onCommit={(val) => updateSkill(row.key, "ranks", val)}
                                                    className="math-inline"
                                                    disabled={disableInputs}
                                                />
                                            </td>
                                            <td>
                                                <MathField
                                                    label="Misc"
                                                    value={row.misc}
                                                    onCommit={(val) => updateSkill(row.key, "misc", val)}
                                                    className="math-inline"
                                                    disabled={disableInputs}
                                                />
                                            </td>
                                            <td>
                                                <span className="skill-total">{formatModifier(row.total)}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                            <div>
                                <h5 style={{ margin: 0 }}>Custom skills</h5>
                                <p className="text-muted text-small" style={{ margin: 0 }}>
                                    Unique proficiencies unlocked through play. Managed by the DM.
                                </p>
                            </div>
                            {customSkillRows.length === 0 ? (
                                <div className="text-muted">No custom skills recorded.</div>
                            ) : (
                                <div className="sheet-table-wrapper">
                                    <table className="sheet-table skill-table">
                                        <thead>
                                            <tr>
                                                <th>Skill</th>
                                                <th>Ability</th>
                                                <th>Ability mod</th>
                                                <th>Ranks</th>
                                                <th>Misc</th>
                                                <th>Total</th>
                                                {canEditSheet && <th aria-label="Actions" />}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {customSkillRows.map((row) => (
                                                <tr key={row.id || row.index}>
                                                    <th scope="row">
                                                        <input
                                                            type="text"
                                                            value={row.label}
                                                            onChange={(e) =>
                                                                updateCustomSkillField(row.index, 'label', e.target.value)
                                                            }
                                                            disabled={disableInputs}
                                                            placeholder="Skill name"
                                                            style={{ width: '100%' }}
                                                        />
                                                    </th>
                                                    <td>
                                                        <select
                                                            value={row.ability}
                                                            onChange={(e) =>
                                                                updateCustomSkillField(
                                                                    row.index,
                                                                    'ability',
                                                                    e.target.value
                                                                )
                                                            }
                                                            disabled={disableInputs}
                                                        >
                                                            {ABILITY_DEFS.map((ability) => (
                                                                <option key={ability.key} value={ability.key}>
                                                                    {ability.key} · {ability.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <span className="pill light">{formatModifier(row.abilityMod)}</span>
                                                    </td>
                                                    <td>
                                                        <MathField
                                                            label="Ranks"
                                                            value={row.ranks}
                                                            onCommit={(val) =>
                                                                updateCustomSkillField(row.index, 'ranks', val)
                                                            }
                                                            className="math-inline"
                                                            disabled={disableInputs}
                                                        />
                                                    </td>
                                                    <td>
                                                        <MathField
                                                            label="Misc"
                                                            value={row.misc}
                                                            onCommit={(val) =>
                                                                updateCustomSkillField(row.index, 'misc', val)
                                                            }
                                                            className="math-inline"
                                                            disabled={disableInputs}
                                                        />
                                                    </td>
                                                    <td>
                                                        <span className="skill-total">{formatModifier(row.total)}</span>
                                                    </td>
                                                    {canEditSheet && (
                                                        <td>
                                                            <button
                                                                className="btn ghost"
                                                                onClick={() => removeCustomSkill(row.index)}
                                                                disabled={disableInputs}
                                                            >
                                                                Remove
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {canEditSheet && (
                                <div
                                    className="row"
                                    style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
                                >
                                    <input
                                        placeholder="Add new custom skill"
                                        value={customDraft.label}
                                        onChange={(e) => setCustomDraft((prev) => ({ ...prev, label: e.target.value }))}
                                        style={{ flex: 2, minWidth: 200 }}
                                        disabled={disableInputs}
                                    />
                                    <label className="field" style={{ minWidth: 160 }}>
                                        <span className="field__label">Ability</span>
                                        <select
                                            value={customDraft.ability}
                                            onChange={(e) =>
                                                setCustomDraft((prev) => ({
                                                    ...prev,
                                                    ability: e.target.value,
                                                }))
                                            }
                                            disabled={disableInputs}
                                        >
                                            {ABILITY_DEFS.map((ability) => (
                                                <option key={ability.key} value={ability.key}>
                                                    {ability.key} · {ability.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <button
                                        className="btn"
                                        onClick={addCustomSkill}
                                        disabled={disableInputs || !customDraft.label.trim()}
                                    >
                                        Add custom skill
                                    </button>
                                </div>
                            )}
                        </div>
                    </section>

                    <div className="sheet-footer">
                        {!canEditSheet && (
                            <span className="text-muted text-small">
                                You have read-only access. Ask your DM for edit permissions.
                            </span>
                        )}
                        <button
                            className="btn"
                            disabled={disableSave}
                            onClick={async () => {
                                if (!hasSelection) return;
                                try {
                                    setSaving(true);
                                    const payload =
                                        isDM && selectedPlayerId !== me.id
                                            ? { userId: selectedPlayerId, character: ch }
                                            : ch;
                                    await onSave(payload);
                                } catch (e) {
                                    alert(e.message);
                                } finally {
                                    setSaving(false);
                                }
                            }}
                        >
                            {saving ? "Saving…" : "Save changes"}
                        </button>
                    </div>
                </>
            )}

            {showWizard && (
                <PlayerSetupWizard
                    open={showWizard}
                    onClose={() => setShowWizard(false)}
                    onApply={handleWizardApply}
                    baseCharacter={ch}
                    playerName={slot?.username || me.username}
                    worldSkills={worldSkills}
                />
            )}
        </div>
    );
}

function PlayerSetupWizard({ open, onClose, onApply, baseCharacter, playerName, worldSkills }) {
    const steps = useMemo(
        () => [
            {
                key: "concept",
                title: "Concept & role",
                blurb: "Align on the basics before you roll any dice.",
            },
            {
                key: "abilities",
                title: "Roll ability points",
                blurb: "Generate six scores (6d20 by default) and place them where you like.",
            },
            {
                key: "arcana",
                title: "Choose an Arcana",
                blurb: "Arcana grant permanent bonuses and penalties on creation.",
            },
            {
                key: "resources",
                title: "Resources & world skills",
                blurb: "Calculate HP/MP/TP/SP and spend skill ranks immediately.",
            },
            {
                key: "review",
                title: "Review & apply",
                blurb: "Double-check your hero, then send everything to the sheet.",
            },
        ],
        []
    );

    const normalizedWorldSkills = useMemo(
        () => normalizeWorldSkillDefs(worldSkills),
        [worldSkills]
    );

    const initial = useMemo(
        () => buildInitialWizardState(baseCharacter, playerName, normalizedWorldSkills),
        [baseCharacter, normalizedWorldSkills, playerName]
    );

    const [step, setStep] = useState(0);
    const [concept, setConcept] = useState(initial.concept);
    const [abilities, setAbilities] = useState(initial.abilities);
    const [resources, setResources] = useState(initial.resources);
    const [skills, setSkills] = useState(initial.skills);
    const [rolled, setRolled] = useState([]);

    useEffect(() => {
        if (!open) return;
        setStep(0);
        setConcept(initial.concept);
        setAbilities(initial.abilities);
        setResources(initial.resources);
        setSkills(initial.skills);
        setRolled([]);
    }, [open, initial]);

    const abilityRows = useMemo(
        () =>
            ABILITY_DEFS.map((entry) => {
                const score = clampNonNegative(abilities?.[entry.key]);
                const modifier = abilityModifier(score);
                return {
                    ...entry,
                    score,
                    modifier,
                };
            }),
        [abilities]
    );

    const abilityMods = useMemo(() => {
        const map = {};
        for (const row of abilityRows) map[row.key] = row.modifier;
        return map;
    }, [abilityRows]);

    const level = clampNonNegative(resources.level) || 1;
    const suggestedHP = Math.max(1, Math.ceil(17 + (abilityMods.CON ?? 0) + (abilityMods.STR ?? 0) / 2));
    const suggestedMP = Math.max(0, Math.ceil(17 + (abilityMods.INT ?? 0) + (abilityMods.WIS ?? 0) / 2));
    const suggestedTP = Math.max(0, Math.ceil(7 + (abilityMods.DEX ?? 0) + (abilityMods.CON ?? 0) / 2));
    const suggestedSP = Math.max(
        0,
        Math.ceil((5 + (abilityMods.INT ?? 0)) * 2 + (abilityMods.CHA ?? 0))
    );
    const maxSkillRank = Math.max(4, level * 2 + 2);

    const wizardSkillRows = useMemo(() => {
        return normalizedWorldSkills.map((skill) => {
            const entry = skills?.[skill.key] || { ranks: 0, misc: 0 };
            const ranks = clampNonNegative(entry.ranks);
            const miscRaw = Number(entry.misc);
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            const abilityMod = abilityMods[skill.ability] ?? 0;
            const total = abilityMod + ranks + misc;
            return { ...skill, ranks, misc, abilityMod, total };
        });
    }, [abilityMods, normalizedWorldSkills, skills]);

    const spentSP = wizardSkillRows.reduce((sum, row) => sum + row.ranks, 0);
    const availableSP =
        resources.sp === undefined || resources.sp === null
            ? suggestedSP
            : clampNonNegative(resources.sp);
    const overSpent = spentSP > availableSP;
    const rankIssues = wizardSkillRows.filter((row) => row.ranks > maxSkillRank).map((row) => row.label);

    const setConceptField = useCallback((field, value) => {
        setConcept((prev) => ({ ...prev, [field]: value }));
    }, []);

    const setAbilityField = useCallback((key, value) => {
        setAbilities((prev) => ({
            ...prev,
            [key]: clampNonNegative(value),
        }));
    }, []);

    const setResourceField = useCallback((field, value) => {
        setResources((prev) => {
            if (field === "mode") {
                return { ...prev, mode: value === "TP" ? "TP" : "MP" };
            }
            if (field === "notes") {
                return { ...prev, notes: value };
            }
            const num = Number(value);
            if (field === "initiative") {
                return { ...prev, initiative: Number.isFinite(num) ? num : 0 };
            }
            return { ...prev, [field]: clampNonNegative(num) };
        });
    }, []);

    const updateSkillField = useCallback(
        (key, field, value) => {
            setSkills((prev) => {
                const next = { ...prev };
                const current = next[key] || { ranks: 0, misc: 0 };
                const num = Number(value);
                const sanitized =
                    field === "misc"
                        ? Number.isFinite(num)
                            ? num
                            : 0
                        : Math.min(Math.max(0, Number.isFinite(num) ? num : 0), maxSkillRank);
                next[key] = { ...current, [field]: sanitized };
                return next;
            });
        },
        [maxSkillRank]
    );

    const assignValuesToAbilities = useCallback((values) => {
        setAbilities((prev) => {
            const next = { ...prev };
            ABILITY_DEFS.forEach((ability, index) => {
                if (values[index] !== undefined) {
                    next[ability.key] = clampNonNegative(values[index]);
                }
            });
            return next;
        });
    }, []);

    const rollStats = useCallback(
        (mode) => {
            const values = [];
            for (let i = 0; i < 6; i++) {
                if (mode === "alt") {
                    values.push(Math.floor(Math.random() * 12) + 1 + 4);
                } else {
                    values.push(Math.floor(Math.random() * 20) + 1);
                }
            }
            setRolled(values);
            assignValuesToAbilities(values);
        },
        [assignValuesToAbilities]
    );

    const autoFillResources = useCallback(() => {
        setResources((prev) => {
            const useTP = prev.mode === "TP";
            return {
                ...prev,
                hp: suggestedHP,
                maxHP: suggestedHP,
                mp: useTP ? prev.mp : suggestedMP,
                maxMP: useTP ? prev.maxMP : suggestedMP,
                tp: useTP ? suggestedTP : prev.tp,
                sp: suggestedSP,
            };
        });
    }, [suggestedHP, suggestedMP, suggestedSP, suggestedTP]);

    const goNext = useCallback(() => {
        setStep((prev) => Math.min(prev + 1, steps.length - 1));
    }, [steps.length]);
    const goBack = useCallback(() => {
        setStep((prev) => Math.max(prev - 1, 0));
    }, []);

    const canAdvance = useMemo(() => {
        const current = steps[step]?.key;
        if (current === "concept") {
            return !!concept.name.trim();
        }
        if (current === "resources") {
            return !overSpent && rankIssues.length === 0;
        }
        return true;
    }, [concept.name, overSpent, rankIssues.length, step, steps]);

    const canApply = !overSpent && rankIssues.length === 0;

    const handleApply = useCallback(() => {
        if (!canApply) return;
        const payload = buildCharacterFromWizard(
            { concept, abilities, resources, skills },
            baseCharacter,
            normalizedWorldSkills
        );
        onApply?.(payload);
    }, [abilities, baseCharacter, canApply, concept, normalizedWorldSkills, onApply, resources, skills]);

    const conceptField = (label, field, opts = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <input
                type="text"
                value={concept[field] ?? ""}
                onChange={(e) => setConceptField(field, e.target.value)}
                placeholder={opts.placeholder || ""}
                autoComplete="off"
            />
        </label>
    );

    const conceptArea = (label, field, opts = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <textarea
                rows={opts.rows || 3}
                value={concept[field] ?? ""}
                onChange={(e) => setConceptField(field, e.target.value)}
                placeholder={opts.placeholder || ""}
            />
        </label>
    );

    const resourceField = (label, field, opts = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <input
                type="number"
                value={resources[field] ?? 0}
                onChange={(e) => setResourceField(field, e.target.value)}
                min={opts.allowNegative ? undefined : 0}
                step={opts.step || 1}
            />
        </label>
    );

    const renderConcept = () => (
        <div className="wizard-stack">
            <p>
                Collaborate with your table on tone and party balance. Mix and match archetypes, and
                remember that demon allies can round out any gaps.
            </p>
            <div className="wizard-grid">
                {conceptField("Character name", "name")}
                {conceptField("Player / handler", "player", { placeholder: playerName || "" })}
                {conceptField("Pronouns", "pronouns")}
                {conceptField("Concept / class", "class")}
                {conceptField("Alignment", "alignment")}
                {conceptField("Negotiator title", "negotiator")}
                {conceptField("Race / origin", "race")}
                {conceptField("Age", "age")}
                {conceptField("Gender", "gender")}
                {conceptField("Height", "height")}
                {conceptField("Weight", "weight")}
                {conceptField("Eye colour", "eye")}
                {conceptField("Hair", "hair")}
            </div>
            <div className="wizard-archetypes">
                {ROLE_ARCHETYPES.map((role) => (
                    <div key={role.key} className="wizard-role-card">
                        <h5>{role.title}</h5>
                        <div className="wizard-role-meta">{role.stats}</div>
                        <div className="wizard-role-row">
                            <span className="pill success">Pros</span>
                            <span>{role.pros}</span>
                        </div>
                        <div className="wizard-role-row">
                            <span className="pill warn">Cons</span>
                            <span>{role.cons}</span>
                        </div>
                    </div>
                ))}
            </div>
            <div className="wizard-grid wizard-grid--stretch">
                {conceptArea("Background & hooks", "background", { rows: 3 })}
                {conceptArea("Notes", "notes", { rows: 3 })}
            </div>
        </div>
    );

    const renderAbilities = () => (
        <div className="wizard-stack">
            <p>
                Roll six ability points using 6d20. The brave can try multiple sets and pick their
                favourite, or use the alternate 6d12+4 method for a flatter 5–16 spread. Even numbers
                bump your modifier; odds are for gear prerequisites.
            </p>
            <div className="wizard-roller">
                <button type="button" className="btn" onClick={() => rollStats("d20")}>Roll 6d20</button>
                <button type="button" className="btn" onClick={() => rollStats("alt")}>Roll 6d12 + 4</button>
                {rolled.length > 0 && (
                    <div className="wizard-rolled" role="status">
                        <span>Latest roll: {rolled.join(", ")}</span>
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={() => assignValuesToAbilities(rolled)}
                        >
                            Reapply to abilities
                        </button>
                    </div>
                )}
            </div>
            <div className="ability-grid ability-grid--wizard">
                {abilityRows.map((ability) => (
                    <div key={ability.key} className="ability-card ability-card--wizard">
                        <div className="ability-card__heading">
                            <span className="ability-card__abbr">{ability.key}</span>
                            <span className="ability-card__title">{ability.label}</span>
                        </div>
                        <label className="field">
                            <span className="field__label">Score</span>
                            <input
                                type="number"
                                value={ability.score}
                                min={0}
                                onChange={(e) => setAbilityField(ability.key, e.target.value)}
                            />
                        </label>
                        <div className="ability-card__mod">
                            <span>Modifier</span>
                            <span className="ability-card__mod-value">{formatModifier(ability.modifier)}</span>
                        </div>
                        <p className="ability-card__summary">{ability.summary}</p>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderArcana = () => (
        <div className="wizard-stack">
            <p>
                Arcana act like races—permanent stat tweaks applied once during creation. Keep the total
                adjustment within four points and remember to update your ability scores if your table
                applies them immediately.
            </p>
            <div className="wizard-arcana-grid">
                {ARCANA_DATA.map((arcana) => {
                    const selected = concept.arcana === arcana.label;
                    return (
                        <label
                            key={arcana.key}
                            className={`wizard-arcana-card${selected ? " is-selected" : ""}`}
                        >
                            <input
                                type="radio"
                                name="wizard-arcana"
                                value={arcana.label}
                                checked={selected}
                                onChange={() => setConceptField("arcana", arcana.label)}
                            />
                            <div className="wizard-arcana-card__body">
                                <span className="wizard-arcana-card__title">{arcana.label}</span>
                                <div className="wizard-arcana-card__row">
                                    <span className="pill success">Bonus</span>
                                    <span>{arcana.bonus}</span>
                                </div>
                                <div className="wizard-arcana-card__row">
                                    <span className="pill warn">Penalty</span>
                                    <span>{arcana.penalty}</span>
                                </div>
                            </div>
                        </label>
                    );
                })}
            </div>
            <p className="text-muted text-small">
                Need a custom Arcana? Keep the math fair—no more than ±4 total across all stats.
            </p>
        </div>
    );

    const renderResources = () => (
        <div className="wizard-stack">
            <p>
                HP uses <b>17 + CON + (STR ÷ 2)</b>. MP uses <b>17 + INT + (WIS ÷ 2)</b>. TP uses
                <b>7 + DEX + (CON ÷ 2)</b> and regens one per round. SP uses <b>((5 + INT) × 2) + CHA</b>
                and must be spent immediately on world skills. Round up and never let gains drop below 1.
            </p>
            <div className="wizard-grid wizard-grid--resources">
                {resourceField("Level", "level")}
                {resourceField("EXP", "exp")}
                <label className="field">
                    <span className="field__label">Resource type</span>
                    <select
                        value={resources.mode}
                        onChange={(e) => setResourceField("mode", e.target.value)}
                    >
                        <option value="MP">MP</option>
                        <option value="TP">TP</option>
                    </select>
                </label>
                {resourceField("HP", "hp")}
                {resourceField("Max HP", "maxHP")}
                {resources.mode === "TP" ? (
                    resourceField("TP", "tp")
                ) : (
                    <>
                        {resourceField("MP", "mp")}
                        {resourceField("Max MP", "maxMP")}
                    </>
                )}
                {resourceField("SP (earned)", "sp")}
                {resourceField("Initiative bonus", "initiative", { allowNegative: true })}
            </div>
            <div className="wizard-hints">
                <div className="sheet-hint">
                    <span className="sheet-hint__label">Suggested HP</span>
                    <span className="sheet-hint__value">{suggestedHP}</span>
                    <span className="sheet-hint__meta">17 + CON + (STR ÷ 2)</span>
                </div>
                <div className="sheet-hint">
                    <span className="sheet-hint__label">
                        {resources.mode === "TP" ? "Suggested TP" : "Suggested MP"}
                    </span>
                    <span className="sheet-hint__value">
                        {resources.mode === "TP" ? suggestedTP : suggestedMP}
                    </span>
                    <span className="sheet-hint__meta">
                        {resources.mode === "TP"
                            ? "7 + DEX + (CON ÷ 2)"
                            : "17 + INT + (WIS ÷ 2)"}
                    </span>
                </div>
                <div className="sheet-hint">
                    <span className="sheet-hint__label">Suggested SP</span>
                    <span className="sheet-hint__value">{suggestedSP}</span>
                    <span className="sheet-hint__meta">((5 + INT) × 2) + CHA</span>
                </div>
                <div className="sheet-hint">
                    <span className="sheet-hint__label">Max skill rank</span>
                    <span className="sheet-hint__value">{maxSkillRank}</span>
                    <span className="sheet-hint__meta">(Level × 2) + 2</span>
                </div>
            </div>
            <div className="wizard-actions">
                <button type="button" className="btn ghost" onClick={autoFillResources}>
                    Use suggested totals
                </button>
            </div>
            <p className="text-muted text-small">
                Optional variants: Cats halve HP (9 + CON + (STR ÷ 2)). Psychic babies double MP (33 + INT + (WIS ÷ 2)).
            </p>
            <h4>World skills</h4>
            <p>
                Spend SP now—unused points vanish. TP regens on its own, MP usually requires rest or items.
            </p>
            <div className={`wizard-sp-summary${overSpent ? " warn" : ""}`}>
                <span>SP spent: {spentSP}</span>
                <span>Available: {availableSP}</span>
                <span>Max rank: {maxSkillRank}</span>
            </div>
            {overSpent && (
                <div className="wizard-warning">You have spent more SP than available.</div>
            )}
            {rankIssues.length > 0 && (
                <div className="wizard-warning">
                    Over the rank cap: {rankIssues.join(", ")}
                </div>
            )}
            <div className="sheet-table-wrapper">
                <table className="sheet-table skill-table">
                    <thead>
                        <tr>
                            <th>Skill</th>
                            <th>Ability</th>
                            <th>Ability mod</th>
                            <th>Ranks</th>
                            <th>Misc</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {wizardSkillRows.map((row) => (
                            <tr key={row.key}>
                                <th scope="row">{row.label}</th>
                                <td>{row.ability}</td>
                                <td>
                                    <span className="pill light">{formatModifier(row.abilityMod)}</span>
                                </td>
                                <td>
                                    <input
                                        type="number"
                                        min={0}
                                        max={maxSkillRank}
                                        value={row.ranks}
                                        onChange={(e) => updateSkillField(row.key, "ranks", e.target.value)}
                                    />
                                </td>
                                <td>
                                    <input
                                        type="number"
                                        value={row.misc}
                                        onChange={(e) => updateSkillField(row.key, "misc", e.target.value)}
                                    />
                                </td>
                                <td>
                                    <span className="skill-total">{formatModifier(row.total)}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderReview = () => {
        const summarySkills = wizardSkillRows.filter((row) => row.ranks || row.misc);
        return (
            <div className="wizard-stack">
                <p>
                    One last look before committing. Level-ups require <b>Level × 1,000 EXP</b>. On a level
                    gain: +1 AP, HP +1d4+CON+(STR ÷ 2), MP +1d4+INT+(WIS ÷ 2) or TP +1d4+((DEX+CON) ÷ 2),
                    and SP equal to (INT + CHA) ÷ 2—spend it immediately.
                </p>
                <div className="wizard-summary">
                    <div className="wizard-summary__section">
                        <h4>Profile</h4>
                        <dl>
                            <div>
                                <dt>Name</dt>
                                <dd>{concept.name || "—"}</dd>
                            </div>
                            <div>
                                <dt>Arcana</dt>
                                <dd>{concept.arcana || "—"}</dd>
                            </div>
                            <div>
                                <dt>Alignment</dt>
                                <dd>{concept.alignment || "Neutral"}</dd>
                            </div>
                            <div>
                                <dt>Pronouns</dt>
                                <dd>{concept.pronouns || "—"}</dd>
                            </div>
                            <div>
                                <dt>Origin</dt>
                                <dd>{concept.race || "—"}</dd>
                            </div>
                        </dl>
                    </div>
                    <div className="wizard-summary__section">
                        <h4>Ability scores</h4>
                        <ul>
                            {abilityRows.map((row) => (
                                <li key={row.key}>
                                    {row.key}: {row.score} ({formatModifier(row.modifier)})
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="wizard-summary__section">
                        <h4>Resources</h4>
                        <ul>
                            <li>Level {level} · EXP {resources.exp}</li>
                            <li>HP {resources.hp}/{resources.maxHP}</li>
                            {resources.mode === "TP" ? (
                                <li>TP {resources.tp}</li>
                            ) : (
                                <li>MP {resources.mp}/{resources.maxMP}</li>
                            )}
                            <li>SP {resources.sp}</li>
                        </ul>
                    </div>
                    <div className="wizard-summary__section">
                        <h4>World skills</h4>
                        {summarySkills.length === 0 ? (
                            <p className="text-muted text-small">No ranks allocated yet.</p>
                        ) : (
                            <ul>
                                {summarySkills.map((row) => (
                                    <li key={row.key}>
                                        {row.label}: {row.ranks} ranks ({formatModifier(row.total)})
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
                <div className="wizard-info">
                    <h4>Scaling new high-level characters or demons</h4>
                    <ol>
                        <li>Roll 6 ability scores and apply Arcana adjustments.</li>
                        <li>Set base HP/MP/TP/SP using the level 1 formulas above.</li>
                        <li>Add X AP into stats (3–5 recommended) for each batch of levels.</li>
                        <li>For each batch, add level-up gains: HP (1d4+CON+(STR ÷ 2)) × X, MP (1d4+INT+(WIS ÷ 2)) × X, TP (1d4+((DEX+CON) ÷ 2)) × X, SP ((INT+CHA) ÷ 2) × X.</li>
                        <li>Repeat until you cover every level beyond 1; use smaller X for precise RNG.</li>
                    </ol>
                </div>
            </div>
        );
    };

    if (!open) return null;

    const activeKey = steps[step]?.key;
    let content = null;
    if (activeKey === "concept") content = renderConcept();
    else if (activeKey === "abilities") content = renderAbilities();
    else if (activeKey === "arcana") content = renderArcana();
    else if (activeKey === "resources") content = renderResources();
    else content = renderReview();

    return (
        <div className="wizard-backdrop" role="dialog" aria-modal="true">
            <div className="wizard-panel">
                <header className="wizard-header">
                    <div>
                        <h3>New player setup</h3>
                        <p className="text-muted text-small">{steps[step]?.blurb || ""}</p>
                    </div>
                    <button type="button" className="btn ghost" onClick={onClose}>
                        Close
                    </button>
                </header>
                <div className="wizard-stepper">
                    {steps.map((item, index) => (
                        <button
                            key={item.key}
                            type="button"
                            className={`wizard-step${
                                index === step
                                    ? " is-active"
                                    : index < step
                                    ? " is-complete"
                                    : ""
                            }`}
                            onClick={() => setStep(index)}
                            disabled={index > step}
                        >
                            <span className="wizard-step__label">{item.title}</span>
                        </button>
                    ))}
                </div>
                <div className="wizard-content">{content}</div>
                <footer className="wizard-footer">
                    <button type="button" className="btn ghost" onClick={onClose}>
                        Cancel
                    </button>
                    <div className="wizard-footer__actions">
                        <button type="button" className="btn secondary" onClick={goBack} disabled={step === 0}>
                            Back
                        </button>
                        {step < steps.length - 1 ? (
                            <button type="button" className="btn" onClick={goNext} disabled={!canAdvance}>
                                Next
                            </button>
                        ) : (
                            <button type="button" className="btn" onClick={handleApply} disabled={!canApply}>
                                Apply to sheet
                            </button>
                        )}
                    </div>
                </footer>
            </div>
        </div>
    );
}

function buildInitialWizardState(character, playerName, worldSkills = DEFAULT_WORLD_SKILLS) {
    const normalized = normalizeCharacter(character, worldSkills);
    const abilityDefaults = ABILITY_DEFS.reduce((acc, ability) => {
        const value = clampNonNegative(normalized.stats?.[ability.key]);
        acc[ability.key] = value || 0;
        return acc;
    }, {});
    const resources = {
        level: clampNonNegative(normalized.resources?.level) || 1,
        exp: clampNonNegative(normalized.resources?.exp),
        hp: clampNonNegative(normalized.resources?.hp),
        maxHP: clampNonNegative(normalized.resources?.maxHP),
        mp: clampNonNegative(normalized.resources?.mp),
        maxMP: clampNonNegative(normalized.resources?.maxMP),
        tp: clampNonNegative(normalized.resources?.tp),
        sp: clampNonNegative(normalized.resources?.sp),
        initiative: Number(normalized.resources?.initiative) || 0,
        mode: normalized.resources?.useTP ? "TP" : "MP",
        notes: normalized.resources?.notes || "",
    };
    const concept = {
        name: normalized.name || "",
        player: normalized.profile?.player || playerName || "",
        pronouns: normalized.profile?.pronouns || "",
        class: normalized.profile?.class || "",
        arcana: normalized.profile?.arcana || "",
        alignment: normalized.profile?.alignment || "",
        negotiator: normalized.profile?.negotiator || "",
        race: normalized.profile?.race || "",
        age: normalized.profile?.age || "",
        gender: normalized.profile?.gender || "",
        height: normalized.profile?.height || "",
        weight: normalized.profile?.weight || "",
        eye: normalized.profile?.eye || "",
        hair: normalized.profile?.hair || "",
        background: normalized.profile?.background || "",
        notes: normalized.profile?.notes || "",
    };
    return {
        concept,
        abilities: abilityDefaults,
        resources,
        skills: normalizeSkills(normalized.skills, worldSkills),
        customSkills: normalizeCustomSkills(normalized.customSkills),
    };
}

function buildCharacterFromWizard(state, base, worldSkills = DEFAULT_WORLD_SKILLS) {
    const normalized = normalizeCharacter(base, worldSkills);
    const merged = deepClone(normalized);
    merged.name = state.concept.name?.trim() || "";
    merged.profile = {
        ...normalized.profile,
        player: state.concept.player || normalized.profile?.player || "",
        pronouns: state.concept.pronouns || "",
        class: state.concept.class || "",
        arcana: state.concept.arcana || "",
        alignment: state.concept.alignment || "",
        negotiator: state.concept.negotiator || "",
        race: state.concept.race || "",
        age: state.concept.age || "",
        gender: state.concept.gender || "",
        height: state.concept.height || "",
        weight: state.concept.weight || "",
        eye: state.concept.eye || "",
        hair: state.concept.hair || "",
        background: state.concept.background || "",
        notes: state.concept.notes || "",
    };
    merged.stats = ABILITY_DEFS.reduce((acc, ability) => {
        acc[ability.key] = clampNonNegative(state.abilities?.[ability.key]);
        return acc;
    }, {});
    const useTP = state.resources.mode === "TP";
    merged.resources = {
        ...normalized.resources,
        level: clampNonNegative(state.resources.level) || 1,
        exp: clampNonNegative(state.resources.exp),
        hp: clampNonNegative(state.resources.hp),
        maxHP: clampNonNegative(state.resources.maxHP),
        mp: useTP ? 0 : clampNonNegative(state.resources.mp),
        maxMP: useTP ? 0 : clampNonNegative(state.resources.maxMP),
        tp: useTP ? clampNonNegative(state.resources.tp) : 0,
        sp: clampNonNegative(state.resources.sp),
        initiative: Number(state.resources.initiative) || 0,
        notes: state.resources.notes || normalized.resources?.notes || "",
        useTP,
    };
    merged.skills = normalizeSkills(state.skills, worldSkills);
    merged.customSkills = normalizeCustomSkills(state.customSkills ?? normalized.customSkills);
    return merged;
}

function normalizeCharacter(raw, worldSkills = DEFAULT_WORLD_SKILLS) {
    if (!raw || typeof raw !== 'object') {
        return {
            name: '',
            profile: {},
            stats: {},
            resources: { useTP: false },
            skills: normalizeSkills({}, worldSkills),
            customSkills: [],
        };
    }
    const clone = deepClone(raw);
    clone.name = typeof clone.name === 'string' ? clone.name : '';
    clone.profile = clone.profile && typeof clone.profile === 'object' ? { ...clone.profile } : {};
    clone.stats = clone.stats && typeof clone.stats === 'object' ? { ...clone.stats } : {};
    clone.resources = clone.resources && typeof clone.resources === 'object' ? { ...clone.resources } : {};
    if (clone.resources.useTP === undefined) {
        clone.resources.useTP = !!clone.resources.tp && !clone.resources.mp;
    } else {
        clone.resources.useTP = !!clone.resources.useTP;
    }
    const skillSource =
        clone.skills && typeof clone.skills === 'object' && !Array.isArray(clone.skills)
            ? { ...clone.skills }
            : {};
    const embeddedCustom = [];
    if (Array.isArray(skillSource.customSkills)) embeddedCustom.push(...skillSource.customSkills);
    if (Array.isArray(skillSource._custom)) embeddedCustom.push(...skillSource._custom);
    delete skillSource.customSkills;
    delete skillSource._custom;
    const demoted = [];
    for (const [key, value] of Object.entries(skillSource)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const label = typeof value.label === 'string' ? value.label.trim() : '';
        const abilityRaw = typeof value.ability === 'string' ? value.ability.trim().toUpperCase() : '';
        if (label && ABILITY_KEY_SET.has(abilityRaw)) {
            demoted.push({
                id: key,
                label,
                ability: abilityRaw,
                ranks: value.ranks,
                misc: value.misc,
            });
            delete skillSource[key];
        }
    }
    clone.skills = normalizeSkills(skillSource, worldSkills);
    const rawCustom = clone.customSkills ?? [...embeddedCustom, ...demoted];
    clone.customSkills = normalizeCustomSkills(rawCustom);
    return clone;
}

function normalizeSkills(raw, worldSkills = DEFAULT_WORLD_SKILLS) {
    const out = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const ranks = clampNonNegative(value.ranks);
            const miscRaw = Number(value.misc);
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            out[key] = { ranks, misc };
        }
    }
    for (const skill of worldSkills) {
        if (!out[skill.key]) out[skill.key] = { ranks: 0, misc: 0 };
    }
    return out;
}

// ---------- Party ----------
function Party({ game, selectedPlayerId, onSelectPlayer, mode = "player", currentUserId }) {
    const players = useMemo(
        () =>
            (game.players || []).filter(
                (entry) => (entry?.role || "").toLowerCase() !== "dm"
            ),
        [game.players]
    );

    const canSelect = typeof onSelectPlayer === "function";
    const title = mode === "dm" ? "Party roster" : "Party lineup";
    const subtitle =
        mode === "dm"
            ? "Tap a player to open their character sheet."
            : "Everyone currently adventuring alongside you.";

    return (
        <div className="card">
            <div className="header">
                <div>
                    <h3>{title}</h3>
                    <p className="text-muted text-small">{subtitle}</p>
                </div>
            </div>
            <div className="list party-roster">
                {players.length === 0 ? (
                    <div className="text-muted">No players have joined yet.</div>
                ) : (
                    players.map((p, index) => {
                        const key = p.userId || `player-${index}`;
                        const name =
                            p.character?.name?.trim() ||
                            p.username ||
                            `Player ${index + 1}`;
                        const lvlRaw = Number(p.character?.resources?.level);
                        const level = Number.isFinite(lvlRaw) ? lvlRaw : null;
                        const hpRaw = Number(p.character?.resources?.hp ?? 0);
                        const hp = Number.isFinite(hpRaw) ? hpRaw : 0;
                        const maxRaw = Number(p.character?.resources?.maxHP ?? 0);
                        const maxHP = Number.isFinite(maxRaw) ? maxRaw : 0;
                        const hpLabel = maxHP > 0 ? `${hp}/${maxHP}` : String(hp);
                        const ratio = maxHP > 0 ? hp / maxHP : hp > 0 ? 1 : 0;
                        let tone = "success";
                        if (hp <= 0) tone = "danger";
                        else if (ratio < 0.35) tone = "warn";
                        const isSelected = !!selectedPlayerId && p.userId === selectedPlayerId;
                        const isSelf = currentUserId && p.userId === currentUserId;
                        const roleLabel = (p.role || "").trim();
                        const showRole = roleLabel && roleLabel.toLowerCase() !== "player";

                        const subtitleParts = [];
                        if (p.character?.profile?.class) {
                            subtitleParts.push(p.character.profile.class);
                        }
                        if (level !== null) subtitleParts.push(`LV ${level}`);
                        const subtitleText = subtitleParts.join(" · ");

                        return (
                            <div
                                key={key}
                                className={`party-row${isSelected ? " is-active" : ""}${
                                    canSelect ? " is-clickable" : ""
                                }`}
                                role={canSelect ? "button" : undefined}
                                tabIndex={canSelect ? 0 : undefined}
                                onClick={() => {
                                    if (!canSelect || !p.userId) return;
                                    onSelectPlayer(p);
                                }}
                                onKeyDown={(evt) => {
                                    if (!canSelect) return;
                                    if (evt.key === "Enter" || evt.key === " ") {
                                        evt.preventDefault();
                                        if (p.userId) onSelectPlayer(p);
                                    }
                                }}
                            >
                                <div className="party-row__info">
                                    <span className="party-row__name">{name}</span>
                                    {subtitleText && (
                                        <span className="text-muted text-small">
                                            {subtitleText}
                                        </span>
                                    )}
                                </div>
                                <div className="party-row__metrics">
                                    <span className={`pill ${tone}`}>HP {hpLabel}</span>
                                    {mode !== "dm" && level !== null && (
                                        <span className="pill">LV {level}</span>
                                    )}
                                    {mode === "dm" && showRole && (
                                        <span className="pill">{roleLabel.toUpperCase()}</span>
                                    )}
                                    {isSelf && <span className="pill success">You</span>}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

const DEFAULT_STORY_POLL_MS = 15_000;
const IMAGE_FILE_REGEX = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/**
 * Normalize the story log payload returned by the server into a predictable shape.
 *
 * @param {unknown} source
 * @returns {{
 *   channelId: string,
 *   guildId: string,
 *   allowPlayerPosts: boolean,
 *   scribeIds: string[],
 *   webhookConfigured: boolean,
 *   botTokenConfigured: boolean,
 *   pollIntervalMs: number
 * }}
 */
function normalizeStoryLogConfig(source) {
    if (!source || typeof source !== "object") {
        return {
            channelId: "",
            guildId: "",
            allowPlayerPosts: false,
            scribeIds: [],
            webhookConfigured: false,
            botTokenConfigured: false,
            pollIntervalMs: DEFAULT_STORY_POLL_MS,
        };
    }
    const ids = Array.isArray(source.scribeIds)
        ? source.scribeIds.filter((id) => typeof id === "string")
        : [];
    return {
        channelId: source.channelId || "",
        guildId: source.guildId || "",
        allowPlayerPosts: !!source.allowPlayerPosts,
        scribeIds: ids,
        webhookConfigured: !!(source.webhookConfigured || source.webhookUrl),
        botTokenConfigured: !!source.botTokenConfigured,
        pollIntervalMs: Number(source.pollIntervalMs) || DEFAULT_STORY_POLL_MS,
    };
}

/**
 * Normalize campaign story configuration for the DM-facing settings form.
 *
 * @param {unknown} story
 * @returns {{
 *   channelId: string,
 *   guildId: string,
 *   webhookUrl: string,
 *   botToken: string,
 *   allowPlayerPosts: boolean,
 *   scribeIds: string[]
 * }}
 */
function normalizeStorySettings(story) {
    if (!story || typeof story !== "object") {
        return {
            channelId: "",
            guildId: "",
            webhookUrl: "",
            botToken: "",
            allowPlayerPosts: false,
            scribeIds: [],
        };
    }
    const ids = Array.isArray(story.scribeIds)
        ? story.scribeIds.filter((id) => typeof id === "string").sort()
        : [];
    return {
        channelId: story.channelId || "",
        guildId: story.guildId || "",
        webhookUrl: story.webhookUrl || "",
        botToken: typeof story.botToken === "string" ? story.botToken : "",
        allowPlayerPosts: !!story.allowPlayerPosts,
        scribeIds: ids,
    };
}

// ---------- Story Logs ----------
function StoryLogsTab({ game, me }) {
    const gameId = game?.id || null;
    const isDM = game.dmId === me.id;
    const realtime = useContext(RealtimeContext);
    const storyConfigFromGame = useMemo(
        () => normalizeStoryLogConfig(game?.story),
        [game?.story]
    );
    const [data, setData] = useState(() => ({
        enabled: false,
        status: null,
        channel: null,
        messages: [],
        pollIntervalMs: null,
        fetchedAt: null,
        config: storyConfigFromGame,
    }));
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [sending, setSending] = useState(false);
    const [message, setMessage] = useState('');
    const [selectedPersona, setSelectedPersona] = useState('');
    const [deletingId, setDeletingId] = useState(null);
    const fetchRef = useRef(false);
    const firstLoadRef = useRef(true);
    const pollMsRef = useRef(DEFAULT_STORY_POLL_MS);
    const previousGameIdRef = useRef(gameId);
    const messagesRef = useRef(null);

    useEffect(() => {
        setData((prev) => ({
            ...prev,
            config: storyConfigFromGame,
        }));
    }, [storyConfigFromGame]);

    useEffect(() => {
        if (previousGameIdRef.current === gameId) {
            return;
        }
        previousGameIdRef.current = gameId;
        firstLoadRef.current = true;
        pollMsRef.current = DEFAULT_STORY_POLL_MS;
        setData({
            enabled: false,
            status: null,
            channel: null,
            messages: [],
            pollIntervalMs: null,
            fetchedAt: null,
            config: storyConfigFromGame,
        });
        setLoading(true);
        setRefreshing(false);
        setError(null);
        setMessage('');
        setSelectedPersona('');
    }, [gameId, storyConfigFromGame]);

    useEffect(() => {
        if (!realtime) return undefined;
        const unsubscribe = realtime.subscribeStory((snapshot) => {
            if (!snapshot) return;
            pollMsRef.current = snapshot.config?.pollIntervalMs || pollMsRef.current;
            setData({
                enabled: !!(snapshot?.enabled ?? snapshot?.status?.enabled),
                status: snapshot?.status ?? null,
                channel: snapshot?.channel ?? snapshot?.status?.channel ?? null,
                messages: Array.isArray(snapshot?.messages) ? snapshot.messages : [],
                pollIntervalMs: Number(snapshot?.pollIntervalMs ?? snapshot?.status?.pollIntervalMs) || null,
                fetchedAt: snapshot?.fetchedAt || new Date().toISOString(),
                config: normalizeStoryLogConfig(snapshot?.config ?? storyConfigFromGame),
            });
            const statusError = snapshot?.status?.error;
            setError(statusError || null);
            setLoading(false);
            setRefreshing(false);
            firstLoadRef.current = false;
        });
        return unsubscribe;
    }, [realtime, storyConfigFromGame]);

    const dateFormatter = useMemo(
        () => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        []
    );
    const relativeFormatter = useMemo(
        () => new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }),
        []
    );

    const formatTimestamp = useCallback(
        (iso) => {
            if (!iso) return '';
            const dt = new Date(iso);
            if (Number.isNaN(dt.getTime())) return '';
            return dateFormatter.format(dt);
        },
        [dateFormatter]
    );

    const formatRelative = useCallback(
        (iso) => {
            if (!iso) return '';
            const value = Date.parse(iso);
            if (!Number.isFinite(value)) return '';
            const diff = value - Date.now();
            const abs = Math.abs(diff);
            const units = [
                ['day', 86_400_000],
                ['hour', 3_600_000],
                ['minute', 60_000],
                ['second', 1000],
            ];
            for (const [unit, ms] of units) {
                if (abs >= ms || unit === 'second') {
                    const amount = Math.round(diff / ms);
                    return relativeFormatter.format(amount, unit);
                }
            }
            return '';
        },
        [relativeFormatter]
    );

    const mergeData = useCallback((result) => {
        const config = normalizeStoryLogConfig(result?.config);
        pollMsRef.current = config.pollIntervalMs || pollMsRef.current;
        setData({
            enabled: !!(result?.enabled ?? result?.status?.enabled),
            status: result?.status ?? null,
            channel: result?.channel ?? result?.status?.channel ?? null,
            messages: Array.isArray(result?.messages) ? result.messages : [],
            pollIntervalMs: Number(result?.pollIntervalMs ?? result?.status?.pollIntervalMs) || null,
            fetchedAt: result?.fetchedAt || new Date().toISOString(),
            config,
        });
    }, []);

    const fetchLogs = useCallback(async () => {
        if (!gameId) {
            setLoading(false);
            setRefreshing(false);
            return;
        }
        if (fetchRef.current) return;
        fetchRef.current = true;
        const isInitial = firstLoadRef.current;
        if (isInitial) {
            setLoading(true);
        } else {
            setRefreshing(true);
        }
        try {
            const result = await StoryLogs.fetch(gameId);
            mergeData(result);
            const statusError = result?.status?.error;
            setError(statusError || null);
        } catch (err) {
            setError(err?.message || 'Failed to load story logs.');
        } finally {
            if (isInitial) {
                firstLoadRef.current = false;
                setLoading(false);
            }
            setRefreshing(false);
            fetchRef.current = false;
        }
    }, [gameId, mergeData]);

    useEffect(() => {
        if (!gameId) {
            setLoading(false);
            return undefined;
        }
        let cancelled = false;
        let timer = null;

        const tick = async () => {
            if (cancelled) return;
            await fetchLogs();
            if (cancelled) return;
            if (realtime?.connected) {
                return;
            }
            const delay = Math.max(5_000, pollMsRef.current || DEFAULT_STORY_POLL_MS);
            timer = setTimeout(tick, delay);
        };

        tick();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [fetchLogs, gameId, realtime?.connected]);

    const handleRefresh = useCallback(() => {
        fetchLogs();
    }, [fetchLogs]);

    useEffect(() => {
        if (!messagesRef.current) return;
        messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }, [data.messages]);

    const config = data.config;
    const players = useMemo(
        () => (Array.isArray(game.players) ? game.players.filter((p) => p && p.userId) : []),
        [game.players]
    );
    const playerLabels = useMemo(
        () =>
            players.map((player, index) => {
                const charName = player?.character?.name;
                if (typeof charName === 'string' && charName.trim()) {
                    return { player, label: charName.trim() };
                }
                if (player?.username) {
                    return { player, label: player.username };
                }
                if (player?.userId) {
                    return { player, label: `Player ${player.userId.slice(0, 6)}` };
                }
                return { player, label: `Player ${index + 1}` };
            }),
        [players]
    );
    const labelMap = useMemo(() => {
        const map = new Map();
        for (const entry of playerLabels) {
            if (entry.player?.userId) {
                map.set(entry.player.userId, entry.label);
            }
        }
        return map;
    }, [playerLabels]);
    const selfLabel = useMemo(() => {
        if (labelMap.has(me.id)) return labelMap.get(me.id);
        return me.username;
    }, [labelMap, me.id, me.username]);

    const scribeIds = config.scribeIds || [];
    const isScribe = scribeIds.includes(me.id);
    const personaStatusList = useMemo(() => {
        if (!realtime?.personaStatuses) return [];
        const entries = Object.values(realtime.personaStatuses).filter((entry) => entry?.gameId === gameId);
        entries.sort((a, b) => {
            const aTime = Date.parse(a?.createdAt || a?.fetchedAt || '');
            const bTime = Date.parse(b?.createdAt || b?.fetchedAt || '');
            return aTime - bTime;
        });
        return entries;
    }, [realtime?.personaStatuses, gameId]);
    const describePersonaStatus = useCallback((status) => {
        const target = status?.targetName || 'the player';
        switch (status?.status) {
            case 'pending':
                return `Awaiting approval from ${target}.`;
            case 'approved':
                return `Approved by ${target}.`;
            case 'denied':
                return `Denied by ${target}.`;
            case 'expired':
                return 'Request expired without a response.';
            default:
                return status?.reason || status?.status || '';
        }
    }, []);

    const personaOptions = useMemo(() => {
        if (isDM) {
            const base = [
                { value: 'bot', label: 'BOT', payload: { persona: 'bot' } },
                { value: 'dm', label: 'Dungeon Master', payload: { persona: 'dm' } },
                { value: 'scribe', label: 'Scribe', payload: { persona: 'scribe' } },
                { value: 'player', label: 'Player', payload: { persona: 'player' } },
            ];
            const impersonation = playerLabels
                .filter(
                    ({ player }) =>
                        player?.userId && (player.role || '').toLowerCase() !== 'dm'
                )
                .map(({ player, label }) => ({
                    value: `player:${player.userId}`,
                    label,
                    payload: { persona: 'player', targetUserId: player.userId },
                }));
            return [...base, ...impersonation];
        }
        const opts = [];
        if (selfLabel) {
            opts.push({ value: 'self', label: selfLabel, payload: { persona: 'self' } });
        }
        if (isScribe) {
            opts.push({ value: 'scribe', label: 'Scribe', payload: { persona: 'scribe' } });
        }
        return opts;
    }, [isDM, isScribe, playerLabels, selfLabel]);

    useEffect(() => {
        if (personaOptions.length === 0) {
            setSelectedPersona('');
            return;
        }
        setSelectedPersona((prev) => {
            if (prev && personaOptions.some((opt) => opt.value === prev)) {
                return prev;
            }
            return personaOptions[0]?.value || '';
        });
    }, [personaOptions]);

    const trimmedMessage = message.trim();
    const canPost = isDM || (!!config.allowPlayerPosts && personaOptions.length > 0);
    const composerHint = useMemo(() => {
        if (!config.webhookConfigured) {
            return 'Connect a Discord webhook in Campaign Settings to enable posting.';
        }
        if (!selectedPersona) {
            return 'Choose who you want to speak as.';
        }
        if (!trimmedMessage) {
            return 'Type your story update above.';
        }
        return 'Messages are delivered straight to the linked Discord channel.';
    }, [config.webhookConfigured, selectedPersona, trimmedMessage]);
    const readyToSend = Boolean(config.webhookConfigured && selectedPersona && trimmedMessage);
    const composerDisabled = sending || !readyToSend;

    const handleSend = useCallback(
        async (evt) => {
            evt.preventDefault();
            if (!gameId) return;
            const trimmed = message.trim();
            if (!trimmed) return;
            const option = personaOptions.find((opt) => opt.value === selectedPersona);
            if (!option) return;
            try {
                setSending(true);
                if (
                    !isDM &&
                    option.payload?.persona === 'player' &&
                    option.payload?.targetUserId &&
                    option.payload.targetUserId !== me.id
                ) {
                    if (!realtime) {
                        throw new Error('Real-time connection unavailable.');
                    }
                    await realtime.requestPersona(option.payload.targetUserId, trimmed);
                    setMessage('');
                    setError(null);
                    return;
                }
                await StoryLogs.post(gameId, { ...option.payload, content: trimmed });
                setMessage('');
                setError(null);
                await fetchLogs();
            } catch (err) {
                setError(err?.message || 'Failed to post to Discord.');
            } finally {
                setSending(false);
            }
        },
        [fetchLogs, gameId, isDM, me.id, message, personaOptions, realtime, selectedPersona]
    );

    const handleDeleteMessage = useCallback(
        async (messageId) => {
            if (!isDM || !gameId || !messageId) return;
            if (typeof window !== 'undefined') {
                const confirmed = window.confirm('Delete this Discord message? This cannot be undone.');
                if (!confirmed) return;
            }
            try {
                setDeletingId(messageId);
                await StoryLogs.delete(gameId, messageId);
                setData((prev) => ({
                    ...prev,
                    messages: prev.messages.filter((entry) => entry.id !== messageId),
                }));
                setError(null);
                if (!realtime?.connected) {
                    await fetchLogs();
                }
            } catch (err) {
                const message = err?.message || 'Failed to delete message.';
                setError(message);
                if (typeof window !== 'undefined') {
                    alert(message);
                }
            } finally {
                setDeletingId(null);
            }
        },
        [fetchLogs, gameId, isDM, realtime?.connected]
    );

    const isImageAttachment = useCallback((att) => {
        if (!att) return false;
        if (typeof att.contentType === 'string' && att.contentType.startsWith('image/')) {
            return true;
        }
        if (typeof att.name === 'string' && IMAGE_FILE_REGEX.test(att.name)) {
            return true;
        }
        if (typeof att.url === 'string') {
            try {
                const url = new URL(att.url);
                return IMAGE_FILE_REGEX.test(url.pathname);
            } catch {
                return IMAGE_FILE_REGEX.test(att.url);
            }
        }
        return false;
    }, []);

    const status = data.status || {};
    const phase = status.phase || (data.enabled ? 'idle' : 'disabled');
    const phaseLabelMap = {
        disabled: 'Disabled',
        idle: 'Idle',
        connecting: 'Connecting',
        ready: 'Connected',
        error: 'Error',
        missing_token: 'Server setup required',
        unconfigured: 'Not linked',
        configuring: 'Connecting',
    };
    const phaseToneMap = {
        disabled: 'warn',
        idle: 'light',
        connecting: 'warn',
        ready: 'success',
        error: 'danger',
        missing_token: 'danger',
        unconfigured: 'warn',
        configuring: 'warn',
    };
    const phaseLabel = phaseLabelMap[phase] || 'Unknown';
    const phaseTone = phaseToneMap[phase] || 'light';
    const channelName = data.channel?.name ? `#${data.channel.name}` : null;
    const channelUrl = data.channel?.url || null;
    const channelTopic = data.channel?.topic || '';
    const lastSynced = status.lastSyncAt || data.fetchedAt;
    const lastSyncedRelative = formatRelative(lastSynced);
    const lastSyncedAbsolute = formatTimestamp(lastSynced);
    const showErrorBanner = Boolean(
        error && (phase === 'error' || phase === 'missing_token')
    );
    const hasMessages = data.messages.length > 0;
    const composerVisible = canPost && personaOptions.length > 0;
    const playerPostingDisabled = !isDM && !config.allowPlayerPosts;
    const webhookMissing = isDM && !config.webhookConfigured;

    return (
        <section className="card story-logs-card">
            <div className="header">
                <div>
                    <h3>Story logs</h3>
                    <p className="text-muted text-small">
                        Keep up with the Discord story log channel without leaving the command center.
                    </p>
                </div>
                <div className="story-logs__actions">
                    <button
                        className="btn ghost btn-small"
                        type="button"
                        onClick={handleRefresh}
                        disabled={loading || refreshing || !gameId}
                    >
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                    </button>
                    {channelUrl && (
                        <a
                            className="btn ghost btn-small"
                            href={channelUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            Open in Discord
                        </a>
                    )}
                </div>
            </div>
            <div className="story-logs__status">
                <span className={`pill ${phaseTone}`}>{phaseLabel}</span>
                {channelName && <span className="story-logs__status-name">{channelName}</span>}
                {lastSyncedAbsolute && (
                    <span className="text-muted text-small">
                        Last synced {lastSyncedRelative ? `${lastSyncedRelative} (${lastSyncedAbsolute})` : lastSyncedAbsolute}
                    </span>
                )}
            </div>
            {showErrorBanner && (
                <div className="story-logs__alert">
                    <p>{error}</p>
                </div>
            )}
            {loading ? (
                <div className="story-logs__empty">
                    <p className="text-muted">Loading story logs…</p>
                </div>
            ) : (
                <>
                    {playerPostingDisabled && (
                        <p className="text-muted text-small" style={{ marginTop: -4 }}>
                            The DM has disabled player posting for this campaign.
                        </p>
                    )}
                    {webhookMissing && (
                        <p className="text-muted text-small" style={{ marginTop: -4 }}>
                            Add a Discord webhook URL in Campaign Settings to enable posting as the bot, DM, or scribe.
                        </p>
                    )}
                    {composerVisible && (
                        <form className="story-logs__composer" onSubmit={handleSend}>
                            <div className="story-logs__composer-row">
                                <label className="text-small" style={{ display: 'grid', gap: 4 }}>
                                    Post as
                                    <select
                                        value={selectedPersona}
                                        onChange={(e) => setSelectedPersona(e.target.value)}
                                        disabled={sending}
                                    >
                                        {personaOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder={
                                    isDM
                                        ? 'Narrate the next beat or speak for an adventurer…'
                                        : 'Share your part of the story…'
                                }
                                disabled={sending}
                            />
                            <div className="story-logs__composer-footer">
                                <span className="text-muted text-small">{composerHint}</span>
                                <button type="submit" className="btn btn-small" disabled={composerDisabled}>
                                    {sending ? 'Sending…' : 'Send to Discord'}
                                </button>
                            </div>
                        </form>
                    )}
                    {isScribe && personaStatusList.length > 0 && (
                        <div className="story-logs__persona-statuses">
                            {personaStatusList.map((status) => (
                                <div
                                    key={status.requestId}
                                    className={`story-logs__persona-status story-logs__persona-status--${status.status}`}
                                >
                                    <span className="story-logs__persona-status-text">
                                        {describePersonaStatus(status)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    {!data.enabled ? (
                        <div className="story-logs__empty">
                            {phase === 'missing_token' ? (
                                <p className="text-muted">
                                    The server administrator must supply a Discord bot token before story syncing can run.
                                </p>
                            ) : phase === 'unconfigured' ? (
                                <p className="text-muted">
                                    Link this campaign to a Discord channel from Campaign Settings to start syncing the story log.
                                </p>
                            ) : (
                                <p className="text-muted">{error || 'Discord sync is inactive for this campaign.'}</p>
                            )}
                        </div>
                    ) : hasMessages ? (
                        <div className="story-logs__body">
                            {channelTopic && <p className="text-muted story-logs__topic">{channelTopic}</p>}
                            <div className="story-logs__messages" ref={messagesRef}>
                                {data.messages.map((msg) => {
                                    const msgRelative = formatRelative(msg.createdAt);
                                    const msgAbsolute = formatTimestamp(msg.createdAt);
                                    return (
                                        <article key={msg.id} className="story-logs__message">
                                            <div className="story-logs__avatar">
                                                {msg.author?.avatarUrl ? (
                                                    <img
                                                        src={msg.author.avatarUrl}
                                                        alt={msg.author?.displayName || 'Avatar'}
                                                    />
                                                ) : (
                                                    <span>{(msg.author?.displayName || '?').slice(0, 1)}</span>
                                                )}
                                            </div>
                                            <div className="story-logs__message-body">
                                                <header className="story-logs__message-header">
                                                    <div className="story-logs__message-meta">
                                                        <span className="story-logs__author">{msg.author?.displayName || 'Unknown'}</span>
                                                        {msg.author?.bot && <span className="pill warn">BOT</span>}
                                                        {msgAbsolute && (
                                                            <time
                                                                className="story-logs__timestamp"
                                                                dateTime={msg.createdAt || undefined}
                                                                title={msgAbsolute}
                                                            >
                                                                {msgRelative || msgAbsolute}
                                                            </time>
                                                        )}
                                                    </div>
                                                    {isDM && msg.id && (
                                                        <button
                                                            type="button"
                                                            className="story-logs__delete"
                                                            onClick={() => handleDeleteMessage(msg.id)}
                                                            disabled={deletingId === msg.id}
                                                        >
                                                            {deletingId === msg.id ? 'Deleting…' : 'Delete'}
                                                        </button>
                                                    )}
                                                </header>
                                                {msg.content && <MessageMarkdown content={msg.content} />}
                                                {msg.attachments?.length > 0 && (
                                                    <ul className="story-logs__attachments">
                                                        {msg.attachments.map((att) => (
                                                            <li key={att.id}>
                                                                {isImageAttachment(att) ? (
                                                                    <a
                                                                        className="story-logs__image-link"
                                                                        href={att.url}
                                                                        target="_blank"
                                                                        rel="noreferrer noopener"
                                                                    >
                                                                        <img
                                                                            className="story-logs__image"
                                                                            src={att.proxyUrl || att.url}
                                                                            alt={att.name || 'Attachment'}
                                                                        />
                                                                    </a>
                                                                ) : (
                                                                    <a href={att.url} target="_blank" rel="noreferrer noopener">
                                                                        {att.name || 'Attachment'}
                                                                    </a>
                                                                )}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                                {msg.jumpLink && (
                                                    <div className="story-logs__message-footer">
                                                        <a href={msg.jumpLink} target="_blank" rel="noreferrer noopener">
                                                            View in Discord
                                                        </a>
                                                    </div>
                                                )}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="story-logs__empty">
                            <p className="text-muted">
                                No messages synced yet. When players post in the configured Discord channel they will appear here.
                            </p>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

const INLINE_PATTERN =
    /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\*(?!\s)([^*]+?)\*(?!\s)|_(?!\s)([^_]+?)_(?!\s))/g;

function sanitizeLinkHref(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^mailto:/i.test(trimmed)) return trimmed;
    if (/^discord:/i.test(trimmed)) return trimmed;
    return null;
}

function renderInlineSegments(text, keyPrefix) {
    if (!text) return [];
    const nodes = [];
    let remaining = text;
    let index = 0;

    while (remaining.length > 0) {
        INLINE_PATTERN.lastIndex = 0;
        const match = INLINE_PATTERN.exec(remaining);
        if (!match || match.index === undefined) {
            if (remaining) nodes.push(remaining);
            break;
        }
        if (match.index > 0) {
            nodes.push(remaining.slice(0, match.index));
        }
        const full = match[0];
        if (match[2] !== undefined) {
            const href = sanitizeLinkHref(match[3]);
            if (href) {
                nodes.push(
                    <a
                        key={`${keyPrefix}-link-${index}`}
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        {renderInlineSegments(match[2], `${keyPrefix}-link-${index}`)}
                    </a>
                );
            } else {
                nodes.push(match[2]);
            }
        } else if (match[4] !== undefined) {
            nodes.push(
                <strong key={`${keyPrefix}-strong-${index}`}>
                    {renderInlineSegments(match[4], `${keyPrefix}-strong-${index}`)}
                </strong>
            );
        } else if (match[5] !== undefined) {
            nodes.push(
                <strong key={`${keyPrefix}-strongu-${index}`}>
                    {renderInlineSegments(match[5], `${keyPrefix}-strongu-${index}`)}
                </strong>
            );
        } else if (match[6] !== undefined) {
            nodes.push(
                <del key={`${keyPrefix}-del-${index}`}>
                    {renderInlineSegments(match[6], `${keyPrefix}-del-${index}`)}
                </del>
            );
        } else if (match[7] !== undefined) {
            nodes.push(
                <code key={`${keyPrefix}-code-${index}`}>{match[7]}</code>
            );
        } else if (match[8] !== undefined) {
            nodes.push(
                <em key={`${keyPrefix}-em-${index}`}>
                    {renderInlineSegments(match[8], `${keyPrefix}-em-${index}`)}
                </em>
            );
        } else if (match[9] !== undefined) {
            nodes.push(
                <em key={`${keyPrefix}-emu-${index}`}>
                    {renderInlineSegments(match[9], `${keyPrefix}-emu-${index}`)}
                </em>
            );
        } else {
            nodes.push(full);
        }
        remaining = remaining.slice(match.index + full.length);
        index += 1;
    }

    return nodes;
}

function renderInlineWithBreaks(text, keyPrefix) {
    const lines = text.split('\n');
    return lines.flatMap((line, idx) => {
        const parts = renderInlineSegments(line, `${keyPrefix}-${idx}`);
        if (idx === lines.length - 1) {
            return parts;
        }
        return [
            <React.Fragment key={`${keyPrefix}-frag-${idx}`}>{parts}</React.Fragment>,
            <br key={`${keyPrefix}-br-${idx}`} />,
        ];
    });
}

function parseMarkdownBlocks(raw) {
    if (!raw) return [];
    const source = String(raw).replace(/\r\n?/g, '\n');
    const lines = source.split('\n');
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        if (line.startsWith('```')) {
            const language = line.slice(3).trim();
            index += 1;
            const codeLines = [];
            while (index < lines.length && !lines[index].startsWith('```')) {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length && lines[index].startsWith('```')) {
                index += 1;
            }
            blocks.push({ type: 'code', language, content: codeLines.join('\n') });
            continue;
        }

        const chunkLines = [];
        while (index < lines.length && !lines[index].startsWith('```')) {
            chunkLines.push(lines[index]);
            index += 1;
        }
        const chunk = chunkLines.join('\n');
        const segments = chunk.split(/\n{2,}/);
        for (const segment of segments) {
            const trimmed = segment.trim();
            if (!trimmed) continue;
            const segLines = trimmed.split('\n');
            const allTrimmed = segLines.map((ln) => ln.trim());
            const isQuote = allTrimmed.every((ln) => ln === '' || ln.startsWith('>'));
            if (isQuote) {
                const cleaned = segLines
                    .map((ln) => ln.replace(/^>\s?/, '').trim())
                    .join('\n')
                    .split(/\n{2,}/)
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                if (cleaned.length > 0) {
                    blocks.push({ type: 'quote', lines: cleaned });
                }
                continue;
            }
            const isBullet = allTrimmed.every((ln) => ln === '' || /^[-*]\s+/.test(ln));
            if (isBullet) {
                const items = segLines
                    .map((ln) => ln.replace(/^[-*]\s+/, '').trim())
                    .filter(Boolean);
                if (items.length > 0) {
                    blocks.push({ type: 'list', ordered: false, items });
                }
                continue;
            }
            const isOrdered = allTrimmed.every((ln) => ln === '' || /^\d+\.\s+/.test(ln));
            if (isOrdered) {
                const items = segLines
                    .map((ln) => ln.replace(/^\d+\.\s+/, '').trim())
                    .filter(Boolean);
                if (items.length > 0) {
                    blocks.push({ type: 'list', ordered: true, items });
                }
                continue;
            }
            blocks.push({ type: 'paragraph', content: trimmed });
        }
    }

    return blocks;
}

function MessageMarkdown({ content }) {
    const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
    if (blocks.length === 0) return null;

    return (
        <div className="story-logs__markdown">
            {blocks.map((block, index) => {
                const key = `md-block-${index}`;
                if (block.type === 'code') {
                    return (
                        <pre key={key} data-language={block.language || undefined}>
                            <code>{block.content}</code>
                        </pre>
                    );
                }
                if (block.type === 'quote') {
                    return (
                        <blockquote key={key}>
                            {block.lines.map((line, idx) => (
                                <p key={`${key}-line-${idx}`}>{renderInlineWithBreaks(line, `${key}-line-${idx}`)}</p>
                            ))}
                        </blockquote>
                    );
                }
                if (block.type === 'list') {
                    const Tag = block.ordered ? 'ol' : 'ul';
                    return (
                        <Tag key={key}>
                            {block.items.map((item, itemIndex) => (
                                <li key={`${key}-item-${itemIndex}`}>
                                    {renderInlineWithBreaks(item, `${key}-item-${itemIndex}`)}
                                </li>
                            ))}
                        </Tag>
                    );
                }
                return (
                    <p key={key}>{renderInlineWithBreaks(block.content, `${key}-paragraph`)}</p>
                );
            })}
        </div>
    );
}

function PersonaPromptCenter({ realtime }) {
    const prompts = Array.isArray(realtime?.personaPrompts)
        ? realtime.personaPrompts
        : EMPTY_ARRAY;
    const respondPersona = realtime?.respondPersona;
    const sorted = useMemo(() => {
        const list = prompts.slice();
        list.sort((a, b) => {
            const aTime = Date.parse(a?.request?.createdAt || '');
            const bTime = Date.parse(b?.request?.createdAt || '');
            return aTime - bTime;
        });
        return list;
    }, [prompts]);
    const active = sorted[0]?.request || null;
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    const [busy, setBusy] = useState(null);
    useEffect(() => {
        setBusy(null);
    }, [active?.id]);

    if (!active) return null;

    const expiresAt = active.expiresAt ? Date.parse(active.expiresAt) : null;
    const remaining = expiresAt ? expiresAt - now : null;
    const remainingLabel = remaining !== null ? formatDuration(remaining) : null;
    const actionDisabled = !respondPersona || busy !== null;

    const handleRespond = (approve) => {
        if (!respondPersona || !active.id) return;
        setBusy(approve ? 'approve' : 'deny');
        try {
            respondPersona(active.id, approve);
        } catch (err) {
            console.error('Failed to respond to persona prompt', err);
            setBusy(null);
        }
    };

    return (
        <div className="persona-overlay" role="presentation">
            <div className="persona-modal" role="dialog" aria-modal="true" aria-labelledby="persona-modal-title">
                <header className="persona-modal__header">
                    <div>
                        <h3 id="persona-modal-title">
                            {active.scribeName || 'A scribe'} wants to speak as you
                        </h3>
                        {active.gameName && (
                            <p className="text-muted text-small">Campaign: {active.gameName}</p>
                        )}
                    </div>
                    {remainingLabel && (
                        <span className="persona-modal__timer">Time left: {remainingLabel}</span>
                    )}
                </header>
                <div className="persona-modal__body">
                    <p className="text-small">
                        Approve to let {active.scribeName || 'the scribe'} send this update as {active.targetName || 'you'}.
                    </p>
                    <MessageMarkdown content={active.content || ''} />
                </div>
                <div className="persona-modal__actions">
                    <button
                        type="button"
                        className="btn ghost"
                        onClick={() => handleRespond(false)}
                        disabled={actionDisabled}
                    >
                        Deny
                    </button>
                    <button
                        type="button"
                        className="btn"
                        onClick={() => handleRespond(true)}
                        disabled={actionDisabled}
                    >
                        Approve
                    </button>
                </div>
            </div>
        </div>
    );
}

const TRADE_REASON_LABELS = {
    timeout: 'Trade timed out.',
    declined: 'The trade was declined.',
    cancelled: 'The trade was cancelled.',
    game_missing: 'Trade cancelled because the campaign data was unavailable.',
    player_missing: 'Trade cancelled because a participant could not be found.',
};

const MAX_TRADE_ITEMS = 20;

function TradeOverlay({ game, me, realtime }) {
    const trades = Array.isArray(realtime?.tradeSessions)
        ? realtime.tradeSessions
        : EMPTY_ARRAY;
    const actions = realtime?.tradeActions || {};
    const relevant = useMemo(() => {
        const list = trades.filter((trade) => trade?.participants?.[me.id]);
        list.sort((a, b) => {
            const aTime = Date.parse(a?.createdAt || '');
            const bTime = Date.parse(b?.createdAt || '');
            return aTime - bTime;
        });
        return list;
    }, [me.id, trades]);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    if (relevant.length === 0) return null;

    return (
        <div className="trade-overlay" role="presentation">
            {relevant.map((trade) => (
                <TradeWindow key={trade.id} trade={trade} me={me} game={game} actions={actions} now={now} />
            ))}
        </div>
    );
}

function TradeWindow({ trade, me, game, actions, now }) {
    const myId = me.id;
    const partnerId = trade.initiatorId === myId ? trade.partnerId : trade.initiatorId;
    const partnerParticipant = trade.participants?.[partnerId];
    const partnerName = partnerParticipant?.name || 'Partner';
    const status = trade.status || 'active';
    const myOffer = useMemo(
        () => (Array.isArray(trade.offers?.[myId]) ? trade.offers[myId] : []),
        [myId, trade.offers]
    );
    const partnerOffer = useMemo(
        () => (Array.isArray(trade.offers?.[partnerId]) ? trade.offers[partnerId] : []),
        [partnerId, trade.offers]
    );
    const myOfferMap = useMemo(() => {
        const map = new Map();
        for (const entry of myOffer) {
            if (entry?.itemId) map.set(entry.itemId, entry);
        }
        return map;
    }, [myOffer]);

    const myPlayer = useMemo(
        () => (Array.isArray(game.players) ? game.players.find((p) => p?.userId === myId) || null : null),
        [game.players, myId]
    );
    const myInventory = useMemo(
        () => (Array.isArray(myPlayer?.inventory) ? myPlayer.inventory : []),
        [myPlayer?.inventory]
    );
    const inventoryMap = useMemo(() => {
        const map = new Map();
        for (const item of myInventory) {
            if (item?.id) map.set(item.id, item);
        }
        return map;
    }, [myInventory]);

    const [draft, setDraft] = useState(() =>
        myOffer.map((entry) => ({
            itemId: entry.itemId,
            quantity: clampQuantity(entry.quantity),
        }))
    );
    const [dirty, setDirty] = useState(false);
    const [picker, setPicker] = useState('');

    useEffect(() => {
        setDraft(
            myOffer.map((entry) => ({
                itemId: entry.itemId,
                quantity: clampQuantity(entry.quantity),
            }))
        );
        setDirty(false);
        setPicker('');
    }, [trade.id, myOffer]);

    useEffect(() => {
        if (dirty) return;
        const remote = myOffer.map((entry) => ({
            itemId: entry.itemId,
            quantity: clampQuantity(entry.quantity),
        }));
        setDraft((prev) => (offersEqual(prev, remote) ? prev : remote));
    }, [dirty, myOffer]);

    useEffect(() => {
        if (!dirty) return;
        const remote = myOffer.map((entry) => ({
            itemId: entry.itemId,
            quantity: clampQuantity(entry.quantity),
        }));
        if (offersEqual(draft, remote)) {
            setDirty(false);
        }
    }, [dirty, draft, myOffer]);

    const expiresAt = trade.expiresAt ? Date.parse(trade.expiresAt) : null;
    const timeLeft = expiresAt ? formatDuration(expiresAt - now) : null;
    const myConfirmed = !!trade.confirmations?.[myId];
    const partnerConfirmed = !!trade.confirmations?.[partnerId];
    const tradeNote = typeof trade.note === 'string' ? trade.note.trim() : '';

    const availableOptions = useMemo(() => {
        return myInventory.filter((item) => {
            if (!item?.id) return false;
            const max = getItemMaxQuantity(inventoryMap, item.id);
            if (max <= 0) return false;
            const offered = draft.find((entry) => entry.itemId === item.id)?.quantity || 0;
            return offered < max;
        });
    }, [draft, inventoryMap, myInventory]);

    const handleAddItem = useCallback(
        (itemId) => {
            if (!itemId) return;
            setDraft((prev) => {
                if (prev.length >= MAX_TRADE_ITEMS) return prev;
                const max = getItemMaxQuantity(inventoryMap, itemId);
                if (max <= 0) return prev;
                const index = prev.findIndex((entry) => entry.itemId === itemId);
                if (index >= 0) {
                    const existing = prev[index];
                    const nextQty = Math.min(max, clampQuantity((existing.quantity || 0) + 1, max));
                    if (nextQty === existing.quantity) return prev;
                    const copy = [...prev];
                    copy[index] = { ...existing, quantity: nextQty };
                    return copy;
                }
                return [...prev, { itemId, quantity: 1 }];
            });
            setDirty(true);
        },
        [inventoryMap]
    );

    const handleQuantityChange = useCallback(
        (itemId, value) => {
            setDraft((prev) => {
                const index = prev.findIndex((entry) => entry.itemId === itemId);
                if (index < 0) return prev;
                const max = getItemMaxQuantity(inventoryMap, itemId) || 9999;
                const nextQty = clampQuantity(value, max || 9999);
                if (nextQty === prev[index].quantity) return prev;
                const copy = [...prev];
                copy[index] = { ...prev[index], quantity: nextQty };
                return copy;
            });
            setDirty(true);
        },
        [inventoryMap]
    );

    const handleRemove = useCallback((itemId) => {
        setDraft((prev) => prev.filter((entry) => entry.itemId !== itemId));
        setDirty(true);
    }, []);

    const handleApply = useCallback(() => {
        if (!actions.updateOffer) return;
        const payload = draft
            .map((entry) => {
                const max = getItemMaxQuantity(inventoryMap, entry.itemId) || entry.quantity;
                return {
                    itemId: entry.itemId,
                    quantity: clampQuantity(entry.quantity, max || 9999),
                };
            })
            .filter((entry) => entry.itemId);
        actions.updateOffer(trade.id, payload);
        setDirty(false);
    }, [actions, draft, inventoryMap, trade.id]);

    const handleConfirm = useCallback(() => {
        actions.confirm?.(trade.id);
    }, [actions, trade.id]);

    const handleUnconfirm = useCallback(() => {
        actions.unconfirm?.(trade.id);
    }, [actions, trade.id]);

    const handleCancel = useCallback(() => {
        actions.cancel?.(trade.id);
    }, [actions, trade.id]);

    const handleAccept = useCallback(() => {
        actions.respond?.(trade.id, true);
    }, [actions, trade.id]);

    const handleDecline = useCallback(() => {
        actions.respond?.(trade.id, false);
    }, [actions, trade.id]);

    const handleDismiss = useCallback(() => {
        actions.dismiss?.(trade.id);
    }, [actions, trade.id]);

    const disableConfirm = dirty || !actions.confirm;

    if (status === 'awaiting-partner') {
        const awaitingPartner = trade.partnerId === myId;
        return (
            <div className="trade-window" role="dialog" aria-modal="true">
                <header className="trade-window__header">
                    <h3>Trade request from {trade.participants?.[trade.initiatorId]?.name || 'Player'}</h3>
                    {timeLeft && <span className="trade-window__timer">Respond within {timeLeft}</span>}
                </header>
                <div className="trade-window__body">
                    {tradeNote && <p className="trade-window__note">“{tradeNote}”</p>}
                    {awaitingPartner ? (
                        <p>{trade.participants?.[trade.initiatorId]?.name || 'A player'} wants to trade items with you.</p>
                    ) : (
                        <p>Waiting for {partnerName} to accept the trade request…</p>
                    )}
                </div>
                <div className="trade-window__actions trade-window__actions--invite">
                    {awaitingPartner ? (
                        <>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={handleDecline}
                                disabled={!actions.respond}
                            >
                                Decline
                            </button>
                            <button
                                type="button"
                                className="btn"
                                onClick={handleAccept}
                                disabled={!actions.respond}
                            >
                                Accept trade
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={handleCancel}
                            disabled={!actions.cancel}
                        >
                            Cancel request
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (status !== 'active') {
        const completed = status === 'completed';
        const reasonText = trade.reason ? TRADE_REASON_LABELS[trade.reason] || trade.reason : null;
        return (
            <div className="trade-window" role="dialog" aria-modal="true">
                <header className="trade-window__header">
                    <h3>{completed ? 'Trade complete' : 'Trade closed'}</h3>
                </header>
                <div className="trade-window__body">
                    <p className="trade-window__message">
                        {completed ? `Your trade with ${partnerName} finished successfully.` : reasonText || 'The trade ended.'}
                    </p>
                </div>
                <div className="trade-window__actions">
                    <button type="button" className="btn" onClick={handleDismiss} disabled={!actions.dismiss}>
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="trade-window" role="dialog" aria-modal="true">
            <header className="trade-window__header">
                <div>
                    <h3>Trading with {partnerName}</h3>
                    {tradeNote && <p className="trade-window__note">“{tradeNote}”</p>}
                </div>
                {timeLeft && <span className="trade-window__timer">Expires in {timeLeft}</span>}
            </header>
            <div className="trade-window__columns">
                <div className="trade-window__column">
                    <h4>Your offer</h4>
                    {dirty && (
                        <p className="trade-window__warning text-small">Apply your changes before confirming.</p>
                    )}
                    <div className="trade-offer">
                        {draft.length > 0 ? (
                            draft.map((entry) => {
                                const item = inventoryMap.get(entry.itemId) || myOfferMap.get(entry.itemId) || {};
                                const label = item.name || 'Item';
                                const type = item.type || '';
                                const desc = item.desc || '';
                                const max = getItemMaxQuantity(inventoryMap, entry.itemId) || undefined;
                                return (
                                    <div key={entry.itemId} className="trade-offer__row">
                                        <div className="trade-offer__info">
                                            <div className="trade-offer__name">{label}</div>
                                            <div className="trade-offer__meta">
                                                {type && <span className="pill">{type}</span>}
                                                {typeof max === 'number' && Number.isFinite(max) && (
                                                    <span className="text-muted text-tiny">Inventory: {max}</span>
                                                )}
                                            </div>
                                            {desc && <p className="trade-offer__desc text-small">{desc}</p>}
                                        </div>
                                        <div className="trade-offer__controls">
                                            <label className="text-tiny" htmlFor={`trade-${trade.id}-${entry.itemId}`}>
                                                Qty
                                            </label>
                                            <input
                                                id={`trade-${trade.id}-${entry.itemId}`}
                                                type="number"
                                                min={1}
                                                max={max || undefined}
                                                value={entry.quantity}
                                                onChange={(e) => handleQuantityChange(entry.itemId, e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                className="btn ghost btn-small"
                                                onClick={() => handleRemove(entry.itemId)}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <p className="trade-offer__empty text-muted">No items offered yet.</p>
                        )}
                    </div>
                    <div className="trade-offer__picker">
                        <label htmlFor={`trade-picker-${trade.id}`} className="text-small">
                            Add from inventory
                        </label>
                        <select
                            id={`trade-picker-${trade.id}`}
                            value={picker}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (value) {
                                    handleAddItem(value);
                                    setPicker('');
                                } else {
                                    setPicker('');
                                }
                            }}
                        >
                            <option value="">Select an item…</option>
                            {availableOptions.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name || 'Item'}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="trade-offer__footer">
                        <button
                            type="button"
                            className="btn secondary"
                            onClick={handleApply}
                            disabled={!actions.updateOffer || !dirty}
                        >
                            Save offer
                        </button>
                    </div>
                </div>
                <div className="trade-window__column trade-window__column--partner">
                    <h4>{partnerName}'s offer</h4>
                    <div className="trade-offer">
                        {partnerOffer.length > 0 ? (
                            partnerOffer.map((entry) => (
                                <div key={entry.itemId} className="trade-offer__row">
                                    <div className="trade-offer__info">
                                        <div className="trade-offer__name">{entry.name || 'Item'}</div>
                                        <div className="trade-offer__meta">
                                            {entry.type && <span className="pill">{entry.type}</span>}
                                            <span className="pill">x{entry.quantity || 1}</span>
                                        </div>
                                        {entry.desc && <p className="trade-offer__desc text-small">{entry.desc}</p>}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="trade-offer__empty text-muted">No items offered yet.</p>
                        )}
                    </div>
                </div>
            </div>
            <footer className="trade-window__footer">
                <div className="trade-window__status">
                    <span className={`pill ${myConfirmed ? 'success' : ''}`}>
                        {myConfirmed ? 'You confirmed' : 'Awaiting your confirmation'}
                    </span>
                    <span className={`pill ${partnerConfirmed ? 'success' : ''}`}>
                        {partnerConfirmed ? `${partnerName} confirmed` : `${partnerName} reviewing`}
                    </span>
                </div>
                <div className="trade-window__actions">
                    <button
                        type="button"
                        className="btn ghost"
                        onClick={handleCancel}
                        disabled={!actions.cancel}
                    >
                        Cancel trade
                    </button>
                    {myConfirmed ? (
                        <button
                            type="button"
                            className="btn secondary"
                            onClick={handleUnconfirm}
                            disabled={!actions.unconfirm}
                        >
                            Unconfirm
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="btn"
                            onClick={handleConfirm}
                            disabled={disableConfirm}
                        >
                            Confirm trade
                        </button>
                    )}
                </div>
            </footer>
        </div>
    );
}

function offersEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i].itemId !== b[i].itemId) return false;
        if (clampQuantity(a[i].quantity) !== clampQuantity(b[i].quantity)) return false;
    }
    return true;
}

function clampQuantity(value, max = 9999) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 1;
    const rounded = Math.round(num);
    return Math.max(1, Math.min(max, rounded));
}

function getItemMaxQuantity(inventoryMap, itemId) {
    const item = inventoryMap.get(itemId);
    if (!item) return 0;
    const amount = Number(item.amount);
    if (!Number.isFinite(amount)) return 0;
    return Math.max(0, Math.round(amount));
}

function formatDuration(ms) {
    if (!Number.isFinite(ms)) return '';
    const clamped = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    if (minutes > 0) {
        return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
    }
    return `${seconds}s`;
}

// ---------- Items ----------
function WorldSkillsTab({ game, me, onUpdate }) {
    const isDM = game.dmId === me.id;
    const abilityDefault = ABILITY_DEFS[0]?.key || "INT";
    const worldSkills = useMemo(() => normalizeWorldSkillDefs(game.worldSkills), [game.worldSkills]);
    const [skillForm, setSkillForm] = useState({ label: "", ability: abilityDefault });
    const [editingSkillId, setEditingSkillId] = useState(null);
    const editingSkill = useMemo(
        () => worldSkills.find((skill) => skill.id === editingSkillId) || null,
        [editingSkillId, worldSkills]
    );
    const [skillBusy, setSkillBusy] = useState(false);
    const [skillRowBusy, setSkillRowBusy] = useState(null);

    const resetSkillForm = useCallback(() => {
        setEditingSkillId(null);
        setSkillForm({ label: "", ability: abilityDefault });
    }, [abilityDefault]);

    useEffect(() => {
        resetSkillForm();
    }, [game.id, resetSkillForm]);

    useEffect(() => {
        if (editingSkill) {
            setSkillForm({
                label: editingSkill.label || "",
                ability: ABILITY_KEY_SET.has(editingSkill.ability)
                    ? editingSkill.ability
                    : abilityDefault,
            });
        } else {
            setSkillForm((prev) =>
                prev.label === "" && prev.ability === abilityDefault
                    ? prev
                    : { label: "", ability: abilityDefault }
            );
        }
    }, [editingSkill, abilityDefault]);

    const startEditSkill = useCallback(
        (skill) => {
            if (!skill) {
                resetSkillForm();
                return;
            }
            setEditingSkillId(skill.id);
        },
        [resetSkillForm]
    );

    const handleSkillSubmit = useCallback(async () => {
        if (!isDM) return;
        const label = skillForm.label.trim();
        if (!label) {
            alert("Skill needs a name");
            return;
        }
        const abilityValue =
            typeof skillForm.ability === "string"
                ? skillForm.ability.trim().toUpperCase()
                : abilityDefault;
        const ability = ABILITY_KEY_SET.has(abilityValue) ? abilityValue : abilityDefault;
        try {
            setSkillBusy(true);
            if (editingSkillId) {
                await Games.updateWorldSkill(game.id, editingSkillId, { label, ability });
            } else {
                await Games.addWorldSkill(game.id, { label, ability });
            }
            await onUpdate?.();
            resetSkillForm();
        } catch (e) {
            alert(e.message);
        } finally {
            setSkillBusy(false);
        }
    }, [abilityDefault, editingSkillId, game.id, isDM, onUpdate, resetSkillForm, skillForm.ability, skillForm.label]);

    const handleSkillDelete = useCallback(
        async (skillId) => {
            if (!isDM || !skillId) return;
            if (!confirm("Remove this world skill?")) return;
            try {
                setSkillRowBusy(skillId);
                await Games.deleteWorldSkill(game.id, skillId);
                if (editingSkillId === skillId) resetSkillForm();
                await onUpdate?.();
            } catch (e) {
                alert(e.message);
            } finally {
                setSkillRowBusy(null);
            }
        },
        [editingSkillId, game.id, isDM, onUpdate, resetSkillForm]
    );

    const players = useMemo(
        () =>
            (game.players || []).filter(
                (p) => (p?.role || "").toLowerCase() !== "dm"
            ),
        [game.players]
    );

    const playerOptions = useMemo(
        () =>
            players.map((p, idx) => ({
                data: p,
                value: p.userId || `player-${idx}`,
                label:
                    p.character?.name?.trim() ||
                    p.username ||
                    (p.userId ? `Player ${p.userId.slice(0, 6)}` : `Player ${idx + 1}`),
            })),
        [players]
    );

    const [selectedPlayerId, setSelectedPlayerId] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isDM) {
            const self = playerOptions.find((opt) => opt.data?.userId === me.id);
            setSelectedPlayerId(self ? self.value : "");
            return;
        }
        setSelectedPlayerId((prev) => {
            if (playerOptions.some((opt) => opt.value === prev)) return prev;
            return playerOptions[0]?.value || "";
        });
    }, [isDM, me.id, playerOptions]);

    const activePlayer = useMemo(() => {
        if (playerOptions.length === 0) return null;
        if (isDM) {
            if (!selectedPlayerId) return null;
            const match = playerOptions.find((opt) => opt.value === selectedPlayerId);
            return match ? match.data : null;
        }
        const self = playerOptions.find((opt) => opt.data?.userId === me.id);
        return self ? self.data : null;
    }, [isDM, me.id, playerOptions, selectedPlayerId]);

    const character = useMemo(
        () => normalizeCharacter(activePlayer?.character, worldSkills),
        [activePlayer?.character, worldSkills]
    );

    const [skills, setSkills] = useState(() => normalizeSkills(character.skills, worldSkills));

    useEffect(() => {
        setSkills(normalizeSkills(character.skills, worldSkills));
    }, [character, worldSkills]);

    const [customSkills, setCustomSkills] = useState(() => normalizeCustomSkills(character.customSkills));
    const [customDraft, setCustomDraft] = useState(() => ({ label: "", ability: abilityDefault }));

    useEffect(() => {
        setCustomSkills(normalizeCustomSkills(character.customSkills));
    }, [character.customSkills]);

    useEffect(() => {
        setCustomDraft((prev) => ({
            label: prev.label.trim() ? prev.label : "",
            ability: ABILITY_KEY_SET.has(prev.ability) ? prev.ability : abilityDefault,
        }));
    }, [abilityDefault]);

    const abilityMods = useMemo(() => {
        return ABILITY_DEFS.reduce((acc, ability) => {
            acc[ability.key] = abilityModifier(character.stats?.[ability.key]);
            return acc;
        }, {});
    }, [character.stats]);

    const abilitySummaries = useMemo(() => {
        return ABILITY_DEFS.map((ability) => {
            const raw = character.stats?.[ability.key];
            const num = Number(raw);
            const score =
                raw === undefined || raw === null || raw === ""
                    ? null
                    : Number.isFinite(num)
                    ? num
                    : null;
            return {
                ...ability,
                score,
                modifier: abilityMods[ability.key] ?? 0,
            };
        });
    }, [abilityMods, character.stats]);

    const level = clampNonNegative(character.resources?.level) || 1;
    const hp = clampNonNegative(character.resources?.hp);
    const maxHP = clampNonNegative(character.resources?.maxHP);
    const hpLabel = maxHP > 0 ? `${hp}/${maxHP}` : hp;
    const resourceMode = character.resources?.useTP ? "TP" : "MP";
    const mp = clampNonNegative(character.resources?.mp);
    const maxMP = clampNonNegative(character.resources?.maxMP);
    const tp = clampNonNegative(character.resources?.tp);
    const initiativeBonus = Number(character.resources?.initiative) || 0;
    const initiativeLabel = formatModifier(initiativeBonus);
    const spRaw = character.resources?.sp;
    const suggestedHP = Math.max(
        1,
        Math.ceil(
            17 + (abilityMods.CON ?? 0) + (abilityMods.STR ?? 0) / 2
        )
    );
    const suggestedMP = Math.max(
        0,
        Math.ceil(
            17 + (abilityMods.INT ?? 0) + (abilityMods.WIS ?? 0) / 2
        )
    );
    const suggestedTP = Math.max(
        0,
        Math.ceil(
            7 + (abilityMods.DEX ?? 0) + (abilityMods.CON ?? 0) / 2
        )
    );
    const suggestedSP = Math.max(
        0,
        Math.ceil((5 + (abilityMods.INT ?? 0)) * 2 + (abilityMods.CHA ?? 0))
    );
    const availableSP =
        spRaw === undefined || spRaw === null || spRaw === ""
            ? suggestedSP
            : clampNonNegative(spRaw);
    const maxSkillRank = Math.max(4, level * 2 + 2);

    const skillRows = useMemo(() => {
        return worldSkills.map((skill) => {
            const entry = skills?.[skill.key] || { ranks: 0, misc: 0 };
            const ranks = clampNonNegative(entry.ranks);
            const miscRaw = Number(entry.misc);
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            const abilityMod = abilityMods[skill.ability] ?? 0;
            const total = abilityMod + ranks + misc;
            return { ...skill, ranks, misc, abilityMod, total };
        });
    }, [abilityMods, skills, worldSkills]);

    const customSkillRows = useMemo(() => {
        return customSkills.map((skill) => {
            const ranks = clampNonNegative(skill.ranks);
            const miscRaw = Number(skill.misc);
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            const abilityMod = abilityMods[skill.ability] ?? 0;
            const total = abilityMod + ranks + misc;
            return { ...skill, ranks, misc, abilityMod, total };
        });
    }, [abilityMods, customSkills]);

    const spentSP = useMemo(() => {
        const base = skillRows.reduce((sum, row) => sum + row.ranks, 0);
        const extras = customSkillRows.reduce((sum, row) => sum + row.ranks, 0);
        return base + extras;
    }, [customSkillRows, skillRows]);
    const overSpent = spentSP > availableSP;
    const rankIssues = useMemo(() => {
        const standard = skillRows
            .filter((row) => row.ranks > maxSkillRank)
            .map((row) => row.label);
        const extras = customSkillRows
            .filter((row) => row.ranks > maxSkillRank)
            .map((row) => row.label);
        return [...standard, ...extras];
    }, [customSkillRows, maxSkillRank, skillRows]);

    const addCustomSkill = useCallback(() => {
        const label = customDraft.label.trim();
        if (!label) return;
        const abilityRaw =
            typeof customDraft.ability === 'string'
                ? customDraft.ability.trim().toUpperCase()
                : abilityDefault;
        const ability = ABILITY_KEY_SET.has(abilityRaw) ? abilityRaw : abilityDefault;
        setCustomSkills((prev) => {
            const ids = new Set(prev.map((entry) => entry.id));
            const id = makeCustomSkillId(label, ids);
            return [...prev, { id, label, ability, ranks: 0, misc: 0 }];
        });
        setCustomDraft({ label: '', ability });
    }, [abilityDefault, customDraft]);

    const updateCustomSkill = useCallback(
        (id, field, value) => {
            setCustomSkills((prev) =>
                prev.map((entry) => {
                    if (entry.id !== id) return entry;
                    if (field === 'label') {
                        return { ...entry, label: String(value) };
                    }
                    if (field === 'ability') {
                        const abilityRaw = typeof value === 'string' ? value.trim().toUpperCase() : '';
                        if (!ABILITY_KEY_SET.has(abilityRaw)) return entry;
                        return { ...entry, ability: abilityRaw };
                    }
                    const num = Number(value);
                    if (field === 'ranks') {
                        const sanitized = Math.min(clampNonNegative(num), maxSkillRank);
                        return { ...entry, ranks: sanitized };
                    }
                    if (field === 'misc') {
                        return { ...entry, misc: Number.isFinite(num) ? num : 0 };
                    }
                    return entry;
                })
            );
        },
        [maxSkillRank]
    );

    const removeCustomSkill = useCallback((id) => {
        setCustomSkills((prev) => prev.filter((entry) => entry.id !== id));
    }, []);

    const saveRows = useMemo(() => {
        const saves = character.resources?.saves || {};
        return SAVE_DEFS.map((save) => {
            const total = clampNonNegative(get(saves, `${save.key}.total`));
            const abilityMod = abilityMods[save.ability] ?? 0;
            const fallback = abilityMod;
            return {
                ...save,
                abilityMod,
                total: total || total === 0 ? total : fallback,
            };
        });
    }, [abilityMods, character.resources?.saves]);

    const updateSkill = useCallback((key, field, value) => {
        setSkills((prev) => {
            const next = { ...prev };
            const current = { ...(next[key] || { ranks: 0, misc: 0 }) };
            if (field === "ranks") {
                current.ranks = clampNonNegative(value);
            } else if (field === "misc") {
                const num = Number(value);
                current.misc = Number.isFinite(num) ? num : 0;
            }
            next[key] = current;
            return next;
        });
    }, []);

    const canEdit = !!activePlayer && (isDM || (game.permissions?.canEditStats && activePlayer.userId === me.id));
    const disableInputs = !canEdit || saving;

    const combatStats = useMemo(() => {
        const resourceDisplay =
            resourceMode === "TP"
                ? String(tp)
                : maxMP > 0
                ? `${mp}/${maxMP}`
                : String(mp);
        return [
            { key: "level", label: "Level", value: level },
            {
                key: "hp",
                label: "HP",
                value: hpLabel,
                meta: `Suggested ${suggestedHP}`,
            },
            {
                key: "resource",
                label: resourceMode === "TP" ? "TP" : "MP",
                value: resourceDisplay,
                meta:
                    resourceMode === "TP"
                        ? `Suggested ${suggestedTP}`
                        : `Suggested ${suggestedMP}`,
            },
            {
                key: "sp",
                label: "SP",
                value: availableSP,
                meta: `Suggested ${suggestedSP}`,
            },
            { key: "init", label: "Initiative", value: initiativeLabel },
        ];
    }, [
        availableSP,
        hpLabel,
        initiativeLabel,
        level,
        maxMP,
        mp,
        resourceMode,
        suggestedHP,
        suggestedMP,
        suggestedSP,
        suggestedTP,
        tp,
    ]);

    const summaryBoxStyle = {
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "8px 10px",
        background: "var(--surface-2)",
        minWidth: 120,
    };

    const playerLabel = activePlayer
        ? activePlayer.character?.name?.trim() ||
          activePlayer.username ||
          "Unnamed Adventurer"
        : "";

    const handleSave = useCallback(async () => {
        if (!activePlayer || saving) return;
        if (isDM && !activePlayer.userId) {
            alert("This player slot is not linked to a user yet.");
            return;
        }
        try {
            setSaving(true);
            const base = normalizeCharacter(activePlayer.character, worldSkills);
            const nextCharacter = deepClone(base);
            nextCharacter.skills = serializeSkills(skills);
            nextCharacter.customSkills = serializeCustomSkills(customSkills);
            if (isDM && activePlayer.userId && activePlayer.userId !== me.id) {
                await Games.saveCharacter(game.id, {
                    userId: activePlayer.userId,
                    character: nextCharacter,
                });
            } else {
                await Games.saveCharacter(game.id, nextCharacter);
            }
            await onUpdate?.();
        } catch (e) {
            alert(e.message || "Failed to save skills");
        } finally {
            setSaving(false);
        }
    }, [activePlayer, customSkills, game.id, isDM, me.id, onUpdate, saving, skills, worldSkills]);

    return (
        <div className="col" style={{ display: "grid", gap: 16 }}>
            {isDM && (
                <div className="card" style={{ display: "grid", gap: 12 }}>
                    <div>
                        <h3>Manage world skills</h3>
                        <p className="text-muted text-small">
                            Add, rename, or remove entries the party can invest ranks into.
                        </p>
                    </div>
                    <div
                        className="row"
                        style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}
                    >
                        <input
                            placeholder="Skill name"
                            value={skillForm.label}
                            onChange={(e) => setSkillForm((prev) => ({
                                ...prev,
                                label: e.target.value,
                            }))}
                            style={{ flex: 2, minWidth: 200 }}
                        />
                        <label className="field" style={{ minWidth: 160 }}>
                            <span className="field__label">Ability</span>
                            <select
                                value={skillForm.ability}
                                onChange={(e) =>
                                    setSkillForm((prev) => ({
                                        ...prev,
                                        ability: e.target.value,
                                    }))
                                }
                            >
                                {ABILITY_DEFS.map((ability) => (
                                    <option key={ability.key} value={ability.key}>
                                        {ability.key} · {ability.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="row" style={{ gap: 8 }}>
                            <button
                                className="btn"
                                onClick={handleSkillSubmit}
                                disabled={skillBusy || !skillForm.label.trim()}
                            >
                                {skillBusy ? "…" : editingSkill ? "Save" : "Add"}
                            </button>
                            {editingSkill && (
                                <button
                                    className="btn"
                                    onClick={resetSkillForm}
                                    disabled={skillBusy}
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="list" style={{ maxHeight: 240, overflow: "auto", gap: 8 }}>
                        {worldSkills.length === 0 ? (
                            <div className="text-muted">No world skills configured yet.</div>
                        ) : (
                            worldSkills.map((skill) => (
                                <div
                                    key={skill.id}
                                    className="row"
                                    style={{
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        gap: 8,
                                        flexWrap: "wrap",
                                    }}
                                >
                                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                                        <strong>{skill.label}</strong>
                                        <span className="pill light">{skill.ability}</span>
                                    </div>
                                    <div className="row" style={{ gap: 6 }}>
                                        <button
                                            className="btn"
                                            onClick={() => startEditSkill(skill)}
                                            disabled={skillBusy || skillRowBusy === skill.id}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="btn"
                                            onClick={() => handleSkillDelete(skill.id)}
                                            disabled={skillRowBusy === skill.id || skillBusy}
                                        >
                                            {skillRowBusy === skill.id ? "…" : "Remove"}
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
            <div className="card" style={{ display: "grid", gap: 16 }}>
                <div
                    className="row"
                    style={{
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                        flexWrap: "wrap",
                    }}
                >
                    <div>
                        <h3>World Skill Planner</h3>
                        <p className="text-muted text-small">
                            Ranks automatically include ability modifiers and combat
                            saves for quick reference.
                        </p>
                    </div>
                    {isDM && playerOptions.length > 0 && (
                        <div
                            className="row"
                            style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}
                        >
                            <label
                                htmlFor="world-skill-player-picker"
                                style={{ fontWeight: 600 }}
                            >
                                Select player:
                            </label>
                            <select
                                id="world-skill-player-picker"
                                value={selectedPlayerId}
                                onChange={(e) => setSelectedPlayerId(e.target.value)}
                                style={{ minWidth: 200 }}
                            >
                                {!selectedPlayerId && (
                                    <option value="">Choose a player…</option>
                                )}
                                {playerOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                {playerOptions.length === 0 ? (
                    <div className="text-muted">No players have joined yet.</div>
                ) : !activePlayer ? (
                    <div className="text-muted">
                        {isDM
                            ? "Select a player to review their world skills."
                            : "No character data available yet."}
                    </div>
                ) : (
                    <>
                        <div
                            className="row"
                            style={{
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 12,
                                flexWrap: "wrap",
                            }}
                        >
                            <div>
                                <h4 style={{ margin: 0 }}>{playerLabel}</h4>
                                <span className="text-muted text-small">
                                    Level {level} · {resourceMode === "TP" ? "TP" : "MP"} mode
                                </span>
                            </div>
                            <div
                                className={`sp-summary${overSpent ? " warn" : ""}`}
                                style={{ margin: 0 }}
                            >
                                <span>SP spent: {spentSP}</span>
                                <span>Available: {availableSP}</span>
                                <span>Max rank: {maxSkillRank}</span>
                                {rankIssues.length > 0 && (
                                    <span className="sp-summary__warning">
                                        Over cap: {rankIssues.join(", ")}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div
                            className="row"
                            style={{ gap: 12, flexWrap: "wrap", alignItems: "stretch" }}
                        >
                            {combatStats.map((stat) => (
                                <div
                                    key={stat.key}
                                    style={{ ...summaryBoxStyle, minWidth: 110 }}
                                >
                                    <span
                                        className="text-small"
                                        style={{ color: "var(--muted)" }}
                                    >
                                        {stat.label}
                                    </span>
                                    <strong style={{ fontSize: "1.1rem" }}>
                                        {stat.value ?? "—"}
                                    </strong>
                                    {stat.meta && (
                                        <span
                                            className="text-small"
                                            style={{ color: "var(--muted)" }}
                                        >
                                            {stat.meta}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div
                            className="row"
                            style={{ gap: 12, flexWrap: "wrap", alignItems: "stretch" }}
                        >
                            {abilitySummaries.map((ability) => (
                                <div
                                    key={ability.key}
                                    style={{ ...summaryBoxStyle, minWidth: 140 }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 6,
                                        }}
                                    >
                                        <span style={{ fontWeight: 600 }}>
                                            {ability.key}
                                        </span>
                                        <span
                                            className="text-small"
                                            style={{ color: "var(--muted)" }}
                                        >
                                            {ability.label}
                                        </span>
                                    </div>
                                    <strong style={{ fontSize: "1.2rem" }}>
                                        {ability.score ?? "—"}
                                    </strong>
                                    <span className="text-small">
                                        Mod {formatModifier(ability.modifier)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className="save-grid">
                            {saveRows.map((save) => (
                                <div key={save.key} className="save-card">
                                    <div className="save-card__header">
                                        <span>{save.label}</span>
                                        <span className="pill light">
                                            {save.ability} mod {formatModifier(save.abilityMod)}
                                        </span>
                                    </div>
                                    <div
                                        className="row"
                                        style={{
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 8,
                                        }}
                                    >
                                        <span className="text-small">Total save</span>
                                        <span className="skill-total">
                                            {formatModifier(save.total)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {worldSkills.length === 0 ? (
                            <div className="text-muted">
                                No world skills are configured. Add entries above to begin planning ranks.
                            </div>
                        ) : (
                            <div className="sheet-table-wrapper">
                                <table className="sheet-table skill-table">
                                    <thead>
                                        <tr>
                                            <th>Skill</th>
                                            <th>Ability</th>
                                            <th>Ability mod</th>
                                            <th>Ranks</th>
                                            <th>Misc</th>
                                            <th>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {skillRows.map((row) => (
                                            <tr key={row.key}>
                                                <th scope="row">
                                                    <span className="skill-name">{row.label}</span>
                                                </th>
                                                <td>{row.ability}</td>
                                                <td>
                                                    <span className="pill light">
                                                        {formatModifier(row.abilityMod)}
                                                    </span>
                                                </td>
                                                <td>
                                                    <MathField
                                                        label="Ranks"
                                                        value={row.ranks}
                                                        onCommit={(val) =>
                                                            updateSkill(row.key, "ranks", val)
                                                        }
                                                        className="math-inline"
                                                        disabled={disableInputs}
                                                    />
                                                </td>
                                                <td>
                                                    <MathField
                                                        label="Misc"
                                                        value={row.misc}
                                                        onCommit={(val) =>
                                                            updateSkill(row.key, "misc", val)
                                                        }
                                                        className="math-inline"
                                                        disabled={disableInputs}
                                                    />
                                                </td>
                                                <td>
                                                    <span className="skill-total">
                                                        {formatModifier(row.total)}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                            <div>
                                <h4 style={{ margin: 0 }}>Custom skills</h4>
                                <p className="text-muted text-small" style={{ margin: 0 }}>
                                    DM-awarded or trained talents unique to {playerLabel || "this hero"}.
                                </p>
                            </div>
                            {customSkillRows.length === 0 ? (
                                <div className="text-muted">No custom skills yet.</div>
                            ) : (
                                <div className="sheet-table-wrapper">
                                    <table className="sheet-table skill-table">
                                        <thead>
                                            <tr>
                                                <th>Skill</th>
                                                <th>Ability</th>
                                                <th>Ability mod</th>
                                                <th>Ranks</th>
                                                <th>Misc</th>
                                                <th>Total</th>
                                                {canEdit && <th aria-label="Actions" />}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {customSkillRows.map((row) => (
                                                <tr key={row.id}>
                                                    <th scope="row">
                                                        <input
                                                            type="text"
                                                            value={row.label}
                                                            onChange={(e) =>
                                                                updateCustomSkill(row.id, 'label', e.target.value)
                                                            }
                                                            disabled={disableInputs}
                                                            placeholder="Skill name"
                                                            style={{ width: '100%' }}
                                                        />
                                                    </th>
                                                    <td>
                                                        <select
                                                            value={row.ability}
                                                            onChange={(e) =>
                                                                updateCustomSkill(row.id, 'ability', e.target.value)
                                                            }
                                                            disabled={disableInputs}
                                                        >
                                                            {ABILITY_DEFS.map((ability) => (
                                                                <option key={ability.key} value={ability.key}>
                                                                    {ability.key} · {ability.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <span className="pill light">
                                                            {formatModifier(row.abilityMod)}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <MathField
                                                            label="Ranks"
                                                            value={row.ranks}
                                                            onCommit={(val) =>
                                                                updateCustomSkill(row.id, 'ranks', val)
                                                            }
                                                            className="math-inline"
                                                            disabled={disableInputs}
                                                        />
                                                    </td>
                                                    <td>
                                                        <MathField
                                                            label="Misc"
                                                            value={row.misc}
                                                            onCommit={(val) =>
                                                                updateCustomSkill(row.id, 'misc', val)
                                                            }
                                                            className="math-inline"
                                                            disabled={disableInputs}
                                                        />
                                                    </td>
                                                    <td>
                                                        <span className="skill-total">
                                                            {formatModifier(row.total)}
                                                        </span>
                                                    </td>
                                                    {canEdit && (
                                                        <td>
                                                            <button
                                                                className="btn ghost"
                                                                onClick={() => removeCustomSkill(row.id)}
                                                                disabled={disableInputs}
                                                            >
                                                                Remove
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {canEdit && (
                                <div
                                    className="row"
                                    style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
                                >
                                    <input
                                        placeholder="Custom skill name"
                                        value={customDraft.label}
                                        onChange={(e) =>
                                            setCustomDraft((prev) => ({ ...prev, label: e.target.value }))
                                        }
                                        style={{ flex: 2, minWidth: 200 }}
                                        disabled={disableInputs}
                                    />
                                    <label className="field" style={{ minWidth: 160 }}>
                                        <span className="field__label">Ability</span>
                                        <select
                                            value={customDraft.ability}
                                            onChange={(e) =>
                                                setCustomDraft((prev) => ({
                                                    ...prev,
                                                    ability: e.target.value,
                                                }))
                                            }
                                            disabled={disableInputs}
                                        >
                                            {ABILITY_DEFS.map((ability) => (
                                                <option key={ability.key} value={ability.key}>
                                                    {ability.key} · {ability.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <button
                                        className="btn"
                                        onClick={addCustomSkill}
                                        disabled={disableInputs || !customDraft.label.trim()}
                                    >
                                        Add custom skill
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="sheet-footer">
                            {!canEdit && (
                                <span className="text-muted text-small">
                                    You have read-only access. Ask your DM for edit
                                    permissions.
                                </span>
                            )}
                            <button
                                className="btn"
                                disabled={disableInputs}
                                onClick={handleSave}
                            >
                                {saving ? "Saving…" : "Save skill ranks"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function ItemsTab({ game, me, onUpdate }) {
    const [premade, setPremade] = useState([]);
    const [form, setForm] = useState({ name: "", type: "", desc: "" });
    const [editing, setEditing] = useState(null);
    const [busySave, setBusySave] = useState(false);
    const [busyRow, setBusyRow] = useState(null);
    const [selectedPlayerId, setSelectedPlayerId] = useState("");
    const [giveBusyId, setGiveBusyId] = useState(null);
    const gearTypes = ["weapon", "armor", "accessory"]; // types reserved for gear

    const isDM = game.dmId === me.id;
    const canEdit = isDM || game.permissions?.canEditItems;

    const resetForm = useCallback(() => {
        setEditing(null);
        setForm({ name: "", type: "", desc: "" });
    }, []);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const data = await Items.premade();
                if (mounted) setPremade(Array.isArray(data) ? data : []);
            } catch (e) {
                console.error(e);
            }
        })();
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        resetForm();
    }, [game.id, resetForm]);

    const save = async (item) => {
        if (!item?.name) return alert("Item needs a name");
        try {
            setBusySave(true);
            if (editing) {
                await Games.updateCustomItem(game.id, editing.id, item);
            } else {
                await Games.addCustomItem(game.id, item);
            }
            await onUpdate();
            resetForm();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusySave(false);
        }
    };

    const remove = async (itemId) => {
        if (!confirm("Remove this item?")) return;
        try {
            setBusyRow(itemId);
            await Games.deleteCustomItem(game.id, itemId);
            if (editing?.id === itemId) resetForm();
            await onUpdate();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusyRow(null);
        }
    };

    const itemList = premade.filter(
        (it) => !gearTypes.some((t) => it.type?.toLowerCase().startsWith(t))
    );
    const gearList = premade.filter((it) =>
        gearTypes.some((t) => it.type?.toLowerCase().startsWith(t))
    );
    const customItems = Array.isArray(game.items?.custom) ? game.items.custom : [];
    const customGear = Array.isArray(game.gear?.custom) ? game.gear.custom : [];
    const libraryItems = [...customItems, ...itemList];
    const libraryGear = [...customGear, ...gearList];
    const canManageGear = isDM || game.permissions?.canEditGear;
    const players = (game.players || []).filter(
        (p) => (p?.role || "").toLowerCase() !== "dm"
    );

    const playerOptions = useMemo(
        () =>
            players.map((p, idx) => ({
                data: p,
                value: p.userId || `player-${idx}`,
                label:
                    p.character?.name?.trim() ||
                    `Player ${p.userId?.slice?.(0, 6) || ""}` ||
                    "Unnamed Player",
            })),
        [players]
    );

    useEffect(() => {
        if (!isDM) {
            setSelectedPlayerId("");
            return;
        }
        setSelectedPlayerId((prev) => {
            if (playerOptions.some((opt) => opt.value === prev)) return prev;
            const next = playerOptions[0]?.value || "";
            return prev === next ? prev : next;
        });
    }, [isDM, playerOptions]);

    const visiblePlayers = useMemo(() => {
        if (isDM) {
            if (!selectedPlayerId) return [];
            const match = playerOptions.find((opt) => opt.value === selectedPlayerId);
            return match ? [match.data] : [];
        }
        const self = players.find((p) => p.userId === me.id);
        return self ? [self] : [];
    }, [isDM, me.id, playerOptions, players, selectedPlayerId]);

    const selectedPlayer = isDM ? visiblePlayers[0] : null;
    const selectedPlayerLabel = useMemo(() => {
        if (!selectedPlayer) return "";
        return (
            selectedPlayer.character?.name?.trim() ||
            selectedPlayer.username ||
            (selectedPlayer.userId ? `Player ${selectedPlayer.userId.slice(0, 6)}` : "Unclaimed slot")
        );
    }, [selectedPlayer]);
    const canGiveToSelected = isDM && !!selectedPlayer?.userId;

    const handleGiveCustom = useCallback(
        async (item) => {
            if (!isDM || !selectedPlayer?.userId || !item) return;
            try {
                setGiveBusyId(item.id);
                await Games.addPlayerItem(game.id, selectedPlayer.userId, {
                    name: item.name,
                    type: item.type,
                    desc: item.desc,
                    amount: 1,
                });
                await onUpdate?.();
            } catch (e) {
                alert(e.message);
            } finally {
                setGiveBusyId(null);
            }
        },
        [game.id, isDM, onUpdate, selectedPlayer?.userId]
    );

    return (
        <div className="col" style={{ display: "grid", gap: 16 }}>
      <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div className="card" style={{ flex: 1, minWidth: 320 }}>
              <h3>{editing ? "Edit Item" : "Custom Item"}</h3>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <input
                            placeholder="Name"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            style={{ flex: 1, minWidth: 180 }}
                        />
                        <input
                            placeholder="Type"
                            value={form.type}
                            onChange={(e) => setForm({ ...form, type: e.target.value })}
                            style={{ flex: 1, minWidth: 160 }}
                        />
                        <input
                            placeholder="Description"
                            value={form.desc}
                            onChange={(e) => setForm({ ...form, desc: e.target.value })}
                            style={{ flex: 2, minWidth: 220 }}
                        />
                        <div className="row" style={{ gap: 8 }}>
                            <button
                                className="btn"
                                disabled={!form.name || busySave || !canEdit}
                                onClick={() => save(form)}
                            >
                                {busySave ? "…" : editing ? "Save" : "Add"}
                            </button>
                            {editing && (
                                <button className="btn" onClick={resetForm} disabled={busySave}>
                                    Cancel
                                </button>
                            )}
                        </div>
              </div>

              <h4 style={{ marginTop: 16 }}>Game Custom Items</h4>
              {isDM && (
                  <p className="text-muted text-small" style={{ marginTop: -4 }}>
                      {canGiveToSelected
                          ? `Give buttons target ${selectedPlayerLabel}.`
                          : "Select a claimed player below to enable the Give button."}
                  </p>
              )}
              <div className="list">
                  {customItems.map((it) => (
                      <div
                          key={it.id}
                          className="row"
                          style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}
                      >
                          <div>
                              <b>{it.name}</b> — {it.type || "—"}
                              <div style={{ opacity: 0.85, fontSize: 12 }}>{it.desc}</div>
                          </div>
                          {(isDM || canEdit) && (
                              <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                  {isDM && (
                                      <button
                                          className="btn"
                                          onClick={() => handleGiveCustom(it)}
                                          disabled={!canGiveToSelected || giveBusyId === it.id}
                                          title={
                                              !selectedPlayer?.userId
                                                  ? "Select a player slot linked to a user to give this item."
                                                  : undefined
                                          }
                                      >
                                          {giveBusyId === it.id
                                              ? "Giving…"
                                              : canGiveToSelected
                                              ? `Give to ${selectedPlayerLabel}`
                                              : "Give"}
                                      </button>
                                  )}
                                  {canEdit && (
                                      <>
                                          <button
                                              className="btn"
                                              onClick={() => {
                                                  setEditing(it);
                                                  setForm({ name: it.name || "", type: it.type || "", desc: it.desc || "" });
                                              }}
                                              disabled={busySave}
                                          >
                                              Edit
                                          </button>
                                          <button
                                              className="btn"
                                              onClick={() => remove(it.id)}
                                              disabled={busyRow === it.id}
                                          >
                                              {busyRow === it.id ? "…" : "Remove"}
                                          </button>
                                      </>
                                  )}
                              </div>
                          )}
                      </div>
                  ))}
                  {customItems.length === 0 && (
                      <div style={{ opacity: 0.7 }}>No custom items yet.</div>
                  )}
                    </div>
                </div>

                <div className="card" style={{ width: 380 }}>
                    <h3>Premade Items</h3>
                    <div className="list" style={{ maxHeight: 420, overflow: "auto" }}>
                        {itemList.map((it, idx) => (
                            <div
                                key={idx}
                                className="row"
                                style={{ justifyContent: "space-between", alignItems: "center" }}
                            >
                                <div>
                                    <b>{it.name}</b> <span className="pill">{it.type || "—"}</span>
                                    <div style={{ opacity: 0.8, fontSize: 12 }}>{it.desc}</div>
                                </div>
                                <button
                                    className="btn"
                                    disabled={!canEdit || busySave}
                                    onClick={() => save({ name: it.name, type: it.type, desc: it.desc })}
                                >
                                    Add
                                </button>
                            </div>
                        ))}
                        {itemList.length === 0 && <div style={{ opacity: 0.7 }}>No premade items.</div>}
                    </div>
                </div>
            </div>

            <div className="card">
                <h3>Player Inventories</h3>
                {isDM && players.length > 0 && (
                    <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                        <label htmlFor="player-inventory-picker" style={{ fontWeight: 600 }}>
                            Select player:
                        </label>
                        <select
                            id="player-inventory-picker"
                            value={selectedPlayerId}
                            onChange={(e) => setSelectedPlayerId(e.target.value)}
                            style={{ minWidth: 200 }}
                        >
                            {!selectedPlayerId && <option value="">Choose a player…</option>}
                            {playerOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                {players.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>No players have joined yet.</div>
                ) : visiblePlayers.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>
                        {isDM
                            ? "Select a player to view their inventory."
                            : "No inventory available for your character yet."}
                    </div>
                ) : (
                    <div className="list" style={{ gap: 20 }}>
                        {visiblePlayers.map((p) => {
                            const canEditItems =
                                isDM || (game.permissions?.canEditItems && me.id === p.userId);
                            const canEditGear =
                                isDM || (game.permissions?.canEditGear && me.id === p.userId);
                            return (
                                <div key={p.userId} className="gear-inventory-stack">
                                    <PlayerInventoryCard
                                        player={p}
                                        canEdit={canEditItems}
                                        gameId={game.id}
                                        onUpdate={onUpdate}
                                        libraryItems={libraryItems}
                                    />
                                    <PlayerGearStashCard
                                        player={p}
                                        canEdit={canEditGear && canManageGear}
                                        gameId={game.id}
                                        onUpdate={onUpdate}
                                        libraryGear={libraryGear}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function PlayerInventoryCard({ player, canEdit, gameId, onUpdate, libraryItems }) {
    const [form, setForm] = useState({ name: "", type: "", desc: "", amount: "1" });
    const [editing, setEditing] = useState(null);
    const [busySave, setBusySave] = useState(false);
    const [busyRow, setBusyRow] = useState(null);
    const [picker, setPicker] = useState("");

    const resetForm = useCallback(() => {
        setEditing(null);
        setForm({ name: "", type: "", desc: "", amount: "1" });
        setPicker("");
    }, []);

    useEffect(() => {
        resetForm();
    }, [player.userId, resetForm]);

    const inventory = Array.isArray(player.inventory) ? player.inventory : [];
    const available = Array.isArray(libraryItems) ? libraryItems : [];

    const parseAmount = useCallback((value, fallback) => {
        if (value === undefined || value === null || value === "") return fallback;
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        const rounded = Math.round(num);
        return rounded < 0 ? 0 : rounded;
    }, []);

    const save = useCallback(async () => {
        if (!canEdit) return;
        const name = form.name.trim();
        if (!name) return alert("Item needs a name");
        const amount = parseAmount(form.amount, editing ? editing.amount ?? 0 : 1);
        const payload = {
            name,
            type: form.type.trim(),
            desc: form.desc.trim(),
            amount: editing ? amount : (amount <= 0 ? 1 : amount),
        };
        try {
            setBusySave(true);
            if (editing) {
                await Games.updatePlayerItem(gameId, player.userId, editing.id, payload);
            } else {
                await Games.addPlayerItem(gameId, player.userId, payload);
            }
            await onUpdate();
            resetForm();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusySave(false);
        }
    }, [canEdit, editing, form.amount, form.desc, form.name, form.type, gameId, onUpdate, parseAmount, player.userId, resetForm]);

    const startEdit = useCallback((item) => {
        setEditing(item);
        setForm({
            name: item.name || "",
            type: item.type || "",
            desc: item.desc || "",
            amount: String(item.amount ?? 1),
        });
        setPicker("");
    }, []);

    const remove = useCallback(async (itemId) => {
        if (!canEdit) return;
        if (!confirm("Remove this item from the inventory?")) return;
        try {
            setBusyRow(itemId);
            await Games.deletePlayerItem(gameId, player.userId, itemId);
            if (editing?.id === itemId) resetForm();
            await onUpdate();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusyRow(null);
        }
    }, [canEdit, editing?.id, gameId, onUpdate, player.userId, resetForm]);

    const playerLabel = player.character?.name || `Player ${player.userId?.slice?.(0, 6) || ""}`;
    const subtitleParts = [];
    if (player.character?.profile?.class) subtitleParts.push(player.character.profile.class);
    if (player.character?.resources?.level) subtitleParts.push(`LV ${player.character.resources.level}`);
    const subtitle = subtitleParts.join(" · ");

    return (
        <div className="card" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <div>
                    <div><b>{playerLabel || "Unnamed Player"}</b></div>
                    {subtitle && <div style={{ opacity: 0.75, fontSize: 12 }}>{subtitle}</div>}
                </div>
                <span className="pill">Items: {inventory.length}</span>
            </div>

            {canEdit && available.length > 0 && (
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <select
                        value={picker}
                        onChange={(e) => {
                            const value = e.target.value;
                            if (!value) {
                                setPicker("");
                                return;
                            }
                            const idx = Number(value);
                            if (!Number.isNaN(idx) && available[idx]) {
                                const chosen = available[idx];
                                setForm((prev) => ({
                                    ...prev,
                                    name: chosen.name || "",
                                    type: chosen.type || "",
                                    desc: chosen.desc || "",
                                }));
                            }
                            setPicker("");
                        }}
                    >
                        <option value="">Copy from library…</option>
                        {available.map((it, idx) => (
                            <option key={`${it.id ?? it.name ?? idx}-${idx}`} value={String(idx)}>
                                {(it.name || "Untitled").slice(0, 40)}
                                {it.type ? ` · ${it.type}` : ""}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <input
                    placeholder="Item name"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={!canEdit}
                    style={{ flex: 2, minWidth: 180 }}
                />
                <input
                    placeholder="Type"
                    value={form.type}
                    onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                    disabled={!canEdit}
                    style={{ flex: 1, minWidth: 140 }}
                />
                <input
                    placeholder="Description"
                    value={form.desc}
                    onChange={(e) => setForm((prev) => ({ ...prev, desc: e.target.value }))}
                    disabled={!canEdit}
                    style={{ flex: 3, minWidth: 200 }}
                />
                <input
                    type="number"
                    placeholder="Qty"
                    min={0}
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    disabled={!canEdit}
                    style={{ width: 80 }}
                />
                <div className="row" style={{ gap: 8 }}>
                    <button className="btn" onClick={save} disabled={!canEdit || busySave || !form.name.trim()}>
                        {busySave ? "…" : editing ? "Save" : "Give"}
                    </button>
                    {editing && (
                        <button className="btn" onClick={resetForm} disabled={busySave}>
                            Cancel
                        </button>
                    )}
                </div>
            </div>

            <div className="list" style={{ marginTop: 12 }}>
                {inventory.map((it) => (
                    <div key={it.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                <b>{it.name}</b>
                                {it.type && <span className="pill">{it.type}</span>}
                                <span className="pill">x{it.amount ?? 0}</span>
                            </div>
                            {it.desc && (
                                <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>{it.desc}</div>
                            )}
                        </div>
                        {canEdit && (
                            <div className="row" style={{ gap: 6 }}>
                                <button className="btn" onClick={() => startEdit(it)} disabled={busySave}>
                                    Edit
                                </button>
                                <button
                                    className="btn"
                                    onClick={() => remove(it.id)}
                                    disabled={busyRow === it.id}
                                >
                                    {busyRow === it.id ? "…" : "Remove"}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
                {inventory.length === 0 && (
                    <div style={{ opacity: 0.7 }}>No items assigned.</div>
                )}
            </div>
        </div>
    );
}

const PLAYER_GEAR_SLOTS = [
    "weapon",
    "armor",
    "accessory",
    "slot4",
    "slot5",
    "slot6",
    "slot7",
    "slot8",
    "slot9",
    "slot10",
];
const PLAYER_GEAR_LABELS = {
    weapon: "Weapon",
    armor: "Armor",
    accessory: "Accessory",
    slot4: "Gear Slot 4",
    slot5: "Gear Slot 5",
    slot6: "Gear Slot 6",
    slot7: "Gear Slot 7",
    slot8: "Gear Slot 8",
    slot9: "Gear Slot 9",
    slot10: "Gear Slot 10",
};

function formatGearSlotLabel(key, index) {
    if (PLAYER_GEAR_LABELS[key]) return PLAYER_GEAR_LABELS[key];
    const cleaned = key.replace(/[-_]+/g, " ").trim();
    if (cleaned) {
        return cleaned
            .split(" ")
            .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
            .join(" ");
    }
    return `Gear Slot ${index}`;
}

function buildGearSlotOptions(player) {
    const seen = new Set();
    const options = [];
    const pushSlot = (value) => {
        if (!value || seen.has(value)) return;
        seen.add(value);
        options.push({ value, label: formatGearSlotLabel(value, options.length + 1) });
    };

    for (const key of PLAYER_GEAR_SLOTS) pushSlot(key);

    const rawSlots = player?.gear && typeof player.gear === "object" ? player.gear.slots : null;
    if (rawSlots && typeof rawSlots === "object") {
        for (const key of Object.keys(rawSlots)) {
            pushSlot(key);
            if (options.length >= PLAYER_GEAR_SLOTS.length) break;
        }
    }

    return options.slice(0, PLAYER_GEAR_SLOTS.length);
}

function buildGearState(player, slotOptions) {
    const raw = player?.gear && typeof player.gear === "object" ? player.gear : {};
    const slotsRaw = raw && typeof raw.slots === "object" ? raw.slots : {};
    const bagRaw = Array.isArray(raw.bag) ? raw.bag : [];
    const bagMap = new Map();

    const insert = (entry, forcedId) => {
        if (!entry || typeof entry !== "object") return null;
        const id =
            forcedId ||
            (typeof entry.id === "string" && entry.id
                ? entry.id
                : `${entry.name || "gear"}-${bagMap.size + 1}`);
        const normalized = {
            id,
            name: entry.name || "",
            type: entry.type || "",
            desc: entry.desc || "",
        };
        if (!bagMap.has(id)) {
            bagMap.set(id, normalized);
        } else {
            bagMap.set(id, { ...bagMap.get(id), ...normalized });
        }
        return id;
    };

    for (const entry of bagRaw) {
        insert(entry);
    }

    const slots = {};
    for (const opt of slotOptions) {
        const slotValue = opt.value;
        let itemId = null;
        const slotEntry = slotsRaw?.[slotValue];
        if (slotEntry && typeof slotEntry.itemId === "string" && slotEntry.itemId) {
            itemId = slotEntry.itemId;
            if (!bagMap.has(itemId) && slotEntry.item && typeof slotEntry.item === "object") {
                insert(slotEntry.item, itemId);
            }
        }
        if (!itemId && raw?.[slotValue] && typeof raw[slotValue] === "object") {
            itemId = insert(raw[slotValue]);
        }
        if (itemId && bagMap.has(itemId)) {
            slots[slotValue] = { itemId };
        } else {
            slots[slotValue] = null;
        }
    }

    return { bag: Array.from(bagMap.values()), slots };
}

function parseAssignmentKey(key, options) {
    const baseline = {};
    if (typeof key === "string" && key.length > 0) {
        for (const part of key.split("|")) {
            if (!part) continue;
            const [slot, value = ""] = part.split(":");
            if (slot) baseline[slot] = value;
        }
    }
    if (Array.isArray(options)) {
        for (const opt of options) {
            if (!Object.prototype.hasOwnProperty.call(baseline, opt.value)) {
                baseline[opt.value] = "";
            }
        }
    }
    return baseline;
}


function PlayerGearCard({ player, canEdit, gameId, onUpdate }) {
    const slotOptions = useMemo(() => buildGearSlotOptions(player), [player]);
    const playerId = player?.userId || "";

    const gearState = useMemo(() => buildGearState(player, slotOptions), [player, slotOptions]);
    const bag = gearState.bag;
    const slots = gearState.slots;

    const bagMap = useMemo(() => {
        const map = new Map();
        for (const item of bag) {
            if (!item || typeof item.id !== "string") continue;
            map.set(item.id, {
                id: item.id,
                name: item.name || "",
                type: item.type || "",
                desc: item.desc || "",
            });
        }
        return map;
    }, [bag]);

    const slotMemo = useMemo(() => {
        const assignments = {};
        const keyParts = [];
        for (const opt of slotOptions) {
            const slotValue = opt.value;
            const itemId = slots?.[slotValue]?.itemId;
            const resolved = itemId && bagMap.has(itemId) ? itemId : "";
            assignments[slotValue] = resolved;
            keyParts.push(`${slotValue}:${resolved}`);
        }
        return { assignments, key: keyParts.join("|") };
    }, [bagMap, slots, slotOptions]);

    const slotAssignments = slotMemo.assignments;
    const assignmentKey = slotMemo.key;

    const [slotDrafts, setSlotDrafts] = useState(() => parseAssignmentKey(assignmentKey, slotOptions));
    const [busySlot, setBusySlot] = useState(null);

    useEffect(() => {
        setSlotDrafts((prev) => {
            const baseline = parseAssignmentKey(assignmentKey, slotOptions);
            const same = slotOptions.every(
                (opt) => (prev[opt.value] || "") === (baseline[opt.value] || "")
            );
            return same ? prev : baseline;
        });
    }, [assignmentKey, slotOptions, playerId]);

    const handleSelectSlot = useCallback((slotValue, itemId) => {
        setSlotDrafts((prev) => {
            const next = { ...prev };
            next[slotValue] = itemId;
            return next;
        });
    }, []);

    const applySlot = useCallback(
        async (slotValue) => {
            if (!canEdit || !playerId) return;
            const targetId = slotDrafts[slotValue] || "";
            const payloadItem = targetId ? bagMap.get(targetId) : null;
            try {
                setBusySlot(slotValue);
                if (targetId && payloadItem) {
                    await Games.setPlayerGear(gameId, playerId, slotValue, {
                        itemId: targetId,
                        item: payloadItem,
                    });
                } else {
                    await Games.clearPlayerGear(gameId, playerId, slotValue);
                }
                await onUpdate();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusySlot(null);
            }
        },
        [bagMap, canEdit, gameId, onUpdate, playerId, slotDrafts]
    );

    const clearSlot = useCallback(
        async (slotValue) => {
            if (!canEdit || !playerId) return;
            try {
                setBusySlot(slotValue);
                await Games.clearPlayerGear(gameId, playerId, slotValue);
                await onUpdate();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusySlot(null);
            }
        },
        [canEdit, gameId, onUpdate, playerId]
    );

    const equippedCount = useMemo(
        () => slotOptions.reduce((sum, opt) => (slotAssignments[opt.value] ? sum + 1 : sum), 0),
        [slotAssignments, slotOptions]
    );
    const bagCount = bag.length;

    const playerLabel = player?.character?.name || `Player ${player?.userId?.slice?.(0, 6) || ""}`;
    const subtitleParts = [];
    if (player?.character?.profile?.class) {
        subtitleParts.push(player.character.profile.class);
    }
    if (player?.character?.resources?.level) {
        subtitleParts.push(`LV ${player.character.resources.level}`);
    }
    const subtitle = subtitleParts.join(" · ");

    return (
        <div className="card gear-overview-card">
            <div className="gear-overview-card__header">
                <div>
                    <div>
                        <b>{playerLabel || "Unnamed Player"}</b>
                    </div>
                    {subtitle && <div className="gear-overview-card__sub">{subtitle}</div>}
                </div>
                <div className="gear-overview-card__stats">
                    <span className="pill">Equipped {equippedCount}/{slotOptions.length}</span>
                    <span className="pill light">Stash {bagCount}</span>
                </div>
            </div>
            <p className="text-muted text-small">
                Equip cards keep battle-ready items visible. Spare weapons live in the Items → Gear Stash tab.
            </p>
            <div className="gear-card-grid">
                {slotOptions.map((opt, idx) => {
                    const currentId = slotAssignments[opt.value] || "";
                    const draftId = slotDrafts[opt.value] ?? "";
                    const currentItem = currentId ? bagMap.get(currentId) : null;
                    const queuedItem = draftId && draftId !== currentId ? bagMap.get(draftId) : null;
                    const hasDirty = (draftId || "") !== (currentId || "");
                    return (
                        <div key={opt.value} className="gear-slot-card">
                            <div className="gear-slot-card__header">
                                <span className="gear-slot-card__index">#{idx + 1}</span>
                                <div className="gear-slot-card__title-group">
                                    <span className="gear-slot-card__title">{opt.label}</span>
                                    {currentItem?.type && <span className="pill light">{currentItem.type}</span>}
                                </div>
                            </div>
                            <div className="gear-slot-card__body">
                                {currentItem ? (
                                    <>
                                        <div className="gear-slot-card__name">{currentItem.name}</div>
                                        {currentItem.desc && (
                                            <div className="gear-slot-card__desc">{currentItem.desc}</div>
                                        )}
                                    </>
                                ) : (
                                    <div className="gear-slot-card__empty">Slot is open for assignment.</div>
                                )}
                                {queuedItem && (
                                    <div className="gear-slot-card__queued">
                                        Ready to equip: <strong>{queuedItem.name || "Unnamed gear"}</strong>
                                    </div>
                                )}
                            </div>
                            <div className="gear-slot-card__controls">
                                <select
                                    value={draftId}
                                    onChange={(e) => handleSelectSlot(opt.value, e.target.value)}
                                    disabled={!canEdit || bag.length === 0 || busySlot === opt.value}
                                >
                                    <option value="">Unequipped</option>
                                    {bag.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.name || "Unnamed"}
                                            {item.type ? ` · ${item.type}` : ""}
                                        </option>
                                    ))}
                                </select>
                                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                    <button
                                        className="btn btn-small"
                                        onClick={() => applySlot(opt.value)}
                                        disabled={!canEdit || busySlot === opt.value || !hasDirty}
                                    >
                                        {busySlot === opt.value ? "…" : "Equip"}
                                    </button>
                                    {currentId && (
                                        <button
                                            className="btn ghost btn-small"
                                            onClick={() => clearSlot(opt.value)}
                                            disabled={!canEdit || busySlot === opt.value}
                                        >
                                            {busySlot === opt.value ? "…" : "Unequip"}
                                        </button>
                                    )}
                                </div>
                            </div>
                            <p className="gear-slot-card__hint text-muted text-small">
                                Stash more options from the Items tab, then select them here when battle prep begins.
                            </p>
                        </div>
                    );
                })}
                {slotOptions.length === 0 && (
                    <div className="gear-slot-card gear-slot-card--empty">
                        <div className="gear-slot-card__empty">No gear slots configured for this character.</div>
                    </div>
                )}
            </div>
        </div>
    );
}


function PlayerGearStashCard({ player, canEdit, gameId, onUpdate, libraryGear }) {
    const slotOptions = useMemo(() => buildGearSlotOptions(player), [player]);
    const playerId = player?.userId || "";

    const gearState = useMemo(() => buildGearState(player, slotOptions), [player, slotOptions]);
    const bag = gearState.bag;
    const slots = gearState.slots;

    const bagMap = useMemo(() => {
        const map = new Map();
        for (const item of bag) {
            if (!item || typeof item.id !== "string") continue;
            map.set(item.id, {
                id: item.id,
                name: item.name || "",
                type: item.type || "",
                desc: item.desc || "",
            });
        }
        return map;
    }, [bag]);

    const slotMemo = useMemo(() => {
        const assignments = {};
        for (const opt of slotOptions) {
            const slotValue = opt.value;
            const itemId = slots?.[slotValue]?.itemId;
            const resolved = itemId && bagMap.has(itemId) ? itemId : "";
            assignments[slotValue] = resolved;
        }
        return assignments;
    }, [bagMap, slots, slotOptions]);

    const [bagForm, setBagForm] = useState({ name: "", type: "", desc: "" });
    const [bagEditing, setBagEditing] = useState(null);
    const [bagBusy, setBagBusy] = useState(false);
    const [bagRowBusy, setBagRowBusy] = useState(null);
    const [bagSearch, setBagSearch] = useState("");
    const [libraryPick, setLibraryPick] = useState("");
    const [quickAddBusy, setQuickAddBusy] = useState(false);
    const [equipDrafts, setEquipDrafts] = useState({});
    const [equipBusy, setEquipBusy] = useState(null);

    const resetBagForm = useCallback(() => {
        setBagEditing(null);
        setBagForm({ name: "", type: "", desc: "" });
    }, []);

    useEffect(() => {
        resetBagForm();
        setBagSearch("");
        setLibraryPick("");
    }, [playerId, resetBagForm]);

    const editingEntry = bagEditing ? bagMap.get(bagEditing) : null;
    useEffect(() => {
        if (!bagEditing) return;
        if (!editingEntry) {
            resetBagForm();
            return;
        }
        setBagForm((prev) => {
            if (
                prev.name === (editingEntry.name || "") &&
                prev.type === (editingEntry.type || "") &&
                prev.desc === (editingEntry.desc || "")
            ) {
                return prev;
            }
            return {
                name: editingEntry.name || "",
                type: editingEntry.type || "",
                desc: editingEntry.desc || "",
            };
        });
    }, [bagEditing, editingEntry, resetBagForm]);

    const libraryOptions = useMemo(() => {
        const list = Array.isArray(libraryGear) ? libraryGear : [];
        return list.map((item, idx) => ({
            key: typeof item.id === "string" && item.id ? item.id : `library-${idx}`,
            item,
            label: `${item.name || "Untitled"}${item.type ? ` · ${item.type}` : ""}`,
        }));
    }, [libraryGear]);

    useEffect(() => {
        setLibraryPick((prev) => (libraryOptions.some((opt) => opt.key === prev) ? prev : ""));
    }, [libraryOptions]);

    useEffect(() => {
        setEquipDrafts((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const item of bag) {
                if (!item || typeof item.id !== "string") continue;
                const key = item.id;
                const assignedSlot = slotOptions.find((opt) => slotMemo[opt.value] === key)?.value || "";
                if (assignedSlot) {
                    if (next[key] !== assignedSlot) {
                        next[key] = assignedSlot;
                        changed = true;
                    }
                } else {
                    const current = next[key];
                    const slotTaken = current && slotMemo[current] && slotMemo[current] !== key;
                    if (!current || slotTaken) {
                        const firstOpen = slotOptions.find((opt) => !slotMemo[opt.value]);
                        const fallback = firstOpen ? firstOpen.value : "";
                        if (current !== fallback) {
                            next[key] = fallback;
                            changed = true;
                        }
                    }
                }
            }
            for (const key of Object.keys(next)) {
                if (!bagMap.has(key)) {
                    delete next[key];
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [bag, bagMap, slotMemo, slotOptions]);

    const normalizedSearch = bagSearch.trim().toLowerCase();
    const filteredBag = useMemo(() => {
        if (!normalizedSearch) return bag;
        return bag.filter((item) => {
            const value = `${item.name} ${item.type} ${item.desc}`.toLowerCase();
            return value.includes(normalizedSearch);
        });
    }, [bag, normalizedSearch]);

    const saveBagForm = useCallback(
        async () => {
            if (!canEdit || !playerId) return;
            const name = bagForm.name.trim();
            if (!name) {
                alert("Gear needs a name");
                return;
            }
            const payload = {
                name,
                type: bagForm.type.trim(),
                desc: bagForm.desc.trim(),
            };
            try {
                setBagBusy(true);
                if (bagEditing) {
                    await Games.updatePlayerGearBag(gameId, playerId, bagEditing, payload);
                } else {
                    await Games.addPlayerGearBag(gameId, playerId, payload);
                }
                await onUpdate();
                resetBagForm();
            } catch (e) {
                alert(e.message);
            } finally {
                setBagBusy(false);
            }
        },
        [bagEditing, bagForm.desc, bagForm.name, bagForm.type, canEdit, gameId, onUpdate, playerId, resetBagForm]
    );

    const removeBagItem = useCallback(
        async (item) => {
            if (!canEdit || !playerId) return;
            if (!item || typeof item.id !== "string") return;
            if (!confirm("Remove this gear from the stash? Equipped slots will be cleared.")) return;
            try {
                setBagRowBusy(item.id);
                await Games.deletePlayerGearBag(gameId, playerId, item.id);
                await onUpdate();
            } catch (e) {
                alert(e.message);
            } finally {
                setBagRowBusy(null);
            }
        },
        [canEdit, gameId, onUpdate, playerId]
    );

    const addFromLibrary = useCallback(async () => {
        if (!canEdit || !playerId) return;
        const option = libraryOptions.find((opt) => opt.key === libraryPick);
        if (!option) {
            alert("Pick gear to add first");
            return;
        }
        const payload = {
            name: option.item?.name || "",
            type: option.item?.type || "",
            desc: option.item?.desc || "",
        };
        try {
            setQuickAddBusy(true);
            await Games.addPlayerGearBag(gameId, playerId, payload);
            await onUpdate();
            setLibraryPick("");
        } catch (e) {
            alert(e.message);
        } finally {
            setQuickAddBusy(false);
        }
    }, [canEdit, gameId, libraryOptions, libraryPick, onUpdate, playerId]);

    const handleEquipItem = useCallback(
        async (item, slotValue) => {
            if (!canEdit || !playerId) return;
            if (!item || typeof item.id !== "string") return;
            if (!slotValue) {
                alert("Select a slot to equip this gear.");
                return;
            }
            try {
                setEquipBusy(`equip:${item.id}`);
                await Games.setPlayerGear(gameId, playerId, slotValue, { itemId: item.id, item });
                await onUpdate();
            } catch (e) {
                alert(e.message);
            } finally {
                setEquipBusy(null);
            }
        },
        [canEdit, gameId, onUpdate, playerId]
    );

    const handleUnequipSlot = useCallback(
        async (slotValue) => {
            if (!canEdit || !playerId) return;
            if (!slotValue) return;
            try {
                setEquipBusy(`clear:${slotValue}`);
                await Games.clearPlayerGear(gameId, playerId, slotValue);
                await onUpdate();
            } catch (e) {
                alert(e.message);
            } finally {
                setEquipBusy(null);
            }
        },
        [canEdit, gameId, onUpdate, playerId]
    );

    const bagFormDirty = bagEditing
        ? bagForm.name !== (editingEntry?.name || "") ||
          bagForm.type !== (editingEntry?.type || "") ||
          bagForm.desc !== (editingEntry?.desc || "")
        : !!(bagForm.name.trim() || bagForm.type.trim() || bagForm.desc.trim());
    const canSubmitBag = canEdit && !bagBusy && bagForm.name.trim();

    const playerLabel = player?.character?.name || `Player ${player?.userId?.slice?.(0, 6) || ""}`;
    const subtitleParts = [];
    if (player?.character?.profile?.class) subtitleParts.push(player.character.profile.class);
    if (player?.character?.resources?.level) subtitleParts.push(`LV ${player.character.resources.level}`);
    const subtitle = subtitleParts.join(" · ");

    return (
        <div className="card gear-stash-card">
            <div className="gear-stash-card__header">
                <div>
                    <div><b>{playerLabel || "Unnamed Player"}</b></div>
                    {subtitle && <div className="gear-stash-card__sub">{subtitle}</div>}
                </div>
                <span className="pill light">Stash items: {bag.length}</span>
            </div>
            <p className="text-muted text-small">
                This stash holds unequipped gear. Add new pieces here, then hop to the gear tab when it's time to slot them in.
            </p>

            <div className="gear-stash-actions">
                {canEdit && (
                    <>
                        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                            <select
                                value={libraryPick}
                                onChange={(e) => setLibraryPick(e.target.value)}
                                disabled={!canEdit || quickAddBusy}
                                style={{ minWidth: 200 }}
                            >
                                <option value="">Copy from gear library…</option>
                                {libraryOptions.map((opt) => (
                                    <option key={opt.key} value={opt.key}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                            <button className="btn btn-small" onClick={addFromLibrary} disabled={!canEdit || quickAddBusy}>
                                {quickAddBusy ? "…" : "Add to stash"}
                            </button>
                        </div>

                        <div className="gear-stash-form">
                            <input
                                placeholder={bagEditing ? "Edit gear name" : "Custom gear name"}
                                value={bagForm.name}
                                onChange={(e) => setBagForm((prev) => ({ ...prev, name: e.target.value }))}
                                disabled={!canEdit || bagBusy}
                            />
                            <input
                                placeholder="Type"
                                value={bagForm.type}
                                onChange={(e) => setBagForm((prev) => ({ ...prev, type: e.target.value }))}
                                disabled={!canEdit || bagBusy}
                            />
                            <textarea
                                rows={2}
                                placeholder="Notes"
                                value={bagForm.desc}
                                onChange={(e) => setBagForm((prev) => ({ ...prev, desc: e.target.value }))}
                                disabled={!canEdit || bagBusy}
                            />
                            <div className="row" style={{ gap: 6 }}>
                                <button className="btn" onClick={saveBagForm} disabled={!canSubmitBag}>
                                    {bagBusy ? "…" : bagEditing ? "Save gear" : "Add gear"}
                                </button>
                                {bagFormDirty && (
                                    <button className="btn ghost" onClick={resetBagForm} disabled={bagBusy}>
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                    </>
                )}
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input
                        placeholder="Search stash"
                        value={bagSearch}
                        onChange={(e) => setBagSearch(e.target.value)}
                        style={{ flex: 1, minWidth: 200 }}
                    />
                    {bagSearch && (
                        <button className="btn ghost btn-small" onClick={() => setBagSearch("")}>Clear</button>
                    )}
                </div>
            </div>

            <div className="list" style={{ gap: 12 }}>
                {filteredBag.map((item) => {
                    const equippedSlot = slotOptions.find((opt) => slotMemo[opt.value] === item.id) || null;
                    const draftSlot = equipDrafts[item.id] ?? (equippedSlot ? equippedSlot.value : "");
                    const equipDisabled = equipBusy !== null;
                    const busyEquipKey = equipBusy === `equip:${item.id}`;
                    const busyClearKey = equippedSlot ? equipBusy === `clear:${equippedSlot.value}` : false;
                    const isRowBusy = bagRowBusy === item.id;
                    return (
                        <div key={item.id} className="gear-stash-row">
                            <div className="gear-stash-row__info">
                                <div className="gear-stash-row__title">
                                    <b>{item.name || "Unnamed gear"}</b>
                                    {item.type && <span className="pill">{item.type}</span>}
                                    {equippedSlot && (
                                        <span className="pill success">Equipped · {equippedSlot.label}</span>
                                    )}
                                </div>
                                {item.desc && (
                                    <div className="gear-stash-row__desc">{item.desc}</div>
                                )}
                            </div>
                            <div className="gear-stash-row__actions">
                                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                    <select
                                        value={draftSlot}
                                        onChange={(e) =>
                                            setEquipDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                                        }
                                        disabled={!canEdit || equipDisabled}
                                    >
                                        <option value="">Choose a slot…</option>
                                        {slotOptions.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                                {slotMemo[opt.value] && slotMemo[opt.value] !== item.id ? " (occupied)" : ""}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        className="btn btn-small"
                                        onClick={() => handleEquipItem(item, draftSlot)}
                                        disabled={!canEdit || equipDisabled || !draftSlot}
                                    >
                                        {busyEquipKey ? "…" : "Equip"}
                                    </button>
                                    {equippedSlot && (
                                        <button
                                            className="btn ghost btn-small"
                                            onClick={() => handleUnequipSlot(equippedSlot.value)}
                                            disabled={!canEdit || equipDisabled}
                                        >
                                            {busyClearKey ? "…" : "Unequip"}
                                        </button>
                                    )}
                                </div>
                                {canEdit && (
                                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                        <button
                                            className="btn ghost btn-small"
                                            onClick={() => setBagEditing(item.id)}
                                            disabled={bagBusy || isRowBusy}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="btn danger btn-small"
                                            onClick={() => removeBagItem(item)}
                                            disabled={isRowBusy}
                                        >
                                            {isRowBusy ? "…" : "Remove"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                {filteredBag.length === 0 && (
                    <div style={{ opacity: 0.7 }}>
                        {bag.length === 0
                            ? "No unequipped gear yet. Add items from the library or craft new pieces above."
                            : "No gear matches your search."}
                    </div>
                )}
            </div>
        </div>
    );
}
// ---------- Gear ----------
function GearTab({ game, me, onUpdate }) {
    const [premade, setPremade] = useState([]);
    const [form, setForm] = useState({ name: "", type: "", desc: "" });
    const [editing, setEditing] = useState(null);
    const [busySave, setBusySave] = useState(false);
    const [busyRow, setBusyRow] = useState(null);
    const [selectedPlayerId, setSelectedPlayerId] = useState("");
    const gearTypes = ["weapon", "armor", "accessory"];

    const isDM = game.dmId === me.id;
    const canEdit = isDM || game.permissions?.canEditGear;

    const resetForm = useCallback(() => {
        setEditing(null);
        setForm({ name: "", type: "", desc: "" });
    }, []);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const data = await Items.premade();
                if (mounted) setPremade(Array.isArray(data) ? data : []);
            } catch (e) {
                console.error(e);
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        resetForm();
    }, [game.id, resetForm]);

    const save = async (item) => {
        if (!item?.name) return alert("Item needs a name");
        try {
            setBusySave(true);
            if (editing) {
                await Games.updateCustomGear(game.id, editing.id, item);
            } else {
                await Games.addCustomGear(game.id, item);
            }
            await onUpdate();
            resetForm();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusySave(false);
        }
    };

    const remove = async (itemId) => {
        if (!confirm("Remove this gear?")) return;
        try {
            setBusyRow(itemId);
            await Games.deleteCustomGear(game.id, itemId);
            if (editing?.id === itemId) resetForm();
            await onUpdate();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusyRow(null);
        }
    };

    const gearList = premade.filter((it) =>
        gearTypes.some((t) => it.type?.toLowerCase().startsWith(t))
    );
    const customGear = Array.isArray(game.gear?.custom) ? game.gear.custom : [];
    const players = (game.players || []).filter(
        (p) => (p?.role || "").toLowerCase() !== "dm"
    );

    const playerOptions = useMemo(
        () =>
            players.map((p, idx) => ({
                data: p,
                value: p.userId || `player-${idx}`,
                label:
                    p.character?.name?.trim() ||
                    `Player ${p.userId?.slice?.(0, 6) || ""}` ||
                    "Unnamed Player",
            })),
        [players]
    );

    useEffect(() => {
        if (!isDM) {
            setSelectedPlayerId("");
            return;
        }
        setSelectedPlayerId((prev) => {
            if (playerOptions.some((opt) => opt.value === prev)) return prev;
            const next = playerOptions[0]?.value || "";
            return prev === next ? prev : next;
        });
    }, [isDM, playerOptions]);

    const visiblePlayers = useMemo(() => {
        if (isDM) {
            if (!selectedPlayerId) return [];
            const match = playerOptions.find((opt) => opt.value === selectedPlayerId);
            return match ? [match.data] : [];
        }
        const self = players.find((p) => p.userId === me.id);
        return self ? [self] : [];
    }, [isDM, me.id, playerOptions, players, selectedPlayerId]);

    return (
        <div className="col" style={{ display: "grid", gap: 16 }}>
            <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div className="card" style={{ flex: 1, minWidth: 320 }}>
                    <h3>{editing ? "Edit Gear" : "Custom Gear"}</h3>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <input
                            placeholder="Name"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            style={{ flex: 1, minWidth: 180 }}
                        />
                        <input
                            placeholder="Type"
                            value={form.type}
                            onChange={(e) => setForm({ ...form, type: e.target.value })}
                        style={{ flex: 1, minWidth: 160 }}
                    />
                    <input
                        placeholder="Description"
                        value={form.desc}
                        onChange={(e) => setForm({ ...form, desc: e.target.value })}
                        style={{ flex: 2, minWidth: 220 }}
                    />
                    <div className="row" style={{ gap: 8 }}>
                        <button
                            className="btn"
                            disabled={!form.name || busySave || !canEdit}
                            onClick={() => save(form)}
                        >
                            {busySave ? "…" : editing ? "Save" : "Add"}
                        </button>
                            {editing && (
                                <button className="btn" onClick={resetForm} disabled={busySave}>
                                    Cancel
                                </button>
                            )}
                        </div>
                    </div>

                    <h4 style={{ marginTop: 16 }}>Game Custom Gear</h4>
                    <div className="list">
                        {customGear.map((it) => (
                            <div key={it.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                    <b>{it.name}</b> — {it.type || "—"}
                                    <div style={{ opacity: 0.85, fontSize: 12 }}>{it.desc}</div>
                                </div>
                                {canEdit && (
                                    <div className="row" style={{ gap: 6 }}>
                                        <button
                                            className="btn"
                                            onClick={() => {
                                                setEditing(it);
                                                setForm({ name: it.name || "", type: it.type || "", desc: it.desc || "" });
                                            }}
                                            disabled={busySave}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="btn"
                                            onClick={() => remove(it.id)}
                                            disabled={busyRow === it.id}
                                        >
                                            {busyRow === it.id ? "…" : "Remove"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                        {customGear.length === 0 && (
                            <div style={{ opacity: 0.7 }}>No custom gear yet.</div>
                        )}
                    </div>
                </div>

            <div className="card" style={{ width: 380 }}>
                <h3>Premade Gear</h3>
                <div className="list" style={{ maxHeight: 420, overflow: "auto" }}>
                    {gearList.map((it, idx) => (
                        <div
                            key={idx}
                            className="row"
                            style={{ justifyContent: "space-between", alignItems: "center" }}
                        >
                            <div>
                                <b>{it.name}</b> <span className="pill">{it.type || "—"}</span>
                                <div style={{ opacity: 0.8, fontSize: 12 }}>{it.desc}</div>
                            </div>
                            <button
                                className="btn"
                                disabled={!canEdit || busySave}
                                onClick={() => save({ name: it.name, type: it.type, desc: it.desc })}
                            >
                                Add
                            </button>
                        </div>
                    ))}
                    {gearList.length === 0 && <div style={{ opacity: 0.7 }}>No premade gear.</div>}
                </div>
            </div>

            </div>

            <div className="card">
                <h3>Player Gear</h3>
                {isDM && players.length > 0 && (
                    <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                        <label htmlFor="player-gear-picker" style={{ fontWeight: 600 }}>
                            Select player:
                        </label>
                        <select
                            id="player-gear-picker"
                            value={selectedPlayerId}
                            onChange={(e) => setSelectedPlayerId(e.target.value)}
                            style={{ minWidth: 200 }}
                        >
                            {!selectedPlayerId && <option value="">Choose a player…</option>}
                            {playerOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                {players.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>No players have joined yet.</div>
                ) : visiblePlayers.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>
                        {isDM
                            ? "Select a player to manage their gear."
                            : "No gear assigned to your character yet."}
                    </div>
                ) : (
                    <div className="list" style={{ gap: 12 }}>
                        {visiblePlayers.map((p) => (
                            <PlayerGearCard
                                key={p.userId}
                                player={p}
                                canEdit={
                                    isDM ||
                                    (game.permissions?.canEditGear && me.id === p.userId)
                                }
                                gameId={game.id}
                                onUpdate={onUpdate}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------- Demons ----------
function DemonTab({ game, me, onUpdate }) {
    const [name, setName] = useState("");
    const [arcana, setArc] = useState("");
    const [align, setAlign] = useState("");
    const [level, setLevel] = useState(1);
    const [stats, setStats] = useState(() => createAbilityMap(0));
    const [resist, setResist] = useState({ weak: "", resist: "", null: "", absorb: "", reflect: "" });
    const [skills, setSkills] = useState("");
    const [notes, setNotes] = useState("");
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const previewStats = useMemo(() => resolveAbilityState(selected?.stats ?? selected), [selected]);
    const previewMods = useMemo(() => (selected?.mods && typeof selected.mods === "object" ? selected.mods : {}), [selected]);
    const [editing, setEditing] = useState(null);
    const [busySave, setBusySave] = useState(false);
    const [busySearch, setBusySearch] = useState(false);
    const [busyDelete, setBusyDelete] = useState(null);

    const isDM = game.dmId === me.id;
    const canEdit = isDM || game.permissions?.canEditDemons;

    const resetForm = useCallback(() => {
        setName("");
        setArc("");
        setAlign("");
        setLevel(1);
        setStats(createAbilityMap(0));
        setResist({ weak: "", resist: "", null: "", absorb: "", reflect: "" });
        setSkills("");
        setNotes("");
        setSelected(null);
        setEditing(null);
    }, []);

    useEffect(() => {
        resetForm();
    }, [game.id, resetForm]);

    const save = async () => {
        if (!canEdit) return;
        if (!editing && !isDM) {
            alert("Only the DM can add new demons.");
            return;
        }
        if (!name.trim()) return alert("Enter a demon name");
        const payload = {
            name,
            arcana,
            alignment: align,
            level,
            stats,
            resistances: resist,
            skills,
            notes,
        };
        try {
            setBusySave(true);
            if (editing) {
                await Games.updateDemon(game.id, editing.id, payload);
            } else {
                await Games.addDemon(game.id, payload);
            }
            await onUpdate();
            resetForm();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusySave(false);
        }
    };

    const remove = async (id) => {
        if (!isDM) return;
        if (!confirm("Remove this demon from the pool?")) return;
        try {
            setBusyDelete(id);
            await Games.delDemon(game.id, id);
            if (editing?.id === id) resetForm();
            await onUpdate();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusyDelete(null);
        }
    };

    // Debounced search
    const debounceRef = useRef(0);
    const runSearch = useCallback(async () => {
        if (!isDM) {
            setBusySearch(false);
            setResults([]);
            return;
        }
        const term = q.trim();
        if (!term) {
            setResults([]);
            return;
        }
        const ticket = Date.now();
        debounceRef.current = ticket;
        try {
            setBusySearch(true);
            const r = await Personas.search(term);
            if (debounceRef.current === ticket) setResults(r || []);
        } catch (e) {
            alert(e.message);
        } finally {
            if (debounceRef.current === ticket) setBusySearch(false);
        }
    }, [isDM, q]);

    const pick = async (slug) => {
        if (!isDM) return;
        try {
            const p = await Personas.get(slug);
            setSelected(p);
            setName(p.name || "");
            setArc(p.arcana || "");
            setAlign(p.alignment || "");
            setLevel(p.level || 1);
            setStats(resolveAbilityState(p.stats ?? p));
            const resist = p.resistances || {};
            const formatList = (value, fallback) => {
                const list = value ?? fallback;
                if (Array.isArray(list)) return list.join(', ');
                if (typeof list === 'string') return list;
                return '';
            };
            setResist({
                weak: formatList(resist.weak, p.weak),
                resist: formatList(resist.resist, p.resists),
                null: formatList(resist.null, p.nullifies),
                absorb: formatList(resist.absorb, p.absorbs),
                reflect: formatList(resist.reflect, p.reflects),
            });
            setSkills(Array.isArray(p.skills) ? p.skills.join('\n') : "");
            setNotes(p.description || "");
        } catch (e) {
            alert(e.message);
        }
    };

    const startEdit = (demon) => {
        setEditing(demon);
        setName(demon.name || "");
        setArc(demon.arcana || "");
        setAlign(demon.alignment || "");
        setLevel(demon.level ?? 0);
        setStats(resolveAbilityState(demon.stats));
        const listToText = (primary, fallback) => {
            const formatted = formatResistanceList(primary, fallback);
            return formatted === '—' ? '' : formatted;
        };
        setResist({
            weak: listToText(demon.resistances?.weak, demon.weak),
            resist: listToText(demon.resistances?.resist, demon.resists),
            null: listToText(demon.resistances?.null, demon.nullifies),
            absorb: listToText(demon.resistances?.absorb, demon.absorbs),
            reflect: listToText(demon.resistances?.reflect, demon.reflects),
        });
        setSkills(Array.isArray(demon.skills) ? demon.skills.join('\n') : "");
        setNotes(demon.notes || "");
        setSelected(null);
    };

    return (
        <div className="card">
            <h3>Shared Demon Pool</h3>

            <div className="row" style={{ marginBottom: 10 }}>
                <span className="pill">
                    {game.demonPool?.used ?? 0}/{game.demonPool?.max ?? 0} used
                </span>
            </div>

            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 2, minWidth: 160 }} />
                <input placeholder="Arcana" value={arcana} onChange={(e) => setArc(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                <input placeholder="Alignment" value={align} onChange={(e) => setAlign(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                <input
                    type="number"
                    placeholder="Level"
                    value={level}
                    onChange={(e) => setLevel(Number(e.target.value || 0))}
                    style={{ width: 100 }}
                />
                <div className="row" style={{ gap: 8 }}>
                    <button
                        className="btn"
                        onClick={save}
                        disabled={!canEdit || busySave || (!editing && !isDM)}
                    >
                        {busySave ? "…" : editing || !isDM ? "Save Demon" : "Add Demon"}
                    </button>
                    {editing && (
                        <button className="btn" onClick={resetForm} disabled={busySave}>
                            Cancel
                        </button>
                    )}
                </div>
            </div>

            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {ABILITY_DEFS.map((ability) => {
                    const value = Number(stats[ability.key]) || 0;
                    const mod = abilityModifier(value);
                    return (
                        <label key={ability.key} className="col" style={{ minWidth: 110 }}>
                            <span>{ability.key}</span>
                            <input
                                type="number"
                                value={value}
                                onChange={(e) =>
                                    setStats((prev) => ({
                                        ...prev,
                                        [ability.key]: Number(e.target.value || 0),
                                    }))
                                }
                            />
                            <span className="text-small" style={{ color: 'var(--muted)' }}>
                                Mod {formatModifier(mod)}
                            </span>
                        </label>
                    );
                })}
            </div>

            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {[
                    ["weak", "Weak"],
                    ["resist", "Resist"],
                    ["null", "Null"],
                    ["absorb", "Absorb"],
                    ["reflect", "Reflect"],
                ].map(([key, label]) => (
                    <label key={key} className="col" style={{ minWidth: 150, flex: 1 }}>
                        <span>{label}</span>
                        <textarea
                            rows={2}
                            value={resist[key]}
                            placeholder="Comma or newline separated"
                            onChange={(e) => setResist((prev) => ({ ...prev, [key]: e.target.value }))}
                            style={{ width: '100%' }}
                        />
                    </label>
                ))}
            </div>

            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <label className="col" style={{ flex: 1, minWidth: 220 }}>
                    <span>Skills (one per line)</span>
                    <textarea rows={3} value={skills} onChange={(e) => setSkills(e.target.value)} style={{ width: '100%' }} />
                </label>
                <label className="col" style={{ flex: 1, minWidth: 220 }}>
                    <span>Notes</span>
                    <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%' }} />
                </label>
            </div>

            <div className="row" style={{ marginTop: 16, gap: 16, alignItems: "flex-start" }}>
                <div className="col" style={{ flex: 1 }}>
                    <h4>Lookup Persona (Persona Compendium)</h4>
                    {isDM ? (
                        <>
                            <div className="row" style={{ gap: 8 }}>
                                <input
                                    placeholder="Search name, e.g., jack frost"
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                                />
                                <button className="btn" onClick={runSearch} disabled={busySearch}>
                                    {busySearch ? "…" : "Search"}
                                </button>
                            </div>

                            <div className="list" style={{ maxHeight: 240, overflow: "auto", marginTop: 8 }}>
                                {results.map((r) => (
                                    <div
                                        key={r.slug}
                                        className="row"
                                        style={{ justifyContent: "space-between", alignItems: "center" }}
                                    >
                                        <div>{r.name}</div>
                                        <button className="btn" onClick={() => pick(r.slug)}>Use</button>
                                    </div>
                                ))}
                                {results.length === 0 && (
                                    <div style={{ opacity: 0.7 }}>{busySearch ? "Searching…" : "No results yet."}</div>
                                )}
                            </div>
                        </>
                    ) : (
                        <p className="text-muted text-small" style={{ marginTop: 4 }}>
                            Only the DM can search the compendium to add new demons.
                        </p>
                    )}
                </div>

                <div className="col" style={{ width: 360 }}>
                    <h4>Preview</h4>
                    {selected ? (
                        <div>
                            {selected.image && (
                                <img
                                    src={selected.image}
                                    alt={selected.name}
                                    style={{
                                        maxWidth: "100%",
                                        background: "#0b0c10",
                                        borderRadius: 12,
                                        border: "1px solid #1f2937",
                                    }}
                                />
                            )}
                            <div style={{ marginTop: 8 }}>
                                <b>{selected.name}</b> · {selected.arcana} · LV {selected.level}
                            </div>
                            <div style={{ opacity: 0.85, fontSize: 13, marginTop: 6 }}>
                                {selected.description}
                            </div>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                                    gap: 6,
                                    marginTop: 8,
                                }}
                            >
                                {ABILITY_DEFS.map((ability) => (
                                    <span key={ability.key} className="pill">
                                        {ability.key} {previewStats[ability.key]} ({formatModifier(previewMods[ability.key] ?? abilityModifier(previewStats[ability.key]))})
                                    </span>
                                ))}
                            </div>
                            <div style={{ marginTop: 8, fontSize: 12 }}>
                                <div><b>Weak:</b> {formatResistanceList(selected.resistances?.weak, selected.weak)}</div>
                                <div><b>Resist:</b> {formatResistanceList(selected.resistances?.resist, selected.resists)}</div>
                                <div><b>Null:</b> {formatResistanceList(selected.resistances?.null, selected.nullifies)}</div>
                                <div><b>Absorb:</b> {formatResistanceList(selected.resistances?.absorb, selected.absorbs)}</div>
                                <div><b>Reflect:</b> {formatResistanceList(selected.resistances?.reflect, selected.reflects)}</div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ opacity: 0.7 }}>Pick a persona to preview</div>
                    )}
                </div>
            </div>

            <div className="list" style={{ marginTop: 12, gap: 12 }}>
                {game.demons.map((d) => (
                    <div key={d.id} className="card" style={{ padding: 12 }}>
                        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                                <div><b>{d.name}</b> · {d.arcana ?? "—"} · {d.alignment ?? "—"}</div>
                                <div style={{ opacity: 0.75, fontSize: 12 }}>Level {d.level ?? 0}</div>
                            </div>
                            {canEdit && (
                                <div className="row" style={{ gap: 8 }}>
                                    <button className="btn" onClick={() => startEdit(d)} disabled={busySave}>
                                        Edit
                                    </button>
                                    {isDM && (
                                        <button
                                            className="btn"
                                            onClick={() => remove(d.id)}
                                            disabled={busyDelete === d.id}
                                        >
                                            {busyDelete === d.id ? "…" : "Remove"}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                            {ABILITY_DEFS.map((ability) => {
                                const score = Number((d.stats || {})[ability.key]) || 0;
                                const mod = d.mods?.[ability.key] ?? abilityModifier(score);
                                return (
                                    <span key={ability.key} className="pill">
                                        {ability.key} {score} ({formatModifier(mod)})
                                    </span>
                                );
                            })}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12 }}>
                            <div><b>Weak:</b> {formatResistanceList(d.resistances?.weak, d.weak)}</div>
                            <div><b>Resist:</b> {formatResistanceList(d.resistances?.resist, d.resists)}</div>
                            <div><b>Null:</b> {formatResistanceList(d.resistances?.null, d.nullifies)}</div>
                            <div><b>Absorb:</b> {formatResistanceList(d.resistances?.absorb, d.absorbs)}</div>
                            <div><b>Reflect:</b> {formatResistanceList(d.resistances?.reflect, d.reflects)}</div>
                        </div>
                        {Array.isArray(d.skills) && d.skills.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 12 }}>
                                <b>Skills:</b> {d.skills.join(', ')}
                            </div>
                        )}
                        {d.notes && (
                            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>{d.notes}</div>
                        )}
                    </div>
                ))}
                {game.demons.length === 0 && <div style={{ opacity: 0.7 }}>No demons in the pool yet.</div>}
            </div>
        </div>
    );
}



function HelpTab() {
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [activeDoc, setActiveDoc] = useState(null);
    const [docContent, setDocContent] = useState("");
    const [docLoading, setDocLoading] = useState(false);
    const [docError, setDocError] = useState("");

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        setError("");
        (async () => {
            try {
                const data = await Help.docs();
                if (!mounted) return;
                const list = Array.isArray(data) ? data : [];
                setDocs(list);
                if (list.length > 0) {
                    setActiveDoc((prev) => {
                        if (prev && list.some((doc) => doc.filename === prev.filename)) {
                            return prev;
                        }
                        return list[0];
                    });
                } else {
                    setActiveDoc(null);
                }
            } catch (e) {
                if (!mounted) return;
                setError(e?.message || "Unable to load help documents.");
                setDocs([]);
                setActiveDoc(null);
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (!activeDoc?.filename) {
            setDocContent("");
            return;
        }
        let cancelled = false;
        setDocLoading(true);
        setDocError("");
        (async () => {
            try {
                const content = await Help.getDoc(activeDoc.filename);
                if (cancelled) return;
                setDocContent(typeof content === "string" ? content : String(content ?? ""));
            } catch (e) {
                if (cancelled) return;
                setDocError(e?.message || "Unable to load this document.");
                setDocContent("");
            } finally {
                if (!cancelled) setDocLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [activeDoc]);

    const friendlyName = (doc) => {
        if (!doc?.name) return "Untitled";
        return doc.name.replace(/\.txt$/i, "");
    };

    return (
        <div className="help-layout">
            <aside className="help-sidebar">
                <h3>Help library</h3>
                <p className="text-muted text-small">
                    These reference files live in <code>txtdocs</code>. Pick a topic to open the matching .txt so
                    everyone sees the same table rulings.
                </p>
                {loading ? (
                    <div className="text-muted">Loading documents…</div>
                ) : error ? (
                    <div className="help-error">{error}</div>
                ) : docs.length === 0 ? (
                    <div className="text-muted">No reference docs were found in the <code>txtdocs</code> folder.</div>
                ) : (
                    <ul className="help-list">
                        {docs.map((doc) => {
                            const isActive = activeDoc?.filename === doc.filename;
                            return (
                                <li key={doc.filename}>
                                    <button
                                        type="button"
                                        className={`help-link${isActive ? " active" : ""}`}
                                        onClick={() => setActiveDoc(doc)}
                                    >
                                        {friendlyName(doc)}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </aside>
            <section className="help-content">
                {activeDoc ? (
                    <div className="help-doc">
                        <div className="help-doc__header">
                            <h3>{friendlyName(activeDoc)}</h3>
                            <span className="text-muted text-small">Source: {activeDoc.name}</span>
                        </div>
                        {docLoading ? (
                            <div className="text-muted">Opening document…</div>
                        ) : docError ? (
                            <div className="help-error">{docError}</div>
                        ) : (
                            <pre className="help-doc__body">{docContent || "This file is empty."}</pre>
                        )}
                    </div>
                ) : (
                    <div className="help-empty">
                        Select a document from the left to read it here. Need more? Drop .txt files into <code>txtdocs</code> and refresh.
                    </div>
                )}
            </section>
        </div>
    );
}
// ---------- Settings ----------
const PERMISSION_OPTIONS = [
    {
        key: "canEditStats",
        label: "Character sheets",
        description: "Allow players to edit their own stats, HP/MP, and background details.",
    },
    {
        key: "canEditItems",
        label: "Party inventory",
        description: "Let players add, update, or delete items from the shared inventory.",
    },
    {
        key: "canEditGear",
        label: "Equipment loadouts",
        description: "Let players swap or edit their own weapons, armor, and gear slots.",
    },
    {
        key: "canEditDemons",
        label: "Demon roster",
        description: "Allow players to manage demons they control, including stats and notes.",
    },
];

const PERMISSION_DEFAULTS = PERMISSION_OPTIONS.reduce((acc, option) => {
    acc[option.key] = false;
    return acc;
}, {});

function SettingsTab({ game, onUpdate, me, onDelete, onKickPlayer, onGameRefresh }) {
    const [perms, setPerms] = useState(() => ({
        ...PERMISSION_DEFAULTS,
        ...(game.permissions || {}),
    }));
    const [saving, setSaving] = useState(false);
    const [removingId, setRemovingId] = useState(null);
    const storyDefaults = useMemo(() => normalizeStorySettings(game.story), [game.story]);
    const [storyForm, setStoryForm] = useState(storyDefaults);
    const [storySaving, setStorySaving] = useState(false);

    useEffect(() => {
        setPerms({
            ...PERMISSION_DEFAULTS,
            ...(game.permissions || {}),
        });
        setRemovingId(null);
    }, [game.id, game.permissions]);

    useEffect(() => {
        setStoryForm(storyDefaults);
    }, [storyDefaults]);

    const removablePlayers = useMemo(
        () =>
            (game.players || []).filter(
                (p) => (p?.role || "").toLowerCase() !== "dm"
            ),
        [game.players]
    );

    const isDM = game.dmId === me?.id;
    const canKick = isDM && typeof onKickPlayer === "function";
    const canDelete = isDM && typeof onDelete === "function";

    const hasChanges = PERMISSION_OPTIONS.some(
        ({ key }) => !!(game.permissions?.[key]) !== !!perms[key]
    );
    const storyDirty = useMemo(
        () => JSON.stringify(storyForm) !== JSON.stringify(storyDefaults),
        [storyDefaults, storyForm]
    );

    return (
        <div className="card">
            <h3>Permissions</h3>
            <p className="text-muted text-small" style={{ marginTop: -4 }}>
                Decide which parts of the campaign your players can maintain themselves.
            </p>

            <div className="stack" style={{ marginTop: 12 }}>
                {PERMISSION_OPTIONS.map((option) => (
                    <label
                        key={option.key}
                        className={`perm-toggle${!isDM ? " is-readonly" : ""}`}
                    >
                        <input
                            type="checkbox"
                            checked={!!perms[option.key]}
                            disabled={!isDM || saving}
                            onChange={(e) =>
                                setPerms((prev) => ({
                                    ...prev,
                                    [option.key]: e.target.checked,
                                }))
                            }
                        />
                        <div className="perm-toggle__text">
                            <span className="perm-toggle__label">{option.label}</span>
                            <span className="text-muted text-small">{option.description}</span>
                        </div>
                    </label>
                ))}
            </div>

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
                <button
                    className="btn"
                    disabled={saving || !hasChanges}
                    onClick={async () => {
                        try {
                            setSaving(true);
                            const payload = PERMISSION_OPTIONS.reduce((acc, option) => {
                                acc[option.key] = !!perms[option.key];
                                return acc;
                            }, {});
                            await onUpdate(payload);
                            setPerms(payload);
                        } catch (e) {
                            alert(e.message);
                        } finally {
                            setSaving(false);
                        }
                    }}
                >
                    {saving ? "Saving…" : hasChanges ? "Save changes" : "Saved"}
                </button>
            </div>

            {isDM && (
                <>
                    <div className="divider" />
                    <div className="col" style={{ gap: 12 }}>
                        <h4>Discord story integration</h4>
                        <p className="text-muted text-small" style={{ marginTop: 0 }}>
                            Link your campaign to a Discord channel and webhook so the story tab can both read and post
                            updates.
                        </p>
                        <label className="field" style={{ display: "grid", gap: 4 }}>
                            <span className="text-small">Bot token</span>
                            <input
                                type="password"
                                value={storyForm.botToken}
                                onChange={(e) =>
                                    setStoryForm((prev) => ({ ...prev, botToken: e.target.value }))
                                }
                                placeholder="Paste the Discord bot token for this campaign"
                                autoComplete="off"
                                spellCheck={false}
                                disabled={storySaving}
                            />
                            <span className="text-muted text-small">
                                Each campaign can use its own bot token. The bot must have access to the configured channel.
                            </span>
                        </label>
                        <label className="field" style={{ display: "grid", gap: 4 }}>
                            <span className="text-small">Channel ID</span>
                            <input
                                type="text"
                                value={storyForm.channelId}
                                onChange={(e) =>
                                    setStoryForm((prev) => ({ ...prev, channelId: e.target.value }))
                                }
                                placeholder="e.g. 123456789012345678"
                                disabled={storySaving}
                            />
                        </label>
                        <label className="field" style={{ display: "grid", gap: 4 }}>
                            <span className="text-small">Guild ID (optional)</span>
                            <input
                                type="text"
                                value={storyForm.guildId}
                                onChange={(e) =>
                                    setStoryForm((prev) => ({ ...prev, guildId: e.target.value }))
                                }
                                placeholder="Needed for jump links if the webhook lives in another server"
                                disabled={storySaving}
                            />
                        </label>
                        <label className="field" style={{ display: "grid", gap: 4 }}>
                            <span className="text-small">Webhook URL</span>
                            <input
                                type="url"
                                value={storyForm.webhookUrl}
                                onChange={(e) =>
                                    setStoryForm((prev) => ({ ...prev, webhookUrl: e.target.value }))
                                }
                                placeholder="https://discord.com/api/webhooks/…"
                                disabled={storySaving}
                            />
                        </label>
                        <label className={`perm-toggle${storySaving ? " is-readonly" : ""}`}>
                            <input
                                type="checkbox"
                                checked={storyForm.allowPlayerPosts}
                                disabled={storySaving}
                                onChange={(e) =>
                                    setStoryForm((prev) => ({ ...prev, allowPlayerPosts: e.target.checked }))
                                }
                            />
                            <div className="perm-toggle__text">
                                <span className="perm-toggle__label">Allow players to post from the dashboard</span>
                                <span className="text-muted text-small">
                                    When enabled, players get a composer in the Story tab. They can only speak as themselves
                                    unless marked as Scribes.
                                </span>
                            </div>
                        </label>
                        <div className="col" style={{ gap: 8 }}>
                            <strong>Scribe access</strong>
                            <p className="text-muted text-small" style={{ marginTop: 0 }}>
                                Scribes can narrate as the outside storyteller instead of their character.
                            </p>
                            {removablePlayers.length === 0 ? (
                                <span className="text-muted text-small">No players have joined yet.</span>
                            ) : (
                                removablePlayers.map((player, index) => {
                                    if (!player?.userId) return null;
                                    const label =
                                        player.character?.name?.trim() ||
                                        player.username ||
                                        `Player ${index + 1}`;
                                    const checked = storyForm.scribeIds.includes(player.userId);
                                    return (
                                        <label key={player.userId} className="perm-toggle">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={storySaving}
                                                onChange={(e) => {
                                                    setStoryForm((prev) => {
                                                        const next = new Set(prev.scribeIds);
                                                        if (e.target.checked) {
                                                            next.add(player.userId);
                                                        } else {
                                                            next.delete(player.userId);
                                                        }
                                                        return {
                                                            ...prev,
                                                            scribeIds: Array.from(next).sort(),
                                                        };
                                                    });
                                                }}
                                            />
                                            <div className="perm-toggle__text">
                                                <span className="perm-toggle__label">{label}</span>
                                                {player.username && (
                                                    <span className="text-muted text-small">@{player.username}</span>
                                                )}
                                            </div>
                                        </label>
                                    );
                                })
                            )}
                        </div>
                        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                            <button
                                className="btn"
                                disabled={storySaving || !storyDirty}
                                onClick={async () => {
                                    try {
                                        setStorySaving(true);
                                        const payload = {
                                            channelId: storyForm.channelId.trim(),
                                            guildId: storyForm.guildId.trim(),
                                            webhookUrl: storyForm.webhookUrl.trim(),
                                            botToken: storyForm.botToken.trim(),
                                            allowPlayerPosts: storyForm.allowPlayerPosts,
                                            scribeIds: storyForm.scribeIds,
                                        };
                                        const result = await StoryLogs.configure(game.id, payload);
                                        setStoryForm(normalizeStorySettings(result?.story));
                                        if (typeof onGameRefresh === "function") {
                                            await onGameRefresh();
                                        }
                                    } catch (e) {
                                        alert(e.message);
                                    } finally {
                                        setStorySaving(false);
                                    }
                                }}
                            >
                                {storySaving ? "Saving…" : storyDirty ? "Save story settings" : "Saved"}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {canKick && (
                <>
                    <div className="divider" />
                    <div className="col" style={{ gap: 12 }}>
                        <h4>Campaign members</h4>
                        <p style={{ color: "var(--muted)", marginTop: 0 }}>
                            Remove players from the campaign if they should no longer have
                            access.
                        </p>
                        <div className="list">
                            {removablePlayers.length === 0 ? (
                                <span className="text-muted text-small">
                                    No players have joined yet.
                                </span>
                            ) : (
                                removablePlayers.map((player, index) => {
                                    const name =
                                        player.character?.name?.trim() ||
                                        player.username ||
                                        `Player ${index + 1}`;
                                    const subtitleParts = [];
                                    if (player.username) {
                                        subtitleParts.push(`@${player.username}`);
                                    }
                                    const charClass = player.character?.profile?.class;
                                    if (charClass) subtitleParts.push(charClass);
                                    const subtitle = subtitleParts.join(" · ");
                                    const isBusy = removingId === player.userId;

                                    return (
                                        <div
                                            key={player.userId || `player-${index}`}
                                            className="row"
                                            style={{
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                gap: 12,
                                            }}
                                        >
                                            <div className="col" style={{ gap: 2 }}>
                                                <strong>{name}</strong>
                                                {subtitle && (
                                                    <span className="text-muted text-small">
                                                        {subtitle}
                                                    </span>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                className="btn danger btn-small"
                                                disabled={removingId !== null}
                                                onClick={async () => {
                                                    if (!canKick || typeof onKickPlayer !== "function") {
                                                        return;
                                                    }
                                                    if (!player?.userId) return;
                                                    const confirmName =
                                                        player.character?.name?.trim() ||
                                                        player.username ||
                                                        "this player";
                                                    if (
                                                        !confirm(
                                                            `Remove ${confirmName} from the campaign? They will lose access to this game.`
                                                        )
                                                    ) {
                                                        return;
                                                    }
                                                    try {
                                                        setRemovingId(player.userId);
                                                        await onKickPlayer(player.userId);
                                                    } catch (e) {
                                                        alert(e.message);
                                                    } finally {
                                                        setRemovingId(null);
                                                    }
                                                }}
                                            >
                                                {isBusy ? "Removing…" : "Remove"}
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </>
            )}

            {canDelete && (
                <>
                    <div className="divider" />
                    <div className="col" style={{ gap: 12 }}>
                        <h4>Danger Zone</h4>
                        <p style={{ color: "var(--muted)", marginTop: 0 }}>
                            Deleting this game will remove all characters, inventory, and invites
                            for every player.
                        </p>
                        <button className="btn danger" onClick={onDelete}>
                            Delete Game
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

// ---------- Utils ----------
function get(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function deepClone(x) {
    if (typeof structuredClone === "function") return structuredClone(x);
    return JSON.parse(JSON.stringify(x));
}
