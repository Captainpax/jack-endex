import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EMPTY_ARRAY } from "../utils/constants";
import { resolveRealtimeUrl } from "../api";
import { getTrackById } from "../utils/music";

function normalizeMusicSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;
    const trackId = typeof snapshot.trackId === "string" ? snapshot.trackId.trim() : "";
    if (!trackId || !getTrackById(trackId)) return null;
    const updatedAt = typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : new Date().toISOString();
    return { trackId, updatedAt };
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


export default function useRealtimeConnection({ gameId, refreshGame, onGameDeleted }) {
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
    const [musicState, setMusicState] = useState(null);
    const [musicError, setMusicError] = useState(null);
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
                case "music:state": {
                    if (msg.gameId !== gameId) return;
                    const snapshot = normalizeMusicSnapshot(msg.music);
                    setMusicState(snapshot);
                    setMusicError(null);
                    break;
                }
                case "music:error":
                    if (msg.gameId !== gameId) return;
                    setMusicError(typeof msg.error === "string" ? msg.error : "Music command failed");
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
                const url = resolveRealtimeUrl("/ws");
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
            setMusicState(null);
            setMusicError(null);
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

    const syncMusic = useCallback((snapshot) => {
        setMusicState(normalizeMusicSnapshot(snapshot));
        setMusicError(null);
    }, []);

    const playMusic = useCallback(
        (trackId) => {
            if (!gameId) throw new Error("missing_game");
            const trimmed = typeof trackId === "string" ? trackId.trim() : "";
            if (!trimmed) throw new Error("missing_track");
            setMusicError(null);
            sendMessage({ type: "music.play", gameId, trackId: trimmed });
        },
        [gameId, sendMessage]
    );

    const stopMusic = useCallback(() => {
        if (!gameId) return;
        setMusicError(null);
        sendMessage({ type: "music.stop", gameId });
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
        musicState,
        musicError,
        syncMusic,
        playMusic,
        stopMusic,
        alerts,
        alertError,
        sendAlert: sendAlertMessage,
        dismissAlert,
    };
}

export { normalizeMusicSnapshot, normalizeAlertEntry };
