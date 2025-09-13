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
                    setTab(full.dmId === me.id ? "party" : "sheet");
                }}
                onCreate={async (name) => {
                    await Games.create(name);
                    setGames(await Games.list());
                }}
            />
        );
    }

    return (
        <div style={{ padding: 20, display: "grid", gap: 16 }}>
            <header className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <h2>{active.name}</h2>
                <div className="row" style={{ gap: 8 }}>
                    <InviteButton gameId={active.id} />
                    <button className="btn" onClick={() => setActive(null)}>Back</button>
                </div>
            </header>

            {(() => {
                const isDM = active.dmId === me.id;
                const tabs = isDM
                    ? ["party", "items", "gear", "demons", "settings"]
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
                    onSave={async (ch) => {
                        await Games.saveCharacter(active.id, ch);
                        const full = await Games.get(active.id);
                        setActive(full);
                    }}
                />
            )}

            {tab === "party" && <Party game={active} />}

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
                    onUpdate={async (per) => {
                        await Games.setPerms(active.id, per);
                        const full = await Games.get(active.id);
                        setActive(full);
                    }}
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
    return (
        <button
            className="btn"
            disabled={busy}
            onClick={async () => {
                try {
                    setBusy(true);
                    const code = await Games.invite(gameId);
                    alert(`Invite code: ${code.code}\nURL: ${location.origin}${code.joinUrl}`);
                } catch (e) {
                    alert(e.message);
                } finally {
                    setBusy(false);
                }
            }}
        >
            {busy ? "…" : "Invite"}
        </button>
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
function Home({ me, games, onOpen, onCreate }) {
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
                    {games.map((g) => (
                        <div key={g.id} className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                                <b>{g.name}</b>{" "}
                                <span className="pill">{(g.players?.length ?? 0)} members</span>
                            </div>
                            <button className="btn" onClick={() => onOpen(g)}>Open</button>
                        </div>
                    ))}
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
function Sheet({ me, game, onSave }) {
    const slot = useMemo(
        () => game.players.find((p) => p.userId === me.id) || {},
        [game.players, me.id]
    );
    const isDM = game.dmId === me.id;
    const [ch, setCh] = useState(slot.character || {});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setCh(slot.character || {});
    }, [game.id, slot.character]);

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

    return (
        <div className="card">
            <h3>Character Sheet</h3>

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
                    disabled={saving || (!isDM && !game.permissions?.canEditStats)}
                    onClick={async () => {
                        try {
                            setSaving(true);
                            await onSave(ch);
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
        </div>
    );
}

// ---------- Party ----------
function Party({ game }) {
    return (
        <div className="card">
            <h3>Party</h3>
            <div className="list">
                {game.players.map((p) => {
                    const lvl = p.character?.resources?.level ?? 1;
                    const hp = p.character?.resources?.hp ?? 0;
                    const maxHP = p.character?.resources?.maxHP ?? 0;
                    return (
                        <div key={p.userId} className="row" style={{ justifyContent: "space-between" }}>
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
    const [busyAdd, setBusyAdd] = useState(false);
    const gearTypes = ["weapon", "armor", "accessory"]; // types reserved for gear

    const isDM = game.dmId === me.id;
    const canEdit = isDM || game.permissions?.canEditItems;

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

    const add = async (item) => {
        if (!item?.name) return alert("Item needs a name");
        try {
            setBusyAdd(true);
            await Games.addCustomItem(game.id, item);
            await onUpdate();
            setForm({ name: "", type: "", desc: "" });
        } catch (e) {
            alert(e.message);
        } finally {
            setBusyAdd(false);
        }
    };

    const itemList = premade.filter(
        (it) => !gearTypes.some((t) => it.type?.toLowerCase().startsWith(t))
    );

    return (
        <div className="row" style={{ gap: 16 }}>
            <div className="card" style={{ flex: 1 }}>
                <h3>Custom Item</h3>
                <div className="row" style={{ gap: 8 }}>
                    <input
                        placeholder="Name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                    <input
                        placeholder="Type"
                        value={form.type}
                        onChange={(e) => setForm({ ...form, type: e.target.value })}
                    />
                    <input
                        placeholder="Description"
                        value={form.desc}
                        onChange={(e) => setForm({ ...form, desc: e.target.value })}
                    />
                    <button
                        className="btn"
                        disabled={!form.name || busyAdd || !canEdit}
                        onClick={() => add(form)}
                    >
                        {busyAdd ? "…" : "Add"}
                    </button>
                </div>

                <h4 style={{ marginTop: 16 }}>Game Custom Items</h4>
                <div className="list">
                    {(game.items?.custom ?? []).map((it) => (
                        <div key={it.id} className="row" style={{ justifyContent: "space-between" }}>
                            <div>
                                <b>{it.name}</b> — {it.type}
                                <div style={{ opacity: 0.85, fontSize: 12 }}>{it.desc}</div>
                            </div>
                        </div>
                    ))}
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
                                disabled={!canEdit}
                                onClick={() => add({ name: it.name, type: it.type, desc: it.desc })}
                            >
                                Add
                            </button>
                        </div>
                    ))}
                    {itemList.length === 0 && <div style={{ opacity: 0.7 }}>No premade items.</div>}
                </div>
            </div>
        </div>
    );
}

// ---------- Gear ----------
function GearTab({ game, me, onUpdate }) {
    const [premade, setPremade] = useState([]);
    const [form, setForm] = useState({ name: "", type: "", desc: "" });
    const [busyAdd, setBusyAdd] = useState(false);
    const gearTypes = ["weapon", "armor", "accessory"];

    const isDM = game.dmId === me.id;
    const canEdit = isDM || game.permissions?.canEditGear;

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

    const add = async (item) => {
        if (!item?.name) return alert("Item needs a name");
        try {
            setBusyAdd(true);
            await Games.addCustomGear(game.id, item);
            await onUpdate();
            setForm({ name: "", type: "", desc: "" });
        } catch (e) {
            alert(e.message);
        } finally {
            setBusyAdd(false);
        }
    };

    const gearList = premade.filter((it) =>
        gearTypes.some((t) => it.type?.toLowerCase().startsWith(t))
    );

    return (
        <div className="row" style={{ gap: 16 }}>
            <div className="card" style={{ flex: 1 }}>
                <h3>Custom Gear</h3>
                <div className="row" style={{ gap: 8 }}>
                    <input
                        placeholder="Name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                    <input
                        placeholder="Type"
                        value={form.type}
                        onChange={(e) => setForm({ ...form, type: e.target.value })}
                    />
                    <input
                        placeholder="Description"
                        value={form.desc}
                        onChange={(e) => setForm({ ...form, desc: e.target.value })}
                    />
                    <button
                        className="btn"
                        disabled={!form.name || busyAdd || !canEdit}
                        onClick={() => add(form)}
                    >
                        {busyAdd ? "…" : "Add"}
                    </button>
                </div>

                <h4 style={{ marginTop: 16 }}>Game Custom Gear</h4>
                <div className="list">
                    {(game.gear?.custom ?? []).map((it) => (
                        <div key={it.id} className="row" style={{ justifyContent: "space-between" }}>
                            <div>
                                <b>{it.name}</b> — {it.type}
                                <div style={{ opacity: 0.85, fontSize: 12 }}>{it.desc}</div>
                            </div>
                        </div>
                    ))}
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
                                disabled={!canEdit}
                                onClick={() => add({ name: it.name, type: it.type, desc: it.desc })}
                            >
                                Add
                            </button>
                        </div>
                    ))}
                    {gearList.length === 0 && <div style={{ opacity: 0.7 }}>No premade gear.</div>}
                </div>
            </div>
        </div>
    );
}

// ---------- Demons ----------
function DemonTab({ game, me, onUpdate }) {
    const [name, setName] = useState("");
    const [arcana, setArc] = useState("");
    const [align, setAlign] = useState("");
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const [busyAdd, setBusyAdd] = useState(false);
    const [busySearch, setBusySearch] = useState(false);

    const isDM = game.dmId === me.id;
    const canEdit = isDM || game.permissions?.canEditDemons;

    const add = async () => {
        if (!name) return alert("Enter a demon name");
        try {
            setBusyAdd(true);
            await Games.addDemon(game.id, { name, arcana, alignment: align });
            await onUpdate();
            setName("");
            setArc("");
            setAlign("");
        } catch (e) {
            alert(e.message);
        } finally {
            setBusyAdd(false);
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
            // only set if latest
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
            setName(p.name);
            setArc(p.arcana);
        } catch (e) {
            alert(e.message);
        }
    };

    return (
        <div className="card">
            <h3>Shared Demon Pool</h3>

            <div className="row" style={{ marginBottom: 10 }}>
        <span className="pill">
          {game.demonPool?.used ?? 0}/{game.demonPool?.max ?? 0} used
        </span>
            </div>

            <div className="row" style={{ gap: 8 }}>
                <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                <input placeholder="Arcana" value={arcana} onChange={(e) => setArc(e.target.value)} />
                <input placeholder="Alignment" value={align} onChange={(e) => setAlign(e.target.value)} />
                <button className="btn" onClick={add} disabled={busyAdd || !canEdit}>
                    {busyAdd ? "…" : "Add Demon"}
                </button>
            </div>

            <div className="row" style={{ marginTop: 16, gap: 16 }}>
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

            <div className="list" style={{ marginTop: 12 }}>
                {game.demons.map((d) => (
                    <div
                        key={d.id}
                        className="row"
                        style={{ justifyContent: "space-between", alignItems: "center" }}
                    >
                        <div>
                            <b>{d.name}</b> · {d.arcana ?? "—"} · {d.alignment ?? "—"}
                        </div>
                        <button
                            className="btn"
                            disabled={!canEdit}
                            onClick={async () => {
                                try {
                                    await Games.delDemon(game.id, d.id);
                                    await onUpdate();
                                } catch (e) {
                                    alert(e.message);
                                }
                            }}
                        >
                            Remove
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ---------- Settings ----------
function SettingsTab({ game, onUpdate }) {
    const [perms, setPerms] = useState(game.permissions || {});
    const [saving, setSaving] = useState(false);

    useEffect(() => setPerms(game.permissions || {}), [game.id, game.permissions]);

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
