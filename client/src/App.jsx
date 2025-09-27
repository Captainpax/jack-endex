// --- FILE: client/src/App.jsx ---
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import { ApiError, Auth, Games, Help, StoryLogs, onApiActivity } from "./api";

import useRealtimeConnection from "./hooks/useRealtimeConnection";
import MathField from "./components/MathField";
import WorldSkillsTab from "./components/WorldSkillsTab";
import { GearTab, ItemsTab } from "./components/ItemsGearTabs";
import DemonTab from "./components/DemonTab";
import DemonImage from "./components/DemonImage";
import { DM_NAV, PLAYER_NAV } from "./constants/navigation";
import { BATTLE_MATH_REFERENCE } from "./constants/referenceContent";
import {
    ABILITY_DEFS,
    ABILITY_KEY_SET,
    ARCANA_DATA,
    COMBAT_CATEGORY_LABELS,
    COMBAT_CATEGORY_OPTIONS,
    COMBAT_SKILL_SORT_OPTIONS,
    COMBAT_SKILL_SORTERS,
    COMBAT_TIER_ORDER,
    COMBAT_TIER_INFO,
    COMBAT_TIER_LABELS,
    CONCEPT_PROMPTS,
    DEFAULT_COMBAT_CATEGORY,
    DEFAULT_WORLD_SKILLS,
    DEMON_RESISTANCE_SORTS,
    WORLD_SKILL_SORT_OPTIONS,
    WORLD_SKILL_SORTERS,
    abilityModifier,
    clampNonNegative,
    computeCombatSkillDamage,
    formatModifier,
    getDemonSkillList,
    makeCustomSkillId,
    NEW_COMBAT_SKILL_ID,
    NEW_WORLD_SKILL_ID,
    normalizeCombatCategoryValue,
    normalizeCombatSkillDefs,
    normalizeCustomSkills,
    normalizeWorldSkillDefs,
    ROLE_ARCHETYPES,
    SAVE_DEFS,
} from "./constants/gameData";
import { EMPTY_ARRAY, EMPTY_OBJECT } from "./utils/constants";
import { createEmptySkillViewPrefs, sanitizeSkillViewPrefs } from "./utils/skillViewPrefs";
import { deepClone, normalizeCharacter, normalizeSkills } from "./utils/character";
import { get } from "./utils/object";
import { getAvailableTracks, getMainMenuTrack, getTrackById } from "./utils/music";

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



const RealtimeContext = createContext(null);

const MusicContext = createContext({
    currentTrack: null,
    playTrack: () => {},
    stopTrack: () => {},
    volume: 0.2,
    setVolume: () => {},
    muted: false,
    setMuted: () => {},
    toggleMute: () => {},
    playbackBlocked: false,
    resume: () => {},
});

const MUSIC_VOLUME_KEY = "amz:musicVolume";
const MUSIC_MUTED_KEY = "amz:musicMuted";

function clampVolume(value, fallback = 0.2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    if (num <= 0) return 0;
    if (num >= 1) return 1;
    return num;
}

function MusicProvider({ children }) {
    const audioRef = useRef(null);
    const [currentTrack, setCurrentTrack] = useState(null);
    const [volume, setVolumeState] = useState(() => {
        if (typeof window === "undefined") return 0.2;
        const stored = window.localStorage.getItem(MUSIC_VOLUME_KEY);
        return clampVolume(stored, 0.2);
    });
    const [muted, setMutedState] = useState(() => {
        if (typeof window === "undefined") return false;
        return window.localStorage.getItem(MUSIC_MUTED_KEY) === "1";
    });
    const [playbackBlocked, setPlaybackBlocked] = useState(false);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.volume = clampVolume(volume, volume);
    }, [volume]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.muted = !!muted;
    }, [muted]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return undefined;
        if (currentTrack && currentTrack.src) {
            const loop = currentTrack.loop !== false;
            if (audio.src !== currentTrack.src) {
                audio.src = currentTrack.src;
                audio.load();
            }
            audio.loop = loop;
            audio.currentTime = 0;
            const attemptPlay = () => {
                try {
                    const maybePromise = audio.play();
                    if (maybePromise && typeof maybePromise.then === "function") {
                        maybePromise
                            .then(() => setPlaybackBlocked(false))
                            .catch((err) => {
                                console.warn("Music playback blocked", err);
                                setPlaybackBlocked(true);
                            });
                    } else {
                        setPlaybackBlocked(false);
                    }
                } catch (err) {
                    console.warn("Music playback failed", err);
                    setPlaybackBlocked(true);
                }
            };
            if (audio.readyState >= 2) {
                attemptPlay();
            } else {
                const onCanPlay = () => {
                    audio.removeEventListener("canplay", onCanPlay);
                    attemptPlay();
                };
                audio.addEventListener("canplay", onCanPlay);
                return () => audio.removeEventListener("canplay", onCanPlay);
            }
        } else {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            setPlaybackBlocked(false);
        }
        return undefined;
    }, [currentTrack]);

    const playTrack = useCallback((track) => {
        if (!track || !track.src) {
            setCurrentTrack(null);
            return;
        }
        setCurrentTrack((prev) => {
            if (
                prev &&
                prev.id === track.id &&
                prev.src === track.src &&
                prev.updatedAt === track.updatedAt
            ) {
                return prev;
            }
            return {
                id: track.id,
                title: track.title,
                subtitle: track.subtitle,
                src: track.src,
                loop: track.loop !== false,
                updatedAt: track.updatedAt || null,
            };
        });
    }, []);

    const stopTrack = useCallback(() => {
        setCurrentTrack(null);
    }, []);

    const updateVolume = useCallback((value) => {
        setVolumeState((prev) => {
            const sanitized = clampVolume(value, prev);
            if (typeof window !== "undefined") {
                window.localStorage.setItem(MUSIC_VOLUME_KEY, String(sanitized));
            }
            return sanitized;
        });
    }, []);

    const updateMuted = useCallback((value) => {
        const next = !!value;
        setMutedState(next);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(MUSIC_MUTED_KEY, next ? "1" : "0");
        }
    }, []);

    const toggleMute = useCallback(() => {
        updateMuted(!muted);
    }, [muted, updateMuted]);

    const resumePlayback = useCallback(() => {
        const audio = audioRef.current;
        if (!audio || !currentTrack?.src) return;
        try {
            const maybePromise = audio.play();
            if (maybePromise && typeof maybePromise.then === "function") {
                maybePromise
                    .then(() => setPlaybackBlocked(false))
                    .catch((err) => {
                        console.warn("Music resume failed", err);
                        setPlaybackBlocked(true);
                    });
            } else {
                setPlaybackBlocked(false);
            }
        } catch (err) {
            console.warn("Music resume failed", err);
            setPlaybackBlocked(true);
        }
    }, [currentTrack]);

    const contextValue = useMemo(
        () => ({
            currentTrack,
            playTrack,
            stopTrack,
            volume,
            setVolume: updateVolume,
            muted,
            setMuted: updateMuted,
            toggleMute,
            playbackBlocked,
            resume: resumePlayback,
        }),
        [currentTrack, playTrack, stopTrack, volume, updateVolume, muted, updateMuted, toggleMute, playbackBlocked, resumePlayback]
    );

    return (
        <MusicContext.Provider value={contextValue}>
            {children}
            <audio ref={audioRef} preload="auto" style={{ display: "none" }} />
        </MusicContext.Provider>
    );
}

// formatting helpers moved to utils/items

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

    const authContent = (
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

    const appContent = (
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

    const body = loading ? <Center>Loading…</Center> : me ? appContent : authContent;

    return <MusicProvider>{body}</MusicProvider>;
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

    const musicControls = useContext(MusicContext);
    const playTrack = musicControls?.playTrack;
    const stopTrack = musicControls?.stopTrack;

    useEffect(() => {
        const track = getMainMenuTrack();
        if (typeof playTrack === "function") {
            if (track) {
                playTrack(track);
            } else if (typeof stopTrack === "function") {
                stopTrack();
            }
        }
        return () => {
            if (typeof stopTrack === "function") {
                stopTrack();
            }
        };
    }, [playTrack, stopTrack]);

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
    const [isDesktop, setIsDesktop] = useState(() =>
        typeof window === "undefined" ? true : window.innerWidth >= 960
    );
    const [sidebarOpen, setSidebarOpen] = useState(() =>
        typeof window === "undefined" ? true : window.innerWidth > 960
    );
    const [logoutBusy, setLogoutBusy] = useState(false);
    const loadedTabRef = useRef(false);
    const loadedSheetRef = useRef(false);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const handleResize = () => {
            setIsDesktop(window.innerWidth >= 960);
        };
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        setSidebarOpen(isDesktop);
    }, [isDesktop]);

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
            if (!isDesktop) {
                setSidebarOpen(false);
            }
        },
        [isDesktop, setTab]
    );

    const toggleSidebar = useCallback(() => {
        setSidebarOpen((prev) => !prev);
    }, []);

    const closeSidebar = useCallback(() => {
        if (isDesktop) return;
        setSidebarOpen(false);
    }, [isDesktop]);

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

    const syncMusic = realtime.syncMusic;
    const musicControls = useContext(MusicContext);
    const playTrack = musicControls?.playTrack;
    const stopTrack = musicControls?.stopTrack;
    const realtimeTrackId = realtime.musicState?.trackId || null;
    const realtimeTrackUpdatedAt = realtime.musicState?.updatedAt || null;
    const volumeValue = typeof musicControls?.volume === "number" ? musicControls.volume : 0.2;
    const muted = !!musicControls?.muted;
    const setVolume = musicControls?.setVolume;
    const toggleMuteControl = musicControls?.toggleMute;
    const resumePlayback = musicControls?.resume;
    const playbackBlocked = !!musicControls?.playbackBlocked;
    const currentMusicTrack = musicControls?.currentTrack || null;
    const canSetVolume = typeof setVolume === "function";
    const canToggleMute = typeof toggleMuteControl === "function";
    const canResumePlayback = typeof resumePlayback === "function";

    useEffect(() => {
        if (typeof syncMusic === "function") {
            syncMusic(game.music);
        }
    }, [game.music, syncMusic]);

    useEffect(() => {
        const track = realtimeTrackId ? getTrackById(realtimeTrackId) : null;
        if (track) {
            if (typeof playTrack === "function") {
                playTrack({ ...track, updatedAt: realtimeTrackUpdatedAt });
            }
        } else if (typeof stopTrack === "function") {
            stopTrack();
        }
    }, [playTrack, stopTrack, realtimeTrackId, realtimeTrackUpdatedAt]);

    useEffect(
        () => () => {
            if (typeof stopTrack === "function") {
                stopTrack();
            }
        },
        [stopTrack]
    );

    const sidebarVisible = sidebarOpen;
    const shellClassName = `app-shell ${sidebarVisible ? "is-sidebar-open" : "is-sidebar-collapsed"}`;

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
                        aria-hidden={!sidebarVisible}
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
                                hidden={isDesktop || !sidebarOpen}
                            >
                                <span aria-hidden>×</span>
                            </button>
                        </div>
                        <nav className="sidebar__nav">
                            {navItems.map((item) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    className={`sidebar__nav-button${
                                        tab === item.key ? " is-active" : ""
                                    }`}
                                    onClick={() => handleSelectNav(item.key)}
                                >
                                    <span className="sidebar__nav-label">{item.label}</span>
                                    {item.description && (
                                        <span className="sidebar__nav-desc">{item.description}</span>
                                    )}
                                </button>
                            ))}
                        </nav>
                        <div className="sidebar__audio-panel">
                            <div className="sidebar__audio-header">
                                <span className="sidebar__audio-title">Session music</span>
                                {playbackBlocked && (
                                    <button
                                        type="button"
                                        className="btn ghost btn-small"
                                        onClick={() => {
                                            if (canResumePlayback) {
                                                resumePlayback();
                                            }
                                        }}
                                        disabled={!canResumePlayback}
                                    >
                                        Resume
                                    </button>
                                )}
                            </div>
                            <div className="sidebar__audio-controls">
                                <button
                                    type="button"
                                    className="btn ghost btn-small"
                                    onClick={() => {
                                        if (canToggleMute) {
                                            toggleMuteControl();
                                        }
                                    }}
                                    disabled={!canToggleMute}
                                >
                                    {muted ? "Unmute" : "Mute"}
                                </button>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={Math.round(volumeValue * 100)}
                                    onChange={(event) => {
                                        if (canSetVolume) {
                                            const next = Number(event.target.value) / 100;
                                            setVolume(next);
                                        }
                                    }}
                                    disabled={!canSetVolume}
                                    aria-label="Music volume"
                                />
                                <span className="sidebar__audio-volume">{Math.round(volumeValue * 100)}%</span>
                            </div>
                            <div className="sidebar__audio-track">
                                {currentMusicTrack ? (
                                    <>
                                        <strong>{currentMusicTrack.title}</strong>
                                        {currentMusicTrack.subtitle && (
                                            <span className="text-muted"> · {currentMusicTrack.subtitle}</span>
                                        )}
                                    </>
                                ) : (
                                    <span className="text-muted">No track selected</span>
                                )}
                            </div>
                        </div>
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
                                    className={`sidebar-toggle${sidebarVisible ? "" : " is-closed"}`}
                                    onClick={toggleSidebar}
                                    aria-expanded={sidebarVisible}
                                    aria-controls="game-sidebar"
                                    title={sidebarOpen ? "Hide navigation" : "Show navigation"}
                                    hidden={isDesktop}
                                    aria-hidden={isDesktop}
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
                                {!isDM && (
                                    <div className="header-metrics">
                                        <div className="header-metric">
                                            <span className="text-muted text-small">Account</span>
                                            <strong>{me?.username?.trim() || "Player"}</strong>
                                        </div>
                                        <div className="header-metric">
                                            <span className="text-muted text-small">Macca</span>
                                            <strong>{playerMaccaInfo.label}</strong>
                                        </div>
                                        {myEntry && (
                                            <div className="header-metric">
                                                <span className="text-muted text-small">Character</span>
                                                <strong>
                                                    {myEntry.character?.name?.trim() ||
                                                        me?.username?.trim() ||
                                                        "Character"}
                                                </strong>
                                            </div>
                                        )}
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

function mapReadBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return false;
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return false;
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
            allowPlayerDrawing: mapReadBoolean(map.settings?.allowPlayerDrawing),
            allowPlayerTokenMoves: mapReadBoolean(map.settings?.allowPlayerTokenMoves),
        },
        paused: mapReadBoolean(map.paused),
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
                                        style={{ backgroundColor: brushColor }}
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
                            const demon = token.kind === 'demon' ? findDemon(token.refId) : null;
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
                    </div>
                </aside>
            </div>
        </div>
    );
}

// ---------- DM Overview ----------
function DMOverview({ game, onInspectPlayer }) {
    const realtime = useContext(RealtimeContext);
    const tracks = useMemo(() => getAvailableTracks(), []);
    const [selectedTrackId, setSelectedTrackId] = useState(() => {
        const initial = realtime?.musicState?.trackId;
        if (initial) return initial;
        return tracks[0]?.id || "";
    });
    const [alertDraft, setAlertDraft] = useState("");
    const [musicFormError, setMusicFormError] = useState(null);
    const [alertFormError, setAlertFormError] = useState(null);
    const isRealtimeConnected = !!realtime?.connected;
    const currentTrackId = realtime?.musicState?.trackId || "";
    const currentMusic = currentTrackId ? getTrackById(currentTrackId) : null;
    const serverMusicError = realtime?.musicError || null;
    const friendlyMusicError = useMemo(() => {
        if (!serverMusicError) return null;
        switch (serverMusicError) {
            case "invalid_track":
                return "That track isn’t available.";
            case "invalid_request":
                return "Select a track before pressing play.";
            case "forbidden":
                return "Only the DM can control playback.";
            case "not_found":
                return "Campaign not found. Refresh and try again.";
            default:
                return serverMusicError;
        }
    }, [serverMusicError]);
    const displayMusicError = musicFormError || friendlyMusicError;
    useEffect(() => {
        if (currentTrackId) {
            setSelectedTrackId(currentTrackId);
        }
    }, [currentTrackId]);
    useEffect(() => {
        if (musicFormError) {
            setMusicFormError(null);
        }
    }, [selectedTrackId, musicFormError]);
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

    useEffect(() => {
        if (tracks.length === 0) return;
        if (!selectedTrackId || !tracks.some((track) => track.id === selectedTrackId)) {
            setSelectedTrackId((prev) => (prev && tracks.some((track) => track.id === prev) ? prev : tracks[0].id));
        }
    }, [tracks, selectedTrackId]);

    const playMusic = realtime?.playMusic;
    const stopMusic = realtime?.stopMusic;
    const hasTracks = tracks.length > 0;
    const canPlayMusic = !!playMusic && isRealtimeConnected && hasTracks;
    const canStopMusic = !!stopMusic && isRealtimeConnected && !!currentMusic;

    const handleMusicSubmit = (evt) => {
        evt.preventDefault();
        if (!playMusic) return;
        const trimmed = typeof selectedTrackId === "string" ? selectedTrackId.trim() : "";
        if (!trimmed) {
            setMusicFormError("Select a track to share");
            return;
        }
        try {
            playMusic(trimmed);
            setMusicFormError(null);
        } catch (err) {
            const message = err?.message === "not_connected"
                ? "Waiting for the realtime connection…"
                : err?.message || "Failed to start music";
            setMusicFormError(message);
        }
    };

    const handleMusicStop = () => {
        if (!stopMusic) return;
        try {
            stopMusic();
            setMusicFormError(null);
        } catch (err) {
            const message = err?.message === "not_connected"
                ? "Waiting for the realtime connection…"
                : err?.message || "Failed to stop music";
            setMusicFormError(message);
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
                            Share ambience music or send urgent alerts to everyone currently online.
                        </p>
                    </div>
                    {!isRealtimeConnected && (
                        <span className="text-muted text-small">Connecting…</span>
                    )}
                </div>
                <div className="stack">
                    <form className="dm-broadcast__form" onSubmit={handleMusicSubmit}>
                        <label htmlFor="dm-broadcast-track">Campaign track</label>
                        <div className="row wrap">
                            <select
                                id="dm-broadcast-track"
                                value={selectedTrackId}
                                onChange={(e) => setSelectedTrackId(e.target.value)}
                                disabled={!hasTracks || !isRealtimeConnected}
                            >
                                {tracks.map((track) => (
                                    <option key={track.id} value={track.id}>
                                        {track.title}
                                        {track.subtitle ? ` — ${track.subtitle}` : ""}
                                    </option>
                                ))}
                                {!hasTracks && <option value="">No tracks available</option>}
                            </select>
                            <button type="submit" className="btn" disabled={!canPlayMusic}>
                                Play for party
                            </button>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={handleMusicStop}
                                disabled={!canStopMusic}
                            >
                                Stop playback
                            </button>
                        </div>
                        <p className="text-muted text-small">
                            Players hear this track until you stop it. They can adjust volume from the sidebar.
                        </p>
                        {currentMusic && (
                            <p className="text-small dm-broadcast__now-playing">
                                Now playing:{" "}
                                <strong>{currentMusic.title}</strong>
                                {currentMusic.subtitle && (
                                    <span className="text-muted"> · {currentMusic.subtitle}</span>
                                )}
                            </p>
                        )}
                        {displayMusicError && (
                            <span className="text-error text-small">{displayMusicError}</span>
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


function SharedMediaDisplay({ isDM }) {
    const realtime = useContext(RealtimeContext);
    const musicControls = useContext(MusicContext);
    const trackId = realtime?.musicState?.trackId || null;
    const track = trackId ? getTrackById(trackId) : null;
    const playbackBlocked = !!musicControls?.playbackBlocked;
    const resume = musicControls?.resume;
    const canResume = typeof resume === "function";
    const muted = !!musicControls?.muted;

    if (!track && !playbackBlocked) return null;

    const description = isDM ? "Shared with the party" : "Broadcast from your DM";

    return (
        <div className="shared-media">
            <div className="shared-media__header">
                <strong>Session music</strong>
                {playbackBlocked && (
                    <button
                        type="button"
                        className="btn ghost btn-small"
                        onClick={() => {
                            if (canResume) {
                                resume();
                            }
                        }}
                        disabled={!canResume}
                    >
                        Resume audio
                    </button>
                )}
            </div>
            <div className="shared-media__body shared-media__body--compact">
                {track ? (
                    <p className="shared-media__track">
                        Now playing: <strong>{track.title}</strong>
                        {track.subtitle && <span className="text-muted"> · {track.subtitle}</span>}
                    </p>
                ) : (
                    <p>No track is currently selected.</p>
                )}
                <p className="text-muted text-small">
                    Use the sidebar controls to adjust volume{muted ? " (muted)" : ""}.
                </p>
                <span className="text-muted text-small">{description}</span>
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

    const [collapsedSections, setCollapsedSections] = useState(() => ({
        profile: false,
        resources: false,
        abilities: false,
        worldSkills: false,
    }));
    const toggleSection = useCallback((key) => {
        setCollapsedSections((prev) => ({
            ...prev,
            [key]: !prev?.[key],
        }));
    }, []);
    const profileSectionId = useId();
    const resourcesSectionId = useId();
    const abilitySectionId = useId();
    const worldSkillsSectionId = useId();

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
    const maxTP = clampNonNegative(get(ch, "resources.maxTP"));
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
        async (payload) => {
            const next = normalizeCharacter(payload || {}, worldSkills);
            setCh(next);
            setShowWizard(false);
            if (!onSave || !canEditSheet || !hasSelection) return;
            try {
                setSaving(true);
                const request =
                    isDM && selectedPlayerId && selectedPlayerId !== me.id
                        ? { userId: selectedPlayerId, character: next }
                        : next;
                await onSave(request);
            } catch (error) {
                console.error(error);
                alert(error?.message || "Failed to save character");
            } finally {
                setSaving(false);
            }
        },
        [canEditSheet, hasSelection, isDM, me.id, onSave, selectedPlayerId, setCh, setShowWizard, setSaving, worldSkills]
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

                    <section
                        className={`sheet-section${collapsedSections.profile ? " is-collapsed" : ""}`}
                    >
                        <button
                            type="button"
                            className="section-header"
                            onClick={() => toggleSection("profile")}
                            aria-expanded={!collapsedSections.profile}
                            aria-controls={profileSectionId}
                        >
                            <div className="section-header__text">
                                <h4>Adventurer profile</h4>
                                <p className="text-muted text-small" style={{ margin: 0 }}>
                                    Capture the essentials, from alignment and arcana to class.
                                </p>
                            </div>
                            <span className="section-header__icon" aria-hidden="true">
                                {collapsedSections.profile ? "▸" : "▾"}
                            </span>
                        </button>
                        {!collapsedSections.profile && (
                            <div className="section-body" id={profileSectionId}>
                                <div className="sheet-grid">
                                    {textField("Character name", "name")}
                                    {textField("Player / handler", "profile.player", {
                                        placeholder: slot?.username || me.username,
                                    })}
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
                            </div>
                        )}
                    </section>

                    <section
                        className={`sheet-section${collapsedSections.resources ? " is-collapsed" : ""}`}
                    >
                        <button
                            type="button"
                            className="section-header"
                            onClick={() => toggleSection("resources")}
                            aria-expanded={!collapsedSections.resources}
                            aria-controls={resourcesSectionId}
                        >
                            <div className="section-header__text">
                                <h4>Progress & resources</h4>
                                <p className="text-muted text-small" style={{ margin: 0 }}>
                                    Base formulas assume modifiers: adjust manually if your table uses variants.
                                </p>
                            </div>
                            <span className="section-header__icon" aria-hidden="true">
                                {collapsedSections.resources ? "▸" : "▾"}
                            </span>
                        </button>
                        {!collapsedSections.resources && (
                            <div className="section-body" id={resourcesSectionId}>
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
                                        <>
                                            <MathField
                                                label="TP"
                                                value={tp}
                                                onCommit={(val) => set("resources.tp", clampNonNegative(val))}
                                                className="math-inline"
                                                disabled={disableInputs}
                                            />
                                            <MathField
                                                label="Max TP"
                                                value={maxTP}
                                                onCommit={(val) => set("resources.maxTP", clampNonNegative(val))}
                                                className="math-inline"
                                                disabled={disableInputs}
                                            />
                                        </>
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
                                                onCommit={(val) =>
                                                    set(`resources.saves.${save.key}.total`, Number(val))
                                                }
                                                className="math-inline"
                                                disabled={disableInputs}
                                            />
                                            <p className="text-muted text-small">
                                                Add class, gear, and situational bonuses here.
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>

                    <section
                        className={`sheet-section${collapsedSections.abilities ? " is-collapsed" : ""}`}
                    >
                        <button
                            type="button"
                            className="section-header"
                            onClick={() => toggleSection("abilities")}
                            aria-expanded={!collapsedSections.abilities}
                            aria-controls={abilitySectionId}
                        >
                            <div className="section-header__text">
                                <h4>Ability scores</h4>
                                <p className="text-muted text-small" style={{ margin: 0 }}>
                                    Every formula references these modifiers. Even numbers step the modifier.
                                </p>
                            </div>
                            <span className="section-header__icon" aria-hidden="true">
                                {collapsedSections.abilities ? "▸" : "▾"}
                            </span>
                        </button>
                        {!collapsedSections.abilities && (
                            <div className="section-body" id={abilitySectionId}>
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
                            </div>
                        )}
                    </section>

                    <section
                        className={`sheet-section${collapsedSections.worldSkills ? " is-collapsed" : ""}`}
                    >
                        <button
                            type="button"
                            className="section-header"
                            onClick={() => toggleSection("worldSkills")}
                            aria-expanded={!collapsedSections.worldSkills}
                            aria-controls={worldSkillsSectionId}
                        >
                            <div className="section-header__text">
                                <h4>World skills</h4>
                                <p className="text-muted text-small" style={{ margin: 0 }}>
                                    Spend SP immediately. Max rank at level {level} is {maxSkillRank}.
                                </p>
                            </div>
                            <span className="section-header__icon" aria-hidden="true">
                                {collapsedSections.worldSkills ? "▸" : "▾"}
                            </span>
                        </button>
                        {!collapsedSections.worldSkills && (
                            <div className="section-body" id={worldSkillsSectionId}>
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
                    </div>
                        )}
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
    const [applying, setApplying] = useState(false);
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
        setApplying(false);
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
                maxTP: useTP ? suggestedTP : prev.maxTP,
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

    const handleApply = useCallback(async () => {
        if (!canApply || applying) return;
        const payload = buildCharacterFromWizard(
            { concept, abilities, resources, skills },
            baseCharacter,
            normalizedWorldSkills
        );
        try {
            setApplying(true);
            await onApply?.(payload);
        } catch (error) {
            console.error(error);
            alert(error?.message || "Failed to apply setup");
        } finally {
            setApplying(false);
        }
    }, [abilities, applying, baseCharacter, canApply, concept, normalizedWorldSkills, onApply, resources, skills]);

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
                {conceptField("Concept / class", "class", {
                    placeholder: "Click a role card below to autofill",
                })}
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
                {ROLE_ARCHETYPES.map((role) => {
                    const selectedTitle = concept.class?.trim().toLowerCase();
                    const normalizedTitle = role.title?.trim().toLowerCase();
                    const isSelected = !!selectedTitle && selectedTitle === normalizedTitle;
                    return (
                        <button
                            key={role.key}
                            type="button"
                            className={`wizard-role-card${isSelected ? " is-selected" : ""}`}
                            onClick={() => setConceptField("class", role.title)}
                            aria-pressed={isSelected}
                        >
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
                            <div className="wizard-role-card__cta" aria-hidden="true">
                                {isSelected ? "Selected" : "Use this class"}
                            </div>
                        </button>
                    );
                })}
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
                    <>
                        {resourceField("TP", "tp")}
                        {resourceField("Max TP", "maxTP")}
                    </>
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
                                <li>TP {resources.tp}/{resources.maxTP || resources.tp}</li>
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
                            <button
                                type="button"
                                className="btn"
                                onClick={handleApply}
                                disabled={!canApply || applying}
                            >
                                {applying ? "Applying…" : "Apply to sheet"}
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
        maxTP: clampNonNegative(normalized.resources?.maxTP),
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
        tp: useTP ? clampNonNegative(state.resources.tp) : clampNonNegative(normalized.resources?.tp),
        maxTP: useTP
            ? clampNonNegative(state.resources.maxTP)
            : clampNonNegative(normalized.resources?.maxTP),
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
    const viewPrefKey = useMemo(
        () => `combat-skill-view:${game.id || "game"}:${me.id || "user"}`,
        [game.id, me.id]
    );
    const [viewPrefs, setViewPrefs] = useState(() => createEmptySkillViewPrefs());
    const [showHiddenSkills, setShowHiddenSkills] = useState(false);
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
        setShowHiddenSkills(false);
    }, [game.id, abilityDefault]);

    const editingSkill = useMemo(() => {
        if (!editingSkillId || editingSkillId === NEW_COMBAT_SKILL_ID) return null;
        return combatSkills.find((skill) => skill.id === editingSkillId) || null;
    }, [editingSkillId, combatSkills]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const stored = window.localStorage.getItem(viewPrefKey);
            if (!stored) {
                setViewPrefs(createEmptySkillViewPrefs());
                return;
            }
            const parsed = JSON.parse(stored);
            setViewPrefs(sanitizeSkillViewPrefs(parsed));
        } catch (err) {
            console.warn("Failed to load combat skill view preferences", err);
            setViewPrefs(createEmptySkillViewPrefs());
        }
    }, [viewPrefKey]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem(viewPrefKey, JSON.stringify(viewPrefs));
        } catch (err) {
            console.warn("Failed to save combat skill view preferences", err);
        }
    }, [viewPrefKey, viewPrefs]);

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
        setViewPrefs((prev) => {
            if (!prev) return createEmptySkillViewPrefs();
            const validIds = new Set(combatSkills.map((skill) => skill.id));
            const favorites = prev.favorites.filter((id) => validIds.has(id));
            const hidden = prev.hidden.filter((id) => validIds.has(id));
            if (favorites.length === prev.favorites.length && hidden.length === prev.hidden.length) {
                return prev;
            }
            return { favorites, hidden };
        });
    }, [combatSkills]);

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

    const favoriteSkillIds = useMemo(() => new Set(viewPrefs.favorites), [viewPrefs.favorites]);
    const hiddenSkillIds = useMemo(() => new Set(viewPrefs.hidden), [viewPrefs.hidden]);

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

    const visibleSkills = useMemo(() => {
        const list = filteredSkills.filter((skill) => !hiddenSkillIds.has(skill.id));
        if (favoriteSkillIds.size === 0) return list;
        const favorites = [];
        const rest = [];
        list.forEach((skill) => {
            if (favoriteSkillIds.has(skill.id)) {
                favorites.push(skill);
            } else {
                rest.push(skill);
            }
        });
        return favorites.concat(rest);
    }, [favoriteSkillIds, filteredSkills, hiddenSkillIds]);

    const displaySkills = useMemo(() => {
        if (!editingSkill) return visibleSkills;
        if (visibleSkills.some((skill) => skill.id === editingSkill.id)) return visibleSkills;
        return [editingSkill, ...visibleSkills];
    }, [editingSkill, visibleSkills]);

    const hiddenSkills = useMemo(
        () => combatSkills.filter((skill) => hiddenSkillIds.has(skill.id)),
        [combatSkills, hiddenSkillIds]
    );

    useEffect(() => {
        if (hiddenSkills.length === 0) {
            setShowHiddenSkills(false);
        }
    }, [hiddenSkills.length]);

    const hasFilters = skillQuery.trim().length > 0 || skillSort !== "default";

    const toggleFavoriteSkill = useCallback((skillId) => {
        if (!skillId) return;
        setViewPrefs((prev) => {
            const favorites = new Set(prev.favorites);
            if (favorites.has(skillId)) {
                favorites.delete(skillId);
            } else {
                favorites.add(skillId);
            }
            const nextFavorites = Array.from(favorites);
            if (
                nextFavorites.length === prev.favorites.length &&
                nextFavorites.every((id, index) => id === prev.favorites[index])
            ) {
                return prev;
            }
            return { favorites: nextFavorites, hidden: prev.hidden };
        });
    }, []);

    const hideSkillFromView = useCallback((skillId) => {
        if (!skillId) return;
        setViewPrefs((prev) => {
            if (prev.hidden.includes(skillId)) return prev;
            return {
                favorites: prev.favorites,
                hidden: [...prev.hidden, skillId],
            };
        });
    }, []);

    const restoreHiddenSkill = useCallback((skillId) => {
        if (!skillId) return;
        setViewPrefs((prev) => {
            if (!prev.hidden.includes(skillId)) return prev;
            const hidden = prev.hidden.filter((id) => id !== skillId);
            return { favorites: prev.favorites, hidden };
        });
    }, []);

    const restoreAllHiddenSkills = useCallback(() => {
        setViewPrefs((prev) => {
            if (prev.hidden.length === 0) return prev;
            return { favorites: prev.favorites, hidden: [] };
        });
    }, []);

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
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activePane === "reference"}
                        className={`combat-skill-manager__tab${
                            activePane === "reference" ? " is-active" : ""
                        }`}
                        onClick={() => setActivePane("reference")}
                    >
                        Battle Math
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
                            <button
                                type="button"
                                className="btn ghost btn-small"
                                onClick={() => setShowHiddenSkills((prev) => !prev)}
                                disabled={hiddenSkills.length === 0}
                            >
                                {hiddenSkills.length === 0
                                    ? "No hidden skills"
                                    : showHiddenSkills
                                    ? "Hide hidden list"
                                    : `Show hidden (${hiddenSkills.length})`}
                            </button>
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
                                const isFavorite = favoriteSkillIds.has(skill.id);
                                return (
                                    <div
                                        key={skill.id}
                                        className={`combat-skill-card${isEditing ? " is-editing" : ""}${
                                            isFavorite ? " is-favorite" : ""
                                        }`}
                                    >
                                        {isEditing ? (
                                            renderSkillEditor("edit")
                                        ) : (
                                            <>
                                                <div className="combat-skill-card__header">
                                                    <div className="combat-skill-card__heading">
                                                        <h4>{skill.label}</h4>
                                                        <div className="combat-skill-card__badges">
                                                            <span className="pill">
                                                                {COMBAT_TIER_LABELS[skill.tier] || "Tier"}
                                                            </span>
                                                            <span className="pill light">{skill.ability} mod</span>
                                                            <span className="pill light">
                                                                {COMBAT_CATEGORY_LABELS[skill.category] || "Other"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="skill-card__toolbar">
                                                        <button
                                                            type="button"
                                                            className={`skill-card__icon-btn skill-card__icon-btn--star${
                                                                isFavorite ? " is-active" : ""
                                                            }`}
                                                            onClick={() => toggleFavoriteSkill(skill.id)}
                                                            aria-pressed={isFavorite}
                                                            aria-label={
                                                                isFavorite
                                                                    ? `Unstar ${skill.label}`
                                                                    : `Star ${skill.label}`
                                                            }
                                                            title={
                                                                isFavorite
                                                                    ? "Unstar to remove from the pinned list"
                                                                    : "Star to pin this skill to the top"
                                                            }
                                                        >
                                                            {isFavorite ? "★" : "☆"}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="skill-card__icon-btn"
                                                            onClick={() => {
                                                                hideSkillFromView(skill.id);
                                                                setShowHiddenSkills(true);
                                                            }}
                                                            disabled={busy || rowBusy === skill.id || isEditing}
                                                            aria-label={`Hide ${skill.label}`}
                                                            title="Hide this skill from the grid"
                                                        >
                                                            Hide
                                                        </button>
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
                        {hiddenSkills.length > 0 && (
                            <div className="skill-hidden">
                                <div className="skill-hidden__summary">
                                    <strong>Hidden skills ({hiddenSkills.length})</strong>
                                    <div className="skill-hidden__summary-actions">
                                        <button
                                            type="button"
                                            className="btn ghost btn-small"
                                            onClick={restoreAllHiddenSkills}
                                        >
                                            Restore all
                                        </button>
                                        {showHiddenSkills && (
                                            <button
                                                type="button"
                                                className="btn ghost btn-small"
                                                onClick={() => setShowHiddenSkills(false)}
                                            >
                                                Collapse
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {showHiddenSkills ? (
                                    <ul className="skill-hidden__list">
                                        {hiddenSkills.map((skill) => {
                                            const isFavorite = favoriteSkillIds.has(skill.id);
                                            return (
                                                <li key={skill.id} className="skill-hidden__item">
                                                    <div className="skill-hidden__info">
                                                        <strong>{skill.label}</strong>
                                                        <span className="text-muted text-small">
                                                            {`${COMBAT_TIER_LABELS[skill.tier] || "Tier"} · ${skill.ability} mod`}
                                                        </span>
                                                    </div>
                                                    <div className="skill-hidden__item-actions">
                                                        <button
                                                            type="button"
                                                            className={`skill-card__icon-btn skill-card__icon-btn--star${
                                                                isFavorite ? " is-active" : ""
                                                            }`}
                                                            onClick={() => toggleFavoriteSkill(skill.id)}
                                                            aria-pressed={isFavorite}
                                                            aria-label={
                                                                isFavorite
                                                                    ? `Unstar ${skill.label}`
                                                                    : `Star ${skill.label}`
                                                            }
                                                            title={
                                                                isFavorite
                                                                    ? "Unstar to remove from the pinned list"
                                                                    : "Star to pin this skill to the top"
                                                            }
                                                        >
                                                            {isFavorite ? "★" : "☆"}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn ghost btn-small"
                                                            onClick={() => restoreHiddenSkill(skill.id)}
                                                        >
                                                            Restore
                                                        </button>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                ) : (
                                    <p className="text-muted text-small">
                                        Hidden combat skills stay tucked away until you restore them.
                                    </p>
                                )}
                            </div>
                        )}
                        {displaySkills.length === 0 && hiddenSkills.length > 0 && (
                            <p className="text-muted text-small" style={{ marginTop: 12 }}>
                                Everything is hidden. Use “Show hidden” to bring skills back.
                            </p>
                        )}
                        {displaySkills.length === 0 && hiddenSkills.length === 0 && !canManage && (
                            <p className="text-muted text-small" style={{ marginTop: 12 }}>
                                No combat skills are available yet.
                            </p>
                        )}
                    </>
                ) : activePane === "codex" ? (
                    <CombatSkillCodexPanel demons={demons} skills={combatSkills} />
                ) : (
                    <CombatSkillReferencePanel reference={BATTLE_MATH_REFERENCE} />
                )}
            </div>
        </div>
    );
}

function CombatSkillReferencePanel({ reference = BATTLE_MATH_REFERENCE }) {
    const steps = [
        `Roll accuracy (${reference.accuracy.formula}).`,
        `Resolve damage (${reference.damage.formula}).`,
        "Apply weapon bonuses, weaknesses, resistances, buffs, debuffs, and critical modifiers.",
    ];

    return (
        <div className="combat-reference stack-lg">
            <section className="combat-reference__section">
                <h4>Battle flow</h4>
                <p className="text-small">{reference.overview}</p>
                <ol className="combat-reference__list combat-reference__list--numbered">
                    {steps.map((step, index) => (
                        <li key={index}>{step}</li>
                    ))}
                </ol>
            </section>

            <section className="combat-reference__section">
                <h4>{reference.accuracy.title}</h4>
                <p className="combat-reference__formula">
                    <code>{reference.accuracy.formula}</code>
                </p>
                <ul className="combat-reference__list">
                    {reference.accuracy.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                    ))}
                </ul>
            </section>

            <section className="combat-reference__section">
                <h4>{reference.damage.title}</h4>
                <p className="combat-reference__formula">
                    <code>{reference.damage.formula}</code>
                </p>
                <ul className="combat-reference__list">
                    {reference.damage.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                    ))}
                </ul>
            </section>

            <section className="combat-reference__section">
                <h4>Standard tiers</h4>
                <div className="combat-reference__table-wrapper">
                    <table className="combat-reference__table">
                        <thead>
                            <tr>
                                <th>Tier</th>
                                <th>Example</th>
                                <th>Dice</th>
                                <th>Ability modifier</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reference.tiers.map((tier) => (
                                <tr key={tier.tier}>
                                    <th scope="row">{tier.tier}</th>
                                    <td>{tier.example}</td>
                                    <td>{tier.dice}</td>
                                    <td>{tier.modifier}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="combat-reference__section">
                <h4>Table rulings</h4>
                <ul className="combat-reference__list">
                    {reference.skillNotes.map((note, index) => (
                        <li key={index}>{note}</li>
                    ))}
                </ul>
            </section>
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
        allowPlayerDrawing: mapReadBoolean(game.map?.settings?.allowPlayerDrawing),
        allowPlayerTokenMoves: mapReadBoolean(game.map?.settings?.allowPlayerTokenMoves),
        paused: mapReadBoolean(game.map?.paused),
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
            allowPlayerDrawing: mapReadBoolean(game.map?.settings?.allowPlayerDrawing),
            allowPlayerTokenMoves: mapReadBoolean(game.map?.settings?.allowPlayerTokenMoves),
            paused: mapReadBoolean(game.map?.paused),
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
                    allowPlayerDrawing: mapReadBoolean(updated.settings?.allowPlayerDrawing),
                    allowPlayerTokenMoves: mapReadBoolean(updated.settings?.allowPlayerTokenMoves),
                    paused: mapReadBoolean(updated.paused),
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

