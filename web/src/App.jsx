// --- FILE: web/src/App.jsx ---
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Auth, Games, Items, Personas } from "./api";

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
                        setTab("party");
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
                    setTab(full.dmId === me.id ? "party" : "sheet");
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

    const isDM = active.dmId === me.id;

    return (
        <div style={{ padding: 20, display: "grid", gap: 16 }}>
            <header className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <h2>{active.name}</h2>
                <div className="row" style={{ gap: 8 }}>
                    <InviteButton gameId={active.id} />
                    <button
                        className="btn"
                        onClick={() => {
                            setActive(null);
                            setDmSheetPlayerId(null);
                        }}
                    >
                        Back
                    </button>
                </div>
            </header>

            {(() => {
                const tabs = isDM
                    ? ["party", "sheet", "items", "gear", "demons", "settings"]
                    : ["sheet", "party", "items", "gear", "demons", "settings"];
                return (
                    <div className="tabs">
                        {tabs.map((k) => (
                            <div
                                key={k}
                                className={"tab" + (tab === k ? " active" : "")}
                                onClick={() => setTab(k)}
                            >
                                {k.toUpperCase()}
                            </div>
                        ))}
                    </div>
                );
            })()}

            {tab === "sheet" && (
                <Sheet
                    me={me}
                    game={active}
                    targetUserId={active.dmId === me.id ? dmSheetPlayerId : undefined}
                    onChangePlayer={active.dmId === me.id ? setDmSheetPlayerId : undefined}
                    onSave={async (ch) => {
                        await Games.saveCharacter(active.id, ch);
                        const full = await Games.get(active.id);
                        setActive(full);
                    }}
                />
            )}

            {tab === "party" && (
                <Party
                    game={active}
                    selectedPlayerId={isDM ? dmSheetPlayerId : null}
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
                    game={active}
                    me={me}
                    onUpdate={async () => {
                        const full = await Games.get(active.id);
                        setActive(full);
                    }}
                />
            )}

            {tab === "gear" && (
                <GearTab
                    game={active}
                    me={me}
                    onUpdate={async () => {
                        const full = await Games.get(active.id);
                        setActive(full);
                    }}
                />
            )}

            {tab === "demons" && (
                <DemonTab
                    game={active}
                    me={me}
                    onUpdate={async () => {
                        const full = await Games.get(active.id);
                        setActive(full);
                    }}
                />
            )}

            {tab === "settings" && (
                <SettingsTab
                    game={active}
                    me={me}
                    onUpdate={async (per) => {
                        await Games.setPerms(active.id, per);
                        const full = await Games.get(active.id);
                        setActive(full);
                    }}
                    onDelete={
                        isDM
                            ? async () => {
                                  if (
                                      !confirm(
                                          `Delete the game "${active.name}"? This cannot be undone.`
                                      )
                                  ) {
                                      return;
                                  }
                                  try {
                                      await Games.delete(active.id);
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
            (selectedPlayerId
                ? (game.players || []).find((p) => p.userId === selectedPlayerId)
                : null) || {},
        [game.players, selectedPlayerId]
    );
    const slotCharacter = slot?.character;
    const [ch, setCh] = useState(slotCharacter || {});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setCh(slotCharacter || {});
    }, [game.id, selectedPlayerId, slotCharacter]);

    const set = useCallback((path, value) => {
        setCh((prev) => {
            const next = deepClone(prev || {});
            let o = next;
            const seg = path.split(".");
            for (let i = 0; i < seg.length - 1; i++) {
                o[seg[i]] = o[seg[i]] ?? {};
                o = o[seg[i]];
            }
            o[seg.at(-1)] = value;
            return next;
        });
    }, []);

    const field = (label, path, type = "text") => {
        return (
            <div className="col">
                <label>{label}</label>
                <input
                    type={type}
                    value={get(ch, path) ?? ""}
                    onChange={(e) =>
                        set(path, type === "number" ? Number(e.target.value || 0) : e.target.value)
                    }
                />
            </div>
        );
    };

    const hasSelection = !isDM || (!!selectedPlayerId && slot && slot.userId);
    const noPlayers = isDM && selectablePlayers.length === 0;
    const isEditingOther = isDM && selectedPlayerId && selectedPlayerId !== me.id;
    const disableSave =
        saving || (!isDM && !game.permissions?.canEditStats) || (isDM && !hasSelection);

    return (
        <div className="card">
            <h3>Character Sheet</h3>

            {isDM && (
                <div className="col" style={{ gap: 8, marginBottom: 12 }}>
                    <label>Player</label>
                    <select
                        value={selectedPlayerId ?? ""}
                        onChange={(e) => onChangePlayer?.(e.target.value || null)}
                        disabled={selectablePlayers.length === 0}
                    >
                        <option value="">Select a player…</option>
                        {selectablePlayers.map((p) => (
                            <option key={p.userId} value={p.userId}>
                                {p.character?.name || "Unnamed Player"}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {noPlayers && (
                <p style={{ color: "var(--muted)", marginTop: 0 }}>
                    Invite players to your campaign to view their character sheets.
                </p>
            )}

            {!hasSelection ? (
                !noPlayers && (
                    <p style={{ color: "var(--muted)", marginTop: 0 }}>
                        Select a player to review and edit their sheet.
                    </p>
                )
            ) : (
                <>
                    <div className="row">
                        {field("Name", "name")}
                        {field("Class", "profile.class")}
                        {field("Level", "resources.level", "number")}
                        {field("EXP", "resources.exp", "number")}
                    </div>

                    <div className="row">
                        {field("HP", "resources.hp", "number")}
                        {field("Max HP", "resources.maxHP", "number")}
                        <div className="col">
                            <label>Resource</label>
                            <select
                                value={get(ch, "resources.useTP") ? "TP" : "MP"}
                                onChange={(e) => set("resources.useTP", e.target.value === "TP")}
                            >
                                <option>MP</option>
                                <option>TP</option>
                            </select>
                        </div>
                        {get(ch, "resources.useTP")
                            ? field("TP", "resources.tp", "number")
                            : (
                                <>
                                    {field("MP", "resources.mp", "number")}
                                    {field("Max MP", "resources.maxMP", "number")}
                                </>
                            )
                        }
                    </div>

                    <div className="row">
                        {["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((s) => (
                            <div key={s} className="col">
                                <label>{s}</label>
                                <input
                                    type="number"
                                    value={get(ch, `stats.${s}`) || 0}
                                    onChange={(e) => set(`stats.${s}`, Number(e.target.value || 0))}
                                />
                            </div>
                        ))}
                    </div>

                    <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button
                            className="btn"
                            disabled={disableSave}
                            onClick={async () => {
                                if (!hasSelection) return;
                                try {
                                    setSaving(true);
                                    const payload = isEditingOther
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
                            {saving ? "Saving…" : "Save"}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

// ---------- Party ----------
function Party({ game, selectedPlayerId, onSelectPlayer }) {
    return (
        <div className="card">
            <h3>Party</h3>
            <div className="list">
                {game.players.map((p) => {
                    const lvl = p.character?.resources?.level ?? 1;
                    const hp = p.character?.resources?.hp ?? 0;
                    const maxHP = p.character?.resources?.maxHP ?? 0;
                    const role = (p.role || "").toLowerCase();
                    const isDMEntry = role === "dm";
                    const isSelected = selectedPlayerId && p.userId === selectedPlayerId;
                    const clickable = typeof onSelectPlayer === "function" && !isDMEntry;
                    return (
                        <div
                            key={p.userId}
                            className="row"
                            style={{
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "8px",
                                borderRadius: "var(--radius-sm)",
                                border: isSelected ? `1px solid var(--border)` : "1px solid transparent",
                                background: isSelected ? "var(--surface-2)" : undefined,
                                cursor: clickable ? "pointer" : "default",
                                transition: "background var(--trans-fast), border var(--trans-fast)",
                            }}
                            onClick={() => {
                                if (!clickable) return;
                                onSelectPlayer(p);
                            }}
                        >
                            <div>
                                <b>{p.role?.toUpperCase()}</b> · {p.character?.name ?? "—"}
                            </div>
                            <div className="row" style={{ gap: 8 }}>
                                <span className="pill">LV {lvl}</span>
                                <span className="pill">HP {hp}/{maxHP}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
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

function PlayerGearCard({ player, canEdit, gameId, onUpdate, libraryGear }) {
    const slotOptions = useMemo(
        () => PLAYER_GEAR_SLOTS.map((value) => ({ value, label: PLAYER_GEAR_LABELS[value] || value })),
        []
    );
    const defaultSlot = slotOptions[0]?.value || "weapon";
    const [form, setForm] = useState(() => ({ slot: defaultSlot, name: "", type: "", desc: "" }));
    const [busySave, setBusySave] = useState(false);
    const [busySlot, setBusySlot] = useState(null);
    const [picker, setPicker] = useState("");

    const slotSet = useMemo(() => new Set(slotOptions.map((opt) => opt.value)), [slotOptions]);

    const normalizeSlot = useCallback(
        (slot) => {
            const value = String(slot || "").toLowerCase();
            return slotSet.has(value) ? value : defaultSlot;
        },
        [slotSet, defaultSlot]
    );

    const gearMap = useMemo(() => {
        const source = player?.gear && typeof player.gear === "object" ? player.gear : {};
        const map = {};
        for (const opt of slotOptions) {
            const entry = source?.[opt.value];
            map[opt.value] = entry && typeof entry === "object" ? entry : null;
        }
        return map;
    }, [player.gear, slotOptions]);

    const playerId = player?.userId || "";
    const prevPlayer = useRef(playerId);

    useEffect(() => {
        if (prevPlayer.current !== playerId) {
            prevPlayer.current = playerId;
            const entry = gearMap[defaultSlot];
            setForm({
                slot: defaultSlot,
                name: entry?.name || "",
                type: entry?.type || "",
                desc: entry?.desc || "",
            });
            setPicker((prev) => (prev ? "" : prev));
            return;
        }
        setForm((prev) => {
            const slot = normalizeSlot(prev.slot);
            const entry = gearMap[slot];
            const next = {
                slot,
                name: entry?.name || "",
                type: entry?.type || "",
                desc: entry?.desc || "",
            };
            if (
                next.slot === prev.slot &&
                next.name === prev.name &&
                next.type === prev.type &&
                next.desc === prev.desc
            ) {
                return prev;
            }
            return next;
        });
        setPicker((prev) => (prev ? "" : prev));
    }, [defaultSlot, gearMap, normalizeSlot, playerId]);

    const available = Array.isArray(libraryGear) ? libraryGear : [];

    const inferSlot = useCallback((type) => {
        const lower = (type || "").toLowerCase();
        if (lower.startsWith("weapon")) return "weapon";
        if (lower.startsWith("armor")) return "armor";
        if (lower.startsWith("accessory")) return "accessory";
        return null;
    }, []);

    const startEdit = useCallback(
        (slot) => {
            const next = normalizeSlot(slot);
            const entry = gearMap[next];
            setForm({
                slot: next,
                name: entry?.name || "",
                type: entry?.type || "",
                desc: entry?.desc || "",
            });
            setPicker("");
        },
        [gearMap, normalizeSlot]
    );

    const resetForm = useCallback(() => {
        startEdit(form.slot);
    }, [form.slot, startEdit]);

    const save = useCallback(async () => {
        if (!canEdit) return;
        const slot = normalizeSlot(form.slot);
        const name = form.name.trim();
        if (!name) return alert("Gear needs a name");
        const payload = {
            name,
            type: form.type.trim(),
            desc: form.desc.trim(),
        };
        try {
            setBusySave(true);
            await Games.setPlayerGear(gameId, player.userId, slot, payload);
            await onUpdate();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusySave(false);
        }
    }, [canEdit, form.name, form.type, form.desc, form.slot, normalizeSlot, gameId, player.userId, onUpdate]);

    const remove = useCallback(
        async (slot) => {
            if (!canEdit) return;
            const normalized = normalizeSlot(slot);
            if (!gearMap[normalized]) return;
            if (!confirm("Remove this gear from the slot?")) return;
            try {
                setBusySlot(normalized);
                await Games.clearPlayerGear(gameId, player.userId, normalized);
                await onUpdate();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusySlot(null);
            }
        },
        [canEdit, gearMap, normalizeSlot, gameId, player.userId, onUpdate]
    );

    const playerLabel = player.character?.name || `Player ${player.userId?.slice?.(0, 6) || ""}`;
    const subtitleParts = [];
    if (player.character?.profile?.class) subtitleParts.push(player.character.profile.class);
    if (player.character?.resources?.level) subtitleParts.push(`LV ${player.character.resources.level}`);
    const subtitle = subtitleParts.join(" · ");

    const activeSlot = normalizeSlot(form.slot);
    const currentEntry = gearMap[activeSlot];
    const equippedCount = slotOptions.reduce(
        (count, opt) => (gearMap[opt.value] ? count + 1 : count),
        0
    );
    const hasChanges = currentEntry
        ? form.name !== (currentEntry.name || "") ||
          form.type !== (currentEntry.type || "") ||
          form.desc !== (currentEntry.desc || "")
        : !!(form.name || form.type || form.desc);

    return (
        <div className="card" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <div>
                    <div><b>{playerLabel || "Unnamed Player"}</b></div>
                    {subtitle && <div style={{ opacity: 0.75, fontSize: 12 }}>{subtitle}</div>}
                </div>
                <span className="pill">Equipped: {equippedCount}/{slotOptions.length}</span>
            </div>

            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <select
                    value={activeSlot}
                    onChange={(e) => startEdit(e.target.value)}
                    disabled={!canEdit}
                    style={{ minWidth: 140 }}
                >
                    {slotOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
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
                            const guessed = normalizeSlot(inferSlot(chosen.type) || activeSlot);
                            setForm({
                                slot: guessed,
                                name: chosen.name || "",
                                type: chosen.type || "",
                                desc: chosen.desc || "",
                            });
                        }
                        setPicker("");
                    }}
                    disabled={!canEdit || available.length === 0}
                    style={{ minWidth: 180 }}
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

            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <input
                    placeholder="Gear name"
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
                    style={{ flex: 1, minWidth: 160 }}
                />
                <input
                    placeholder="Description"
                    value={form.desc}
                    onChange={(e) => setForm((prev) => ({ ...prev, desc: e.target.value }))}
                    disabled={!canEdit}
                    style={{ flex: 3, minWidth: 220 }}
                />
                <div className="row" style={{ gap: 8 }}>
                    <button className="btn" onClick={save} disabled={!canEdit || busySave || !form.name.trim()}>
                        {busySave ? "…" : currentEntry ? "Update" : "Assign"}
                    </button>
                    {hasChanges && (
                        <button className="btn" onClick={resetForm} disabled={busySave}>
                            Cancel
                        </button>
                    )}
                </div>
            </div>

            <div className="list" style={{ marginTop: 12 }}>
                {slotOptions.map((opt) => {
                    const entry = gearMap[opt.value];
                    return (
                        <div key={opt.value} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600 }}>{opt.label}</div>
                                {entry ? (
                                    <>
                                        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
                                            <b>{entry.name}</b>
                                            {entry.type && <span className="pill">{entry.type}</span>}
                                        </div>
                                        {entry.desc && (
                                            <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>{entry.desc}</div>
                                        )}
                                    </>
                                ) : (
                                    <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>Empty slot.</div>
                                )}
                            </div>
                            {canEdit && (
                                <div className="row" style={{ gap: 6 }}>
                                    <button className="btn" onClick={() => startEdit(opt.value)} disabled={busySave}>
                                        {entry ? "Edit" : "Assign"}
                                    </button>
                                    {entry && (
                                        <button
                                            className="btn"
                                            onClick={() => remove(opt.value)}
                                            disabled={busySlot === opt.value}
                                        >
                                            {busySlot === opt.value ? "…" : "Remove"}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
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
        if (!canEdit) return;
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
    }, [q]);

    const pick = async (slug) => {
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
                    <button className="btn" onClick={save} disabled={!canEdit || busySave}>
                        {busySave ? "…" : editing ? "Save Demon" : "Add Demon"}
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
                                    <button
                                        className="btn"
                                        onClick={() => remove(d.id)}
                                        disabled={busyDelete === d.id}
                                    >
                                        {busyDelete === d.id ? "…" : "Remove"}
                                    </button>
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
function SettingsTab({ game, onUpdate, me, onDelete }) {
    const [perms, setPerms] = useState(game.permissions || {});
    const [saving, setSaving] = useState(false);

    useEffect(() => setPerms(game.permissions || {}), [game.id, game.permissions]);

    const isDM = game.dmId === me?.id;
    const canDelete = isDM && typeof onDelete === "function";

    return (
        <div className="card">
            <h3>Permissions</h3>
            {Object.entries(perms).map(([k, v]) => (
                <label key={k} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                        type="checkbox"
                        checked={!!v}
                        onChange={(e) => setPerms((p) => ({ ...p, [k]: e.target.checked }))}
                    />
                    {k}
                </label>
            ))}
            <div className="row" style={{ justifyContent: "flex-end" }}>
                <button
                    className="btn"
                    disabled={saving}
                    onClick={async () => {
                        try {
                            setSaving(true);
                            await onUpdate(perms);
                        } catch (e) {
                            alert(e.message);
                        } finally {
                            setSaving(false);
                        }
                    }}
                >
                    {saving ? "Saving…" : "Save"}
                </button>
            </div>

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
