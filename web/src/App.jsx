// --- FILE: web/src/App.jsx ---
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Auth, Games, Items, Personas, onApiActivity } from "./api";

const ENV = import.meta.env || {};
const readEnv = (key) => {
    const raw = ENV?.[key];
    return typeof raw === "string" ? raw.trim() : "";
};

const DISCORD_SERVER_ID = readEnv("VITE_DISCORD_SERVER_ID");
const DISCORD_CHANNEL_ID = readEnv("VITE_DISCORD_CHANNEL_ID");
const DISCORD_WIDGET_BASE = readEnv("VITE_DISCORD_WIDGET_BASE");
const DISCORD_WIDGET_THEME = readEnv("VITE_DISCORD_WIDGET_THEME") || "dark";

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
        key: "demons",
        label: "Demon Companions",
        description: "Track your summoned allies",
    },
    {
        key: "storyLogs",
        label: "Story Logs",
        description: "Catch up on the Discord channel",
    },
];

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

const WORLD_SKILLS = [
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
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);
    const [games, setGames] = useState([]);
    const [active, setActive] = useState(null);
    const [tab, setTab] = useState("sheet");
    const [dmSheetPlayerId, setDmSheetPlayerId] = useState(null);
    const [pendingJoinCode, setPendingJoinCode] = useState(() => {
        if (typeof window === "undefined") return null;
        const match = window.location.pathname.match(/^\/join\/([^/?#]+)/i);
        return match ? match[1].toUpperCase() : null;
    });
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
        if (!pendingJoinCode || !me || joinInFlight.current) return;
        joinInFlight.current = true;
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
                }
            } catch (e) {
                console.error(e);
                alert(e.message || "Failed to join game");
            } finally {
                setPendingJoinCode(null);
                joinInFlight.current = false;
                if (typeof window !== "undefined") {
                    window.history.replaceState({}, "", "/");
                }
            }
        })();
    }, [pendingJoinCode, me]);

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

    const handleRefresh = useCallback(async () => {
        if (!game?.id) return;
        try {
            setRefreshBusy(true);
            const full = await Games.get(game.id);
            setActive(full);
        } catch (e) {
            alert(e.message);
        } finally {
            setRefreshBusy(false);
        }
    }, [game?.id, setActive]);

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

    return (
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

                    {tab === "storyLogs" && <StoryLogsTab />}

                    {tab === "settings" && isDM && (
                        <SettingsTab
                            game={game}
                            me={me}
                            onUpdate={async (per) => {
                                await Games.setPerms(game.id, per);
                                const full = await Games.get(game.id);
                                setActive(full);
                            }}
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
    </div>
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
    const [ch, setCh] = useState(() => normalizeCharacter(slotCharacter));
    const [saving, setSaving] = useState(false);
    const [showWizard, setShowWizard] = useState(false);

    useEffect(() => {
        setCh(normalizeCharacter(slotCharacter));
    }, [game.id, selectedPlayerId, slotCharacter]);

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
            return normalizeCharacter(next);
        });
    }, []);

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
        return WORLD_SKILLS.map((skill) => {
            const ranks = clampNonNegative(get(skills, `${skill.key}.ranks`));
            const miscRaw = Number(get(skills, `${skill.key}.misc`));
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            const abilityMod = getMod(skill.ability);
            const total = abilityMod + ranks + misc;
            return { ...skill, ranks, misc, abilityMod, total };
        });
    }, [ch?.skills, getMod]);

    const spentSP = skillRows.reduce((sum, row) => sum + row.ranks, 0);
    const availableSP =
        spRaw === undefined || spRaw === null || spRaw === ""
            ? suggestedSP
            : spValue;
    const maxSkillRank = Math.max(4, level * 2 + 2);
    const overSpent = spentSP > availableSP;
    const rankIssues = skillRows.filter((row) => row.ranks > maxSkillRank).map((row) => row.label);

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

    const handleWizardApply = useCallback(
        (payload) => {
            setCh(normalizeCharacter(payload || {}));
            setShowWizard(false);
        },
        []
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
                />
            )}
        </div>
    );
}

function PlayerSetupWizard({ open, onClose, onApply, baseCharacter, playerName }) {
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

    const initial = useMemo(
        () => buildInitialWizardState(baseCharacter, playerName),
        [baseCharacter, playerName]
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
        return WORLD_SKILLS.map((skill) => {
            const entry = skills?.[skill.key] || { ranks: 0, misc: 0 };
            const ranks = clampNonNegative(entry.ranks);
            const miscRaw = Number(entry.misc);
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            const abilityMod = abilityMods[skill.ability] ?? 0;
            const total = abilityMod + ranks + misc;
            return { ...skill, ranks, misc, abilityMod, total };
        });
    }, [abilityMods, skills]);

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
            baseCharacter
        );
        onApply?.(payload);
    }, [abilities, baseCharacter, canApply, concept, onApply, resources, skills]);

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

function buildInitialWizardState(character, playerName) {
    const normalized = normalizeCharacter(character);
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
        skills: normalizeSkills(normalized.skills),
    };
}

function buildCharacterFromWizard(state, base) {
    const normalized = normalizeCharacter(base);
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
    merged.skills = normalizeSkills(state.skills);
    return merged;
}

function normalizeCharacter(raw) {
    if (!raw || typeof raw !== "object") {
        return {
            name: "",
            profile: {},
            stats: {},
            resources: { useTP: false },
            skills: normalizeSkills({}),
        };
    }
    const clone = deepClone(raw);
    clone.name = typeof clone.name === "string" ? clone.name : "";
    clone.profile = clone.profile && typeof clone.profile === "object" ? { ...clone.profile } : {};
    clone.stats = clone.stats && typeof clone.stats === "object" ? { ...clone.stats } : {};
    clone.resources = clone.resources && typeof clone.resources === "object" ? { ...clone.resources } : {};
    if (clone.resources.useTP === undefined) {
        clone.resources.useTP = !!clone.resources.tp && !clone.resources.mp;
    } else {
        clone.resources.useTP = !!clone.resources.useTP;
    }
    clone.skills = normalizeSkills(clone.skills);
    return clone;
}

function normalizeSkills(raw) {
    const out = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw)) {
            if (!value || typeof value !== "object") continue;
            const ranks = clampNonNegative(value.ranks);
            const miscRaw = Number(value.misc);
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            out[key] = { ranks, misc };
        }
    }
    for (const skill of WORLD_SKILLS) {
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

// ---------- Story Logs ----------
function StoryLogsTab() {
    const serverId = DISCORD_SERVER_ID;
    const channelId = DISCORD_CHANNEL_ID;
    const widgetTheme = DISCORD_WIDGET_THEME;
    const widgetBase = DISCORD_WIDGET_BASE || "https://e.widgetbot.io/channels";

    const embedUrl = useMemo(() => {
        if (!serverId || !channelId) return "";
        const trimmedBase = widgetBase.replace(/\/+$/, "");
        const baseUrl = `${trimmedBase}/${encodeURIComponent(serverId)}/${encodeURIComponent(
            channelId
        )}`;
        const params = new URLSearchParams();
        if (widgetTheme) params.set("theme", widgetTheme);
        const query = params.toString();
        return query ? `${baseUrl}?${query}` : baseUrl;
    }, [channelId, serverId, widgetBase, widgetTheme]);

    const channelLink = useMemo(() => {
        if (!serverId || !channelId) return "";
        return `https://discord.com/channels/${encodeURIComponent(serverId)}/${encodeURIComponent(
            channelId
        )}`;
    }, [channelId, serverId]);

    const isConfigured = Boolean(embedUrl);

    return (
        <section className="card story-logs-card">
            <div className="header">
                <div>
                    <h3>Story logs</h3>
                    <p className="text-muted text-small">
                        Keep up with the Discord story log channel without leaving the command
                        center.
                    </p>
                </div>
                {isConfigured && channelLink && (
                    <a
                        className="btn ghost btn-small"
                        href={channelLink}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        Open in Discord
                    </a>
                )}
            </div>
            {isConfigured ? (
                <div className="story-logs__embed">
                    <iframe
                        title="Discord story logs"
                        src={embedUrl}
                        loading="lazy"
                        allowTransparency
                        allow="clipboard-read; clipboard-write"
                    />
                </div>
            ) : (
                <div className="story-logs__empty">
                    <p className="text-muted">
                        Provide <code>VITE_DISCORD_SERVER_ID</code> and <code>VITE_DISCORD_CHANNEL_ID</code>
                        {" "}
                        in your environment configuration to embed the Discord story logs.
                    </p>
                </div>
            )}
        </section>
    );
}

// ---------- Items ----------
function ItemsTab({ game, me, onUpdate }) {
    const [premade, setPremade] = useState([]);
    const [form, setForm] = useState({ name: "", type: "", desc: "" });
    const [editing, setEditing] = useState(null);
    const [busySave, setBusySave] = useState(false);
    const [busyRow, setBusyRow] = useState(null);
    const [selectedPlayerId, setSelectedPlayerId] = useState("");
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
    const customItems = Array.isArray(game.items?.custom) ? game.items.custom : [];
    const libraryItems = [...customItems, ...itemList];
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
                    <div className="list">
                        {customItems.map((it) => (
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
                    <div className="list" style={{ gap: 12 }}>
                        {visiblePlayers.map((p) => (
                            <PlayerInventoryCard
                                key={p.userId}
                                player={p}
                                canEdit={
                                    isDM ||
                                    (game.permissions?.canEditItems && me.id === p.userId)
                                }
                                gameId={game.id}
                                onUpdate={onUpdate}
                                libraryItems={libraryItems}
                            />
                        ))}
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

const PLAYER_GEAR_SLOTS = ["weapon", "armor", "accessory"];
const PLAYER_GEAR_LABELS = {
    weapon: "Weapon",
    armor: "Armor",
    accessory: "Accessory",
};

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

function PlayerGearCard({ player, canEdit, gameId, onUpdate, libraryGear }) {
    const slotOptions = useMemo(
        () => PLAYER_GEAR_SLOTS.map((value) => ({ value, label: PLAYER_GEAR_LABELS[value] || value })),
        []
    );

    const playerId = player?.userId || "";

    const gearState = useMemo(() => {
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
    }, [player?.gear, slotOptions]);

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
    const [bagForm, setBagForm] = useState({ name: "", type: "", desc: "" });
    const [bagEditing, setBagEditing] = useState(null);
    const [bagBusy, setBagBusy] = useState(false);
    const [bagRowBusy, setBagRowBusy] = useState(null);
    const [bagSearch, setBagSearch] = useState("");
    const [libraryPick, setLibraryPick] = useState("");
    const [quickAddBusy, setQuickAddBusy] = useState(false);

    useEffect(() => {
        setSlotDrafts((prev) => {
            const baseline = parseAssignmentKey(assignmentKey, slotOptions);
            const same = slotOptions.every(
                (opt) => (prev[opt.value] || "") === (baseline[opt.value] || "")
            );
            return same ? prev : baseline;
        });
    }, [assignmentKey, slotOptions, playerId]);

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

    const normalizedSearch = bagSearch.trim().toLowerCase();
    const filteredBag = useMemo(() => {
        if (!normalizedSearch) return bag;
        return bag.filter((item) => {
            const value = `${item.name} ${item.type} ${item.desc}`.toLowerCase();
            return value.includes(normalizedSearch);
        });
    }, [bag, normalizedSearch]);

    const playerLabel =
        player?.character?.name || `Player ${player?.userId?.slice?.(0, 6) || ""}`;
    const subtitleParts = [];
    if (player?.character?.profile?.class) {
        subtitleParts.push(player.character.profile.class);
    }
    if (player?.character?.resources?.level) {
        subtitleParts.push(`LV ${player.character.resources.level}`);
    }
    const subtitle = subtitleParts.join(" · ");
    const bagCount = bag.length;
    const equippedCount = slotOptions.reduce(
        (count, opt) => (slotAssignments[opt.value] ? count + 1 : count),
        0
    );
    const handleSelectSlot = useCallback((slot, value) => {
        setSlotDrafts((prev) => ({ ...prev, [slot]: value }));
    }, []);

    const applySlot = useCallback(
        async (slot) => {
            if (!canEdit || !playerId) return;
            const targetId = slotDrafts[slot] || "";
            const baseline = slotAssignments[slot] || "";
            if (targetId === baseline) return;
            try {
                setBusySlot(slot);
                setSlotDrafts((prev) => ({ ...prev, [slot]: targetId }));
                if (!targetId) {
                    await Games.clearPlayerGear(gameId, playerId, slot);
                } else {
                    await Games.setPlayerGear(gameId, playerId, slot, { itemId: targetId });
                }
                await onUpdate();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusySlot(null);
            }
        },
        [canEdit, gameId, onUpdate, playerId, slotAssignments, slotDrafts]
    );

    const clearSlot = useCallback(
        async (slot) => {
            if (!canEdit || !playerId) return;
            if (!slotAssignments[slot]) {
                setSlotDrafts((prev) => ({ ...prev, [slot]: "" }));
                return;
            }
            try {
                setBusySlot(slot);
                setSlotDrafts((prev) => ({ ...prev, [slot]: "" }));
                await Games.clearPlayerGear(gameId, playerId, slot);
                await onUpdate();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusySlot(null);
            }
        },
        [canEdit, gameId, onUpdate, playerId, slotAssignments]
    );

    const inferSlot = useCallback(
        (type) => {
            const lower = (type || "").toLowerCase();
            if (lower.startsWith("weapon")) return "weapon";
            if (lower.startsWith("armor")) return "armor";
            if (lower.startsWith("accessory")) return "accessory";
            return slotOptions[0]?.value || null;
        },
        [slotOptions]
    );

    const quickEquip = useCallback(
        async (item) => {
            if (!canEdit || !playerId) return;
            if (!item || typeof item.id !== "string") return;
            const slot = inferSlot(item.type) || slotOptions[0]?.value;
            if (!slot) return;
            try {
                setBusySlot(slot);
                setSlotDrafts((prev) => ({ ...prev, [slot]: item.id }));
                await Games.setPlayerGear(gameId, playerId, slot, { itemId: item.id });
                await onUpdate();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusySlot(null);
            }
        },
        [canEdit, gameId, inferSlot, onUpdate, playerId, slotOptions]
    );

    const startBagEdit = useCallback((item) => {
        if (!item || typeof item.id !== "string") return;
        setBagEditing(item.id);
        setBagForm({
            name: item.name || "",
            type: item.type || "",
            desc: item.desc || "",
        });
    }, []);

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
            if (!confirm("Remove this gear from the bag? Equipped slots will be cleared.")) return;
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

    const bagFormDirty = bagEditing
        ? bagForm.name !== (editingEntry?.name || "") ||
          bagForm.type !== (editingEntry?.type || "") ||
          bagForm.desc !== (editingEntry?.desc || "")
        : !!(bagForm.name.trim() || bagForm.type.trim() || bagForm.desc.trim());
    const canSubmitBag = canEdit && !bagBusy && bagForm.name.trim();

    return (
        <div className="card" style={{ padding: 12 }}>
            <div
                className="row"
                style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}
            >
                <div>
                    <div>
                        <b>{playerLabel || "Unnamed Player"}</b>
                    </div>
                    {subtitle && <div style={{ opacity: 0.75, fontSize: 12 }}>{subtitle}</div>}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <span className="pill">Equipped {equippedCount}/{slotOptions.length}</span>
                    <span className="pill light">Bag {bagCount}</span>
                </div>
            </div>

            <div className="stack" style={{ marginTop: 12, gap: 16 }}>
                <section className="col" style={{ gap: 12 }}>
                    <h4>Equipped gear</h4>
                    <div className="list" style={{ gap: 12 }}>
                        {slotOptions.map((opt) => {
                            const currentId = slotAssignments[opt.value] || "";
                            const draftId = slotDrafts[opt.value] ?? "";
                            const currentItem = currentId ? bagMap.get(currentId) : null;
                            const hasDirty = (draftId || "") !== (currentId || "");
                            return (
                                <div
                                    key={opt.value}
                                    className="row"
                                    style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}
                                >
                                    <div style={{ flex: 1, minWidth: 220 }}>
                                        <div style={{ fontWeight: 600 }}>{opt.label}</div>
                                        {currentItem ? (
                                            <>
                                                <div
                                                    className="row"
                                                    style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}
                                                >
                                                    <b>{currentItem.name}</b>
                                                    {currentItem.type && <span className="pill">{currentItem.type}</span>}
                                                </div>
                                                {currentItem.desc && (
                                                    <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                                                        {currentItem.desc}
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>Empty slot.</div>
                                        )}
                                    </div>
                                    <div className="col" style={{ gap: 6, minWidth: 220 }}>
                                        <select
                                            value={draftId}
                                            onChange={(e) => handleSelectSlot(opt.value, e.target.value)}
                                            disabled={!canEdit || bag.length === 0 || busySlot === opt.value}
                                            style={{ minWidth: 180 }}
                                        >
                                            <option value="">Unequipped</option>
                                            {bag.map((item) => (
                                                <option key={item.id} value={item.id}>
                                                    {item.name || "Unnamed"}
                                                    {item.type ? ` · ${item.type}` : ""}
                                                </option>
                                            ))}
                                        </select>
                                        <div className="row" style={{ gap: 6 }}>
                                            <button
                                                className="btn btn-small"
                                                onClick={() => applySlot(opt.value)}
                                                disabled={!canEdit || busySlot === opt.value || !hasDirty}
                                            >
                                                {busySlot === opt.value ? "…" : "Apply"}
                                            </button>
                                            {currentId && (
                                                <button
                                                    className="btn ghost btn-small"
                                                    onClick={() => clearSlot(opt.value)}
                                                    disabled={!canEdit || busySlot === opt.value}
                                                >
                                                    {busySlot === opt.value ? "…" : "Clear"}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {slotOptions.length === 0 && (
                            <div style={{ opacity: 0.7 }}>No gear slots configured for this character.</div>
                        )}
                    </div>
                </section>

                <section className="col" style={{ gap: 12 }}>
                    <h4>Gear bag</h4>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <select
                            value={libraryPick}
                            onChange={(e) => setLibraryPick(e.target.value)}
                            disabled={!canEdit || libraryOptions.length === 0 || quickAddBusy}
                            style={{ minWidth: 220 }}
                        >
                            <option value="">Add from library…</option>
                            {libraryOptions.map((opt) => (
                                <option key={opt.key} value={opt.key}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                        <button
                            className="btn btn-small"
                            onClick={addFromLibrary}
                            disabled={!canEdit || !libraryPick || quickAddBusy}
                        >
                            {quickAddBusy ? "…" : "Add to bag"}
                        </button>
                    </div>

                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <input
                            placeholder={bagEditing ? "Edit gear name" : "Custom gear name"}
                            value={bagForm.name}
                            onChange={(e) => setBagForm((prev) => ({ ...prev, name: e.target.value }))}
                            disabled={!canEdit || bagBusy}
                            style={{ flex: 2, minWidth: 180 }}
                        />
                        <input
                            placeholder="Type"
                            value={bagForm.type}
                            onChange={(e) => setBagForm((prev) => ({ ...prev, type: e.target.value }))}
                            disabled={!canEdit || bagBusy}
                            style={{ flex: 1, minWidth: 140 }}
                        />
                        <textarea
                            rows={2}
                            placeholder="Notes"
                            value={bagForm.desc}
                            onChange={(e) => setBagForm((prev) => ({ ...prev, desc: e.target.value }))}
                            disabled={!canEdit || bagBusy}
                            style={{ flex: 2, minWidth: 220 }}
                        />
                        <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
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

                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <input
                            placeholder="Search bag"
                            value={bagSearch}
                            onChange={(e) => setBagSearch(e.target.value)}
                            style={{ flex: 1, minWidth: 200 }}
                        />
                        {bagSearch && (
                            <button
                                className="btn ghost btn-small"
                                onClick={() => setBagSearch("")}
                                disabled={bagBusy}
                            >
                                Clear search
                            </button>
                        )}
                    </div>

                    <div className="list" style={{ gap: 12 }}>
                        {filteredBag.map((item) => {
                            const equippedSlot = slotOptions.find((opt) => slotAssignments[opt.value] === item.id);
                            const isRowBusy = bagRowBusy === item.id;
                            return (
                                <div
                                    key={item.id}
                                    className="row"
                                    style={{
                                        alignItems: "flex-start",
                                        justifyContent: "space-between",
                                        gap: 12,
                                        flexWrap: "wrap",
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 220 }}>
                                        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                            <b>{item.name || "Unnamed gear"}</b>
                                            {item.type && <span className="pill">{item.type}</span>}
                                            {equippedSlot && (
                                                <span className="pill success">Equipped · {equippedSlot.label}</span>
                                            )}
                                        </div>
                                        {item.desc && (
                                            <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>{item.desc}</div>
                                        )}
                                    </div>
                                    {canEdit && (
                                        <div className="col" style={{ gap: 6, minWidth: 200 }}>
                                            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                                <button
                                                    className="btn btn-small"
                                                    onClick={() => quickEquip(item)}
                                                    disabled={busySlot !== null || isRowBusy}
                                                >
                                                    Equip now
                                                </button>
                                                <button
                                                    className="btn ghost btn-small"
                                                    onClick={() => startBagEdit(item)}
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
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {filteredBag.length === 0 && (
                            <div style={{ opacity: 0.7 }}>
                                {bag.length === 0
                                    ? "No gear in the bag yet. Add items from the library or create custom gear."
                                    : "No gear matches your search."}
                            </div>
                        )}
                    </div>
                </section>
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
    const libraryGear = [...customGear, ...gearList];
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
                                libraryGear={libraryGear}
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
    const [stats, setStats] = useState({ strength: 0, magic: 0, endurance: 0, agility: 0, luck: 0 });
    const [resist, setResist] = useState({ weak: "", resist: "", null: "", absorb: "", reflect: "" });
    const [skills, setSkills] = useState("");
    const [notes, setNotes] = useState("");
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
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
        setStats({ strength: 0, magic: 0, endurance: 0, agility: 0, luck: 0 });
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
            setStats({
                strength: p.strength ?? 0,
                magic: p.magic ?? 0,
                endurance: p.endurance ?? 0,
                agility: p.agility ?? 0,
                luck: p.luck ?? 0,
            });
            setResist({
                weak: (p.weak || []).join(', '),
                resist: (p.resists || []).join(', '),
                null: (p.nullifies || []).join(', '),
                absorb: (p.absorbs || []).join(', '),
                reflect: (p.reflects || []).join(', '),
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
        setStats({
            strength: demon.stats?.strength ?? 0,
            magic: demon.stats?.magic ?? 0,
            endurance: demon.stats?.endurance ?? 0,
            agility: demon.stats?.agility ?? 0,
            luck: demon.stats?.luck ?? 0,
        });
        setResist({
            weak: (demon.resistances?.weak || []).join(', '),
            resist: (demon.resistances?.resist || []).join(', '),
            null: (demon.resistances?.null || []).join(', '),
            absorb: (demon.resistances?.absorb || []).join(', '),
            reflect: (demon.resistances?.reflect || []).join(', '),
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
                {[
                    ["strength", "STR"],
                    ["magic", "MAG"],
                    ["endurance", "END"],
                    ["agility", "AGI"],
                    ["luck", "LUC"],
                ].map(([key, label]) => (
                    <label key={key} className="col" style={{ minWidth: 90 }}>
                        <span>{label}</span>
                        <input
                            type="number"
                            value={stats[key] ?? 0}
                            onChange={(e) => setStats((prev) => ({ ...prev, [key]: Number(e.target.value || 0) }))}
                        />
                    </label>
                ))}
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
                                    gridTemplateColumns: "repeat(5, 1fr)",
                                    gap: 6,
                                    marginTop: 8,
                                }}
                            >
                                <span className="pill">STR {selected.strength}</span>
                                <span className="pill">MAG {selected.magic}</span>
                                <span className="pill">END {selected.endurance}</span>
                                <span className="pill">AGI {selected.agility}</span>
                                <span className="pill">LUC {selected.luck}</span>
                            </div>
                            <div style={{ marginTop: 8, fontSize: 12 }}>
                                <div><b>Weak:</b> {selected.weak?.join(', ') || '—'}</div>
                                <div><b>Resist:</b> {selected.resists?.join(', ') || '—'}</div>
                                <div><b>Null:</b> {selected.nullifies?.join(', ') || '—'}</div>
                                <div><b>Absorb:</b> {selected.absorbs?.join(', ') || '—'}</div>
                                <div><b>Reflect:</b> {selected.reflects?.join(', ') || '—'}</div>
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
                            <span className="pill">STR {d.stats?.strength ?? 0}</span>
                            <span className="pill">MAG {d.stats?.magic ?? 0}</span>
                            <span className="pill">END {d.stats?.endurance ?? 0}</span>
                            <span className="pill">AGI {d.stats?.agility ?? 0}</span>
                            <span className="pill">LUC {d.stats?.luck ?? 0}</span>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12 }}>
                            <div><b>Weak:</b> {(d.resistances?.weak || []).join(', ') || '—'}</div>
                            <div><b>Resist:</b> {(d.resistances?.resist || []).join(', ') || '—'}</div>
                            <div><b>Null:</b> {(d.resistances?.null || []).join(', ') || '—'}</div>
                            <div><b>Absorb:</b> {(d.resistances?.absorb || []).join(', ') || '—'}</div>
                            <div><b>Reflect:</b> {(d.resistances?.reflect || []).join(', ') || '—'}</div>
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

function SettingsTab({ game, onUpdate, me, onDelete, onKickPlayer }) {
    const [perms, setPerms] = useState(() => ({
        ...PERMISSION_DEFAULTS,
        ...(game.permissions || {}),
    }));
    const [saving, setSaving] = useState(false);
    const [removingId, setRemovingId] = useState(null);

    useEffect(() => {
        setPerms({
            ...PERMISSION_DEFAULTS,
            ...(game.permissions || {}),
        });
        setRemovingId(null);
    }, [game.id, game.permissions]);

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
