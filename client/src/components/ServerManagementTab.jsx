import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ServerAdmin } from "../api";

const SUBTABS = [
    { key: "users", label: "Users" },
    { key: "games", label: "Games" },
    { key: "demons", label: "Default Demons" },
    { key: "bot", label: "Master Discord Bot" },
];

function formatError(err) {
    if (!err) return "";
    if (typeof err === "string") return err;
    if (err instanceof Error) return err.message;
    return err?.message || "Unexpected error";
}

function UsersAdminPanel({ onChanged }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [users, setUsers] = useState([]);
    const [drafts, setDrafts] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const list = await ServerAdmin.users.list();
            setUsers(Array.isArray(list) ? list : []);
            setDrafts({});
        } catch (err) {
            setError(formatError(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const getDraft = (user) => {
        const base = drafts[user.id];
        if (base) return base;
        return {
            username: user.username || "",
            email: user.email || "",
            banned: !!user.banned,
        };
    };

    const updateDraft = (user, changes) => {
        setDrafts((prev) => ({
            ...prev,
            [user.id]: { ...getDraft(user), ...(prev[user.id] || {}), ...changes },
        }));
    };

    const handleSave = async (user) => {
        const draft = getDraft(user);
        const payload = {
            username: draft.username.trim(),
            email: draft.email.trim(),
            banned: !!draft.banned,
        };
        try {
            const updated = await ServerAdmin.users.update(user.id, payload);
            setUsers((prev) => prev.map((item) => (item.id === user.id ? updated : item)));
            setDrafts((prev) => {
                const next = { ...prev };
                delete next[user.id];
                return next;
            });
            if (typeof onChanged === "function") onChanged();
        } catch (err) {
            alert(formatError(err));
        }
    };

    const handleDelete = async (user) => {
        if (!window.confirm(`Delete user "${user.username}"? This will remove them from all games.`)) {
            return;
        }
        try {
            await ServerAdmin.users.delete(user.id);
            setUsers((prev) => prev.filter((item) => item.id !== user.id));
            setDrafts((prev) => {
                const next = { ...prev };
                delete next[user.id];
                return next;
            });
            if (typeof onChanged === "function") onChanged();
        } catch (err) {
            alert(formatError(err));
        }
    };

    const renderUser = (user) => {
        const draft = getDraft(user);
        const originalEmail = user.email || "";
        const dirty =
            draft.username.trim() !== (user.username || "") ||
            draft.email.trim() !== originalEmail ||
            !!draft.banned !== !!user.banned;

        return (
            <div key={user.id} className="card" style={{ padding: 16, gap: 12 }}>
                <div className="row" style={{ alignItems: "center", gap: 12 }}>
                    <h3 style={{ margin: 0 }}>{user.username}</h3>
                    {user.email && (
                        <span className="text-muted">{user.email}</span>
                    )}
                    {user.banned && <span className="pill danger">Banned</span>}
                </div>
                <div className="grid" style={{ gap: 12 }}>
                    <label className="col">
                        <span className="text-muted text-small">Username</span>
                        <input
                            value={draft.username}
                            onChange={(e) => updateDraft(user, { username: e.target.value })}
                        />
                    </label>
                    <label className="col">
                        <span className="text-muted text-small">Email</span>
                        <input
                            value={draft.email}
                            onChange={(e) => updateDraft(user, { email: e.target.value })}
                        />
                    </label>
                    <label className="row" style={{ alignItems: "center", gap: 8 }}>
                        <input
                            type="checkbox"
                            checked={draft.banned}
                            onChange={(e) => updateDraft(user, { banned: e.target.checked })}
                        />
                        <span>Banned</span>
                    </label>
                </div>
                <div className="row" style={{ gap: 8 }}>
                    <button
                        type="button"
                        className="btn"
                        onClick={() => handleSave(user)}
                        disabled={!dirty}
                    >
                        Save
                    </button>
                    <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setDrafts((prev) => {
                            const next = { ...prev };
                            delete next[user.id];
                            return next;
                        })}
                        disabled={!drafts[user.id]}
                    >
                        Reset
                    </button>
                    <button
                        type="button"
                        className="btn danger"
                        onClick={() => handleDelete(user)}
                    >
                        Delete
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="col" style={{ gap: 16 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>User Directory</h2>
                <button type="button" className="btn ghost" onClick={load} disabled={loading}>
                    {loading ? "Loading…" : "Refresh"}
                </button>
            </div>
            {error && <div className="alert warn">{error}</div>}
            {loading && users.length === 0 ? (
                <div className="text-muted">Loading users…</div>
            ) : users.length === 0 ? (
                <div className="text-muted">No users found.</div>
            ) : (
                <div className="col" style={{ gap: 12 }}>
                    {users.map((user) => renderUser(user))}
                </div>
            )}
        </div>
    );
}

function GamesAdminPanel({ activeGameId, onGameDeleted, onRefreshGames, onRefreshActiveGame }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [games, setGames] = useState([]);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const list = await ServerAdmin.games.list();
            setGames(Array.isArray(list) ? list : []);
        } catch (err) {
            setError(formatError(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const refreshAll = useCallback(async () => {
        await load();
        if (typeof onRefreshGames === "function") await onRefreshGames();
    }, [load, onRefreshGames]);

    const handleDeleteGame = async (game) => {
        if (!window.confirm(`Delete the game "${game.name}"? This cannot be undone.`)) {
            return;
        }
        try {
            await ServerAdmin.games.delete(game.id);
            if (game.id === activeGameId && typeof onGameDeleted === "function") {
                await onGameDeleted();
            }
            await refreshAll();
        } catch (err) {
            alert(formatError(err));
        }
    };

    const handleRemovePlayer = async (game, playerId) => {
        if (!playerId) return;
        try {
            await ServerAdmin.games.removePlayer(game.id, playerId);
            if (game.id === activeGameId && typeof onRefreshActiveGame === "function") {
                await onRefreshActiveGame();
            }
            await refreshAll();
        } catch (err) {
            alert(formatError(err));
        }
    };

    const handleSetDm = async (game, dmId) => {
        if (!dmId) return;
        try {
            await ServerAdmin.games.setDungeonMaster(game.id, dmId);
            if (game.id === activeGameId && typeof onRefreshActiveGame === "function") {
                await onRefreshActiveGame();
            }
            await refreshAll();
        } catch (err) {
            alert(formatError(err));
        }
    };

    const renderGame = (game) => {
        const players = Array.isArray(game.players) ? game.players : [];
        return (
            <div key={game.id} className="card" style={{ padding: 16, gap: 12 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                    <div>
                        <h3 style={{ margin: 0 }}>{game.name}</h3>
                        <p className="text-muted" style={{ margin: 0 }}>
                            DM: {game.dmUsername || game.dmId || "Unassigned"}
                        </p>
                        <p className="text-muted" style={{ margin: 0 }}>
                            Players: {players.length}
                        </p>
                    </div>
                    <button type="button" className="btn danger" onClick={() => handleDeleteGame(game)}>
                        Delete Game
                    </button>
                </div>
                <div className="col" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <label className="row" style={{ gap: 8, alignItems: "center" }}>
                            <span className="text-muted text-small">Remove player</span>
                            <select
                                onChange={(e) => {
                                    const value = e.target.value;
                                    if (value) handleRemovePlayer(game, value);
                                    e.target.value = "";
                                }}
                                defaultValue=""
                            >
                                <option value="">Select player…</option>
                                {players
                                    .filter((p) => p && p.userId !== game.dmId)
                                    .map((player) => (
                                        <option key={player.userId} value={player.userId}>
                                            {player.username || player.userId}
                                        </option>
                                    ))}
                            </select>
                        </label>
                        <label className="row" style={{ gap: 8, alignItems: "center" }}>
                            <span className="text-muted text-small">Change DM</span>
                            <select
                                onChange={(e) => {
                                    const value = e.target.value;
                                    if (value) handleSetDm(game, value);
                                    e.target.value = "";
                                }}
                                defaultValue=""
                            >
                                <option value="">Select new DM…</option>
                                {players.map((player) => (
                                    <option key={player.userId} value={player.userId}>
                                        {player.username || player.userId}
                                        {player.userId === game.dmId ? " (current)" : ""}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="col" style={{ gap: 16 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>Games</h2>
                <button type="button" className="btn ghost" onClick={refreshAll} disabled={loading}>
                    {loading ? "Loading…" : "Refresh"}
                </button>
            </div>
            {error && <div className="alert warn">{error}</div>}
            {loading && games.length === 0 ? (
                <div className="text-muted">Loading games…</div>
            ) : games.length === 0 ? (
                <div className="text-muted">No games found.</div>
            ) : (
                <div className="col" style={{ gap: 12 }}>
                    {games.map((game) => renderGame(game))}
                </div>
            )}
        </div>
    );
}

function createDemonDraft(demon) {
    if (!demon) {
        return {
            arcana: "",
            level: "",
            alignment: "",
            personality: "",
            description: "",
            skillsText: "",
            resistances: {
                weak: "",
                resist: "",
                block: "",
                drain: "",
                reflect: "",
            },
        };
    }
    const resist = demon.resistances || {};
    return {
        arcana: demon.arcana || "",
        level: demon.level ?? "",
        alignment: demon.alignment || "",
        personality: demon.personality || "",
        description: demon.description || "",
        skillsText: Array.isArray(demon.skills) ? demon.skills.join(", ") : "",
        resistances: {
            weak: Array.isArray(resist.weak) ? resist.weak.join(", ") : "",
            resist: Array.isArray(resist.resist) ? resist.resist.join(", ") : "",
            block: Array.isArray(resist.block) ? resist.block.join(", ") : "",
            drain: Array.isArray(resist.drain) ? resist.drain.join(", ") : "",
            reflect: Array.isArray(resist.reflect) ? resist.reflect.join(", ") : "",
        },
    };
}

function DemonsAdminPanel() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [demons, setDemons] = useState([]);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState(null);
    const [draft, setDraft] = useState(null);
    const [csvReport, setCsvReport] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const list = await ServerAdmin.demons.list();
            setDemons(Array.isArray(list) ? list : []);
        } catch (err) {
            setError(formatError(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        const demon = demons.find((entry) => Number(entry?.id) === Number(selectedId));
        setDraft(createDemonDraft(demon));
    }, [demons, selectedId]);

    const filteredDemons = useMemo(() => {
        if (!search) return demons;
        const term = search.toLowerCase();
        return demons.filter((demon) =>
            (demon.name || "").toLowerCase().includes(term) ||
            (demon.arcana || "").toLowerCase().includes(term),
        );
    }, [demons, search]);

    const selectedDemon = useMemo(
        () => demons.find((entry) => Number(entry?.id) === Number(selectedId)) || null,
        [demons, selectedId],
    );

    const handleSelectDemon = (id) => {
        setSelectedId(id);
    };

    const handleDraftChange = (changes) => {
        setDraft((prev) => ({
            ...(prev || {}),
            ...changes,
        }));
    };

    const handleResistanceChange = (key, value) => {
        setDraft((prev) => ({
            ...(prev || {}),
            resistances: {
                ...(prev?.resistances || {}),
                [key]: value,
            },
        }));
    };

    const handleSave = async () => {
        if (!selectedDemon || !draft) return;
        const parsedLevel = Number(draft.level);
        const payload = {
            arcana: draft.arcana,
            level:
                draft.level === ""
                    ? null
                    : Number.isFinite(parsedLevel)
                    ? parsedLevel
                    : selectedDemon.level,
            alignment: draft.alignment,
            personality: draft.personality,
            description: draft.description,
            skills: draft.skillsText
                ? draft.skillsText
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean)
                : [],
            resistances: {
                weak: draft.resistances?.weak
                    ? draft.resistances.weak.split(",").map((item) => item.trim()).filter(Boolean)
                    : [],
                resist: draft.resistances?.resist
                    ? draft.resistances.resist.split(",").map((item) => item.trim()).filter(Boolean)
                    : [],
                block: draft.resistances?.block
                    ? draft.resistances.block.split(",").map((item) => item.trim()).filter(Boolean)
                    : [],
                drain: draft.resistances?.drain
                    ? draft.resistances.drain.split(",").map((item) => item.trim()).filter(Boolean)
                    : [],
                reflect: draft.resistances?.reflect
                    ? draft.resistances.reflect.split(",").map((item) => item.trim()).filter(Boolean)
                    : [],
            },
        };
        try {
            const updated = await ServerAdmin.demons.update(selectedDemon.id, payload);
            setDemons((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
            alert("Demon updated");
        } catch (err) {
            alert(formatError(err));
        }
    };

    const handleReset = () => {
        const demon = demons.find((entry) => Number(entry?.id) === Number(selectedId));
        setDraft(createDemonDraft(demon));
    };

    const handleCsvUpload = async (file) => {
        if (!file) return;
        try {
            const text = await file.text();
            const report = await ServerAdmin.demons.uploadCsv(text);
            setCsvReport(report);
            if (report?.wrote) {
                await load();
            }
            if (report?.demonsUpdated > 0 && window.confirm("Testing - passed, push to database?")) {
                const sync = await ServerAdmin.demons.sync();
                setCsvReport((prev) => ({ ...prev, synced: sync?.count ?? 0 }));
            }
        } catch (err) {
            alert(formatError(err));
        }
    };

    return (
        <div className="col" style={{ gap: 16 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>Default Demons</h2>
                <label className="btn ghost">
                    Upload CSV
                    <input
                        type="file"
                        accept=".csv,text/csv"
                        style={{ display: "none" }}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleCsvUpload(file);
                            e.target.value = "";
                        }}
                    />
                </label>
            </div>
            {error && <div className="alert warn">{error}</div>}
            <div className="row" style={{ gap: 12 }}>
                <input
                    placeholder="Search demons"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <button type="button" className="btn ghost" onClick={load} disabled={loading}>
                    {loading ? "Loading…" : "Refresh"}
                </button>
            </div>
            <div className="row" style={{ gap: 16 }}>
                <div style={{ flex: "0 0 260px", maxHeight: 360, overflow: "auto" }}>
                    {loading && demons.length === 0 ? (
                        <div className="text-muted">Loading demons…</div>
                    ) : filteredDemons.length === 0 ? (
                        <div className="text-muted">No demons match your search.</div>
                    ) : (
                        <ul className="col" style={{ listStyle: "none", margin: 0, padding: 0, gap: 4 }}>
                            {filteredDemons.map((demon) => (
                                <li key={demon.id}>
                                    <button
                                        type="button"
                                        className={`btn ghost btn-small${selectedId === demon.id ? " is-active" : ""}`}
                                        onClick={() => handleSelectDemon(demon.id)}
                                    >
                                        {demon.name} <span className="text-muted">({demon.arcana})</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div style={{ flex: 1 }}>
                    {!selectedDemon ? (
                        <div className="text-muted">Select a demon to edit.</div>
                    ) : (
                        <div className="col" style={{ gap: 12 }}>
                            <h3 style={{ margin: 0 }}>{selectedDemon.name}</h3>
                            <div className="grid" style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                                <label className="col">
                                    <span className="text-muted text-small">Arcana</span>
                                    <input
                                        value={draft?.arcana || ""}
                                        onChange={(e) => handleDraftChange({ arcana: e.target.value })}
                                    />
                                </label>
                                <label className="col">
                                    <span className="text-muted text-small">Level</span>
                                    <input
                                        value={draft?.level ?? ""}
                                        onChange={(e) => handleDraftChange({ level: e.target.value })}
                                    />
                                </label>
                                <label className="col">
                                    <span className="text-muted text-small">Alignment</span>
                                    <input
                                        value={draft?.alignment || ""}
                                        onChange={(e) => handleDraftChange({ alignment: e.target.value })}
                                    />
                                </label>
                                <label className="col">
                                    <span className="text-muted text-small">Personality</span>
                                    <input
                                        value={draft?.personality || ""}
                                        onChange={(e) => handleDraftChange({ personality: e.target.value })}
                                    />
                                </label>
                            </div>
                            <label className="col">
                                <span className="text-muted text-small">Description</span>
                                <textarea
                                    rows={4}
                                    value={draft?.description || ""}
                                    onChange={(e) => handleDraftChange({ description: e.target.value })}
                                />
                            </label>
                            <label className="col">
                                <span className="text-muted text-small">Skills (comma separated)</span>
                                <textarea
                                    rows={2}
                                    value={draft?.skillsText || ""}
                                    onChange={(e) => handleDraftChange({ skillsText: e.target.value })}
                                />
                            </label>
                            <div className="grid" style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                                {[
                                    ["weak", "Weak"],
                                    ["resist", "Resist"],
                                    ["block", "Block/Null"],
                                    ["drain", "Drain"],
                                    ["reflect", "Reflect"],
                                ].map(([key, label]) => (
                                    <label key={key} className="col">
                                        <span className="text-muted text-small">{label}</span>
                                        <textarea
                                            rows={2}
                                            value={draft?.resistances?.[key] || ""}
                                            onChange={(e) => handleResistanceChange(key, e.target.value)}
                                        />
                                    </label>
                                ))}
                            </div>
                            <div className="row" style={{ gap: 8 }}>
                                <button type="button" className="btn" onClick={handleSave}>
                                    Save Changes
                                </button>
                                <button type="button" className="btn ghost" onClick={handleReset}>
                                    Reset
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {csvReport && (
                <div className="card" style={{ padding: 16, gap: 8 }}>
                    <strong>CSV Import Summary</strong>
                    <div>Rows processed: {csvReport.rowsProcessed}</div>
                    <div>Demons updated: {csvReport.demonsUpdated}</div>
                    {Array.isArray(csvReport.warnings) && csvReport.warnings.length > 0 && (
                        <div className="alert warn" style={{ marginTop: 8 }}>
                            <strong>Warnings</strong>
                            <ul style={{ margin: '8px 0 0 16px' }}>
                                {csvReport.warnings.map((message, idx) => (
                                    <li key={idx}>{message}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {csvReport.backupPath && (
                        <div className="text-muted">Backup: {csvReport.backupPath}</div>
                    )}
                    {typeof csvReport.synced === "number" && (
                        <div className="text-muted">Synced records: {csvReport.synced}</div>
                    )}
                    {Array.isArray(csvReport.changeLog) && csvReport.changeLog.length > 0 && (
                        <details>
                            <summary>Change log</summary>
                            <ul>
                                {csvReport.changeLog.slice(0, 20).map((entry, idx) => (
                                    <li key={idx}>
                                        {entry.who || "row"}: {entry.note || (entry.changes || []).join(", ")}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                </div>
            )}
        </div>
    );
}

function MasterBotSettingsPanel() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [settings, setSettings] = useState(null);
    const [draft, setDraft] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const value = await ServerAdmin.masterBot.get();
            setSettings(value);
            setDraft(value);
        } catch (err) {
            setError(formatError(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleChange = (changes) => {
        setDraft((prev) => ({ ...(prev || {}), ...changes }));
    };

    const handleArrayChange = (key, value) => {
        handleChange({ [key]: value.split(",").map((item) => item.trim()).filter(Boolean) });
    };

    const handleNestedChange = (group, key, value) => {
        setDraft((prev) => ({
            ...(prev || {}),
            [group]: { ...(prev?.[group] || {}), [key]: value },
        }));
    };

    const handleToggle = (group, key, checked) => {
        setDraft((prev) => ({
            ...(prev || {}),
            [group]: { ...(prev?.[group] || {}), [key]: checked },
        }));
    };

    const handleSave = async () => {
        try {
            const saved = await ServerAdmin.masterBot.update(draft || {});
            setSettings(saved);
            setDraft(saved);
            alert("Settings updated");
        } catch (err) {
            alert(formatError(err));
        }
    };

    if (loading && !settings) {
        return <div className="text-muted">Loading settings…</div>;
    }

    if (error && !settings) {
        return <div className="alert warn">{error}</div>;
    }

    return (
        <div className="col" style={{ gap: 16 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>Master Discord Bot</h2>
                <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn ghost" onClick={load} disabled={loading}>
                        {loading ? "Loading…" : "Reset"}
                    </button>
                    <button type="button" className="btn" onClick={handleSave} disabled={loading}>
                        Save Settings
                    </button>
                </div>
            </div>
            {error && <div className="alert warn">{error}</div>}
            <div className="col" style={{ gap: 12 }}>
                <label className="col">
                    <span className="text-muted text-small">Command Prefix</span>
                    <input
                        value={draft?.prefix || ""}
                        onChange={(e) => handleChange({ prefix: e.target.value })}
                    />
                </label>
                <label className="col">
                    <span className="text-muted text-small">Admin Roles (comma separated)</span>
                    <textarea
                        rows={2}
                        value={(draft?.adminRoles || []).join(", ")}
                        onChange={(e) => handleArrayChange("adminRoles", e.target.value)}
                    />
                </label>
                <div className="grid" style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                    {Object.entries(draft?.channelBindings || {}).map(([key, value]) => (
                        <label key={key} className="col">
                            <span className="text-muted text-small">Channel: {key}</span>
                            <input
                                value={value || ""}
                                onChange={(e) => handleNestedChange("channelBindings", key, e.target.value)}
                            />
                        </label>
                    ))}
                </div>
                <div className="grid" style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                    {Object.entries(draft?.webhooks || {}).map(([key, value]) => (
                        <label key={key} className="col">
                            <span className="text-muted text-small">Webhook: {key}</span>
                            <input
                                value={value || ""}
                                onChange={(e) => handleNestedChange("webhooks", key, e.target.value)}
                            />
                        </label>
                    ))}
                </div>
                <div className="col" style={{ gap: 8 }}>
                    <span className="text-muted text-small">Event Toggles</span>
                    {Object.entries(draft?.events || {}).map(([key, value]) => (
                        <label key={key} className="row" style={{ gap: 8, alignItems: "center" }}>
                            <input
                                type="checkbox"
                                checked={!!value}
                                onChange={(e) => handleToggle("events", key, e.target.checked)}
                            />
                            <span>{key}</span>
                        </label>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function ServerManagementTab({ activeGameId, onGameDeleted, onRefreshGames, onRefreshActiveGame }) {
    const [subtab, setSubtab] = useState(SUBTABS[0].key);

    const renderContent = () => {
        switch (subtab) {
            case "users":
                return <UsersAdminPanel onChanged={onRefreshGames} />;
            case "games":
                return (
                    <GamesAdminPanel
                        activeGameId={activeGameId}
                        onGameDeleted={onGameDeleted}
                        onRefreshGames={onRefreshGames}
                        onRefreshActiveGame={onRefreshActiveGame}
                    />
                );
            case "demons":
                return <DemonsAdminPanel />;
            case "bot":
                return <MasterBotSettingsPanel />;
            default:
                return null;
        }
    };

    return (
        <div className="col" style={{ gap: 20 }}>
            <header className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {SUBTABS.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        className={`btn ghost${subtab === item.key ? " is-active" : ""}`}
                        onClick={() => setSubtab(item.key)}
                    >
                        {item.label}
                    </button>
                ))}
            </header>
            <section>{renderContent()}</section>
        </div>
    );
}
