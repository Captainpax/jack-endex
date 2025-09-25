// --- FILE: web/src/App.jsx ---
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, Auth, Games, Help, Items, Personas, StoryLogs, onApiActivity } from "./api";

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});

const DEMON_IMAGE_FALLBACK_BASES = [
    "https://static.megatenwiki.com",
    "https://megatenwiki.miraheze.org",
    "https://static.miraheze.org/megatenwiki",
    "https://static.miraheze.org/megatenwikiwiki",
    "https://static.wikia.nocookie.net/megamitensei",
];
const DEMON_IMAGE_FILE_RE = /\.(?:png|jpe?g|gif|webp|svg)$/i;
const DEMON_IMAGE_PROXY_ORIGINS = [
    "megatenwiki.com",
    "www.megatenwiki.com",
    "static.megatenwiki.com",
    "megatenwiki.miraheze.org",
    "static.miraheze.org",
    "static.wikia.nocookie.net",
];

function shouldProxyDemonImage(url) {
    if (typeof url !== "string") return false;
    const trimmed = url.trim();
    if (!trimmed || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return false;
    if (!/^https?:/i.test(trimmed) && !trimmed.startsWith("//")) return false;
    let parsed;
    try {
        parsed = new URL(trimmed, "https://megatenwiki.com/");
    } catch {
        return false;
    }
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    const host = (parsed.host || "").toLowerCase();
    if (!host) return false;
    return DEMON_IMAGE_PROXY_ORIGINS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function createProxiedImageSource(url) {
    return `/api/personas/image-proxy?src=${encodeURIComponent(url)}`;
}

function finalizeDemonImageSources(sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
        return EMPTY_ARRAY;
    }

    const finalSources = [];
    const pushSource = (value) => {
        if (!value) return;
        const normalized = value.trim();
        if (!normalized) return;
        if (finalSources.includes(normalized)) return;
        finalSources.push(normalized);
    };

    for (const source of sources) {
        if (shouldProxyDemonImage(source)) {
            pushSource(createProxiedImageSource(source));
        }
        pushSource(source);
    }

    return finalSources;
}

function computeDemonImageSources(imageUrl, { personaSlug } = {}) {
    const trimmed = typeof imageUrl === "string" ? imageUrl.trim() : "";
    const slug = typeof personaSlug === "string" ? personaSlug.trim() : "";

    const sources = [];
    const seen = new Set();
    const addSource = (value) => {
        if (!value) return;
        const normalized = value.trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        sources.push(normalized);
    };

    if (slug) {
        addSource(`/api/personas/${encodeURIComponent(slug)}/image`);
    }

    if (!trimmed) {
        return finalizeDemonImageSources(sources);
    }

    addSource(trimmed);

    const isDataUrl = /^data:/i.test(trimmed);
    const isBlobUrl = /^blob:/i.test(trimmed);
    const isFileScheme = /^file:/i.test(trimmed);
    const isSpecialScheme = /^special:filepath\//i.test(trimmed);

    let fileName = "";
    if (isFileScheme) {
        fileName = trimmed.slice(trimmed.indexOf(":") + 1).split(/[?#]/)[0].trim();
    } else if (isSpecialScheme) {
        fileName = trimmed.slice(trimmed.indexOf("/") + 1).split(/[?#]/)[0].trim();
    } else if (/^images\//i.test(trimmed)) {
        fileName = trimmed.split("/").pop()?.split(/[?#]/)[0].trim() || "";
    } else if (!trimmed.includes("://")) {
        fileName = trimmed.split(/[/?#]/).pop()?.trim() || "";
    }

    let parsed = null;
    let parsedHost = "";
    const shouldAddSpecialFallback = () => {
        if (!fileName) return false;
        if (isFileScheme || isSpecialScheme || /^images\//i.test(trimmed) || !trimmed.includes("://")) {
            if (!DEMON_IMAGE_FILE_RE.test(fileName) && !(isFileScheme || isSpecialScheme)) {
                return false;
            }
            return true;
        }
        if (!DEMON_IMAGE_FILE_RE.test(fileName)) return false;
        if (!parsedHost) return false;
        return /megaten|persona|nocookie|atlus/i.test(parsedHost);
    };
    const addSpecialFallback = () => {
        if (!shouldAddSpecialFallback()) return;
        addSource(`https://megatenwiki.com/wiki/Special:FilePath/${fileName}`);
    };

    if (isFileScheme && fileName) {
        addSpecialFallback();
        try {
            parsed = new URL(`https://megatenwiki.com/wiki/Special:FilePath/${fileName}`);
        } catch {
            parsed = null;
        }
    } else {
        try {
            parsed = new URL(trimmed);
            addSource(parsed.toString());
        } catch {
            if (!isDataUrl && !isBlobUrl) {
                if (isSpecialScheme && fileName) {
                    const specialUrl = `https://megatenwiki.com/wiki/${trimmed}`;
                    addSource(specialUrl);
                    try {
                        parsed = new URL(specialUrl);
                    } catch {
                        parsed = null;
                    }
                }
                if (!parsed) {
                    try {
                        parsed = new URL(trimmed, "https://megatenwiki.com/");
                        addSource(parsed.toString());
                    } catch {
                        parsed = null;
                    }
                }
            }
        }
    }

    if (!parsed) {
        addSpecialFallback();
        return finalizeDemonImageSources(sources);
    }

    const { protocol, host, pathname, search, hash } = parsed;
    parsedHost = (host || "").toLowerCase();

    if (protocol === "http:") {
        addSource(`https://${host}${pathname}${search}${hash}`);
    }

    if (!fileName) {
        const segment = pathname.split("/").filter(Boolean).pop();
        if (segment) {
            fileName = segment.split(/[?#]/)[0];
        }
    }

    let imagePath = "";
    const pathMatch = pathname.match(/(\/images\/[^?#]+)/i);
    if (pathMatch) {
        imagePath = pathMatch[1];
    } else if (/^images\//i.test(trimmed)) {
        imagePath = `/${trimmed.replace(/^\/+/, "")}`;
    } else {
        const trimmedMatch = trimmed.match(/(\/images\/[^?#]+)/i);
        if (trimmedMatch) {
            imagePath = trimmedMatch[1];
        }
    }

    if (imagePath) {
        for (const base of DEMON_IMAGE_FALLBACK_BASES) {
            addSource(`${base}${imagePath}`);
        }
    }

    if (fileName) {
        addSpecialFallback();
    }

    return finalizeDemonImageSources(sources);
}

function DemonImage({
    src,
    alt,
    personaSlug,
    onError,
    crossOrigin: crossOriginProp,
    referrerPolicy: referrerPolicyProp,
    ...imgProps
}) {
    const sources = useMemo(() => computeDemonImageSources(src, { personaSlug }), [src, personaSlug]);
    const [index, setIndex] = useState(0);

    useEffect(() => {
        setIndex(0);
    }, [sources]);

    const handleError = useCallback(
        (event) => {
            if (index < sources.length - 1) {
                setIndex((prev) => prev + 1);
            } else if (onError) {
                onError(event);
            }
        },
        [index, onError, sources.length],
    );

    if (sources.length === 0) {
        return null;
    }

    const crossOrigin = crossOriginProp ?? "anonymous";
    const referrerPolicy = referrerPolicyProp ?? "no-referrer";

    return (
        <img
            {...imgProps}
            alt={alt}
            src={sources[index]}
            onError={handleError}
            crossOrigin={crossOrigin}
            referrerPolicy={referrerPolicy}
        />
    );
}

function normalizeMediaSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;
    const videoId = typeof snapshot.videoId === "string" ? snapshot.videoId.trim() : "";
    const playing = !!snapshot.playing && videoId.length > 0;
    if (!playing) return null;
    const startRaw = Number(snapshot.startSeconds);
    const startSeconds = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0;
    const url = typeof snapshot.url === "string" ? snapshot.url : "";
    const updatedAt = typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : new Date().toISOString();
    return { videoId, startSeconds, url, updatedAt };
}

function normalizeAlertEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const id = typeof entry.id === "string" ? entry.id : null;
    const message = typeof entry.message === "string" ? entry.message.trim() : "";
    if (!id || !message) return null;
    const senderName = typeof entry.senderName === "string" && entry.senderName.trim()
        ? entry.senderName.trim()
        : "Dungeon Master";
    const issuedAt = typeof entry.issuedAt === "string" ? entry.issuedAt : new Date().toISOString();
    return { id, message, senderName, issuedAt, senderId: entry.senderId || null };
}

function normalizePrimaryBot(primaryBot) {
    if (!primaryBot || typeof primaryBot !== "object") {
        return {
            available: false,
            inviteUrl: "",
            applicationId: "",
            defaultGuildId: "",
            defaultChannelId: "",
        };
    }

    const inviteUrl = typeof primaryBot.inviteUrl === "string" ? primaryBot.inviteUrl : "";
    const applicationId = typeof primaryBot.applicationId === "string" ? primaryBot.applicationId : "";
    const defaultGuildId = typeof primaryBot.defaultGuildId === "string" ? primaryBot.defaultGuildId : "";
    const defaultChannelId = typeof primaryBot.defaultChannelId === "string"
        ? primaryBot.defaultChannelId
        : "";

    return {
        available: !!primaryBot.available,
        inviteUrl,
        applicationId,
        defaultGuildId,
        defaultChannelId,
    };
}

const DM_NAV = [
    {
        key: "overview",
        label: "DM Overview",
        description: "Monitor the party at a glance",
    },
    {
        key: "map",
        label: "Battle Map",
        description: "Sketch encounters and track tokens",
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
        key: "combatSkills",
        label: "Combat Skills",
        description: "Build combat formulas and helpers",
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
        key: "map",
        label: "Battle Map",
        description: "Follow encounters in real time",
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
        key: "combatSkills",
        label: "Combat Skills",
        description: "Damage calculators and tier references",
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

const GEAR_TYPE_KEYWORDS = ["weapon", "armor", "accessory"];
const GEAR_TYPE_PATTERNS = GEAR_TYPE_KEYWORDS.map((keyword) => new RegExp(`\\b${keyword}\\b`, "i"));

function isGearCategory(type) {
    if (typeof type !== "string") return false;
    return GEAR_TYPE_PATTERNS.some((pattern) => pattern.test(type));
}

function formatHealingEffect(healing) {
    if (!healing || typeof healing !== "object") return "";
    const parts = [];
    const hasHpPercent = typeof healing.hpPercent === "number" && healing.hpPercent > 0;
    const hasHpFlat = typeof healing.hp === "number" && healing.hp > 0;
    const hasMpPercent = typeof healing.mpPercent === "number" && healing.mpPercent > 0;
    const hasMpFlat = typeof healing.mp === "number" && healing.mp > 0;

    if (healing.revive === "full") {
        parts.push("Revives to full HP");
    } else if (healing.revive === "partial") {
        if (hasHpPercent) {
            parts.push(`Revives with ${healing.hpPercent}% HP`);
        } else if (hasHpFlat) {
            parts.push(`Revives with ${healing.hp} HP`);
        } else {
            parts.push("Revives");
        }
    }

    if (hasHpPercent && (!healing.revive || healing.revive === "full")) {
        parts.push(`Restores ${healing.hpPercent}% HP`);
    }
    if (hasHpFlat && (!healing.revive || healing.revive === "full")) {
        parts.push(`Restores ${healing.hp} HP`);
    }
    if (hasMpPercent) {
        parts.push(`Restores ${healing.mpPercent}% MP`);
    }
    if (hasMpFlat) {
        parts.push(`Restores ${healing.mp} MP`);
    }

    return parts.join(" · ");
}

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
    const [onlineUsers, setOnlineUsers] = useState(() => ({}));
    const [mediaState, setMediaState] = useState(null);
    const [mediaError, setMediaError] = useState(null);
    const [alerts, setAlerts] = useState([]);
    const [alertError, setAlertError] = useState(null);
    const refreshRef = useRef(refreshGame);
    const refreshPromiseRef = useRef(null);
    const refreshQueuedRef = useRef(false);
    const gameDeletedRef = useRef(onGameDeleted);
    const alertTimersRef = useRef(new Map());

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
                case "media:state": {
                    if (msg.gameId !== gameId) return;
                    const snapshot = normalizeMediaSnapshot(msg.media);
                    setMediaState(snapshot);
                    setMediaError(null);
                    break;
                }
                case "media:error":
                    if (msg.gameId !== gameId) return;
                    setMediaError(typeof msg.error === "string" ? msg.error : "Media command failed");
                    break;
                case "alert:show": {
                    if (msg.gameId !== gameId) return;
                    const entry = normalizeAlertEntry(msg.alert);
                    if (!entry) return;
                    setAlerts((prev) => {
                        const next = prev.filter((item) => item.id !== entry.id);
                        next.push(entry);
                        return next.slice(-5);
                    });
                    if (typeof window !== "undefined") {
                        const existing = alertTimersRef.current.get(entry.id);
                        if (existing) {
                            clearTimeout(existing);
                        }
                        const timer = window.setTimeout(() => {
                            setAlerts((prev) => prev.filter((item) => item.id !== entry.id));
                            alertTimersRef.current.delete(entry.id);
                        }, 20_000);
                        alertTimersRef.current.set(entry.id, timer);
                    }
                    setAlertError(null);
                    break;
                }
                case "alert:error":
                    if (msg.gameId !== gameId) return;
                    setAlertError(typeof msg.error === "string" ? msg.error : "Alert failed");
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
                case "presence:state": {
                    if (msg.gameId !== gameId) return;
                    const list = Array.isArray(msg.online) ? msg.online : EMPTY_ARRAY;
                    setOnlineUsers(() => {
                        const next = {};
                        for (const entry of list) {
                            if (typeof entry === "string" && entry) {
                                next[entry] = true;
                            }
                        }
                        return next;
                    });
                    break;
                }
                case "presence:update":
                    if (msg.gameId !== gameId) return;
                    if (typeof msg.userId !== "string" || !msg.userId) return;
                    setOnlineUsers((prev) => {
                        const next = { ...prev };
                        if (msg.online) {
                            next[msg.userId] = true;
                        } else {
                            delete next[msg.userId];
                        }
                        return next;
                    });
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
                    setOnlineUsers(() => ({}));
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
        setOnlineUsers(() => ({}));
        latestStoryRef.current = null;
        connect();

        const timers = alertTimersRef.current;
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
            setOnlineUsers(() => ({}));
            setMediaState(null);
            setMediaError(null);
            setAlerts([]);
            setAlertError(null);
            if (typeof window !== "undefined") {
                for (const timer of timers.values()) {
                    clearTimeout(timer);
                }
            }
            timers.clear();
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

    const syncMedia = useCallback((snapshot) => {
        setMediaState(normalizeMediaSnapshot(snapshot));
        setMediaError(null);
    }, []);

    const playMedia = useCallback(
        (url) => {
            if (!gameId) throw new Error("missing_game");
            const trimmed = typeof url === "string" ? url.trim() : "";
            if (!trimmed) throw new Error("missing_url");
            setMediaError(null);
            sendMessage({ type: "media.play", gameId, url: trimmed });
        },
        [gameId, sendMessage]
    );

    const stopMedia = useCallback(() => {
        if (!gameId) return;
        setMediaError(null);
        sendMessage({ type: "media.stop", gameId });
    }, [gameId, sendMessage]);

    const sendAlertMessage = useCallback(
        (message) => {
            if (!gameId) throw new Error("missing_game");
            const trimmed = typeof message === "string" ? message.trim() : "";
            if (!trimmed) throw new Error("missing_message");
            setAlertError(null);
            sendMessage({ type: "alert.broadcast", gameId, message: trimmed });
        },
        [gameId, sendMessage]
    );

    const dismissAlert = useCallback((alertId) => {
        if (!alertId) return;
        setAlerts((prev) => prev.filter((entry) => entry.id !== alertId));
        if (typeof window !== "undefined") {
            const timer = alertTimersRef.current.get(alertId);
            if (timer) {
                clearTimeout(timer);
                alertTimersRef.current.delete(alertId);
            }
        }
    }, []);

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
        onlineUsers,
        mediaState,
        mediaError,
        syncMedia,
        playMedia,
        stopMedia,
        alerts,
        alertError,
        sendAlert: sendAlertMessage,
        dismissAlert,
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

const ABILITY_SORT_INDEX = ABILITY_DEFS.reduce((map, ability, index) => {
    map[ability.key] = index;
    return map;
}, {});

const DEMON_RESISTANCE_SORTS = [
    { key: "weak", label: "Weakness slots (fewest → most)", direction: "asc" },
    { key: "resist", label: "Resistances (most → fewest)", direction: "desc" },
    { key: "null", label: "Nullifications (most → fewest)", direction: "desc" },
    { key: "absorb", label: "Absorptions (most → fewest)", direction: "desc" },
    { key: "reflect", label: "Reflections (most → fewest)", direction: "desc" },
];

const DEMON_SORT_OPTIONS = [
    { value: "name", label: "Name (A → Z)" },
    { value: "arcana", label: "Arcana (A → Z)" },
    { value: "levelHigh", label: "Level (high → low)" },
    { value: "levelLow", label: "Level (low → high)" },
    ...ABILITY_DEFS.map((ability) => ({
        value: `stat:${ability.key}`,
        label: `${ability.label} (high → low)`,
    })),
    ...DEMON_RESISTANCE_SORTS.map((entry) => ({
        value: `resist:${entry.key}`,
        label: entry.label,
    })),
    { value: "skillCount", label: "Skills (most → fewest)" },
];

const COMBAT_TIER_ORDER = ["WEAK", "MEDIUM", "HEAVY", "SEVERE"];
const COMBAT_TIER_INDEX = COMBAT_TIER_ORDER.reduce((map, tier, index) => {
    map[tier] = index;
    return map;
}, {});
const COMBAT_TIER_LABELS = {
    WEAK: "Weak",
    MEDIUM: "Medium",
    HEAVY: "Heavy",
    SEVERE: "Severe",
};
const COMBAT_TIER_INFO = {
    WEAK: { label: "Weak", dice: "1d6", modMultiplier: 1 },
    MEDIUM: { label: "Medium", dice: "2d8", modMultiplier: 2 },
    HEAVY: { label: "Heavy", dice: "3d12", modMultiplier: 3 },
    SEVERE: { label: "Severe", dice: "4d20", modMultiplier: 4 },
};

const COMBAT_CATEGORY_OPTIONS = [
    { value: "physical", label: "Physical" },
    { value: "gun", label: "Gun" },
    { value: "spell", label: "Spell" },
    { value: "support", label: "Support" },
    { value: "hybrid", label: "Hybrid / Other" },
];
const COMBAT_CATEGORY_ALIASES = {
    physical: "physical",
    phys: "physical",
    melee: "physical",
    gun: "gun",
    ranged: "gun",
    shoot: "gun",
    spell: "spell",
    magic: "spell",
    caster: "spell",
    support: "support",
    buff: "support",
    heal: "support",
    hybrid: "hybrid",
    other: "hybrid",
    tech: "hybrid",
};
const COMBAT_CATEGORY_INDEX = COMBAT_CATEGORY_OPTIONS.reduce((map, option, index) => {
    map[option.value] = index;
    return map;
}, {});
const COMBAT_CATEGORY_LABELS = COMBAT_CATEGORY_OPTIONS.reduce((map, option) => {
    map[option.value] = option.label;
    return map;
}, {});
const DEFAULT_COMBAT_CATEGORY = COMBAT_CATEGORY_OPTIONS[0]?.value || "physical";

const NEW_COMBAT_SKILL_ID = "__new_combat_skill__";

function compareByNameAsc(a, b) {
    return a.label.localeCompare(b.label);
}

function compareByNameDesc(a, b) {
    return b.label.localeCompare(a.label);
}

function compareByAbilityAsc(a, b) {
    const aIndex = ABILITY_SORT_INDEX[a.ability] ?? 999;
    const bIndex = ABILITY_SORT_INDEX[b.ability] ?? 999;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return compareByNameAsc(a, b);
}

function compareByAbilityDesc(a, b) {
    const aIndex = ABILITY_SORT_INDEX[a.ability] ?? -1;
    const bIndex = ABILITY_SORT_INDEX[b.ability] ?? -1;
    if (aIndex !== bIndex) return bIndex - aIndex;
    return compareByNameDesc(a, b);
}

function compareByTierAsc(a, b) {
    const aIndex = COMBAT_TIER_INDEX[a.tier] ?? 0;
    const bIndex = COMBAT_TIER_INDEX[b.tier] ?? 0;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return compareByNameAsc(a, b);
}

function compareByTierDesc(a, b) {
    const aIndex = COMBAT_TIER_INDEX[a.tier] ?? 0;
    const bIndex = COMBAT_TIER_INDEX[b.tier] ?? 0;
    if (aIndex !== bIndex) return bIndex - aIndex;
    return compareByNameAsc(a, b);
}

function compareByCategoryAsc(a, b) {
    const aIndex = COMBAT_CATEGORY_INDEX[a.category] ?? 999;
    const bIndex = COMBAT_CATEGORY_INDEX[b.category] ?? 999;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return compareByNameAsc(a, b);
}

function compareByCategoryDesc(a, b) {
    const aIndex = COMBAT_CATEGORY_INDEX[a.category] ?? -1;
    const bIndex = COMBAT_CATEGORY_INDEX[b.category] ?? -1;
    if (aIndex !== bIndex) return bIndex - aIndex;
    return compareByNameAsc(a, b);
}

const WORLD_SKILL_SORT_OPTIONS = [
    { value: "default", label: "Default order" },
    { value: "nameAsc", label: "Name (A → Z)" },
    { value: "nameDesc", label: "Name (Z → A)" },
    { value: "abilityAsc", label: "Ability (STR → CHA)" },
    { value: "abilityDesc", label: "Ability (CHA → STR)" },
];

const WORLD_SKILL_SORTERS = {
    default: null,
    nameAsc: compareByNameAsc,
    nameDesc: compareByNameDesc,
    abilityAsc: compareByAbilityAsc,
    abilityDesc: compareByAbilityDesc,
};

const COMBAT_SKILL_SORT_OPTIONS = [
    { value: "default", label: "Default order" },
    { value: "nameAsc", label: "Name (A → Z)" },
    { value: "nameDesc", label: "Name (Z → A)" },
    { value: "tierAsc", label: "Tier (Weak → Severe)" },
    { value: "tierDesc", label: "Tier (Severe → Weak)" },
    { value: "abilityAsc", label: "Ability (STR → CHA)" },
    { value: "abilityDesc", label: "Ability (CHA → STR)" },
    { value: "categoryAsc", label: "Category A → Z" },
    { value: "categoryDesc", label: "Category Z → A" },
];

const COMBAT_SKILL_SORTERS = {
    default: null,
    nameAsc: compareByNameAsc,
    nameDesc: compareByNameDesc,
    abilityAsc: compareByAbilityAsc,
    abilityDesc: compareByAbilityDesc,
    tierAsc: compareByTierAsc,
    tierDesc: compareByTierDesc,
    categoryAsc: compareByCategoryAsc,
    categoryDesc: compareByCategoryDesc,
};

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

const CONCEPT_PROMPTS = Object.freeze([
    {
        key: "reluctant-binder",
        title: "Reluctant Binder",
        hook: "You made a desperate pact with a demon to save someone dear to you.",
        question: "What clause still keeps you awake at night?",
    },
    {
        key: "wandering-scholar",
        title: "Wandering Scholar",
        hook: "Your research into forgotten Arcana drew the attention of rival cults.",
        question: "Which taboo discovery are you hiding from the party?",
    },
    {
        key: "fallen-prodigy",
        title: "Fallen Prodigy",
        hook: "Once a celebrated exorcist, you vanished after a mission went wrong.",
        question: "Who from your old order is still hunting you down?",
    },
    {
        key: "masked-mediator",
        title: "Masked Mediator",
        hook: "You broker truces between mortals and demons in neutral ground night markets.",
        question: "What price will you demand for the party's first favour?",
    },
]);

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
const NEW_WORLD_SKILL_ID = "__new_world_skill__";

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

function normalizeStringList(value) {
    if (!value && value !== 0) return EMPTY_ARRAY;
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '')))
            .filter((entry) => entry.length > 0);
    }
    if (typeof value === 'string') {
        return value
            .split(/[\n,]/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }
    const text = String(value ?? '').trim();
    return text ? [text] : EMPTY_ARRAY;
}

function getResistanceValues(demon, key) {
    if (!demon) return EMPTY_ARRAY;
    const primary = demon.resistances?.[key];
    const fallback = demon[key];
    const primaryList = normalizeStringList(primary);
    if (primaryList.length > 0) return primaryList;
    return normalizeStringList(fallback);
}

function collectResistanceTerms(demon) {
    if (!demon) return EMPTY_ARRAY;
    const keys = ['weak', 'resist', 'null', 'absorb', 'reflect'];
    const values = [];
    for (const key of keys) {
        for (const entry of getResistanceValues(demon, key)) {
            values.push(entry.toLowerCase());
        }
    }
    return values;
}

function getResistanceCount(demon, key) {
    return getResistanceValues(demon, key).length;
}

function getDemonSkillList(demon) {
    if (!demon) return EMPTY_ARRAY;
    if (Array.isArray(demon.skills)) {
        return demon.skills
            .map((entry) => {
                if (typeof entry === 'string') return entry.trim();
                if (entry && typeof entry === 'object') {
                    if (typeof entry.name === 'string') return entry.name.trim();
                    if (typeof entry.label === 'string') return entry.label.trim();
                }
                return '';
            })
            .filter((entry) => entry.length > 0);
    }
    if (typeof demon.skills === 'string') {
        return demon.skills
            .split(/[\n,]/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }
    return EMPTY_ARRAY;
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

function makeCombatSkillId(label, seen) {
    const base = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const fallback = base || `combat-${Math.random().toString(36).slice(2, 8)}`;
    let id = fallback;
    let attempt = 1;
    while (seen.has(id)) {
        attempt += 1;
        id = `${fallback}-${attempt}`;
    }
    seen.add(id);
    return id;
}

function normalizeCombatCategoryValue(raw) {
    if (typeof raw === "string" && raw.trim()) {
        const key = raw.trim().toLowerCase();
        if (COMBAT_CATEGORY_ALIASES[key]) {
            return COMBAT_CATEGORY_ALIASES[key];
        }
        if (Object.prototype.hasOwnProperty.call(COMBAT_CATEGORY_INDEX, key)) {
            return key;
        }
    }
    return DEFAULT_COMBAT_CATEGORY;
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

function normalizeCombatSkillDefs(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const normalized = [];
    for (const entry of source) {
        if (!entry || typeof entry !== "object") continue;
        const labelValue =
            typeof entry.label === "string"
                ? entry.label.trim()
                : typeof entry.name === "string"
                ? entry.name.trim()
                : "";
        if (!labelValue) continue;
        let id = typeof entry.id === "string" ? entry.id.trim() : "";
        if (!id && typeof entry.key === "string") id = entry.key.trim();
        if (!id || seen.has(id)) {
            id = makeCombatSkillId(labelValue, seen);
        } else {
            seen.add(id);
        }
        const abilityRaw = typeof entry.ability === "string" ? entry.ability.trim().toUpperCase() : "";
        const ability = ABILITY_KEY_SET.has(abilityRaw) ? abilityRaw : ABILITY_DEFS[0]?.key || "INT";
        const tierRaw = typeof entry.tier === "string" ? entry.tier.trim().toUpperCase() : "";
        const tier = COMBAT_TIER_ORDER.includes(tierRaw) ? tierRaw : COMBAT_TIER_ORDER[0];
        const categoryValue =
            typeof entry.category === "string"
                ? entry.category
                : typeof entry.type === "string"
                ? entry.type
                : DEFAULT_COMBAT_CATEGORY;
        const category = normalizeCombatCategoryValue(categoryValue);
        const cost = typeof entry.cost === "string" ? entry.cost.trim() : typeof entry.resource === "string" ? entry.resource.trim() : "";
        const notes =
            typeof entry.notes === "string"
                ? entry.notes.trim()
                : typeof entry.description === "string"
                ? entry.description.trim()
                : "";
        normalized.push({ id, key: id, label: labelValue, ability, tier, category, cost, notes });
    }
    return normalized;
}

function computeCombatSkillDamage({ tier, abilityMod, roll, bonus = 0, buff = 1, critical = false }) {
    const info = COMBAT_TIER_INFO[tier] || COMBAT_TIER_INFO.WEAK;
    const rollValue = Number(roll);
    const abilityValue = Number(abilityMod);
    const bonusValue = Number(bonus);
    let buffValue = Number(buff);
    if (!Number.isFinite(rollValue) || !Number.isFinite(abilityValue) || !Number.isFinite(bonusValue)) {
        return null;
    }
    if (!Number.isFinite(buffValue) || buffValue <= 0) {
        buffValue = 1;
    }
    const abilityContribution = abilityValue * info.modMultiplier;
    const base = rollValue + abilityContribution + bonusValue;
    const critMultiplier = critical ? 1.75 : 1;
    const preBuff = base * critMultiplier;
    const total = Math.ceil(preBuff * buffValue);
    return {
        total,
        baseRoll: rollValue,
        abilityContribution,
        bonus: bonusValue,
        critMultiplier,
        buffMultiplier: buffValue,
        preBuff,
    };
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
    const gameList = useMemo(() => {
        if (Array.isArray(games)) return games;
        if (games && Array.isArray(games.items)) return games.items;
        if (games && typeof games === "object") {
            console.warn("Unexpected games payload", games);
        }
        return [];
    }, [games]);

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
                    {gameList.length === 0 && <div>No games yet.</div>}
                    {gameList.map((g) => {
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
    const [sidebarOpen, setSidebarOpen] = useState(() =>
        typeof window === "undefined" ? true : window.innerWidth > 960
    );
    const [logoutBusy, setLogoutBusy] = useState(false);
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

    const handleSelectNav = useCallback(
        (key) => {
            setTab(key);
            if (typeof window !== "undefined" && window.innerWidth < 960) {
                setSidebarOpen(false);
            }
        },
        [setTab]
    );

    const toggleSidebar = useCallback(() => {
        setSidebarOpen((prev) => !prev);
    }, []);

    const closeSidebar = useCallback(() => {
        setSidebarOpen(false);
    }, []);

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

    const playerMaccaInfo = useMemo(() => {
        if (!myEntry) {
            return { value: 0, label: "0" };
        }
        const raw = Number(myEntry.character?.resources?.macca);
        const value = Number.isFinite(raw) ? raw : 0;
        return {
            value,
            label: Number.isFinite(raw) ? value.toLocaleString() : "0",
        };
    }, [myEntry]);

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

    const handleMainMenu = useCallback(() => {
        if (typeof window !== "undefined") {
            window.location.href = "/";
        }
    }, []);

    const handleLogout = useCallback(async () => {
        try {
            setLogoutBusy(true);
            await Auth.logout();
            if (typeof window !== "undefined") {
                window.location.href = "/";
            }
        } catch (err) {
            alert(err?.message || "Failed to log out");
        } finally {
            setLogoutBusy(false);
        }
    }, []);

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

    const syncMedia = realtime.syncMedia;

    useEffect(() => {
        if (typeof syncMedia === "function") {
            syncMedia(game.media);
        }
    }, [game.media, syncMedia]);

    const shellClassName = `app-shell ${sidebarOpen ? "is-sidebar-open" : "is-sidebar-collapsed"}`;

    return (
        <RealtimeContext.Provider value={realtime}>
            <div className="app-root">
                <div className={`app-activity${apiBusy ? " is-active" : ""}`}>
                    <div className="app-activity__bar" />
                </div>
                <SharedMediaDisplay isDM={isDM} />
                <AlertOverlay />
                <div className={shellClassName}>
                    <aside
                        id="game-sidebar"
                        className="app-sidebar"
                        aria-hidden={!sidebarOpen}
                    >
                        <div className="sidebar__header">
                            <div className="sidebar__header-main">
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
                            <button
                                type="button"
                                className="sidebar__close"
                                onClick={closeSidebar}
                                aria-label="Close menu"
                                title="Close menu"
                                hidden={!sidebarOpen}
                            >
                                <span aria-hidden>×</span>
                            </button>
                        </div>
                        <nav className="sidebar__nav">
                            {navItems.map((item) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    className={`sidebar__nav-button${tab === item.key ? " is-active" : ""}`}
                                    onClick={() => handleSelectNav(item.key)}
                                >
                                    <span className="sidebar__nav-label">{item.label}</span>
                                    <span className="sidebar__nav-desc">{item.description}</span>
                                </button>
                            ))}
                        </nav>
                        <div className="sidebar__footer">
                            {!isDM && myEntry && (
                                <div className="sidebar__player-info" aria-live="polite">
                                    <span className="sidebar__player-label">Macca</span>
                                    <span className="sidebar__player-value">{playerMaccaInfo.label}</span>
                                </div>
                            )}
                            {isDM && <InviteButton gameId={game.id} />}
                            <button type="button" className="btn ghost" onClick={handleMainMenu}>
                                Main menu
                            </button>
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
                            <button
                                type="button"
                                className="btn danger"
                                onClick={handleLogout}
                                disabled={logoutBusy}
                            >
                                {logoutBusy ? "Logging out…" : "Log out"}
                            </button>
                        </div>
                    </aside>
                    <main className="app-main">
                        <header className="app-main__header">
                            <div className="header-leading">
                                <button
                                    type="button"
                                    className={`sidebar-toggle${sidebarOpen ? "" : " is-closed"}`}
                                    onClick={toggleSidebar}
                                    aria-expanded={sidebarOpen}
                                    aria-controls="game-sidebar"
                                    title={sidebarOpen ? "Hide navigation" : "Show navigation"}
                                >
                                    <span className="sidebar-toggle__icon" aria-hidden>
                                        ☰
                                    </span>
                                    <span className="sidebar-toggle__label">
                                        {sidebarOpen ? "Hide menu" : "Show menu"}
                                    </span>
                                </button>
                                <div>
                                    <span className="eyebrow">
                                        {isDM ? "Dungeon Master" : "Player"} View
                                    </span>
                                    <h1>{activeNav?.label || ""}</h1>
                                    {activeNav?.description && (
                                        <p className="text-muted">{activeNav.description}</p>
                                    )}
                                </div>
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

                    {tab === "map" && <MapTab game={game} me={me} />}

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

                    {tab === "combatSkills" && (
                        <CombatSkillsTab
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

const MAP_DEFAULT_SETTINGS = Object.freeze({
    allowPlayerDrawing: false,
    allowPlayerTokenMoves: false,
});

const MAP_BRUSH_COLORS = ['#f97316', '#38bdf8', '#a855f7', '#22c55e', '#f472b6'];
const MAP_ENEMY_DEFAULT_COLOR = '#ef4444';
const MAP_MAX_POINTS_PER_STROKE = 600;
const MAP_DEFAULT_BACKGROUND = Object.freeze({
    url: '',
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    opacity: 1,
});
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
const MAP_SIDEBAR_TABS = [
    { key: 'tokens', label: 'Tokens' },
    { key: 'overlays', label: 'External Images' },
    { key: 'shapes', label: 'Shapes' },
    { key: 'library', label: 'Library' },
];

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
    };
}

function clampText(value, max = 200) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, max).trim();
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

function EnemyTooltipCard({ info, label }) {
    if (!info) return null;
    const hasName = info.showName && info.name;
    const hasStats = info.showStats && Array.isArray(info.stats) && info.stats.length > 0;
    const hasNotes = info.showNotes && info.notes;
    const hasImage = info.showImage && info.image;
    if (!hasName && !hasStats && !hasNotes && !hasImage) {
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
            </div>
        </div>
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
    let enemyInfo = null;
    let color = typeof token.color === 'string' && token.color ? token.color : '#a855f7';
    if (!token.color) {
        if (kind === 'player') color = '#38bdf8';
        else if (kind === 'demon') color = '#f97316';
        else if (kind === 'enemy') color = MAP_ENEMY_DEFAULT_COLOR;
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
    return { url, x, y, scale, rotation, opacity };
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
    return {
        strokes,
        tokens,
        shapes,
        settings: {
            allowPlayerDrawing: !!map.settings?.allowPlayerDrawing,
            allowPlayerTokenMoves: !!map.settings?.allowPlayerTokenMoves,
        },
        paused: !!map.paused,
        background: normalizeClientMapBackground(map.background),
        updatedAt: typeof map.updatedAt === 'string' ? map.updatedAt : null,
    };
}

function describePlayerName(player) {
    if (!player) return 'Player';
    const name = player.character?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
    if (player.username) return player.username;
    if (player.userId) return `Player ${player.userId.slice(0, 6)}`;
    return 'Player';
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
    const [mapState, setMapState] = useState(() => normalizeClientMapState(game?.map));
    const [mapLibrary, setMapLibrary] = useState(() => normalizeMapLibrary(game?.mapLibrary));
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

    const [tool, setTool] = useState('select');
    const [brushColor, setBrushColor] = useState(MAP_BRUSH_COLORS[0]);
    const [brushSize, setBrushSize] = useState(4);
    const [draftStroke, setDraftStroke] = useState(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const canvasRef = useRef(null);
    const boardRef = useRef(null);
    const [boardSize, setBoardSize] = useState({ width: 0, height: 0 });
    const [dragging, setDragging] = useState(null);
    const [dragPreview, setDragPreview] = useState(null);
    const [playerChoice, setPlayerChoice] = useState('');
    const [demonChoice, setDemonChoice] = useState('');
    const [demonQuery, setDemonQuery] = useState('');
    const [enemyForm, setEnemyForm] = useState(createEnemyFormState);
    const [enemyDemonChoice, setEnemyDemonChoice] = useState('');
    const [enemyQuery, setEnemyQuery] = useState('');
    const [sidebarTab, setSidebarTab] = useState('tokens');
    const [overlayForm, setOverlayForm] = useState({
        url: '',
        width: 0.4,
        height: 0.4,
        opacity: 1,
        rotation: 0,
    });
    const resetEnemyForm = useCallback(() => {
        setEnemyForm(createEnemyFormState());
        setEnemyDemonChoice('');
    }, []);

    useEffect(() => {
        if (!isDM && tool === 'draw' && (!mapState.settings.allowPlayerDrawing || mapState.paused)) {
            setTool('select');
        } else if (!isDM && tool === 'background') {
            setTool('select');
        }
    }, [isDM, mapState.paused, mapState.settings.allowPlayerDrawing, tool]);

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

    const canDraw = isDM || (!mapState.paused && mapState.settings.allowPlayerDrawing);
    const canPaint = canDraw && tool === 'draw';
    const isBackgroundTool = tool === 'background';
    const isShapeTool = tool === 'shape';
    const tokenLayerPointerEvents = canPaint || isBackgroundTool || (isDM && isShapeTool) ? 'none' : 'auto';
    const shapeLayerPointerEvents = isDM && isShapeTool ? 'auto' : 'none';
    const canvasPointerEvents = isBackgroundTool || isShapeTool ? 'none' : 'auto';
    const backgroundDisplay = useMemo(() => {
        const base = mapState.background || MAP_DEFAULT_BACKGROUND;
        if (dragPreview && dragPreview.kind === 'background') {
            return { ...base, x: dragPreview.x, y: dragPreview.y };
        }
        return base;
    }, [dragPreview, mapState.background]);

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

    const demonMap = useMemo(() => {
        const map = new Map();
        if (Array.isArray(game.demons)) {
            for (const demon of game.demons) {
                if (!demon || !demon.id) continue;
                map.set(demon.id, demon);
            }
        }
        return map;
    }, [game.demons]);

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
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM]
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
        } catch (err) {
            alert(err.message);
        }
    }, [game.id, isDM]);

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
                        updatedAt: response?.createdAt || prev.updatedAt,
                    }));
                }
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id]
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
            });
            setIsDrawing(false);
            return null;
        });
    }, [sendStroke]);

    const handleCanvasPointerDown = useCallback(
        (event) => {
            if (!canPaint) return;
            event.preventDefault();
            const { x, y } = getPointerPosition(event);
            setDraftStroke({
                id: `draft-${Date.now()}`,
                color: brushColor,
                size: brushSize,
                points: [{ x, y }],
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
        [brushColor, brushSize, canPaint, getPointerPosition]
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
        [completeStroke, draftStroke, isDrawing]
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
            ctx.strokeStyle = stroke.color || MAP_BRUSH_COLORS[0];
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
                } catch (err) {
                    alert(err.message);
                }
            })();
        },
        [dragPreview, dragging, game.id]
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
                }
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id]
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
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM]
    );

    const handleAddPlayerToken = useCallback(async () => {
        if (!playerChoice) return;
        try {
            const response = await Games.addMapToken(game.id, {
                kind: 'player',
                refId: playerChoice,
            });
            const normalized = normalizeClientMapToken(response);
            if (normalized) {
                setMapState((prev) => ({
                    ...prev,
                    tokens: prev.tokens.concat(normalized),
                    updatedAt: response?.updatedAt || prev.updatedAt,
                }));
            }
            setPlayerChoice('');
        } catch (err) {
            alert(err.message);
        }
    }, [game.id, playerChoice]);

    const handleAddDemonToken = useCallback(async () => {
        if (!demonChoice) return;
        try {
            const response = await Games.addMapToken(game.id, {
                kind: 'demon',
                refId: demonChoice,
            });
            const normalized = normalizeClientMapToken(response);
            if (normalized) {
                setMapState((prev) => ({
                    ...prev,
                    tokens: prev.tokens.concat(normalized),
                    updatedAt: response?.updatedAt || prev.updatedAt,
                }));
            }
            setDemonChoice('');
        } catch (err) {
            alert(err.message);
        }
    }, [demonChoice, game.id]);

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
                }
            }
            resetEnemyForm();
        } catch (err) {
            alert(err.message);
        }
    }, [enemyForm, game.id, resetEnemyForm]);

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
                }
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM]
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
                }
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM]
    );

    const handleRemoveShape = useCallback(
        async (shapeId) => {
            if (!isDM) return;
            if (!shapeId) return;
            if (!window.confirm('Remove this shape from the map?')) return;
            try {
                await Games.deleteMapShape(game.id, shapeId);
                setMapState((prev) => ({
                    ...prev,
                    shapes: prev.shapes.filter((shape) => shape.id !== shapeId),
                    updatedAt: new Date().toISOString(),
                }));
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM]
    );

    const handleShapePointerDown = useCallback(
        (shape, event) => {
            if (!shape || !isDM || tool !== 'shape') return;
            event.preventDefault();
            event.stopPropagation();
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
        },
        [isDM]
    );

    const handleImportEnemyDemon = useCallback(() => {
        if (!isDM) return;
        const slug = (enemyDemonChoice || '').trim();
        if (!slug) return;
        const demon = demonMap.get(slug);
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
    }, [demonMap, enemyDemonChoice, isDM]);

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
        } catch (err) {
            alert(err.message);
        }
    }, [game.id, isDM, mapLibrary.length, refreshMapLibrary]);

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
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM, refreshMapLibrary]
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
            } catch (err) {
                alert(err.message);
            }
        },
        [game.id, isDM]
    );

    const handleTogglePause = useCallback(async () => {
        try {
            const updated = await Games.updateMapSettings(game.id, { paused: !mapState.paused });
            setMapState(normalizeClientMapState(updated));
        } catch (err) {
            alert(err.message);
        }
    }, [game.id, mapState.paused]);

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
                    </div>
                    <div className="map-toolbar__status">
                        <span className={`pill ${mapState.paused ? 'warn' : 'success'}`}>
                            {mapState.paused ? 'Updates paused' : 'Live updates'}
                        </span>
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
                    </div>
                </div>
                {canDraw && (
                    <div className="map-toolbar__row map-toolbar__brush">
                        <div>
                            <span className="text-small">Brush color</span>
                            <div className="map-toolbar__colors">
                                {MAP_BRUSH_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        className={`map-color${brushColor === color ? ' is-active' : ''}`}
                                        style={{ background: color }}
                                        onClick={() => setBrushColor(color)}
                                    />
                                ))}
                            </div>
                            <label className="map-color-picker">
                                <span className="text-small">Custom color</span>
                                <div className="color-input">
                                    <input
                                        type="color"
                                        value={brushColor}
                                        onChange={(event) => {
                                            const value = event.target.value || brushColor;
                                            setBrushColor(typeof value === 'string' ? value : brushColor);
                                        }}
                                    />
                                    <span className="text-muted text-small">{brushColor.toUpperCase()}</span>
                                </div>
                            </label>
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
                <div className="map-board card" ref={boardRef}>
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
                    <div className="map-board__shapes" style={{ pointerEvents: shapeLayerPointerEvents }}>
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
                            const className = [
                                'map-shape',
                                `map-shape--${display.type}`,
                                isDM && tool === 'shape' ? 'is-editing' : '',
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
                            const demon = token.kind === 'demon' ? demonMap.get(token.refId) : null;
                            const display =
                                dragPreview && dragPreview.kind === 'token' && dragPreview.id === token.id
                                    ? { ...token, x: dragPreview.x, y: dragPreview.y }
                                    : token;
                            const showTooltip = token.showTooltip && token.tooltip;
                            const canDrag = canMoveToken(token);
                            const label = token.label || (player ? describePlayerName(player) : demon ? demon.name : 'Marker');
                            return (
                                <button
                                    key={token.id}
                                    type="button"
                                    className={`map-token map-token--${token.kind}${canDrag ? ' is-draggable' : ''}`}
                                    style={{ left: `${display.x * 100}%`, top: `${display.y * 100}%`, background: token.color }}
                                    onPointerDown={(event) => handleTokenPointerDown(token, event)}
                                    onPointerMove={(event) => handleTokenPointerMove(token, event)}
                                    onPointerUp={(event) => handleTokenPointerUp(token, event)}
                                    onPointerCancel={(event) => handleTokenPointerUp(token, event)}
                                >
                                    <span className="map-token__label">{label.slice(0, 2).toUpperCase()}</span>
                                    {showTooltip && (
                                        token.kind === 'enemy' && token.enemyInfo ? (
                                            <span className="map-token__tooltip map-token__tooltip--card">
                                                <EnemyTooltipCard info={token.enemyInfo} label={label} />
                                            </span>
                                        ) : (
                                            <span className="map-token__tooltip">{token.tooltip}</span>
                                        )
                                    )}
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
                </div>
                <aside className="map-sidebar">
                    <div className="map-sidebar__tabs">
                        {MAP_SIDEBAR_TABS.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                className={`map-sidebar__tab${sidebarTab === tab.key ? ' is-active' : ''}`}
                                onClick={() => setSidebarTab(tab.key)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <div className="map-sidebar__content">
                        {sidebarTab === 'tokens' && (
                            <div className="stack">
                                <MapAccordionSection
                                    title="Player tokens"
                                    description="Place and manage party members on the encounter map."
                                >
                                    {isDM && (
                                        <>
                                            {availablePlayers.length > 0 ? (
                                                <div className="map-token-form">
                                                    <label className="text-small" htmlFor="map-add-player">
                                                        Add party member
                                                    </label>
                                                    <div className="map-token-form__controls">
                                                        <select
                                                            id="map-add-player"
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
                                                        <button
                                                            type="button"
                                                            className="btn btn-small"
                                                            onClick={handleAddPlayerToken}
                                                            disabled={!playerChoice}
                                                        >
                                                            Place token
                                                        </button>
                                                    </div>
                                                    <p className="text-small text-muted">
                                                        Tokens can be dragged when the Select tool is active.
                                                    </p>
                                                </div>
                                            ) : (
                                                <p className="text-small text-muted">
                                                    Every party member already has a token on the board.
                                                </p>
                                            )}
                                        </>
                                    )}
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
                                    {isDM && (
                                        <div className="map-token-form">
                                            <label className="text-small" htmlFor="map-demon-search">
                                                Search codex
                                            </label>
                                            <input
                                                id="map-demon-search"
                                                type="text"
                                                value={demonQuery}
                                                onChange={(event) => setDemonQuery(event.target.value)}
                                                placeholder="Filter demons…"
                                            />
                                            <div className="map-token-form__controls">
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
                                                <button
                                                    type="button"
                                                    className="btn btn-small"
                                                    onClick={handleAddDemonToken}
                                                    disabled={!demonChoice}
                                                >
                                                    Summon
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {demonTokens.length === 0 ? (
                                        <p className="map-empty text-muted">No companions placed.</p>
                                    ) : (
                                        <ul className="map-token-list">
                                            {demonTokens.map((token) => {
                                                const demon = demonMap.get(token.refId);
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
                                    {isDM && (
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
                                                <EnemyTooltipCard
                                                    info={enemyDetailsInfo}
                                                    label={enemyForm.label || 'Enemy'}
                                                />
                                                <p className="text-small text-muted">
                                                    {enemyForm.showTooltip && enemyFormHasVisibleTooltip
                                                        ? 'Players will see the selected fields on hover.'
                                                        : 'Tooltip hidden from players.'}
                                                </p>
                                            </fieldset>
                                            <div className="map-enemy-form__actions">
                                                {enemyForm.id && (
                                                    <button
                                                        type="button"
                                                        className="btn ghost btn-small"
                                                        onClick={resetEnemyForm}
                                                    >
                                                        Cancel edit
                                                    </button>
                                                )}
                                                <button type="submit" className="btn btn-small" disabled={!enemyFormValid}>
                                                    {enemyForm.id ? 'Save enemy' : 'Place enemy'}
                                                </button>
                                            </div>
                                        </form>
                                    )}
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
                                        description="Layer supplemental art, grids, or handouts on top of the battlefield."
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
                                            <div className="map-overlay-form__sliders">
                                                <label>
                                                    <span className="text-small">
                                                        Width ({Math.round(overlayForm.width * 100)}%)
                                                    </span>
                                                    <input
                                                        type="range"
                                                        min="10"
                                                        max="100"
                                                        value={Math.round(overlayForm.width * 100)}
                                                        onChange={(event) =>
                                                            setOverlayForm((prev) => ({
                                                                ...prev,
                                                                width: clamp(Number(event.target.value) / 100, 0.1, 1, prev.width),
                                                            }))
                                                        }
                                                    />
                                                </label>
                                                <label>
                                                    <span className="text-small">
                                                        Height ({Math.round(overlayForm.height * 100)}%)
                                                    </span>
                                                    <input
                                                        type="range"
                                                        min="10"
                                                        max="100"
                                                        value={Math.round(overlayForm.height * 100)}
                                                        onChange={(event) =>
                                                            setOverlayForm((prev) => ({
                                                                ...prev,
                                                                height: clamp(Number(event.target.value) / 100, 0.1, 1, prev.height),
                                                            }))
                                                        }
                                                    />
                                                </label>
                                                <label>
                                                    <span className="text-small">
                                                        Opacity ({Math.round(overlayForm.opacity * 100)}%)
                                                    </span>
                                                    <input
                                                        type="range"
                                                        min="10"
                                                        max="100"
                                                        value={Math.round(overlayForm.opacity * 100)}
                                                        onChange={(event) =>
                                                            setOverlayForm((prev) => ({
                                                                ...prev,
                                                                opacity: clamp(Number(event.target.value) / 100, 0.1, 1, prev.opacity),
                                                            }))
                                                        }
                                                    />
                                                </label>
                                                <label>
                                                    <span className="text-small">
                                                        Rotation ({Math.round(overlayForm.rotation)}°)
                                                    </span>
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="360"
                                                        value={Math.round(overlayForm.rotation)}
                                                        onChange={(event) =>
                                                            setOverlayForm((prev) => ({
                                                                ...prev,
                                                                rotation: clamp(Number(event.target.value), 0, 360, prev.rotation),
                                                            }))
                                                        }
                                                    />
                                                </label>
                                            </div>
                                            <div className="map-overlay-form__actions">
                                                <button type="submit" className="btn btn-small" disabled={!overlayForm.url.trim()}>
                                                    Add overlay
                                                </button>
                                                <p className="text-small text-muted">
                                                    Use the Shapes tool to drag overlays into position.
                                                </p>
                                            </div>
                                        </form>
                                    </MapAccordionSection>
                                )}
                                <MapAccordionSection
                                    title="Overlay images"
                                    description="Manage existing overlays. Drag with the Shapes tool to reposition."
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
                                                        <div className="map-shape-card__sliders">
                                                            <label>
                                                                <span className="text-small">
                                                                    Width ({Math.round(shape.width * 100)}%)
                                                                </span>
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
                                                                        setMapState((prev) => ({
                                                                            ...prev,
                                                                            shapes: prev.shapes.map((entry) =>
                                                                                entry.id === shape.id
                                                                                    ? { ...entry, width: value }
                                                                                    : entry
                                                                            ),
                                                                        }));
                                                                        handleUpdateShape(shape.id, { width: value });
                                                                    }}
                                                                />
                                                            </label>
                                                            <label>
                                                                <span className="text-small">
                                                                    Height ({Math.round(shape.height * 100)}%)
                                                                </span>
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
                    </div>
                </aside>
            </div>
        </div>
    );
}

// ---------- DM Overview ----------
function DMOverview({ game, onInspectPlayer }) {
    const realtime = useContext(RealtimeContext);
    const [mediaDraft, setMediaDraft] = useState("");
    const [alertDraft, setAlertDraft] = useState("");
    const [mediaFormError, setMediaFormError] = useState(null);
    const [alertFormError, setAlertFormError] = useState(null);
    const currentMedia = realtime?.mediaState || null;
    const serverMediaError = realtime?.mediaError || null;
    const friendlyMediaError = useMemo(() => {
        if (!serverMediaError) return null;
        switch (serverMediaError) {
            case "invalid_url":
                return "Unable to parse that YouTube link. Try a different URL.";
            case "invalid_request":
                return "Provide a YouTube link before pressing play.";
            case "forbidden":
                return "Only the DM can control playback.";
            case "not_found":
                return "Campaign not found. Refresh and try again.";
            default:
                return serverMediaError;
        }
    }, [serverMediaError]);
    const displayMediaError = mediaFormError || friendlyMediaError;
    const serverAlertError = realtime?.alertError || null;
    const friendlyAlertError = useMemo(() => {
        if (!serverAlertError) return null;
        switch (serverAlertError) {
            case "invalid_message":
                return "Enter a message before sending.";
            case "forbidden":
                return "Only the DM can send alerts.";
            case "not_found":
                return "Campaign not found. Refresh and try again.";
            default:
                return serverAlertError;
        }
    }, [serverAlertError]);
    const displayAlertError = alertFormError || friendlyAlertError;
    const isRealtimeConnected = !!realtime?.connected;
    const presenceMap = realtime?.onlineUsers || EMPTY_OBJECT;

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

    const handleMediaSubmit = (evt) => {
        evt.preventDefault();
        if (!realtime?.playMedia) return;
        const trimmed = mediaDraft.trim();
        if (!trimmed) {
            setMediaFormError("Enter a YouTube link or video ID");
            return;
        }
        try {
            realtime.playMedia(trimmed);
            setMediaDraft("");
            setMediaFormError(null);
        } catch (err) {
            const message = err?.message === "not_connected"
                ? "Waiting for the realtime connection…"
                : err?.message || "Failed to share video";
            setMediaFormError(message);
        }
    };

    const handleMediaStop = () => {
        if (!realtime?.stopMedia) return;
        try {
            realtime.stopMedia();
            setMediaFormError(null);
        } catch (err) {
            const message = err?.message === "not_connected"
                ? "Waiting for the realtime connection…"
                : err?.message || "Failed to stop video";
            setMediaFormError(message);
        }
    };

    const handleAlertSubmit = (evt) => {
        evt.preventDefault();
        if (!realtime?.sendAlert) return;
        const trimmed = alertDraft.trim();
        if (!trimmed) {
            setAlertFormError("Enter a message to send");
            return;
        }
        try {
            realtime.sendAlert(trimmed);
            setAlertDraft("");
            setAlertFormError(null);
        } catch (err) {
            const message = err?.message === "not_connected"
                ? "Waiting for the realtime connection…"
                : err?.message || "Failed to send alert";
            setAlertFormError(message);
        }
    };

    return (
        <div className="stack-lg dm-overview">
            <section className="card dm-broadcast">
                <div className="header">
                    <div>
                        <h3>Table broadcast</h3>
                        <p className="text-muted text-small">
                            Share ambience videos or send urgent alerts to everyone currently online.
                        </p>
                    </div>
                    {!isRealtimeConnected && (
                        <span className="text-muted text-small">Connecting…</span>
                    )}
                </div>
                <div className="stack">
                    <form className="dm-broadcast__form" onSubmit={handleMediaSubmit}>
                        <label htmlFor="dm-broadcast-url">YouTube link</label>
                        <div className="row wrap">
                            <input
                                id="dm-broadcast-url"
                                type="text"
                                placeholder="https://youtu.be/ambient-track"
                                value={mediaDraft}
                                onChange={(e) => setMediaDraft(e.target.value)}
                                disabled={!isRealtimeConnected}
                                autoComplete="off"
                                spellCheck={false}
                            />
                            <button type="submit" className="btn" disabled={!isRealtimeConnected}>
                                Play for party
                            </button>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={handleMediaStop}
                                disabled={!isRealtimeConnected || !currentMedia}
                            >
                                Stop playback
                            </button>
                        </div>
                        <p className="text-muted text-small">
                            Players receive a floating player and can mute it locally.
                        </p>
                        {currentMedia && (
                            <p className="text-small dm-broadcast__now-playing">
                                Now playing:{" "}
                                <a
                                    href={currentMedia.url || `https://youtu.be/${currentMedia.videoId}`}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    {currentMedia.url ? currentMedia.url : `youtu.be/${currentMedia.videoId}`}
                                </a>
                            </p>
                        )}
                        {displayMediaError && (
                            <span className="text-error text-small">{displayMediaError}</span>
                        )}
                    </form>
                    <form className="dm-broadcast__form" onSubmit={handleAlertSubmit}>
                        <label htmlFor="dm-broadcast-alert">Party alert</label>
                        <div className="row wrap">
                            <input
                                id="dm-broadcast-alert"
                                type="text"
                                placeholder="Heads up! Boss fight in 1 minute."
                                value={alertDraft}
                                onChange={(e) => setAlertDraft(e.target.value)}
                                disabled={!isRealtimeConnected}
                                maxLength={300}
                                autoComplete="off"
                            />
                            <button type="submit" className="btn secondary" disabled={!isRealtimeConnected}>
                                Send alert
                            </button>
                        </div>
                        <p className="text-muted text-small">Creates an on-screen popup for everyone in the session.</p>
                        {displayAlertError && <span className="text-error text-small">{displayAlertError}</span>}
                    </form>
                </div>
            </section>
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
                            const isOnline = !!(
                                (player.userId && presenceMap[player.userId]) ?? player.online
                            );

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
                                        <span
                                            className={`presence-indicator ${
                                                isOnline ? "is-online" : "is-offline"
                                            }`}
                                        >
                                            {isOnline ? "Online" : "Offline"}
                                        </span>
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

function SharedMediaDisplay({ isDM }) {
    const realtime = useContext(RealtimeContext);
    const media = realtime?.mediaState;
    const [collapsed, setCollapsed] = useState(false);
    const [muted, setMuted] = useState(false);
    const iframeRef = useRef(null);

    useEffect(() => {
        setCollapsed(false);
        setMuted(false);
    }, [media?.videoId, media?.updatedAt]);

    if (!media) return null;

    const params = new URLSearchParams({
        autoplay: '1',
        start: media.startSeconds ? String(media.startSeconds) : '0',
        enablejsapi: '1',
        controls: '1',
        modestbranding: '1',
        rel: '0',
        playsinline: '1',
    });
    const embedSrc = `https://www.youtube.com/embed/${media.videoId}?${params.toString()}`;

    const toggleMute = () => {
        const frame = iframeRef.current;
        if (!frame || !frame.contentWindow) return;
        const next = !muted;
        try {
            frame.contentWindow.postMessage(
                JSON.stringify({ event: 'command', func: next ? 'mute' : 'unMute', args: [] }),
                '*'
            );
            setMuted(next);
        } catch (err) {
            console.warn('mute toggle failed', err);
        }
    };

    const description = isDM ? 'Shared with the party' : 'Broadcast from your DM';

    return (
        <div className={`shared-media${collapsed ? ' is-collapsed' : ''}`}>
            <div className="shared-media__header">
                <strong>DM Broadcast</strong>
                <div className="shared-media__actions">
                    <button
                        type="button"
                        className="btn ghost btn-small"
                        onClick={toggleMute}
                    >
                        {muted ? 'Unmute' : 'Mute'}
                    </button>
                    <button
                        type="button"
                        className="btn ghost btn-small"
                        onClick={() => setCollapsed((prev) => !prev)}
                    >
                        {collapsed ? 'Expand' : 'Collapse'}
                    </button>
                </div>
            </div>
            <div className="shared-media__body">
                <div className="shared-media__player">
                    <iframe
                        ref={iframeRef}
                        src={embedSrc}
                        title="DM shared media"
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                    />
                </div>
                <div className="shared-media__footer">
                    <span className="text-muted text-small">{description}</span>
                    <div className="shared-media__links">
                        {media.url && (
                            <a href={media.url} target="_blank" rel="noreferrer">
                                Open on YouTube
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AlertOverlay() {
    const realtime = useContext(RealtimeContext);
    const alerts = realtime?.alerts || EMPTY_ARRAY;
    const dismiss = realtime?.dismissAlert;

    const timeFormatter = useMemo(
        () => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }),
        []
    );

    if (!alerts || alerts.length === 0) return null;

    return (
        <div className="alert-overlay">
            {alerts.map((alert) => {
                let timeLabel = '';
                if (alert?.issuedAt) {
                    const date = new Date(alert.issuedAt);
                    if (!Number.isNaN(date.getTime())) {
                        timeLabel = timeFormatter.format(date);
                    }
                }
                return (
                    <div key={alert.id} className="alert-toast">
                        <div className="alert-toast__header">
                            <strong>DM Alert</strong>
                            <button
                                type="button"
                                className="btn ghost btn-small"
                                onClick={() => dismiss?.(alert.id)}
                            >
                                Dismiss
                            </button>
                        </div>
                        <p>{alert.message}</p>
                        <span className="text-muted text-small">
                            {alert.senderName}
                            {timeLabel ? ` · ${timeLabel}` : ''}
                        </span>
                    </div>
                );
            })}
        </div>
    );
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
    const [playerSortMode, setPlayerSortMode] = useState("name");
    const playerCollator = useMemo(
        () => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }),
        [],
    );

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

    const getPlayerLabel = useCallback((player) => {
        if (!player) return "Unnamed player";
        const charName = typeof player.character?.name === "string" ? player.character.name.trim() : "";
        if (charName) return charName;
        const username = typeof player.username === "string" ? player.username.trim() : "";
        if (username) return username;
        return "Unnamed player";
    }, []);

    const getPlayerLevel = useCallback((player) => {
        const raw = player?.character?.resources?.level;
        const num = Number(raw);
        return Number.isFinite(num) ? num : 0;
    }, []);

    const sortedPlayers = useMemo(() => {
        if (!Array.isArray(selectablePlayers) || selectablePlayers.length === 0) {
            return selectablePlayers;
        }
        const arr = [...selectablePlayers];
        arr.sort((a, b) => {
            if (playerSortMode === "player") {
                const aName = typeof a?.username === "string" ? a.username.trim() : "";
                const bName = typeof b?.username === "string" ? b.username.trim() : "";
                const cmp = playerCollator.compare(aName, bName);
                if (cmp !== 0) return cmp;
            } else if (playerSortMode === "levelHigh" || playerSortMode === "levelLow") {
                const aLevel = getPlayerLevel(a);
                const bLevel = getPlayerLevel(b);
                if (aLevel !== bLevel) {
                    return playerSortMode === "levelHigh" ? bLevel - aLevel : aLevel - bLevel;
                }
            }
            const cmpLabel = playerCollator.compare(getPlayerLabel(a), getPlayerLabel(b));
            if (cmpLabel !== 0) return cmpLabel;
            const aName = typeof a?.username === "string" ? a.username.trim() : "";
            const bName = typeof b?.username === "string" ? b.username.trim() : "";
            const cmpUser = playerCollator.compare(aName, bName);
            if (cmpUser !== 0) return cmpUser;
            return playerCollator.compare(String(a?.userId ?? ""), String(b?.userId ?? ""));
        });
        return arr;
    }, [getPlayerLabel, getPlayerLevel, playerCollator, playerSortMode, selectablePlayers]);

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
                            disabled={sortedPlayers.length === 0}
                        >
                            <option value="">Select a player…</option>
                            {sortedPlayers.map((p) => (
                                <option key={p.userId} value={p.userId}>
                                    {getPlayerLabel(p)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span className="field__label">Sort players by</span>
                        <select
                            value={playerSortMode}
                            onChange={(e) => setPlayerSortMode(e.target.value)}
                            disabled={sortedPlayers.length === 0}
                        >
                            <option value="name">Character name (A → Z)</option>
                            <option value="player">Player name (A → Z)</option>
                            <option value="levelHigh">Level (high → low)</option>
                            <option value="levelLow">Level (low → high)</option>
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
                            <p className="text-muted text-small">Handler: {handlerName}</p>
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
                                Capture the essentials, from alignment and arcana to class.
                            </p>
                        </div>
                        <div className="sheet-grid">
                            {textField("Character name", "name")}
                            {textField("Player / handler", "profile.player", { placeholder: slot?.username || me.username })}
                            {textField("Concept / class", "profile.class")}
                            {selectField(
                                "Arcana",
                                "profile.arcana",
                                ARCANA_DATA.map((opt) => ({ ...opt, value: opt.label }))
                            )}
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
                                label="Macca"
                                value={get(ch, "resources.macca")}
                                onCommit={(val) => set("resources.macca", clampNonNegative(val))}
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

    const promptCount = CONCEPT_PROMPTS.length;
    const displayName = playerName?.trim() ? playerName.trim() : "adventurer";

    const [step, setStep] = useState(0);
    const [concept, setConcept] = useState(initial.concept);
    const [abilities, setAbilities] = useState(initial.abilities);
    const [resources, setResources] = useState(initial.resources);
    const [skills, setSkills] = useState(initial.skills);
    const [rolled, setRolled] = useState([]);
    const [conceptPromptIndex, setConceptPromptIndex] = useState(() =>
        promptCount ? Math.floor(Math.random() * promptCount) : 0
    );
    const [promptApplied, setPromptApplied] = useState(false);

    const conceptPrompt = CONCEPT_PROMPTS[conceptPromptIndex] || null;
    const conceptPromptSnippet = conceptPrompt
        ? [conceptPrompt.hook, conceptPrompt.question].filter(Boolean).join("\n")
        : "";
    const progress = Math.round(((step + 1) / steps.length) * 100);

    useEffect(() => {
        if (!open) return;
        setStep(0);
        setConcept(initial.concept);
        setAbilities(initial.abilities);
        setResources(initial.resources);
        setSkills(initial.skills);
        setRolled([]);
        setPromptApplied(false);
        if (promptCount) {
            setConceptPromptIndex(Math.floor(Math.random() * promptCount));
        }
    }, [initial, open, promptCount]);

    useEffect(() => {
        if (!promptApplied) return undefined;
        const timer = setTimeout(() => setPromptApplied(false), 2400);
        return () => clearTimeout(timer);
    }, [promptApplied]);

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

    const cyclePrompt = useCallback(() => {
        if (!promptCount) return;
        setConceptPromptIndex((prev) => {
            if (promptCount <= 1) return prev;
            let next = prev;
            while (next === prev) {
                next = Math.floor(Math.random() * promptCount);
            }
            return next;
        });
        setPromptApplied(false);
    }, [promptCount, setConceptPromptIndex, setPromptApplied]);

    const applyPromptToBackground = useCallback(() => {
        if (!conceptPromptSnippet) return;
        setConcept((prev) => {
            const existing = typeof prev.background === "string" ? prev.background : "";
            if (existing.includes(conceptPromptSnippet)) {
                return prev;
            }
            const trimmed = existing.trim();
            const nextBackground = trimmed
                ? `${trimmed}\n\n${conceptPromptSnippet}`
                : conceptPromptSnippet;
            return { ...prev, background: nextBackground };
        });
        setPromptApplied(true);
    }, [conceptPromptSnippet, setConcept, setPromptApplied]);

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
                Welcome, {displayName}! Collaborate with your table on tone and party balance. Mix and
                match archetypes, and remember that demon allies can round out any gaps. If inspiration
                runs dry, try the prompt generator below.
            </p>
            {conceptPrompt && (
                <div className="wizard-prompt" role="status" aria-live="polite">
                    <div className="wizard-prompt__body">
                        <span className="wizard-prompt__title">{conceptPrompt.title}</span>
                        <p className="wizard-prompt__hook">{conceptPrompt.hook}</p>
                        <p className="wizard-prompt__question">{conceptPrompt.question}</p>
                    </div>
                    <div className="wizard-prompt__actions">
                        <button type="button" className="btn ghost" onClick={cyclePrompt}>
                            New idea
                        </button>
                        <button
                            type="button"
                            className="btn secondary"
                            onClick={applyPromptToBackground}
                        >
                            Add to background
                        </button>
                    </div>
                    {promptApplied && (
                        <span className="wizard-prompt__hint">Prompt added to background</span>
                    )}
                </div>
            )}
            <div className="wizard-grid">
                {conceptField("Character name", "name")}
                {conceptField("Player / handler", "player", { placeholder: playerName || "" })}
                {conceptField("Concept / class", "class")}
                {conceptField("Alignment", "alignment")}
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
                {resourceField("Macca", "macca")}
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
                        <li>Macca {resources.macca}</li>
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
                    <div className="wizard-header__text">
                        <h3>New player setup</h3>
                        <p className="text-muted text-small">{steps[step]?.blurb || ""}</p>
                        <div className="wizard-progress__meta">Step {step + 1} of {steps.length}</div>
                        <div
                            className="wizard-progress"
                            role="progressbar"
                            aria-valuenow={progress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label="Setup progress"
                        >
                            <span className="wizard-progress__bar" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                    <div className="wizard-header__actions">
                        <button type="button" className="btn ghost" onClick={onClose}>
                            Close
                        </button>
                    </div>
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
        macca: clampNonNegative(normalized.resources?.macca),
        initiative: Number(normalized.resources?.initiative) || 0,
        mode: normalized.resources?.useTP ? "TP" : "MP",
        notes: normalized.resources?.notes || "",
    };
    const concept = {
        name: normalized.name || "",
        player: normalized.profile?.player || playerName || "",
        class: normalized.profile?.class || "",
        arcana: normalized.profile?.arcana || "",
        alignment: normalized.profile?.alignment || "",
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
        class: state.concept.class || "",
        arcana: state.concept.arcana || "",
        alignment: state.concept.alignment || "",
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
        macca: clampNonNegative(state.resources.macca),
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
    const realtime = useContext(RealtimeContext);
    const players = useMemo(
        () =>
            (game.players || []).filter(
                (entry) => (entry?.role || "").toLowerCase() !== "dm"
            ),
        [game.players]
    );
    const presenceMap = realtime?.onlineUsers || EMPTY_OBJECT;

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
                        const isOnline = !!(
                            (p.userId && presenceMap[p.userId]) ?? p.online
                        );

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
                                    <span
                                        className={`presence-indicator ${
                                            isOnline ? "is-online" : "is-offline"
                                        }`}
                                    >
                                        {isOnline ? "Online" : "Offline"}
                                    </span>
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
            webhookConfigured: false,
            botTokenConfigured: false,
            primaryBot: normalizePrimaryBot(null),
        };
    }
    const ids = Array.isArray(story.scribeIds)
        ? story.scribeIds.filter((id) => typeof id === "string").sort()
        : [];
    const webhookConfigured = !!(story.webhookConfigured || story.webhookUrl);
    const botTokenConfigured = !!(story.botTokenConfigured || story.botToken);
    return {
        channelId: story.channelId || "",
        guildId: story.guildId || "",
        webhookUrl: story.webhookUrl || "",
        botToken: typeof story.botToken === "string" ? story.botToken : "",
        allowPlayerPosts: !!story.allowPlayerPosts,
        scribeIds: ids,
        webhookConfigured,
        botTokenConfigured,
        primaryBot: normalizePrimaryBot(story.primaryBot),
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

function CombatSkillsTab({ game, me, onUpdate }) {
    const isDM = game.dmId === me.id;
    const abilityDefault = ABILITY_DEFS[0]?.key || "INT";
    const combatSkills = useMemo(() => normalizeCombatSkillDefs(game.combatSkills), [game.combatSkills]);
    const worldSkills = useMemo(() => normalizeWorldSkillDefs(game.worldSkills), [game.worldSkills]);
    const demons = useMemo(
        () => (Array.isArray(game.demons) ? game.demons.filter(Boolean) : EMPTY_ARRAY),
        [game.demons]
    );
    const [skillQuery, setSkillQuery] = useState("");
    const [skillSort, setSkillSort] = useState("default");
    const [editingSkillId, setEditingSkillId] = useState(null);
    const [form, setForm] = useState({
        label: "",
        ability: abilityDefault,
        tier: COMBAT_TIER_ORDER[0],
        category: DEFAULT_COMBAT_CATEGORY,
        cost: "",
        notes: "",
    });
    const [activePane, setActivePane] = useState("library");
    const [busy, setBusy] = useState(false);
    const [rowBusy, setRowBusy] = useState(null);
    const canManage = isDM || !!game.permissions?.canEditCombatSkills;

    useEffect(() => {
        setSkillQuery("");
        setSkillSort("default");
        setEditingSkillId(null);
        setForm({
            label: "",
            ability: abilityDefault,
            tier: COMBAT_TIER_ORDER[0],
            category: DEFAULT_COMBAT_CATEGORY,
            cost: "",
            notes: "",
        });
        setActivePane("library");
    }, [game.id, abilityDefault]);

    const editingSkill = useMemo(() => {
        if (!editingSkillId || editingSkillId === NEW_COMBAT_SKILL_ID) return null;
        return combatSkills.find((skill) => skill.id === editingSkillId) || null;
    }, [editingSkillId, combatSkills]);

    useEffect(() => {
        if (activePane !== "library" && editingSkillId) {
            setEditingSkillId(null);
        }
    }, [activePane, editingSkillId]);

    useEffect(() => {
        if (!canManage && editingSkillId) {
            setEditingSkillId(null);
        }
    }, [canManage, editingSkillId]);

    useEffect(() => {
        if (editingSkill) {
            setForm({
                label: editingSkill.label || "",
                ability: ABILITY_KEY_SET.has(editingSkill.ability) ? editingSkill.ability : abilityDefault,
                tier: COMBAT_TIER_ORDER.includes(editingSkill.tier) ? editingSkill.tier : COMBAT_TIER_ORDER[0],
                category: normalizeCombatCategoryValue(editingSkill.category),
                cost: editingSkill.cost || "",
                notes: editingSkill.notes || "",
            });
        } else {
            setForm((prev) =>
                prev.label === "" &&
                prev.ability === abilityDefault &&
                prev.tier === COMBAT_TIER_ORDER[0] &&
                prev.category === DEFAULT_COMBAT_CATEGORY &&
                prev.cost === "" &&
                prev.notes === ""
                    ? prev
                    : {
                          label: "",
                          ability: abilityDefault,
                          tier: COMBAT_TIER_ORDER[0],
                          category: DEFAULT_COMBAT_CATEGORY,
                          cost: "",
                          notes: "",
                      }
            );
        }
    }, [editingSkill, abilityDefault]);

    const filteredSkills = useMemo(() => {
        const q = skillQuery.trim().toLowerCase();
        let list = combatSkills.slice();
        if (q) {
            list = list.filter((skill) => {
                const label = skill.label.toLowerCase();
                const ability = skill.ability.toLowerCase();
                const tierLabel = COMBAT_TIER_LABELS[skill.tier]?.toLowerCase() || "";
                const categoryLabel = COMBAT_CATEGORY_LABELS[skill.category]?.toLowerCase() || "";
                const notes = (skill.notes || "").toLowerCase();
                const cost = (skill.cost || "").toLowerCase();
                return (
                    label.includes(q) ||
                    ability.includes(q) ||
                    tierLabel.includes(q) ||
                    categoryLabel.includes(q) ||
                    notes.includes(q) ||
                    cost.includes(q)
                );
            });
        }
        const comparator = COMBAT_SKILL_SORTERS[skillSort] || null;
        if (comparator) list.sort(comparator);
        return list;
    }, [combatSkills, skillQuery, skillSort]);

    const displaySkills = useMemo(() => {
        if (!editingSkill) return filteredSkills;
        if (filteredSkills.some((skill) => skill.id === editingSkill.id)) return filteredSkills;
        return [editingSkill, ...filteredSkills];
    }, [editingSkill, filteredSkills]);

    const hasFilters = skillQuery.trim().length > 0 || skillSort !== "default";

    const playerOptions = useMemo(() => {
        const players = (game.players || []).filter((p) => (p?.role || "").toLowerCase() !== "dm");
        return players
            .filter((p) => isDM || p.userId === me.id)
            .map((p) => {
                const character = normalizeCharacter(p.character, worldSkills);
                const label = character?.name?.trim() || p.username || "Unnamed Adventurer";
                const mods = ABILITY_DEFS.reduce((acc, ability) => {
                    acc[ability.key] = abilityModifier(character?.stats?.[ability.key]);
                    return acc;
                }, {});
                return { value: p.userId || `slot-${label}`, label, mods };
            });
    }, [game.players, isDM, me.id, worldSkills]);

    const startCreate = useCallback(() => {
        if (!canManage) return;
        setActivePane("library");
        setEditingSkillId(NEW_COMBAT_SKILL_ID);
        setForm({
            label: "",
            ability: abilityDefault,
            tier: COMBAT_TIER_ORDER[0],
            category: DEFAULT_COMBAT_CATEGORY,
            cost: "",
            notes: "",
        });
    }, [abilityDefault, canManage]);

    const startEdit = useCallback(
        (skill) => {
            if (!canManage) return;
            if (!skill) {
                setEditingSkillId(null);
                return;
            }
            setActivePane("library");
            setEditingSkillId(skill.id);
        },
        [canManage]
    );

    const cancelEdit = useCallback(() => {
        setEditingSkillId(null);
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!canManage) return;
        const label = form.label.trim();
        if (!label) {
            alert("Skill needs a name");
            return;
        }
        const payload = {
            label,
            ability: ABILITY_KEY_SET.has(form.ability) ? form.ability : abilityDefault,
            tier: COMBAT_TIER_ORDER.includes(form.tier) ? form.tier : COMBAT_TIER_ORDER[0],
            category: normalizeCombatCategoryValue(form.category),
            cost: form.cost.trim(),
            notes: form.notes.trim(),
        };
        try {
            if (editingSkillId === NEW_COMBAT_SKILL_ID) {
                setBusy(true);
                await Games.addCombatSkill(game.id, payload);
            } else if (editingSkill) {
                setRowBusy(editingSkill.id);
                await Games.updateCombatSkill(game.id, editingSkill.id, payload);
            }
            setEditingSkillId(null);
            await onUpdate?.();
        } catch (err) {
            alert(err?.message || "Failed to save combat skill");
        } finally {
            setBusy(false);
            setRowBusy(null);
        }
    }, [abilityDefault, canManage, editingSkill, editingSkillId, form, game.id, onUpdate]);

    const handleDelete = useCallback(
        async (skill) => {
            if (!canManage || !skill) return;
            const confirmed = confirm(`Delete ${skill.label}? This cannot be undone.`);
            if (!confirmed) return;
            try {
                setRowBusy(skill.id);
                await Games.deleteCombatSkill(game.id, skill.id);
                await onUpdate?.();
            } catch (err) {
                alert(err?.message || "Failed to delete combat skill");
            } finally {
                setRowBusy(null);
            }
        },
        [canManage, game.id, onUpdate]
    );

    const renderSkillEditor = (mode) => {
        const disableSubmit = busy || !canManage || (mode === "edit" && rowBusy === editingSkill?.id);
        const submitLabel = mode === "create" ? "Add skill" : "Save changes";
        return (
            <form
                className="combat-skill-editor"
                onSubmit={(evt) => {
                    evt.preventDefault();
                    handleSubmit();
                }}
            >
                <label className="text-small" htmlFor={`${mode}-combat-name`}>
                    Name
                    <input
                        id={`${mode}-combat-name`}
                        type="text"
                        value={form.label}
                        onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                        disabled={disableSubmit}
                    />
                </label>
                <div className="row wrap" style={{ gap: 12 }}>
                    <label className="col text-small">
                        Ability
                        <select
                            value={form.ability}
                            onChange={(e) => setForm((prev) => ({ ...prev, ability: e.target.value }))}
                            disabled={disableSubmit}
                        >
                            {ABILITY_DEFS.map((ability) => (
                                <option key={ability.key} value={ability.key}>
                                    {ability.key} · {ability.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="col text-small">
                        Tier
                        <select
                            value={form.tier}
                            onChange={(e) => setForm((prev) => ({ ...prev, tier: e.target.value }))}
                            disabled={disableSubmit}
                        >
                            {COMBAT_TIER_ORDER.map((tier) => (
                                <option key={tier} value={tier}>
                                    {COMBAT_TIER_LABELS[tier]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="col text-small">
                        Category
                        <select
                            value={form.category}
                            onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                            disabled={disableSubmit}
                        >
                            {COMBAT_CATEGORY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <label className="text-small" htmlFor={`${mode}-combat-cost`}>
                    Cost / resources
                    <input
                        id={`${mode}-combat-cost`}
                        type="text"
                        value={form.cost}
                        onChange={(e) => setForm((prev) => ({ ...prev, cost: e.target.value }))}
                        disabled={disableSubmit}
                    />
                </label>
                <label className="text-small" htmlFor={`${mode}-combat-notes`}>
                    Notes
                    <textarea
                        id={`${mode}-combat-notes`}
                        value={form.notes}
                        rows={3}
                        onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                        disabled={disableSubmit}
                    />
                </label>
                <div className="combat-skill-editor__actions">
                    <button type="submit" className="btn" disabled={disableSubmit}>
                        {disableSubmit ? "…" : submitLabel}
                    </button>
                    <button type="button" className="btn ghost" onClick={cancelEdit} disabled={disableSubmit}>
                        Cancel
                    </button>
                </div>
            </form>
        );
    };

    return (
        <div className="stack-lg combat-skill-tab">
            <div className="card">
                <div className="combat-skill-manager__header">
                    <div>
                        <h3>Combat Skills</h3>
                        <p className="text-muted text-small">
                            Share combat techniques and guide players through the Battle Math quick reference.
                        </p>
                    </div>
                </div>
                <div className="combat-skill-manager__nav" role="tablist" aria-label="Combat skill views">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activePane === "library"}
                        className={`combat-skill-manager__tab${
                            activePane === "library" ? " is-active" : ""
                        }`}
                        onClick={() => setActivePane("library")}
                    >
                        Skill library
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activePane === "codex"}
                        className={`combat-skill-manager__tab${
                            activePane === "codex" ? " is-active" : ""
                        }`}
                        onClick={() => setActivePane("codex")}
                    >
                        Demon codex
                    </button>
                </div>
                {activePane === "library" ? (
                    <>
                        <div className="combat-skill-manager__filters row wrap">
                            <label className="text-small" style={{ flexGrow: 1 }}>
                                Search
                                <input
                                    type="search"
                                    value={skillQuery}
                                    onChange={(e) => setSkillQuery(e.target.value)}
                                    placeholder="Filter by name, tier, or notes"
                                />
                            </label>
                            <label className="text-small">
                                Sort by
                                <select value={skillSort} onChange={(e) => setSkillSort(e.target.value)}>
                                    {COMBAT_SKILL_SORT_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {hasFilters && (
                                <button
                                    type="button"
                                    className="btn ghost btn-small"
                                    onClick={() => {
                                        setSkillQuery("");
                                        setSkillSort("default");
                                    }}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div className="combat-skill-grid">
                            {displaySkills.map((skill) => {
                                const isEditing = editingSkill && editingSkill.id === skill.id;
                                return (
                                    <div key={skill.id} className={`combat-skill-card${isEditing ? " is-editing" : ""}`}>
                                        {isEditing ? (
                                            renderSkillEditor("edit")
                                        ) : (
                                            <>
                                                <div className="combat-skill-card__header">
                                                    <h4>{skill.label}</h4>
                                                    <div className="combat-skill-card__badges">
                                                        <span className="pill">{COMBAT_TIER_LABELS[skill.tier] || "Tier"}</span>
                                                        <span className="pill light">{skill.ability} mod</span>
                                                        <span className="pill light">{COMBAT_CATEGORY_LABELS[skill.category] || "Other"}</span>
                                                    </div>
                                                </div>
                                                {skill.cost && (
                                                    <div className="combat-skill-card__meta text-small">Cost: {skill.cost}</div>
                                                )}
                                                {skill.notes && (
                                                    <p className="combat-skill-card__notes text-small">{skill.notes}</p>
                                                )}
                                                <CombatSkillCalculator skill={skill} playerOptions={playerOptions} />
                                                {canManage && (
                                                    <div className="combat-skill-card__actions">
                                                        <button
                                                            type="button"
                                                            className="btn ghost btn-small"
                                                            onClick={() => startEdit(skill)}
                                                            disabled={busy || rowBusy === skill.id}
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn ghost btn-small"
                                                            onClick={() => handleDelete(skill)}
                                                            disabled={busy || rowBusy === skill.id}
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                            {canManage && (
                                <div
                                    className={`combat-skill-card combat-skill-card--add${
                                        editingSkillId === NEW_COMBAT_SKILL_ID ? " is-editing" : ""
                                    }`}
                                >
                                    {editingSkillId === NEW_COMBAT_SKILL_ID ? (
                                        renderSkillEditor("create")
                                    ) : (
                                        <button
                                            type="button"
                                            className="combat-skill-card__add-btn"
                                            onClick={startCreate}
                                            disabled={busy || !canManage}
                                        >
                                            <span className="combat-skill-card__plus" aria-hidden="true">
                                                +
                                            </span>
                                            <span>New combat skill</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                        {displaySkills.length === 0 && !canManage && (
                            <p className="text-muted text-small" style={{ marginTop: 12 }}>
                                No combat skills are available yet.
                            </p>
                        )}
                    </>
                ) : (
                    <CombatSkillCodexPanel demons={demons} skills={combatSkills} />
                )}
            </div>
        </div>
    );
}

function CombatSkillCalculator({ skill, playerOptions }) {
    const tierInfo = COMBAT_TIER_INFO[skill.tier] || COMBAT_TIER_INFO.WEAK;
    const options = useMemo(
        () => [{ value: "", label: "Manual entry", mods: {} }, ...playerOptions],
        [playerOptions]
    );
    const [playerId, setPlayerId] = useState(options[0]?.value || "");
    const [modInput, setModInput] = useState("");
    const [rollInput, setRollInput] = useState("");
    const [bonusInput, setBonusInput] = useState("");
    const [buffInput, setBuffInput] = useState("1");
    const [critical, setCritical] = useState(false);

    useEffect(() => {
        if (!options.some((option) => option.value === playerId)) {
            setPlayerId(options[0]?.value || "");
        }
    }, [options, playerId]);

    const selected = options.find((option) => option.value === playerId) || options[0];
    const autoMod = selected && selected.value ? selected.mods?.[skill.ability] ?? 0 : 0;

    const manualModRaw = modInput.trim();
    const manualModValue = Number(modInput);
    const manualModValid = manualModRaw === "" || Number.isFinite(manualModValue);
    const abilityMod = manualModRaw === "" ? autoMod : manualModValue;

    const rollRaw = rollInput.trim();
    const bonusRaw = bonusInput.trim();
    const buffRaw = buffInput.trim();
    const rollValue = rollRaw === "" ? null : Number(rollInput);
    const bonusValue = bonusRaw === "" ? 0 : Number(bonusInput);
    const buffValue = buffRaw === "" ? 1 : Number(buffInput);
    const rollValid = rollRaw === "" || Number.isFinite(rollValue);
    const bonusValid = bonusRaw === "" || Number.isFinite(bonusValue);
    const buffValid = buffRaw === "" || Number.isFinite(buffValue);

    let damage = null;
    if (manualModValid && rollValid && bonusValid && buffValid && rollValue !== null) {
        damage = computeCombatSkillDamage({
            tier: skill.tier,
            abilityMod,
            roll: rollValue,
            bonus: bonusValue,
            buff: buffValue,
            critical,
        });
    }

    const resultTotal = damage ? damage.total : "—";
    const modDisplay = manualModRaw === "" ? autoMod : abilityMod;

    const handleReset = () => {
        setModInput("");
        setRollInput("");
        setBonusInput("");
        setBuffInput("1");
        setCritical(false);
    };

    return (
        <div className="combat-calculator">
            {playerOptions.length > 0 && (
                <label className="text-small">
                    Acting player
                    <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
                        {options.map((option) => (
                            <option key={option.value || "__manual"} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            <div className="row wrap" style={{ gap: 12 }}>
                <label className="col text-small">
                    Ability modifier ({skill.ability})
                    <input
                        type="number"
                        value={modInput}
                        placeholder={String(autoMod)}
                        onChange={(e) => setModInput(e.target.value)}
                        className={manualModValid ? undefined : "input-error"}
                    />
                </label>
                <label className="col text-small">
                    Roll total ({tierInfo.dice})
                    <input
                        type="number"
                        value={rollInput}
                        placeholder={`Roll ${tierInfo.dice}`}
                        onChange={(e) => setRollInput(e.target.value)}
                        className={rollValid ? undefined : "input-error"}
                    />
                </label>
            </div>
            <div className="row wrap" style={{ gap: 12 }}>
                <label className="col text-small">
                    Bonus damage
                    <input
                        type="number"
                        value={bonusInput}
                        placeholder="0"
                        onChange={(e) => setBonusInput(e.target.value)}
                        className={bonusValid ? undefined : "input-error"}
                    />
                </label>
                <label className="col text-small">
                    Buff multiplier
                    <input
                        type="number"
                        step="0.01"
                        value={buffInput}
                        placeholder="1"
                        onChange={(e) => setBuffInput(e.target.value)}
                        className={buffValid ? undefined : "input-error"}
                    />
                </label>
            </div>
            <label className="checkbox">
                <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
                Critical hit (+75% damage)
            </label>
            <div className="combat-calculator__result">
                <div className="combat-calculator__total">{resultTotal}</div>
                <div className="text-small text-muted">
                    Ask the acting player to roll {tierInfo.dice}. Enter the total above, then round up the result.
                </div>
                {damage && (
                    <div className="text-small text-muted">
                        Roll {damage.baseRoll} + ability ({skill.ability} × {tierInfo.modMultiplier} = {formatModifier(damage.abilityContribution)})
                        {damage.bonus ? ` + bonus ${formatModifier(damage.bonus)}` : ""}
                        {critical ? " → crit ×1.75" : ""}
                        {damage.buffMultiplier !== 1 ? ` → buffs ×${damage.buffMultiplier}` : ""}
                        → round up = {damage.total}
                    </div>
                )}
            </div>
            <div className="combat-calculator__footer">
                <span className="text-small text-muted">Using modifier {formatModifier(modDisplay)}.</span>
                <button type="button" className="btn ghost btn-small" onClick={handleReset}>
                    Clear inputs
                </button>
            </div>
        </div>
    );
}

function CombatSkillCodexPanel({ demons, skills }) {
    const demonOptions = useMemo(() => {
        if (!Array.isArray(demons) || demons.length === 0) return EMPTY_ARRAY;
        return demons.map((demon, index) => {
            const value = demon?.id || `demon-${index}`;
            const name = typeof demon?.name === "string" && demon.name.trim() ? demon.name.trim() : `Demon ${index + 1}`;
            const arcana = typeof demon?.arcana === "string" && demon.arcana.trim() ? demon.arcana.trim() : "";
            const alignment = typeof demon?.alignment === "string" && demon.alignment.trim() ? demon.alignment.trim() : "";
            const levelRaw = Number(demon?.level);
            const level = Number.isFinite(levelRaw) ? levelRaw : null;
            const label = arcana ? `${name} · ${arcana}` : name;
            return { value, demon, label, name, arcana, alignment, level };
        });
    }, [demons]);

    const [selectedId, setSelectedId] = useState(() => demonOptions[0]?.value || "");

    useEffect(() => {
        if (demonOptions.length === 0) {
            setSelectedId("");
            return;
        }
        if (!demonOptions.some((option) => option.value === selectedId)) {
            setSelectedId(demonOptions[0].value);
        }
    }, [demonOptions, selectedId]);

    const activeMeta = useMemo(
        () => demonOptions.find((option) => option.value === selectedId) || null,
        [demonOptions, selectedId]
    );
    const activeDemon = activeMeta?.demon || null;

    const [query, setQuery] = useState("");

    useEffect(() => {
        setQuery("");
    }, [selectedId]);

    const demonSkillList = useMemo(() => getDemonSkillList(activeDemon), [activeDemon]);
    const demonSkillSet = useMemo(() => {
        return new Set(demonSkillList.map((name) => name.toLowerCase()));
    }, [demonSkillList]);
    const matchedSkills = useMemo(() => {
        if (!Array.isArray(skills) || skills.length === 0 || demonSkillSet.size === 0) return EMPTY_ARRAY;
        return skills.filter((skill) => demonSkillSet.has(skill.label.toLowerCase()));
    }, [demonSkillSet, skills]);
    const unmatchedSkills = useMemo(() => {
        if (demonSkillList.length === 0) return EMPTY_ARRAY;
        const matchedLabels = new Set(matchedSkills.map((skill) => skill.label.toLowerCase()));
        return demonSkillList.filter((label) => !matchedLabels.has(label.toLowerCase()));
    }, [demonSkillList, matchedSkills]);
    const filteredSkills = useMemo(() => {
        if (matchedSkills.length === 0) return matchedSkills;
        const term = query.trim().toLowerCase();
        if (!term) return matchedSkills;
        return matchedSkills.filter((skill) => {
            const tierLabel = (COMBAT_TIER_LABELS[skill.tier] || "").toLowerCase();
            const categoryLabel = (COMBAT_CATEGORY_LABELS[skill.category] || "").toLowerCase();
            const notes = (skill.notes || "").toLowerCase();
            const cost = (skill.cost || "").toLowerCase();
            return (
                skill.label.toLowerCase().includes(term) ||
                skill.ability.toLowerCase().includes(term) ||
                tierLabel.includes(term) ||
                categoryLabel.includes(term) ||
                notes.includes(term) ||
                cost.includes(term)
            );
        });
    }, [matchedSkills, query]);

    if (demonOptions.length === 0) {
        return (
            <div className="combat-codex__empty text-muted text-small">
                Add demons to your roster to explore their combat skills.
            </div>
        );
    }

    const displayName = activeMeta?.name || activeMeta?.label || "Selected demon";
    const levelLabel = typeof activeMeta?.level === "number" ? `Lv ${activeMeta.level}` : null;

    return (
        <div className="combat-codex">
            <div className="combat-codex__controls">
                <label className="text-small combat-codex__control">
                    Demon
                    <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                        {demonOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                {matchedSkills.length > 0 && (
                    <label className="text-small combat-codex__control">
                        Filter skills
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search by name, ability, or notes"
                        />
                    </label>
                )}
            </div>
            {activeDemon ? (
                <div className="combat-codex__content">
                    <div className="combat-codex__summary">
                        <h4>{displayName}</h4>
                        <div className="combat-codex__meta">
                            {levelLabel && <span className="pill">{levelLabel}</span>}
                            {activeMeta?.arcana && <span className="pill light">{activeMeta.arcana}</span>}
                            {activeMeta?.alignment && <span className="pill light">{activeMeta.alignment}</span>}
                        </div>
                        {matchedSkills.length > 0 ? (
                            <p className="text-small text-muted">
                                Showing {filteredSkills.length} of {matchedSkills.length} linked skills from the codex.
                            </p>
                        ) : demonSkillList.length > 0 ? (
                            <p className="text-small text-muted">
                                No combat skills in the codex match these names yet.
                            </p>
                        ) : (
                            <p className="text-small text-muted">This demon does not list any combat skills yet.</p>
                        )}
                    </div>
                    {matchedSkills.length > 0 ? (
                        <div className="combat-codex__skills">
                            {filteredSkills.length > 0 ? (
                                filteredSkills.map((skill) => (
                                    <article key={skill.id} className="demon-skill-modal__item">
                                        <div className="demon-skill-modal__item-header">
                                            <h4>{skill.label}</h4>
                                            <div className="demon-skill-modal__badges">
                                                <span className="pill">{COMBAT_TIER_LABELS[skill.tier] || "Tier"}</span>
                                                <span className="pill light">{skill.ability} mod</span>
                                                <span className="pill light">{COMBAT_CATEGORY_LABELS[skill.category] || "Other"}</span>
                                            </div>
                                        </div>
                                        {skill.cost && <div className="text-small">Cost: {skill.cost}</div>}
                                        {skill.notes && <p className="text-small">{skill.notes}</p>}
                                    </article>
                                ))
                            ) : (
                                <div className="combat-codex__empty text-small text-muted">
                                    No combat skills match that filter.
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="combat-codex__empty text-small text-muted">
                            {demonSkillList.length === 0
                                ? "This demon does not list any combat skills yet."
                                : "No combat skills in the codex match these names."}
                        </div>
                    )}
                    {unmatchedSkills.length > 0 && (
                        <div className="combat-codex__unmatched text-small">
                            <strong>Unlinked skills:</strong> {unmatchedSkills.join(", ")}
                        </div>
                    )}
                </div>
            ) : (
                <div className="combat-codex__empty text-muted text-small">
                    Select a demon to view codex matches.
                </div>
            )}
        </div>
    );
}

function WorldSkillsTab({ game, me, onUpdate }) {
    const isDM = game.dmId === me.id;
    const abilityDefault = ABILITY_DEFS[0]?.key || "INT";
    const worldSkills = useMemo(() => normalizeWorldSkillDefs(game.worldSkills), [game.worldSkills]);
    const [skillQuery, setSkillQuery] = useState("");
    const [skillSort, setSkillSort] = useState("default");
    const [skillForm, setSkillForm] = useState({ label: "", ability: abilityDefault });
    const [editingSkillId, setEditingSkillId] = useState(null);
    const editingSkill = useMemo(() => {
        if (!editingSkillId || editingSkillId === NEW_WORLD_SKILL_ID) return null;
        return worldSkills.find((skill) => skill.id === editingSkillId) || null;
    }, [editingSkillId, worldSkills]);
    const [skillBusy, setSkillBusy] = useState(false);
    const [skillRowBusy, setSkillRowBusy] = useState(null);
    const isCreatingSkill = editingSkillId === NEW_WORLD_SKILL_ID;
    const abilityDetails = useMemo(
        () =>
            ABILITY_DEFS.reduce((map, ability) => {
                map[ability.key] = ability;
                return map;
            }, {}),
        []
    );

    const resetSkillForm = useCallback(() => {
        setEditingSkillId(null);
        setSkillForm({ label: "", ability: abilityDefault });
    }, [abilityDefault]);

    useEffect(() => {
        resetSkillForm();
    }, [game.id, resetSkillForm]);

    useEffect(() => {
        setSkillQuery("");
        setSkillSort("default");
    }, [game.id]);

    const startCreateSkill = useCallback(() => {
        setEditingSkillId(NEW_WORLD_SKILL_ID);
        setSkillForm({ label: "", ability: abilityDefault });
    }, [abilityDefault, setEditingSkillId, setSkillForm]);

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

    const filteredSkills = useMemo(() => {
        const query = skillQuery.trim().toLowerCase();
        if (!query && skillSort === "default") {
            return worldSkills;
        }
        let list = worldSkills.slice();
        if (query) {
            list = list.filter((skill) => {
                const label = skill.label.toLowerCase();
                const ability = skill.ability.toLowerCase();
                const abilityLabel = abilityDetails[skill.ability]?.label?.toLowerCase() || "";
                return label.includes(query) || ability.includes(query) || abilityLabel.includes(query);
            });
        }
        const comparator = WORLD_SKILL_SORTERS[skillSort] || null;
        if (comparator) {
            list.sort(comparator);
        }
        return list;
    }, [abilityDetails, skillQuery, skillSort, worldSkills]);

    const displaySkills = useMemo(() => {
        if (!editingSkill) return filteredSkills;
        if (filteredSkills.some((skill) => skill.id === editingSkill.id)) {
            return filteredSkills;
        }
        return [editingSkill, ...filteredSkills];
    }, [editingSkill, filteredSkills]);

    const hasSkillFilters = skillQuery.trim().length > 0 || skillSort !== "default";

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
            const targetId =
                editingSkillId && editingSkillId !== NEW_WORLD_SKILL_ID
                    ? editingSkillId
                    : null;
            if (targetId && editingSkill) {
                await Games.updateWorldSkill(game.id, targetId, { label, ability });
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
    }, [
        abilityDefault,
        editingSkill,
        editingSkillId,
        game.id,
        isDM,
        onUpdate,
        resetSkillForm,
        skillForm.ability,
        skillForm.label,
    ]);

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

    const updateSkill = useCallback(
        (key, field, value) => {
            setSkills((prev) => {
                const next = { ...prev };
                const current = { ...(next[key] || { ranks: 0, misc: 0 }) };
                if (field === "ranks") {
                    const sanitized = clampNonNegative(value);
                    current.ranks = Math.min(sanitized, maxSkillRank);
                } else if (field === "misc") {
                    const num = Number(value);
                    current.misc = Number.isFinite(num) ? num : 0;
                }
                next[key] = current;
                return next;
            });
        },
        [maxSkillRank]
    );

    const handleTakeAwaySkill = useCallback(
        (skillKey, skillLabel) => {
            if (!isDM || !skillKey) return;
            const entry = skills?.[skillKey];
            if (entry && entry.ranks === 0 && entry.misc === 0) {
                return;
            }
            const label = typeof skillLabel === "string" && skillLabel.trim() ? skillLabel.trim() : null;
            const name = label ? label : "this skill";
            const confirmed = confirm(
                `Take away ${name}? This resets their ranks and misc bonuses.`
            );
            if (!confirmed) return;
            setSkills((prev) => {
                const current = prev?.[skillKey];
                if (current && current.ranks === 0 && current.misc === 0) {
                    return prev;
                }
                return { ...prev, [skillKey]: { ranks: 0, misc: 0 } };
            });
        },
        [isDM, skills]
    );

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

    const renderSkillEditor = (mode) => {
        const submitLabel =
            skillBusy ? "Saving…" : mode === "edit" ? "Save changes" : "Add skill";
        return (
            <form
                className="world-skill-card__form"
                onSubmit={(e) => {
                    e.preventDefault();
                    void handleSkillSubmit();
                }}
            >
                <label className="field">
                    <span className="field__label">Skill name</span>
                    <input
                        value={skillForm.label}
                        onChange={(e) =>
                            setSkillForm((prev) => ({
                                ...prev,
                                label: e.target.value,
                            }))
                        }
                        placeholder="e.g. Tracking"
                        autoFocus
                    />
                </label>
                <label className="field">
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
                <div className="world-skill-card__actions">
                    <button
                        type="submit"
                        className="btn btn-small"
                        disabled={skillBusy || !skillForm.label.trim()}
                    >
                        {submitLabel}
                    </button>
                    <button
                        type="button"
                        className="btn btn-small secondary"
                        onClick={resetSkillForm}
                        disabled={skillBusy}
                    >
                        Cancel
                    </button>
                </div>
            </form>
        );
    };

    return (
        <div className="col" style={{ display: "grid", gap: 16 }}>
            {isDM && (
                <div className="card world-skill-manager">
                    <div className="world-skill-manager__header">
                        <div>
                            <h3>Manage world skills</h3>
                            <p className="text-muted text-small">
                                Craft the world's challenges with a glance. Edit cards below or add new
                                expertise with the plus tile.
                            </p>
                        </div>
                        <div className="world-skill-manager__header-actions">
                            {(editingSkill || isCreatingSkill) && (
                                <span className="world-skill-manager__status text-small">
                                    {editingSkill?.label
                                        ? `Editing ${editingSkill.label}`
                                        : "Creating a new world skill"}
                                </span>
                            )}
                            <div className="world-skill-manager__tools">
                                <input
                                    type="search"
                                    className="world-skill-manager__search"
                                    placeholder="Search skills…"
                                    value={skillQuery}
                                    onChange={(e) => setSkillQuery(e.target.value)}
                                    aria-label="Search world skills"
                                />
                                <label className="world-skill-manager__sort text-small">
                                    <span>Sort by</span>
                                    <select
                                        value={skillSort}
                                        onChange={(e) => setSkillSort(e.target.value)}
                                        aria-label="Sort world skills"
                                    >
                                        {WORLD_SKILL_SORT_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="world-skill-grid">
                        {worldSkills.length === 0 && !isCreatingSkill && (
                            <div className="world-skill-empty">
                                <strong>No world skills yet</strong>
                                <span className="text-muted text-small">
                                    Use the plus card to create your first training option.
                                </span>
                            </div>
                        )}
                        {displaySkills.length === 0 && worldSkills.length > 0 && hasSkillFilters && (
                            <div className="world-skill-empty">
                                <strong>No skills match your filters</strong>
                                <span className="text-muted text-small">
                                    Adjust your search or sorting to see the full list.
                                </span>
                            </div>
                        )}
                        {displaySkills.map((skill) => {
                            const abilityInfo = abilityDetails[skill.ability] || null;
                            const isEditing = editingSkillId === skill.id;
                            return (
                                <div
                                    key={skill.id}
                                    className={`world-skill-card${isEditing ? " is-editing" : ""}`}
                                >
                                    <div className="world-skill-card__header">
                                        <span className="world-skill-card__badge">{skill.ability}</span>
                                        <button
                                            type="button"
                                            className="world-skill-card__delete"
                                            onClick={() => handleSkillDelete(skill.id)}
                                            disabled={skillRowBusy === skill.id || skillBusy || isEditing}
                                            aria-label={`Delete ${skill.label}`}
                                        >
                                            {skillRowBusy === skill.id ? "…" : "×"}
                                        </button>
                                    </div>
                                    {isEditing ? (
                                        renderSkillEditor("edit")
                                    ) : (
                                        <div className="world-skill-card__body">
                                            <h4>{skill.label}</h4>
                                            <span className="pill light">
                                                {skill.ability}
                                                {abilityInfo ? ` · ${abilityInfo.label}` : ""}
                                            </span>
                                            {abilityInfo?.summary && (
                                                <p className="text-muted text-small">
                                                    {abilityInfo.summary}
                                                </p>
                                            )}
                                            <div className="world-skill-card__actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small ghost"
                                                    onClick={() => startEditSkill(skill)}
                                                    disabled={skillBusy || skillRowBusy === skill.id}
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        <div
                            className={`world-skill-card world-skill-card--add${
                                isCreatingSkill ? " is-editing" : ""
                            }`}
                        >
                            {isCreatingSkill ? (
                                renderSkillEditor("create")
                            ) : (
                                <button
                                    type="button"
                                    className="world-skill-card__add-btn"
                                    onClick={startCreateSkill}
                                    disabled={skillBusy}
                                >
                                    <span className="world-skill-card__plus" aria-hidden="true">
                                        +
                                    </span>
                                    <span>New world skill</span>
                                </button>
                            )}
                        </div>
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
                                            {isDM && <th aria-label="Actions" />}
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
                                                {isDM && (
                                                    <td>
                                                        <button
                                                            type="button"
                                                            className="btn btn-small danger"
                                                            onClick={() => handleTakeAwaySkill(row.key, row.label)}
                                                            disabled={
                                                                disableInputs ||
                                                                (row.ranks === 0 && row.misc === 0)
                                                            }
                                                        >
                                                            Take away
                                                        </button>
                                                    </td>
                                                )}
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
    const [form, setForm] = useState({ name: "", type: "", desc: "", libraryItemId: "" });
    const [editing, setEditing] = useState(null);
    const [busySave, setBusySave] = useState(false);
    const [busyRow, setBusyRow] = useState(null);
    const [busyRowAction, setBusyRowAction] = useState(null);
    const [selectedPlayerId, setSelectedPlayerId] = useState("");
    const [giveBusyId, setGiveBusyId] = useState(null);

    const isDM = game.dmId === me.id;
    const canEdit = isDM || game.permissions?.canEditItems;

    const libraryCatalog = useMemo(() => {
        const map = new Map();
        for (const item of premade) {
            if (item?.id) map.set(item.id, item);
        }
        return map;
    }, [premade]);

    const resetForm = useCallback(() => {
        setEditing(null);
        setForm({ name: "", type: "", desc: "", libraryItemId: "" });
    }, []);

    const applyLibraryToForm = useCallback(
        (libraryId) => {
            setForm((prev) => {
                if (!libraryId) {
                    return { ...prev, libraryItemId: "" };
                }
                const linked = libraryCatalog.get(libraryId);
                const next = { ...prev, libraryItemId: libraryId };
                if (linked && prev.libraryItemId !== libraryId) {
                    next.name = linked.name || "";
                    next.type = linked.type || "";
                    next.desc = linked.desc || "";
                }
                return next;
            });
        },
        [libraryCatalog],
    );

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const data = await Items.premade();
                if (mounted) {
                    setPremade(Array.isArray(data) ? data : []);
                }
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

    const formLinked = form.libraryItemId ? libraryCatalog.get(form.libraryItemId) : null;
    const formLinkedEffect = formLinked ? formatHealingEffect(formLinked.healing) : "";

    const save = useCallback(
        async (itemOverride) => {
            const source = itemOverride || form;
            const payload = {
                name: (source.name || "").trim(),
                type: (source.type || "").trim(),
                desc: (source.desc || "").trim(),
            };
            if (!payload.name) {
                alert("Item needs a name");
                return;
            }
            const rawIdSource =
                itemOverride && Object.prototype.hasOwnProperty.call(itemOverride, "libraryItemId")
                    ? itemOverride.libraryItemId
                    : form.libraryItemId;
            const normalizedId = typeof rawIdSource === "string" ? rawIdSource.trim() : "";
            payload.libraryItemId = normalizedId;
            try {
                setBusySave(true);
                if (editing) {
                    await Games.updateCustomItem(game.id, editing.id, payload);
                } else {
                    await Games.addCustomItem(game.id, payload);
                }
                await onUpdate?.();
                resetForm();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusySave(false);
            }
        },
        [editing, form, game.id, onUpdate, resetForm],
    );

    const remove = useCallback(
        async (itemId) => {
            if (!confirm("Remove this item?")) return;
            try {
                setBusyRow(itemId);
                setBusyRowAction("remove");
                await Games.deleteCustomItem(game.id, itemId);
                if (editing?.id === itemId) {
                    resetForm();
                }
                await onUpdate?.();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusyRow(null);
                setBusyRowAction(null);
            }
        },
        [editing?.id, game.id, onUpdate, resetForm],
    );

    const handleUnlinkCustom = useCallback(
        async (item) => {
            if (!canEdit || !item?.id) return;
            try {
                setBusyRow(item.id);
                setBusyRowAction("unlink");
                await Games.updateCustomItem(game.id, item.id, { libraryItemId: "" });
                if (editing?.id === item.id) {
                    setForm((prev) => ({ ...prev, libraryItemId: "" }));
                }
                await onUpdate?.();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusyRow(null);
                setBusyRowAction(null);
            }
        },
        [canEdit, editing?.id, game.id, onUpdate],
    );

    const itemList = useMemo(
        () =>
            premade.filter((it) => {
                if (!it || isGearCategory(it.type)) return false;
                const slug = (it.slug || it.id || "").toLowerCase();
                const name = (it.name || "").toLowerCase();
                return slug !== "tools-macca" && name !== "macca";
            }),
        [premade],
    );
    const gearList = useMemo(() => premade.filter((it) => it && isGearCategory(it.type)), [premade]);

    const customItems = Array.isArray(game.items?.custom) ? game.items.custom : [];
    const customGear = Array.isArray(game.gear?.custom) ? game.gear.custom : [];

    const libraryItems = itemList;
    const libraryGear = [...customGear, ...gearList];

    const canManageGear = isDM || game.permissions?.canEditGear;
    const players = (game.players || []).filter((p) => (p?.role || "").toLowerCase() !== "dm");

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
        [players],
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
                    libraryItemId: item.libraryItemId || "",
                });
                await onUpdate?.();
            } catch (e) {
                alert(e.message);
            } finally {
                setGiveBusyId(null);
            }
        },
        [game.id, isDM, onUpdate, selectedPlayer?.userId],
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
                    </div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                        <select
                            value={form.libraryItemId}
                            onChange={(e) => applyLibraryToForm(e.target.value)}
                            disabled={!canEdit || busySave}
                            style={{ flex: 1, minWidth: 240 }}
                        >
                            <option value="">No premade link</option>
                            {premade.map((it) => (
                                <option key={it.id} value={it.id}>
                                    {it.name}
                                    {it.type ? ` · ${it.type}` : ""}
                                </option>
                            ))}
                        </select>
                        {form.libraryItemId && (
                            <button
                                className="btn ghost"
                                onClick={() => applyLibraryToForm("")}
                                disabled={busySave}
                            >
                                Unlink
                            </button>
                        )}
                    </div>
                    {formLinked ? (
                        <div className="text-muted text-small" style={{ marginTop: -4 }}>
                            Linked to <b>{formLinked.name}</b>
                            {formLinked.type ? ` · ${formLinked.type}` : ""}
                            {formLinkedEffect && <div>Effect: {formLinkedEffect}</div>}
                        </div>
                    ) : form.libraryItemId ? (
                        <div className="text-small warn" style={{ marginTop: -4 }}>
                            Linked premade item not found.
                        </div>
                    ) : null}
                    <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button className="btn" disabled={!canEdit || busySave} onClick={() => save()}>
                            {busySave ? "…" : editing ? "Save" : "Add"}
                        </button>
                        {editing && (
                            <button className="btn" onClick={resetForm} disabled={busySave}>
                                Cancel
                            </button>
                        )}
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
                        {customItems.map((it) => {
                            const linked = it.libraryItemId ? libraryCatalog.get(it.libraryItemId) : null;
                            const effectLabel = linked ? formatHealingEffect(linked.healing) : "";
                            const rowBusy = busyRow === it.id;
                            const unlinking = rowBusy && busyRowAction === "unlink";
                            const removing = rowBusy && busyRowAction === "remove";
                            return (
                                <div
                                    key={it.id}
                                    className="row"
                                    style={{
                                        gap: 12,
                                        flexWrap: "wrap",
                                        alignItems: "flex-start",
                                        justifyContent: "space-between",
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 220 }}>
                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                            <b>{it.name || "Unnamed item"}</b>
                                            {it.type && <span className="pill">{it.type}</span>}
                                        </div>
                                        {it.desc && (
                                            <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>{it.desc}</div>
                                        )}
                                        {linked ? (
                                            <div className="text-muted text-small" style={{ marginTop: 4 }}>
                                                Linked to <b>{linked.name}</b>
                                                {linked.type ? ` · ${linked.type}` : ""}
                                                {effectLabel && <div>Effect: {effectLabel}</div>}
                                            </div>
                                        ) : it.libraryItemId ? (
                                            <div className="text-small warn" style={{ marginTop: 4 }}>
                                                Linked premade item not found.
                                            </div>
                                        ) : null}
                                    </div>
                                    <div
                                        className="row"
                                        style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}
                                    >
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
                                        {canEdit && it.libraryItemId && (
                                            <button
                                                className="btn ghost"
                                                onClick={() => handleUnlinkCustom(it)}
                                                disabled={unlinking}
                                            >
                                                {unlinking ? "…" : "Unlink"}
                                            </button>
                                        )}
                                        {canEdit && (
                                            <>
                                                <button
                                                    className="btn"
                                                    onClick={() => {
                                                        setEditing(it);
                                                        setForm({
                                                            name: it.name || "",
                                                            type: it.type || "",
                                                            desc: it.desc || "",
                                                            libraryItemId: it.libraryItemId || "",
                                                        });
                                                    }}
                                                    disabled={busySave}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    className="btn"
                                                    onClick={() => remove(it.id)}
                                                    disabled={removing}
                                                >
                                                    {removing ? "…" : "Remove"}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {customItems.length === 0 && <div style={{ opacity: 0.7 }}>No custom items yet.</div>}
                    </div>
                </div>

                <div className="card" style={{ width: 380 }}>
                    <h3>Premade Items</h3>
                    <div className="list" style={{ maxHeight: 420, overflow: "auto" }}>
                        {itemList.map((it) => {
                            const effectLabel = formatHealingEffect(it.healing);
                            return (
                                <div
                                    key={it.id}
                                    className="row"
                                    style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}
                                >
                                    <div style={{ flex: 1, minWidth: 220 }}>
                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                            <b>{it.name}</b>
                                            {it.type && <span className="pill">{it.type}</span>}
                                        </div>
                                        {it.desc && (
                                            <div style={{ opacity: 0.8, fontSize: 12 }}>{it.desc}</div>
                                        )}
                                        {effectLabel && (
                                            <div className="text-muted text-small" style={{ marginTop: 2 }}>
                                                {effectLabel}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        className="btn"
                                        disabled={!canEdit || busySave}
                                        onClick={() =>
                                            save({
                                                name: it.name,
                                                type: it.type,
                                                desc: it.desc,
                                                libraryItemId: it.id,
                                            })
                                        }
                                    >
                                        Add
                                    </button>
                                </div>
                            );
                        })}
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
                                        libraryCatalog={libraryCatalog}
                                        currentUserId={me.id}
                                        isDM={isDM}
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

function PlayerInventoryCard({ player, canEdit, gameId, onUpdate, libraryItems, libraryCatalog, isDM, currentUserId }) {
    const [form, setForm] = useState({ name: "", type: "", desc: "", amount: "1", libraryItemId: "" });
    const [editing, setEditing] = useState(null);
    const [busySave, setBusySave] = useState(false);
    const [busyRow, setBusyRow] = useState(null);
    const [busyRowAction, setBusyRowAction] = useState(null);
    const [busyUse, setBusyUse] = useState(null);

    const inventory = Array.isArray(player.inventory) ? player.inventory : [];
    const available = Array.isArray(libraryItems) ? libraryItems : [];
    const libraryMap = useMemo(() => {
        if (libraryCatalog instanceof Map) {
            return libraryCatalog;
        }
        return new Map();
    }, [libraryCatalog]);

    const resetForm = useCallback(() => {
        setEditing(null);
        setForm({ name: "", type: "", desc: "", amount: "1", libraryItemId: "" });
    }, []);

    useEffect(() => {
        resetForm();
    }, [player.userId, resetForm]);

    const parseAmount = useCallback((value, fallback) => {
        if (value === undefined || value === null || value === "") return fallback;
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        const rounded = Math.round(num);
        return rounded < 0 ? 0 : rounded;
    }, []);

    const formLinked = form.libraryItemId ? libraryMap.get(form.libraryItemId) : null;
    const formLinkedEffect = formLinked ? formatHealingEffect(formLinked.healing) : "";

    const handleLibrarySelect = useCallback(
        (value) => {
            setForm((prev) => {
                if (!value) {
                    return { ...prev, libraryItemId: "" };
                }
                const linked = libraryMap.get(value);
                const next = { ...prev, libraryItemId: value };
                if (linked && prev.libraryItemId !== value) {
                    next.name = linked.name || "";
                    next.type = linked.type || "";
                    next.desc = linked.desc || "";
                }
                return next;
            });
        },
        [libraryMap],
    );

    const save = useCallback(async () => {
        if (!canEdit) return;
        const name = form.name.trim();
        if (!name) {
            alert("Item needs a name");
            return;
        }
        const amount = parseAmount(form.amount, editing ? editing.amount ?? 0 : 1);
        const payload = {
            name,
            type: form.type.trim(),
            desc: form.desc.trim(),
            amount: editing ? amount : amount <= 0 ? 1 : amount,
            libraryItemId: typeof form.libraryItemId === "string" ? form.libraryItemId.trim() : "",
        };
        try {
            setBusySave(true);
            if (editing) {
                await Games.updatePlayerItem(gameId, player.userId, editing.id, payload);
            } else {
                await Games.addPlayerItem(gameId, player.userId, payload);
            }
            await onUpdate?.();
            resetForm();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusySave(false);
        }
    }, [canEdit, editing, form, gameId, onUpdate, parseAmount, player.userId, resetForm]);

    const startEdit = useCallback((item) => {
        setEditing(item);
        setForm({
            name: item.name || "",
            type: item.type || "",
            desc: item.desc || "",
            amount: String(item.amount ?? 1),
            libraryItemId: item.libraryItemId || "",
        });
    }, []);

    const remove = useCallback(
        async (itemId) => {
            if (!canEdit) return;
            if (!confirm("Remove this item from the inventory?")) return;
            try {
                setBusyRow(itemId);
                setBusyRowAction("remove");
                await Games.deletePlayerItem(gameId, player.userId, itemId);
                if (editing?.id === itemId) resetForm();
                await onUpdate?.();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusyRow(null);
                setBusyRowAction(null);
            }
        },
        [canEdit, editing?.id, gameId, onUpdate, player.userId, resetForm],
    );

    const unlink = useCallback(
        async (itemId) => {
            if (!canEdit) return;
            try {
                setBusyRow(itemId);
                setBusyRowAction("unlink");
                await Games.updatePlayerItem(gameId, player.userId, itemId, { libraryItemId: "" });
                await onUpdate?.();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusyRow(null);
                setBusyRowAction(null);
            }
        },
        [canEdit, gameId, onUpdate, player.userId],
    );

    const canUseItems = isDM || currentUserId === player.userId;

    const handleUse = useCallback(
        async (item) => {
            if (!canUseItems || !item?.id) return;
            try {
                setBusyUse(item.id);
                const result = await Games.consumePlayerItem(gameId, player.userId, item.id);
                if (result?.applied) {
                    const { applied, remaining } = result;
                    const parts = [];
                    if (applied.revived) parts.push("Revived");
                    if (
                        typeof applied.hpBefore === "number" &&
                        typeof applied.hpAfter === "number" &&
                        applied.hpAfter !== applied.hpBefore
                    ) {
                        parts.push(`HP ${applied.hpBefore} → ${applied.hpAfter}`);
                    }
                    if (
                        typeof applied.mpBefore === "number" &&
                        typeof applied.mpAfter === "number" &&
                        applied.mpAfter !== applied.mpBefore
                    ) {
                        parts.push(`MP ${applied.mpBefore} → ${applied.mpAfter}`);
                    }
                    if (typeof remaining === "number") {
                        parts.push(`Remaining: ${remaining}`);
                    }
                    if (parts.length > 0) {
                        alert(`Used ${item.name || "item"}. ${parts.join(", ")}`);
                    } else {
                        alert(`Used ${item.name || "item"}.`);
                    }
                }
                await onUpdate?.();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusyUse(null);
            }
        },
        [canUseItems, gameId, onUpdate, player.userId],
    );

    const playerLabel = player.character?.name || `Player ${player.userId?.slice?.(0, 6) || ""}`;
    const subtitleParts = [];
    if (player.character?.profile?.class) subtitleParts.push(player.character.profile.class);
    if (player.character?.resources?.level) subtitleParts.push(`LV ${player.character.resources.level}`);
    const subtitle = subtitleParts.join(" · ");
    const maccaRaw = Number(player.character?.resources?.macca);
    const macca = Number.isFinite(maccaRaw) ? maccaRaw : 0;
    const maccaLabel = Number.isFinite(maccaRaw) ? macca.toLocaleString() : "0";

    return (
        <div className="card" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <div>
                    <div>
                        <b>{playerLabel || "Unnamed Player"}</b>
                    </div>
                    {subtitle && <div style={{ opacity: 0.75, fontSize: 12 }}>{subtitle}</div>}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="pill">Items: {inventory.length}</span>
                    <span className="pill light">Macca {maccaLabel}</span>
                </div>
            </div>

            {canEdit && (
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {available.length > 0 && (
                        <select
                            value={form.libraryItemId}
                            onChange={(e) => handleLibrarySelect(e.target.value)}
                            disabled={busySave}
                            style={{ flex: 1, minWidth: 220 }}
                        >
                            <option value="">No premade link</option>
                            {available.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name}
                                    {item.type ? ` · ${item.type}` : ""}
                                </option>
                            ))}
                        </select>
                    )}
                    {form.libraryItemId && (
                        <button className="btn ghost" onClick={() => handleLibrarySelect("")} disabled={busySave}>
                            Clear link
                        </button>
                    )}
                </div>
            )}
            {formLinked ? (
                <div className="text-muted text-small" style={{ marginTop: canEdit ? -4 : 8 }}>
                    Linked to <b>{formLinked.name}</b>
                    {formLinked.type ? ` · ${formLinked.type}` : ""}
                    {formLinkedEffect && <div>Effect: {formLinkedEffect}</div>}
                </div>
            ) : form.libraryItemId ? (
                <div className="text-small warn" style={{ marginTop: canEdit ? -4 : 8 }}>
                    Linked premade item not found.
                </div>
            ) : null}

            <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <input
                    placeholder="Name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    style={{ flex: 1, minWidth: 160 }}
                    disabled={!canEdit}
                />
                <input
                    placeholder="Type"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    style={{ flex: 1, minWidth: 140 }}
                    disabled={!canEdit}
                />
                <input
                    placeholder="Description"
                    value={form.desc}
                    onChange={(e) => setForm({ ...form, desc: e.target.value })}
                    style={{ flex: 2, minWidth: 220 }}
                    disabled={!canEdit}
                />
                <input
                    type="number"
                    min={0}
                    placeholder="Qty"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    style={{ width: 80 }}
                    disabled={!canEdit}
                />
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={save} disabled={!canEdit || busySave}>
                    {busySave ? "…" : editing ? "Save" : "Add"}
                </button>
                {editing && (
                    <button className="btn" onClick={resetForm} disabled={busySave}>
                        Cancel
                    </button>
                )}
            </div>

            <div className="list" style={{ marginTop: 16 }}>
                {inventory.map((item) => {
                    const linked = item.libraryItemId ? libraryMap.get(item.libraryItemId) : null;
                    const effectLabel = linked ? formatHealingEffect(linked.healing) : "";
                    const missingLink = item.libraryItemId && !linked;
                    const amount = parseAmount(item.amount, 0);
                    const rowBusy = busyRow === item.id;
                    const unlinking = rowBusy && busyRowAction === "unlink";
                    const removing = rowBusy && busyRowAction === "remove";
                    const canUse = canUseItems && linked?.healing && amount > 0;
                    return (
                        <div
                            key={item.id}
                            className="row"
                            style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between" }}
                        >
                            <div style={{ flex: 1, minWidth: 220 }}>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                    <b>{item.name || "Unnamed item"}</b>
                                    {item.type && <span className="pill">{item.type}</span>}
                                    <span className="pill light">x{amount}</span>
                                </div>
                                {item.desc && <div style={{ opacity: 0.8, fontSize: 12 }}>{item.desc}</div>}
                                {linked ? (
                                    <div className="text-muted text-small" style={{ marginTop: 4 }}>
                                        Linked to <b>{linked.name}</b>
                                        {linked.type ? ` · ${linked.type}` : ""}
                                        {effectLabel && <div>Effect: {effectLabel}</div>}
                                    </div>
                                ) : missingLink ? (
                                    <div className="text-small warn" style={{ marginTop: 4 }}>
                                        Linked premade item not found.
                                    </div>
                                ) : null}
                            </div>
                            <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                {canUse && (
                                    <button
                                        className="btn secondary"
                                        onClick={() => handleUse(item)}
                                        disabled={busyUse === item.id}
                                        title={effectLabel || "Use item"}
                                    >
                                        {busyUse === item.id ? "…" : "Use"}
                                    </button>
                                )}
                                {canEdit && item.libraryItemId && (
                                    <button className="btn ghost" onClick={() => unlink(item.id)} disabled={unlinking}>
                                        {unlinking ? "…" : "Unlink"}
                                    </button>
                                )}
                                {canEdit && (
                                    <>
                                        <button className="btn" onClick={() => startEdit(item)} disabled={busySave}>
                                            Edit
                                        </button>
                                        <button className="btn" onClick={() => remove(item.id)} disabled={removing}>
                                            {removing ? "…" : "Remove"}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
                {inventory.length === 0 && <div style={{ opacity: 0.7 }}>No items in inventory.</div>}
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
    const [giveBusyId, setGiveBusyId] = useState(null);

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

    const gearList = premade.filter((it) => isGearCategory(it.type));
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
                await Games.addPlayerGearBag(game.id, selectedPlayer.userId, {
                    name: item.name,
                    type: item.type,
                    desc: item.desc,
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
                    {isDM && (
                        <p className="text-muted text-small" style={{ marginTop: -4 }}>
                            {canGiveToSelected
                                ? `Give buttons target ${selectedPlayerLabel}.`
                                : "Select a claimed player below to enable the Give button."}
                        </p>
                    )}
                    <div className="list">
                        {customGear.map((it) => (
                            <div key={it.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
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
                                                        ? "Select a player slot linked to a user to give this gear."
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
                                                        setForm({
                                                            name: it.name || "",
                                                            type: it.type || "",
                                                            desc: it.desc || "",
                                                        });
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
function DemonCombatSkillDialog({ demon, skills, onClose }) {
    const [query, setQuery] = useState("");
    const demonSkillList = useMemo(() => getDemonSkillList(demon), [demon]);
    const demonSkillSet = useMemo(() => {
        return new Set(demonSkillList.map((name) => name.toLowerCase()));
    }, [demonSkillList]);
    const matchedSkills = useMemo(() => {
        if (!Array.isArray(skills) || skills.length === 0 || demonSkillSet.size === 0) return EMPTY_ARRAY;
        return skills.filter((skill) => demonSkillSet.has(skill.label.toLowerCase()));
    }, [demonSkillSet, skills]);
    const unmatchedSkills = useMemo(() => {
        if (demonSkillList.length === 0) return EMPTY_ARRAY;
        const matchedLabels = new Set(matchedSkills.map((skill) => skill.label.toLowerCase()));
        return demonSkillList.filter((label) => !matchedLabels.has(label.toLowerCase()));
    }, [demonSkillList, matchedSkills]);
    const filteredSkills = useMemo(() => {
        if (matchedSkills.length === 0) return matchedSkills;
        const term = query.trim().toLowerCase();
        if (!term) return matchedSkills;
        return matchedSkills.filter((skill) => {
            const tierLabel = (COMBAT_TIER_LABELS[skill.tier] || "").toLowerCase();
            const categoryLabel = (COMBAT_CATEGORY_LABELS[skill.category] || "").toLowerCase();
            const notes = (skill.notes || "").toLowerCase();
            const cost = (skill.cost || "").toLowerCase();
            return (
                skill.label.toLowerCase().includes(term) ||
                skill.ability.toLowerCase().includes(term) ||
                tierLabel.includes(term) ||
                categoryLabel.includes(term) ||
                notes.includes(term) ||
                cost.includes(term)
            );
        });
    }, [matchedSkills, query]);

    useEffect(() => {
        const handleKey = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose?.();
            }
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [onClose]);

    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    if (!demon) return null;

    const demonName = demon.name || "Demon";

    return (
        <div className="demon-skill-overlay" role="dialog" aria-modal="true" aria-labelledby="demon-skill-title">
            <div className="demon-skill-modal">
                <header className="demon-skill-modal__header">
                    <div>
                        <h3 id="demon-skill-title">{demonName} combat skills</h3>
                        <p className="text-small text-muted">
                            Matching entries from the Combat Skills tab.
                        </p>
                    </div>
                    <button type="button" className="btn ghost btn-small" onClick={onClose}>
                        Close
                    </button>
                </header>
                {matchedSkills.length > 0 ? (
                    <>
                        <label className="field">
                            <span className="field__label">Filter skills</span>
                            <input
                                type="search"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search by name, ability, or notes"
                                autoFocus
                            />
                        </label>
                        <div className="demon-skill-modal__list">
                            {filteredSkills.map((skill) => (
                                <article key={skill.id} className="demon-skill-modal__item">
                                    <div className="demon-skill-modal__item-header">
                                        <h4>{skill.label}</h4>
                                        <div className="demon-skill-modal__badges">
                                            <span className="pill">{COMBAT_TIER_LABELS[skill.tier] || "Tier"}</span>
                                            <span className="pill light">{skill.ability} mod</span>
                                            <span className="pill light">{COMBAT_CATEGORY_LABELS[skill.category] || "Other"}</span>
                                        </div>
                                    </div>
                                    {skill.cost && <div className="text-small">Cost: {skill.cost}</div>}
                                    {skill.notes && <p className="text-small">{skill.notes}</p>}
                                </article>
                            ))}
                            {filteredSkills.length === 0 && (
                                <div className="demon-skill-modal__empty text-small text-muted">
                                    No combat skills match that filter.
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="demon-skill-modal__empty text-small text-muted">
                        {demonSkillList.length === 0
                            ? "This demon does not list any combat skills yet."
                            : "No combat skills in the codex match these names."}
                    </div>
                )}
                {unmatchedSkills.length > 0 && (
                    <div className="demon-skill-modal__unmatched text-small">
                        <strong>Unlinked skills:</strong> {unmatchedSkills.join(', ')}
                    </div>
                )}
            </div>
        </div>
    );
}

function DemonTab({ game, me, onUpdate }) {
    const [name, setName] = useState("");
    const [arcana, setArc] = useState("");
    const [align, setAlign] = useState("");
    const [level, setLevel] = useState(1);
    const [stats, setStats] = useState(() => createAbilityMap(0));
    const [resist, setResist] = useState({ weak: "", resist: "", null: "", absorb: "", reflect: "" });
    const [skills, setSkills] = useState("");
    const [notes, setNotes] = useState("");
    const [image, setImage] = useState("");
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const [editing, setEditing] = useState(null);
    const previewStats = useMemo(() => resolveAbilityState(stats), [stats]);
    const previewMods = useMemo(() => {
        const source = (selected && selected.mods) || (editing && editing.mods);
        return source && typeof source === "object" ? source : EMPTY_OBJECT;
    }, [editing, selected]);
    const [busySave, setBusySave] = useState(false);
    const [busySearch, setBusySearch] = useState(false);
    const [busyDelete, setBusyDelete] = useState(null);
    const [demonSortMode, setDemonSortMode] = useState("name");
    const [demonSearch, setDemonSearch] = useState("");
    const [arcanaFilter, setArcanaFilter] = useState("");
    const [skillFilter, setSkillFilter] = useState("");
    const [resistanceFilter, setResistanceFilter] = useState("");
    const [skillModalDemon, setSkillModalDemon] = useState(null);
    const demonCollator = useMemo(
        () => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }),
        [],
    );
    const combatSkills = useMemo(() => normalizeCombatSkillDefs(game.combatSkills), [game.combatSkills]);

    const isDM = game.dmId === me.id;
    const canEdit = isDM || game.permissions?.canEditDemons;
    const [activeSubTab, setActiveSubTab] = useState("shared");

    const availableSubTabs = useMemo(() => {
        const tabs = [{ key: "shared", label: "Shared demons" }];
        if (isDM) {
            tabs.push({ key: "lookup", label: "Lookup" }, { key: "fusion", label: "Demon fusion" });
        }
        return tabs;
    }, [isDM]);

    useEffect(() => {
        if (!availableSubTabs.some((tab) => tab.key === activeSubTab)) {
            setActiveSubTab(availableSubTabs[0]?.key || "shared");
        }
    }, [activeSubTab, availableSubTabs]);

    const resetForm = useCallback(() => {
        setName("");
        setArc("");
        setAlign("");
        setLevel(1);
        setStats(createAbilityMap(0));
        setResist({ weak: "", resist: "", null: "", absorb: "", reflect: "" });
        setSkills("");
        setNotes("");
        setImage("");
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
            image,
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

    const filteredDemons = useMemo(() => {
        const source = Array.isArray(game.demons) ? game.demons : EMPTY_ARRAY;
        if (source.length === 0) return source;
        const searchTerm = demonSearch.trim().toLowerCase();
        const arcanaTerm = arcanaFilter.trim().toLowerCase();
        const skillTerm = skillFilter.trim().toLowerCase();
        const resistanceTerm = resistanceFilter.trim().toLowerCase();
        if (!searchTerm && !arcanaTerm && !skillTerm && !resistanceTerm) {
            return source;
        }
        return source.filter((demon) => {
            if (!demon) return false;
            const name = (demon.name || "").toLowerCase();
            const arcana = (demon.arcana || "").toLowerCase();
            const alignment = (demon.alignment || "").toLowerCase();
            const notesText = (demon.notes || "").toLowerCase();
            const description = (demon.description || "").toLowerCase();
            const skillsLower = getDemonSkillList(demon).map((skill) => skill.toLowerCase());
            const resistanceTerms = collectResistanceTerms(demon);
            if (arcanaTerm && !arcana.includes(arcanaTerm)) {
                return false;
            }
            if (skillTerm && !skillsLower.some((entry) => entry.includes(skillTerm))) {
                return false;
            }
            if (resistanceTerm && !resistanceTerms.some((entry) => entry.includes(resistanceTerm))) {
                return false;
            }
            if (searchTerm) {
                const matchesSearch =
                    name.includes(searchTerm) ||
                    arcana.includes(searchTerm) ||
                    alignment.includes(searchTerm) ||
                    notesText.includes(searchTerm) ||
                    description.includes(searchTerm) ||
                    skillsLower.some((entry) => entry.includes(searchTerm)) ||
                    resistanceTerms.some((entry) => entry.includes(searchTerm));
                if (!matchesSearch) return false;
            }
            return true;
        });
    }, [arcanaFilter, demonSearch, game.demons, resistanceFilter, skillFilter]);

    const sortedDemons = useMemo(() => {
        if (!Array.isArray(filteredDemons) || filteredDemons.length === 0) {
            return Array.isArray(filteredDemons) ? filteredDemons : EMPTY_ARRAY;
        }
        const list = [...filteredDemons];
        const getName = (d) => (typeof d?.name === "string" ? d.name.trim() : "");
        const getArcana = (d) => (typeof d?.arcana === "string" ? d.arcana.trim() : "");
        const getLevel = (d) => {
            const raw = Number(d?.level);
            return Number.isFinite(raw) ? raw : 0;
        };
        const getStatValue = (d, key) => {
            const raw = Number(d?.stats?.[key]);
            return Number.isFinite(raw) ? raw : 0;
        };
        const getSkillCount = (d) => getDemonSkillList(d).length;

        list.sort((a, b) => {
            if (demonSortMode.startsWith("stat:")) {
                const key = demonSortMode.slice(5);
                const valueA = getStatValue(a, key);
                const valueB = getStatValue(b, key);
                if (valueA !== valueB) {
                    return valueB - valueA;
                }
            } else if (demonSortMode.startsWith("resist:")) {
                const key = demonSortMode.slice(7);
                const config = DEMON_RESISTANCE_SORTS.find((entry) => entry.key === key);
                if (config) {
                    const countA = getResistanceCount(a, key);
                    const countB = getResistanceCount(b, key);
                    if (countA !== countB) {
                        return config.direction === "asc" ? countA - countB : countB - countA;
                    }
                }
            } else if (demonSortMode === "levelHigh" || demonSortMode === "levelLow") {
                const levelA = getLevel(a);
                const levelB = getLevel(b);
                if (levelA !== levelB) {
                    return demonSortMode === "levelHigh" ? levelB - levelA : levelA - levelB;
                }
            } else if (demonSortMode === "arcana") {
                const cmpArc = demonCollator.compare(getArcana(a), getArcana(b));
                if (cmpArc !== 0) return cmpArc;
            } else if (demonSortMode === "skillCount") {
                const countA = getSkillCount(a);
                const countB = getSkillCount(b);
                if (countA !== countB) {
                    return countB - countA;
                }
            }
            return demonCollator.compare(getName(a), getName(b));
        });

        return list;
    }, [demonCollator, demonSortMode, filteredDemons]);

    const hasDemonFilters =
        demonSearch.trim().length > 0 ||
        arcanaFilter.trim().length > 0 ||
        skillFilter.trim().length > 0 ||
        resistanceFilter.trim().length > 0;

    const openSkillModal = useCallback((demon) => {
        if (!demon) return;
        setSkillModalDemon(demon);
    }, []);

    const closeSkillModal = useCallback(() => {
        setSkillModalDemon(null);
    }, []);

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
            setImage(p.image || "");
        } catch (e) {
            if (e instanceof ApiError && (e.code === "persona_not_found" || e.message === "persona_not_found")) {
                const suggestion = e.details?.closeMatch;
                if (suggestion?.slug && suggestion.slug !== slug) {
                    const displayName = suggestion.name || suggestion.slug;
                    const confidence = typeof suggestion.confidence === "number"
                        ? ` (confidence ${(suggestion.confidence * 100).toFixed(1)}%)`
                        : "";
                    if (
                        confirm(
                            `No demon matched "${slug}". Did you mean ${displayName}${confidence}?`
                        )
                    ) {
                        await pick(suggestion.slug);
                        return;
                    }
                }
                alert(`No demon matched "${slug}".`);
                return;
            }
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
        setImage(demon.image || "");
        setSelected(null);
    };

    const sharedContent = (
        <>
            <p className="text-muted text-small">
                Browse the shared demon roster. Edit a card to update stats, resistances, or notes.
            </p>
            <div className="demon-codex__filters">
                <label className="field demon-codex__filter">
                    <span className="field__label">Search demons</span>
                    <input
                        type="search"
                        value={demonSearch}
                        onChange={(event) => setDemonSearch(event.target.value)}
                        placeholder="Name, alignment, notes…"
                    />
                </label>
                <label className="field demon-codex__filter">
                    <span className="field__label">Arcana</span>
                    <input
                        type="search"
                        value={arcanaFilter}
                        onChange={(event) => setArcanaFilter(event.target.value)}
                        placeholder="e.g., Fool"
                    />
                </label>
                <label className="field demon-codex__filter">
                    <span className="field__label">Skill contains</span>
                    <input
                        type="search"
                        value={skillFilter}
                        onChange={(event) => setSkillFilter(event.target.value)}
                        placeholder="e.g., Agidyne"
                    />
                </label>
                <label className="field demon-codex__filter">
                    <span className="field__label">Resistance contains</span>
                    <input
                        type="search"
                        value={resistanceFilter}
                        onChange={(event) => setResistanceFilter(event.target.value)}
                        placeholder="e.g., Fire"
                    />
                </label>
                <label className="field demon-codex__filter">
                    <span className="field__label">Sort demons</span>
                    <select value={demonSortMode} onChange={(event) => setDemonSortMode(event.target.value)}>
                        <option value="name">Name (A to Z)</option>
                        <option value="nameDesc">Name (Z to A)</option>
                        <option value="arcana">Arcana</option>
                        <option value="levelHigh">Level (high to low)</option>
                        <option value="levelLow">Level (low to high)</option>
                        <option value="skillCount">Skill count</option>
                        <option value="resist:weak">Weak resist count</option>
                        <option value="resist:resist">Resist count</option>
                        <option value="resist:null">Null resist count</option>
                        <option value="resist:absorb">Absorb resist count</option>
                        <option value="resist:reflect">Reflect resist count</option>
                        {ABILITY_DEFS.map((ability) => (
                            <option key={ability.key} value={`stat:${ability.key}`}>
                                {ability.key} score
                            </option>
                        ))}
                    </select>
                </label>
                {hasDemonFilters && (
                    <button
                        type="button"
                        className="btn ghost btn-small demon-codex__clear"
                        onClick={() => {
                            setDemonSortMode("name");
                            setDemonSearch("");
                            setArcanaFilter("");
                            setSkillFilter("");
                            setResistanceFilter("");
                        }}
                    >
                        Clear filters
                    </button>
                )}
            </div>

            {sortedDemons.length === 0 ? (
                <div className="demon-codex__empty text-muted">
                    {Array.isArray(game.demons) && game.demons.length > 0
                        ? "No demons match the current filters."
                        : "No demons in the pool yet."}
                </div>
            ) : (
                <div className="demon-codex__grid">
                    {sortedDemons.map((d) => {
                        const skillList = getDemonSkillList(d);
                        const canShowSkillModal = skillList.length > 0 && combatSkills.length > 0;
                        return (
                            <article key={d.id || d.name} className="card demon-card">
                                <header className="demon-card__top">
                                    <div className="demon-card__identity">
                                        <h4 className="demon-card__name">{d.name}</h4>
                                        <div className="demon-card__chips">
                                            <span className="demon-card__chip">{d.arcana ?? '—'}</span>
                                            <span className="demon-card__chip">{d.alignment ?? '—'}</span>
                                        </div>
                                    </div>
                                    <div className="demon-card__actions">
                                        <span className="demon-card__level">LV {d.level ?? 0}</span>
                                        {canEdit && (
                                            <div className="demon-card__buttons">
                                                <button
                                                    type="button"
                                                    className="btn ghost btn-small"
                                                    onClick={() => startEdit(d)}
                                                    disabled={busySave}
                                                >
                                                    Edit
                                                </button>
                                                {isDM && (
                                                    <button
                                                        type="button"
                                                        className="btn ghost btn-small"
                                                        onClick={() => remove(d.id)}
                                                        disabled={busyDelete === d.id}
                                                    >
                                                        {busyDelete === d.id ? '…' : 'Remove'}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </header>
                                {d.description && <p className="demon-card__description">{d.description}</p>}
                                <div className="demon-card__body">
                                    {d.image && (
                                        <DemonImage
                                            src={d.image}
                                            personaSlug={d.slug || d.query}
                                            alt={`${d.name} artwork`}
                                            loading="lazy"
                                            decoding="async"
                                            className="demon-card__portrait"
                                        />
                                    )}
                                    <div className="demon-card__info">
                                        <div className="demon-card__stats-row">
                                            {ABILITY_DEFS.map((ability) => {
                                                const score = Number((d.stats || {})[ability.key]) || 0;
                                                const mod = d.mods?.[ability.key] ?? abilityModifier(score);
                                                return (
                                                    <span key={ability.key} className="demon-card__stat">
                                                        <span className="demon-card__stat-key">{ability.key}</span>
                                                        <span className="demon-card__stat-value">{score} ({formatModifier(mod)})</span>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                        <div className="demon-card__resist-grid">
                                            <div className="demon-card__resist">
                                                <span className="demon-card__resist-label">Weak</span>
                                                <span className="demon-card__resist-values">{formatResistanceList(d.resistances?.weak, d.weak)}</span>
                                            </div>
                                            <div className="demon-card__resist">
                                                <span className="demon-card__resist-label">Resist</span>
                                                <span className="demon-card__resist-values">{formatResistanceList(d.resistances?.resist, d.resists)}</span>
                                            </div>
                                            <div className="demon-card__resist">
                                                <span className="demon-card__resist-label">Null</span>
                                                <span className="demon-card__resist-values">{formatResistanceList(d.resistances?.null, d.nullifies)}</span>
                                            </div>
                                            <div className="demon-card__resist">
                                                <span className="demon-card__resist-label">Absorb</span>
                                                <span className="demon-card__resist-values">{formatResistanceList(d.resistances?.absorb, d.absorbs)}</span>
                                            </div>
                                            <div className="demon-card__resist">
                                                <span className="demon-card__resist-label">Reflect</span>
                                                <span className="demon-card__resist-values">{formatResistanceList(d.resistances?.reflect, d.reflects)}</span>
                                            </div>
                                        </div>
                                        <div className="demon-card__skills">
                                            <span className="demon-card__section-label">Skills</span>
                                            <div className="demon-card__skill-list">
                                                {skillList.slice(0, 5).map((skill) => (
                                                    <span key={skill} className="demon-card__skill-chip">{skill}</span>
                                                ))}
                                                {skillList.length > 5 && (
                                                    <span className="demon-card__skill-chip">+{skillList.length - 5} more</span>
                                                )}
                                                {canShowSkillModal && (
                                                    <button
                                                        type="button"
                                                        className="btn ghost btn-small demon-card__skills-btn"
                                                        onClick={() => openSkillModal(d)}
                                                    >
                                                        Combat skill details
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {d.notes && <div className="demon-card__notes text-small">{d.notes}</div>}
                            </article>
                        );
                    })}
                </div>
            )}
        </>
    );

    const lookupContent = (
        <div className="demon-lookup">
            <p className="text-muted text-small">
                Search the compendium to pre-fill the editor with persona stats, resistances, and skills.
            </p>
            <div className="demon-lookup__controls">
                <label className="field demon-lookup__field">
                    <span className="field__label">Compendium search</span>
                    <input
                        type="search"
                        placeholder="Search name, e.g., jack frost"
                        value={q}
                        onChange={(event) => setQ(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && runSearch()}
                    />
                </label>
                <button className="btn" onClick={runSearch} disabled={busySearch}>
                    {busySearch ? "…" : "Search"}
                </button>
            </div>
            <div className="demon-lookup__results">
                {results.length === 0 ? (
                    <div className="demon-lookup__empty text-muted">
                        {busySearch ? "Searching…" : "No results yet. Try a demon name to load stats."}
                    </div>
                ) : (
                    results.map((r) => (
                        <div key={r.slug} className="demon-lookup__result">
                            <div>
                                <div className="demon-lookup__name">{r.name}</div>
                                {r.arcana && <div className="text-small text-muted">{r.arcana}</div>}
                            </div>
                            <button className="btn ghost btn-small" onClick={() => pick(r.slug)}>
                                Use
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const fusionContent = (
        <div className="demon-fusion">
            <h4>Demon fusion planning</h4>
            <p className="text-muted text-small">
                Map out fusion recipes and track ingredient costs. This workspace is a placeholder for future tools.
            </p>
        </div>
    );

    const previewImage = image.trim() || selected?.image || "";
    const previewName = name || selected?.name || "";
    const previewArcana = arcana || selected?.arcana || "—";
    const previewAlignment = align || selected?.alignment || "—";
    const previewLevel = Number.isFinite(level) ? level : selected?.level ?? 0;
    const previewDescription = notes || selected?.description || "";
    const previewSlug = selected?.slug || selected?.query || "";
    const weakText = formatResistanceList(resist.weak, selected?.resistances?.weak ?? selected?.weak);
    const resistText = formatResistanceList(resist.resist, selected?.resistances?.resist ?? selected?.resists);
    const nullText = formatResistanceList(resist.null, selected?.resistances?.null ?? selected?.nullifies);
    const absorbText = formatResistanceList(resist.absorb, selected?.resistances?.absorb ?? selected?.absorbs);
    const reflectText = formatResistanceList(resist.reflect, selected?.resistances?.reflect ?? selected?.reflects);
    const hasPreview = Boolean(previewImage || previewName || previewDescription || selected);

    const editorContent = (
        <div className="demon-editor__content">
            <header className="demon-editor__header">
                <div>
                    <h3 className="demon-editor__title">{editing ? `Edit ${editing.name || "demon"}` : "Demon editor"}</h3>
                    <p className="text-muted text-small">
                        {isDM
                            ? "Add new summons or update allies in the shared pool."
                            : "Update demons you've been allowed to manage."}
                    </p>
                </div>
            </header>
            <div className="demon-editor__actions">
                <button
                    type="button"
                    className="btn"
                    onClick={save}
                    disabled={!canEdit || busySave || (!editing && !isDM)}
                >
                    {busySave ? "…" : editing || !isDM ? "Save Demon" : "Add Demon"}
                </button>
                {editing && (
                    <button type="button" className="btn ghost" onClick={resetForm} disabled={busySave}>
                        Cancel
                    </button>
                )}
            </div>
            <div className="demon-editor__section">
                <div className="demon-editor__row">
                    <label className="field demon-editor__field">
                        <span className="field__label">Name</span>
                        <input placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
                    </label>
                    <label className="field demon-editor__field">
                        <span className="field__label">Arcana</span>
                        <input placeholder="Arcana" value={arcana} onChange={(event) => setArc(event.target.value)} />
                    </label>
                    <label className="field demon-editor__field">
                        <span className="field__label">Alignment</span>
                        <input placeholder="Alignment" value={align} onChange={(event) => setAlign(event.target.value)} />
                    </label>
                </div>
                <div className="demon-editor__row">
                    <label className="field demon-editor__field demon-editor__field--compact">
                        <span className="field__label">Level</span>
                        <input
                            type="number"
                            inputMode="numeric"
                            value={level}
                            onChange={(event) => setLevel(Number(event.target.value || 0))}
                        />
                    </label>
                    <label className="field demon-editor__field demon-editor__field--wide">
                        <span className="field__label">Image URL</span>
                        <input
                            type="url"
                            placeholder="https://example.com/artwork.png"
                            value={image}
                            onChange={(event) => setImage(event.target.value)}
                        />
                    </label>
                </div>
            </div>
            <div className="demon-editor__section">
                <span className="field__label">Ability scores</span>
                <div className="demon-editor__stats-grid">
                    {ABILITY_DEFS.map((ability) => {
                        const value = Number(stats[ability.key]) || 0;
                        const mod = abilityModifier(value);
                        return (
                            <label key={ability.key} className="field demon-editor__stat-field">
                                <span className="field__label">{ability.key}</span>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    value={value}
                                    onChange={(event) =>
                                        setStats((prev) => ({
                                            ...prev,
                                            [ability.key]: Number(event.target.value || 0),
                                        }))
                                    }
                                />
                                <span className="text-small text-muted">Mod {formatModifier(mod)}</span>
                            </label>
                        );
                    })}
                </div>
            </div>
            <div className="demon-editor__section">
                <span className="field__label">Resistances</span>
                <div className="demon-editor__resist-grid">
                    {[
                        ["weak", "Weak"],
                        ["resist", "Resist"],
                        ["null", "Null"],
                        ["absorb", "Absorb"],
                        ["reflect", "Reflect"],
                    ].map(([key, label]) => (
                        <label key={key} className="field demon-editor__resist-field">
                            <span className="field__label">{label}</span>
                            <textarea
                                rows={2}
                                value={resist[key]}
                                placeholder="Comma or newline separated"
                                onChange={(event) => setResist((prev) => ({ ...prev, [key]: event.target.value }))}
                            />
                        </label>
                    ))}
                </div>
            </div>
            <div className="demon-editor__section">
                <div className="demon-editor__row">
                    <label className="field demon-editor__field">
                        <span className="field__label">Skills (one per line)</span>
                        <textarea
                            rows={3}
                            value={skills}
                            onChange={(event) => setSkills(event.target.value)}
                        />
                    </label>
                    <label className="field demon-editor__field">
                        <span className="field__label">Notes</span>
                        <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
                    </label>
                </div>
            </div>
            <div className="demon-editor__preview">
                <h4>Preview</h4>
                {!hasPreview ? (
                    <div className="text-muted text-small">Fill in details or pick a persona to preview.</div>
                ) : (
                    <div className="demon-editor__preview-body">
                        {(previewImage || previewSlug) && (
                            <DemonImage
                                src={previewImage}
                                personaSlug={previewSlug}
                                alt={previewName || "Demon artwork"}
                                loading="lazy"
                                decoding="async"
                                className="demon-editor__preview-image"
                            />
                        )}
                        <div className="demon-editor__preview-meta">
                            <div>
                                <strong>{previewName || "Unnamed demon"}</strong> · {previewArcana || "—"} · {previewAlignment || "—"} ·
                                LV {previewLevel}
                            </div>
                            {previewDescription && <div className="text-small">{previewDescription}</div>}
                            <div className="demon-editor__preview-stats">
                                {ABILITY_DEFS.map((ability) => (
                                    <span key={ability.key} className="pill">
                                        {ability.key} {previewStats[ability.key]} ({formatModifier(previewMods[ability.key] ?? abilityModifier(previewStats[ability.key]))})
                                    </span>
                                ))}
                            </div>
                            <div className="demon-editor__preview-resists text-small">
                                <div><b>Weak:</b> {weakText}</div>
                                <div><b>Resist:</b> {resistText}</div>
                                <div><b>Null:</b> {nullText}</div>
                                <div><b>Absorb:</b> {absorbText}</div>
                                <div><b>Reflect:</b> {reflectText}</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="demon-codex">
            <div className="demon-codex__layout">
                <section className="demon-codex__main">
                    <div className="card demon-codex__panel">
                        <header className="demon-codex__panel-header">
                            <div>
                                <h3>Shared Demon Pool</h3>
                                <p className="text-muted text-small">
                                    Summoned allies, compendium tools, and future fusion planning.
                                </p>
                            </div>
                            <span className="pill demon-codex__pool-usage">
                                {game.demonPool?.used ?? 0}/{game.demonPool?.max ?? 0} used
                            </span>
                        </header>
                        {availableSubTabs.length > 1 && (
                            <nav className="demon-codex__tabs" aria-label="Demon codex subtabs">
                                {availableSubTabs.map((tab) => {
                                    const isActive = tab.key === activeSubTab;
                                    return (
                                        <button
                                            key={tab.key}
                                            type="button"
                                            className={`demon-codex__tab-btn${isActive ? " is-active" : ""}`}
                                            onClick={() => setActiveSubTab(tab.key)}
                                        >
                                            {tab.label}
                                        </button>
                                    );
                                })}
                            </nav>
                        )}
                        <div className="demon-codex__content">
                            {activeSubTab === "shared" && sharedContent}
                            {activeSubTab === "lookup" && isDM && lookupContent}
                            {activeSubTab === "fusion" && isDM && fusionContent}
                        </div>
                    </div>
                </section>
                <aside className="demon-codex__aside">
                    <div className="card demon-editor">
                        <div className="demon-codex__pool-mobile pill">
                            {game.demonPool?.used ?? 0}/{game.demonPool?.max ?? 0} used
                        </div>
                        {editorContent}
                    </div>
                </aside>
            </div>
            {skillModalDemon && (
                <DemonCombatSkillDialog demon={skillModalDemon} skills={combatSkills} onClose={closeSkillModal} />
            )}
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
        key: "canEditCombatSkills",
        label: "Combat skills",
        description: "Allow players to add, edit, or delete shared combat techniques.",
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
    const [mapSettings, setMapSettings] = useState(() => ({
        allowPlayerDrawing: !!game.map?.settings?.allowPlayerDrawing,
        allowPlayerTokenMoves: !!game.map?.settings?.allowPlayerTokenMoves,
        paused: !!game.map?.paused,
    }));
    const [mapSaving, setMapSaving] = useState(false);
    const [clearingDrawings, setClearingDrawings] = useState(false);

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

    useEffect(() => {
        setMapSettings({
            allowPlayerDrawing: !!game.map?.settings?.allowPlayerDrawing,
            allowPlayerTokenMoves: !!game.map?.settings?.allowPlayerTokenMoves,
            paused: !!game.map?.paused,
        });
    }, [
        game.id,
        game.map?.paused,
        game.map?.settings?.allowPlayerDrawing,
        game.map?.settings?.allowPlayerTokenMoves,
    ]);

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

    const mapStrokeCount = Array.isArray(game.map?.strokes) ? game.map.strokes.length : 0;
    const storyBotTokenValue = typeof storyForm.botToken === "string" ? storyForm.botToken : "";
    const hasCustomBotToken = storyBotTokenValue.trim().length > 0;
    const storyPrimaryBot = storyForm.primaryBot || normalizePrimaryBot(null);
    const sharedBotAvailable = !!storyPrimaryBot.available;
    const usingSharedBot = sharedBotAvailable && !hasCustomBotToken;

    const applyMapSettings = useCallback(
        async (changes) => {
            if (!isDM) return;
            const previous = { ...mapSettings };
            setMapSettings((current) => ({ ...current, ...changes }));
            setMapSaving(true);
            try {
                const updated = await Games.updateMapSettings(game.id, changes);
                setMapSettings({
                    allowPlayerDrawing: !!updated.settings?.allowPlayerDrawing,
                    allowPlayerTokenMoves: !!updated.settings?.allowPlayerTokenMoves,
                    paused: !!updated.paused,
                });
                if (typeof onGameRefresh === "function") {
                    await onGameRefresh();
                }
            } catch (err) {
                alert(err.message);
                setMapSettings(previous);
            } finally {
                setMapSaving(false);
            }
        },
        [game.id, isDM, mapSettings, onGameRefresh]
    );

    const handleClearDrawings = useCallback(async () => {
        if (!isDM) return;
        if (!confirm("Clear all drawings from the battle map?")) return;
        try {
            setClearingDrawings(true);
            await Games.clearMapStrokes(game.id);
            if (typeof onGameRefresh === "function") {
                await onGameRefresh();
            }
        } catch (err) {
            alert(err.message);
        } finally {
            setClearingDrawings(false);
        }
    }, [game.id, isDM, onGameRefresh]);

    const navSections = useMemo(() => {
        const sections = [
            { key: "permissions", label: "Permissions" },
            { key: "battleMap", label: "Battle Map" },
            { key: "story", label: "Story Tools" },
        ];
        if (canKick) sections.push({ key: "members", label: "Members" });
        if (canDelete) sections.push({ key: "danger", label: "Danger Zone" });
        return sections;
    }, [canKick, canDelete]);

    const [activeSection, setActiveSection] = useState(() => navSections[0]?.key || "permissions");

    useEffect(() => {
        if (!navSections.some((section) => section.key === activeSection)) {
            setActiveSection(navSections[0]?.key || "permissions");
        }
    }, [activeSection, navSections]);

    let sectionContent = null;

    if (activeSection === "permissions") {
        sectionContent = (
            <>
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
            </>
        );
    } else if (activeSection === "battleMap") {
        sectionContent = (
            <>
                <h3>Battle Map controls</h3>
                <p className="text-muted text-small" style={{ marginTop: -4 }}>
                    Control how players collaborate on the live battle map.
                </p>
                <div className="stack">
                    <label className={`perm-toggle${!isDM ? " is-readonly" : ""}`}>
                        <input
                            type="checkbox"
                            checked={mapSettings.allowPlayerDrawing}
                            disabled={!isDM || mapSaving}
                            onChange={(event) =>
                                applyMapSettings({ allowPlayerDrawing: event.target.checked })
                            }
                        />
                        <div className="perm-toggle__text">
                            <span className="perm-toggle__label">Allow players to draw</span>
                            <span className="text-muted text-small">
                                When enabled, party members can sketch routes, traps, and plans directly on the board.
                            </span>
                        </div>
                    </label>
                    <label className={`perm-toggle${!isDM ? " is-readonly" : ""}`}>
                        <input
                            type="checkbox"
                            checked={mapSettings.allowPlayerTokenMoves}
                            disabled={!isDM || mapSaving}
                            onChange={(event) =>
                                applyMapSettings({ allowPlayerTokenMoves: event.target.checked })
                            }
                        />
                        <div className="perm-toggle__text">
                            <span className="perm-toggle__label">Allow players to move their tokens</span>
                            <span className="text-muted text-small">
                                Grant owners the ability to drag their own token markers during encounters.
                            </span>
                        </div>
                    </label>
                    <label className={`perm-toggle${!isDM ? " is-readonly" : ""}`}>
                        <input
                            type="checkbox"
                            checked={mapSettings.paused}
                            disabled={!isDM || mapSaving}
                            onChange={(event) => applyMapSettings({ paused: event.target.checked })}
                        />
                        <div className="perm-toggle__text">
                            <span className="perm-toggle__label">Pause live updates</span>
                            <span className="text-muted text-small">
                                Pause the board while you prep the battlefield. Players keep their view until you resume.
                            </span>
                        </div>
                    </label>
                </div>
                <div className="row" style={{ justifyContent: "space-between", marginTop: 12, gap: 12 }}>
                    <span className="text-muted text-small">
                        {mapStrokeCount === 0
                            ? "No freehand drawings saved yet."
                            : `${mapStrokeCount} drawing${mapStrokeCount === 1 ? "" : "s"} on the board.`}
                    </span>
                    <button
                        type="button"
                        className="btn ghost btn-small"
                        disabled={!isDM || clearingDrawings || mapStrokeCount === 0}
                        onClick={handleClearDrawings}
                    >
                        {clearingDrawings ? "Clearing…" : "Clear drawings"}
                    </button>
                </div>
            </>
        );
    } else if (activeSection === "story") {
        const sharedStatusClass = `pill ${sharedBotAvailable ? "success" : "warn"}`;
        const sharedStatusText = sharedBotAvailable ? "Shared bot ready" : "Shared bot unavailable";
        const botModeDescription = hasCustomBotToken
            ? "This campaign will authenticate with its own Discord bot token."
            : usingSharedBot
                ? "This campaign will use the shared Jack Endex bot configured on the server."
                : "Add a bot token or rely on the shared bot to enable Discord syncing.";
        const showPrimaryDefaults = !!(
            storyPrimaryBot.defaultGuildId || storyPrimaryBot.defaultChannelId
        );
        sectionContent = (
            <>
                <h3>Discord story integration</h3>
                <p className="text-muted text-small" style={{ marginTop: -4 }}>
                    Link your campaign to a Discord channel and webhook so the story tab can both read and post updates.
                </p>
                <div className="story-callout">
                    <div
                        className="row"
                        style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}
                    >
                        <div className="col" style={{ gap: 4 }}>
                            <strong>Shared bot status</strong>
                            <span className="text-muted text-small">{botModeDescription}</span>
                        </div>
                        <span className={sharedStatusClass}>{sharedStatusText}</span>
                    </div>
                    {sharedBotAvailable ? (
                        <>
                            <p className="text-muted text-small" style={{ marginTop: 8 }}>
                                Leave the token field blank to fall back to the shared bot.
                                {storyPrimaryBot.inviteUrl
                                    ? " Invite it to your server if it isn't already present."
                                    : ""}
                            </p>
                            {storyPrimaryBot.inviteUrl && (
                                <div className="row" style={{ marginTop: 4, justifyContent: "flex-start" }}>
                                    <a
                                        className="btn ghost btn-small"
                                        href={storyPrimaryBot.inviteUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Invite the shared bot
                                    </a>
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="text-muted text-small" style={{ marginTop: 8 }}>
                            No shared bot token is configured on the server. Provide a bot token below to enable syncing.
                        </p>
                    )}
                    {showPrimaryDefaults && (
                        <div className="story-callout__grid">
                            {storyPrimaryBot.defaultGuildId && (
                                <div>
                                    <span className="story-callout__label">Default guild</span>
                                    <code>{storyPrimaryBot.defaultGuildId}</code>
                                </div>
                            )}
                            {storyPrimaryBot.defaultChannelId && (
                                <div>
                                    <span className="story-callout__label">Default channel</span>
                                    <code>{storyPrimaryBot.defaultChannelId}</code>
                                </div>
                            )}
                        </div>
                    )}
                    {storyPrimaryBot.applicationId && (
                        <span className="text-muted text-small">
                            Application ID for slash commands: <code>{storyPrimaryBot.applicationId}</code>
                        </span>
                    )}
                </div>
                <label className="field" style={{ display: "grid", gap: 4 }}>
                    <span className="text-small">Bot token</span>
                    <input
                        type="password"
                        value={storyBotTokenValue}
                        onChange={(e) =>
                            setStoryForm((prev) => ({ ...prev, botToken: e.target.value }))
                        }
                        placeholder="Paste the Discord bot token for this campaign"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={storySaving}
                    />
                    {!hasCustomBotToken && sharedBotAvailable && (
                        <span className="text-muted text-small">
                            Leave blank to use the shared token configured on the server.
                        </span>
                    )}
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
                            When enabled, players get a composer in the Story tab. They can only speak as themselves unless
                            marked as Scribes.
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
                                    botToken: storyBotTokenValue.trim(),
                                    channelId: storyForm.channelId.trim(),
                                    guildId: storyForm.guildId.trim(),
                                    webhookUrl: storyForm.webhookUrl.trim(),
                                    allowPlayerPosts: !!storyForm.allowPlayerPosts,
                                    scribeIds: storyForm.scribeIds,
                                };
                                const result = await StoryLogs.configure(game.id, payload);
                                if (typeof onGameRefresh === "function") {
                                    await onGameRefresh();
                                }
                                const nextStory =
                                    result?.story && typeof result.story === "object"
                                        ? normalizeStorySettings(result.story)
                                        : normalizeStorySettings({
                                              ...storyForm,
                                              ...payload,
                                          });
                                setStoryForm(nextStory);
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
            </>
        );
    } else if (activeSection === "members" && canKick) {
        sectionContent = (
            <>
                <h3>Campaign members</h3>
                <p style={{ color: "var(--muted)", marginTop: -4 }}>
                    Remove players from the campaign if they should no longer have access.
                </p>
                <div className="list">
                    {removablePlayers.length === 0 ? (
                        <span className="text-muted text-small">No players have joined yet.</span>
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
                                            <span className="text-muted text-small">{subtitle}</span>
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
            </>
        );
    } else if (activeSection === "danger" && canDelete) {
        sectionContent = (
            <>
                <h3>Danger Zone</h3>
                <p style={{ color: "var(--muted)", marginTop: -4 }}>
                    Deleting this game will remove all characters, inventory, and invites for every player.
                </p>
                <button className="btn danger" onClick={onDelete}>
                    Delete Game
                </button>
            </>
        );
    }

    return (
        <div className="card settings-card">
            <div className="settings-tabs">
                {navSections.map((section) => (
                    <button
                        key={section.key}
                        type="button"
                        className={`settings-tab${activeSection === section.key ? " is-active" : ""}`}
                        onClick={() => setActiveSection(section.key)}
                    >
                        {section.label}
                    </button>
                ))}
            </div>
            <div className="settings-content">{sectionContent}</div>
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
