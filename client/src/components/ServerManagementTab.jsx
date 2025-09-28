import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ServerAdmin } from "../api";
import { ABILITY_DEFS } from "../constants/gameData";
import DemonImage from "./DemonImage";

const ABILITY_KEYS = ABILITY_DEFS.map((ability) => ability.key);
const MAX_DEMON_IMAGE_BYTES = 2 * 1024 * 1024;

const SUBTABS = [
    { key: "users", label: "Users" },
    { key: "games", label: "Games" },
    { key: "items", label: "Default Items" },
    { key: "demons", label: "Default Demons" },
    { key: "bot", label: "Master Discord Bot" },
];

function formatError(err) {
    if (!err) return "";
    if (typeof err === "string") return err;
    if (err instanceof Error) return err.message;
    return err?.message || "Unexpected error";
}

function sortItems(list) {
    return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
        const orderA = Number.isFinite(a?.order) ? a.order : Number.MAX_SAFE_INTEGER;
        const orderB = Number.isFinite(b?.order) ? b.order : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return (a?.name || "").localeCompare(b?.name || "");
    });
}

function createItemDraft(item) {
    if (!item || typeof item !== "object") {
        return {
            slug: "",
            name: "",
            type: "",
            category: "",
            subcategory: "",
            slot: "",
            tags: "",
            desc: "",
            order: "",
        };
    }
    return {
        slug: item.slug || "",
        name: item.name || "",
        type: item.type || "",
        category: item.category || "",
        subcategory: item.subcategory || "",
        slot: item.slot || "",
        tags: Array.isArray(item.tags) ? item.tags.join(", ") : "",
        desc: item.desc || "",
        order: item.order ?? "",
    };
}

function parseTagsInput(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value
            .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
            .filter(Boolean);
    }
    return String(value)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
}

function formatTagsForCompare(value) {
    return parseTagsInput(value).join("||");
}

function parseOrderValue(value) {
    if (value === "" || value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
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
            image: "",
            stats: ABILITY_KEYS.reduce((acc, key) => {
                acc[key] = "";
                return acc;
            }, {}),
            mods: ABILITY_KEYS.reduce((acc, key) => {
                acc[key] = "";
                return acc;
            }, {}),
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
        image: typeof demon.image === "string" ? demon.image : "",
        stats: ABILITY_KEYS.reduce((acc, key) => {
            const value = demon.stats?.[key];
            acc[key] = value === undefined || value === null ? "" : String(value);
            return acc;
        }, {}),
        mods: ABILITY_KEYS.reduce((acc, key) => {
            const value = demon.mods?.[key];
            acc[key] = value === undefined || value === null ? "" : String(value);
            return acc;
        }, {}),
        resistances: {
            weak: Array.isArray(resist.weak) ? resist.weak.join(", ") : "",
            resist: Array.isArray(resist.resist) ? resist.resist.join(", ") : "",
            block: Array.isArray(resist.block) ? resist.block.join(", ") : "",
            drain: Array.isArray(resist.drain) ? resist.drain.join(", ") : "",
            reflect: Array.isArray(resist.reflect) ? resist.reflect.join(", ") : "",
        },
    };
}

function ItemsAdminPanel() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [items, setItems] = useState([]);
    const [search, setSearch] = useState("");
    const [selectedSlug, setSelectedSlug] = useState(null);
    const [draft, setDraft] = useState(createItemDraft(null));
    const [saving, setSaving] = useState(false);
    const [saveNotice, setSaveNotice] = useState("");
    const [syncState, setSyncState] = useState({ status: "idle", message: "" });

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const list = await ServerAdmin.items.list();
            setItems(sortItems(Array.isArray(list) ? list : []));
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
        if (items.length === 0) {
            setSelectedSlug(null);
            return;
        }
        if (!selectedSlug || !items.some((item) => item?.slug === selectedSlug)) {
            setSelectedSlug(items[0]?.slug || null);
        }
    }, [items, selectedSlug]);

    useEffect(() => {
        const selected = items.find((item) => item.slug === selectedSlug) || null;
        setDraft(createItemDraft(selected));
        setSaveNotice("");
    }, [items, selectedSlug]);

    const filteredItems = useMemo(() => {
        if (!search) return items;
        const term = search.toLowerCase();
        return items.filter((item) => {
            const tags = Array.isArray(item.tags) ? item.tags.join(" ") : "";
            return (
                (item.name || "").toLowerCase().includes(term) ||
                (item.type || "").toLowerCase().includes(term) ||
                (item.category || "").toLowerCase().includes(term) ||
                (item.subcategory || "").toLowerCase().includes(term) ||
                tags.toLowerCase().includes(term)
            );
        });
    }, [items, search]);

    const selectedItem = useMemo(
        () => items.find((item) => item.slug === selectedSlug) || null,
        [items, selectedSlug],
    );

    const dirty = useMemo(() => {
        if (!selectedItem) return false;
        const compare = (a, b) => (a || "").trim() === (b || "").trim();
        if (!compare(draft.name, selectedItem.name)) return true;
        if (!compare(draft.type, selectedItem.type)) return true;
        if (!compare(draft.category, selectedItem.category)) return true;
        if (!compare(draft.subcategory, selectedItem.subcategory)) return true;
        if (!compare(draft.slot, selectedItem.slot)) return true;
        if (!compare(draft.desc, selectedItem.desc)) return true;
        if (formatTagsForCompare(draft.tags) !== formatTagsForCompare(selectedItem.tags)) return true;
        if (parseOrderValue(draft.order) !== parseOrderValue(selectedItem.order)) return true;
        return false;
    }, [draft, selectedItem]);

    const handleDraftChange = (field, value) => {
        setDraft((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleSave = async () => {
        if (!selectedItem) return;
        setSaving(true);
        setSaveNotice("");
        try {
            const payload = {
                name: (draft.name || "").trim(),
                type: (draft.type || "").trim(),
                category: (draft.category || "").trim(),
                subcategory: (draft.subcategory || "").trim(),
                slot: (draft.slot || "").trim(),
                desc: draft.desc || "",
                tags: parseTagsInput(draft.tags || ""),
            };
            const orderValue = parseOrderValue(draft.order);
            if (orderValue !== null) {
                payload.order = orderValue;
            }
            const updated = await ServerAdmin.items.update(selectedItem.slug, payload);
            setItems((prev) =>
                sortItems(prev.map((item) => (item.slug === selectedItem.slug ? updated : item))),
            );
            setSelectedSlug(updated.slug);
            setDraft(createItemDraft(updated));
            setSaveNotice("Saved changes.");
        } catch (err) {
            alert(formatError(err));
        } finally {
            setSaving(false);
        }
    };

    const handleReset = () => {
        setDraft(createItemDraft(selectedItem));
        setSaveNotice("");
    };

    const syncPending = syncState.status === "pending";

    const handleSync = async () => {
        setSyncState({ status: "pending", message: "" });
        try {
            const result = await ServerAdmin.items.sync();
            const count = Number(result?.count);
            setSyncState({
                status: "success",
                message:
                    Number.isFinite(count) && count >= 0
                        ? `Synced ${count} items into the library.`
                        : "Sync completed.",
            });
        } catch (err) {
            setSyncState({ status: "error", message: formatError(err) });
        }
    };

    return (
        <div className="col" style={{ gap: 16 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <h2 style={{ margin: 0 }}>Default Items</h2>
                <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn ghost" onClick={handleSync} disabled={syncPending}>
                        {syncPending ? "Syncing…" : "Sync Library"}
                    </button>
                    <button type="button" className="btn ghost" onClick={load} disabled={loading}>
                        {loading ? "Loading…" : "Refresh"}
                    </button>
                </div>
            </div>
            {error && <div className="alert warn">{error}</div>}
            {syncState.status === "success" && (
                <div className="alert success">{syncState.message || "Sync completed."}</div>
            )}
            {syncState.status === "error" && <div className="alert warn">{syncState.message}</div>}
            <div className="row" style={{ gap: 12 }}>
                <input
                    placeholder="Search items"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>
            <div className="row" style={{ gap: 16 }}>
                <div style={{ flex: "0 0 260px", maxHeight: 360, overflow: "auto" }}>
                    {loading && items.length === 0 ? (
                        <div className="text-muted">Loading items…</div>
                    ) : filteredItems.length === 0 ? (
                        <div className="text-muted">No items match your search.</div>
                    ) : (
                        <ul className="col" style={{ listStyle: "none", margin: 0, padding: 0, gap: 4 }}>
                            {filteredItems.map((item) => (
                                <li key={item.slug}>
                                    <button
                                        type="button"
                                        className={`btn ghost btn-small${selectedSlug === item.slug ? " is-active" : ""}`}
                                        onClick={() => setSelectedSlug(item.slug)}
                                    >
                                        {item.name} <span className="text-muted">({item.type || item.category || "Item"})</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div style={{ flex: 1 }}>
                    {!selectedItem ? (
                        <div className="text-muted">Select an item to edit.</div>
                    ) : (
                        <div className="col" style={{ gap: 12 }}>
                            <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
                                <h3 style={{ margin: 0 }}>{selectedItem.name}</h3>
                                <span className="text-muted text-small">Slug: {selectedItem.slug}</span>
                            </div>
                            <div
                                className="grid"
                                style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
                            >
                                <label className="col">
                                    <span className="text-muted text-small">Name</span>
                                    <input
                                        value={draft.name}
                                        onChange={(e) => handleDraftChange("name", e.target.value)}
                                    />
                                </label>
                                <label className="col">
                                    <span className="text-muted text-small">Type</span>
                                    <input
                                        value={draft.type}
                                        onChange={(e) => handleDraftChange("type", e.target.value)}
                                    />
                                </label>
                                <label className="col">
                                    <span className="text-muted text-small">Category</span>
                                    <input
                                        value={draft.category}
                                        onChange={(e) => handleDraftChange("category", e.target.value)}
                                    />
                                </label>
                                <label className="col">
                                    <span className="text-muted text-small">Subcategory</span>
                                    <input
                                        value={draft.subcategory}
                                        onChange={(e) => handleDraftChange("subcategory", e.target.value)}
                                    />
                                </label>
                                <label className="col">
                                    <span className="text-muted text-small">Slot</span>
                                    <input
                                        value={draft.slot}
                                        onChange={(e) => handleDraftChange("slot", e.target.value)}
                                    />
                                </label>
                                <label className="col">
                                    <span className="text-muted text-small">Order</span>
                                    <input
                                        type="number"
                                        value={draft.order}
                                        onChange={(e) => handleDraftChange("order", e.target.value)}
                                    />
                                </label>
                                <label className="col" style={{ gridColumn: "1 / -1" }}>
                                    <span className="text-muted text-small">Tags (comma separated)</span>
                                    <input
                                        value={draft.tags}
                                        onChange={(e) => handleDraftChange("tags", e.target.value)}
                                    />
                                </label>
                            </div>
                            <label className="col">
                                <span className="text-muted text-small">Description</span>
                                <textarea
                                    rows={6}
                                    value={draft.desc}
                                    onChange={(e) => handleDraftChange("desc", e.target.value)}
                                />
                            </label>
                            {saveNotice && <div className="text-muted text-small">{saveNotice}</div>}
                            <div className="row" style={{ gap: 8 }}>
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={handleSave}
                                    disabled={!dirty || saving}
                                >
                                    {saving ? "Saving…" : "Save Changes"}
                                </button>
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={handleReset}
                                    disabled={saving || !dirty}
                                >
                                    Reset
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function DemonsAdminPanel() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [demons, setDemons] = useState([]);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState(null);
    const [draft, setDraft] = useState(null);
    const [csvReport, setCsvReport] = useState(null);
    const imageInputRef = useRef(null);
    const [imageError, setImageError] = useState("");

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
        setImageError("");
        if (imageInputRef.current) {
            imageInputRef.current.value = "";
        }
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

    const handleStatChange = (key, value) => {
        setDraft((prev) => ({
            ...(prev || {}),
            stats: {
                ...(prev?.stats || {}),
                [key]: value,
            },
        }));
    };

    const handleModChange = (key, value) => {
        setDraft((prev) => ({
            ...(prev || {}),
            mods: {
                ...(prev?.mods || {}),
                [key]: value,
            },
        }));
    };

    const handleImageUploadClick = () => {
        imageInputRef.current?.click();
    };

    const handleImageUpload = (event) => {
        const input = event.target;
        const file = input?.files?.[0];

        const reset = () => {
            if (input) input.value = "";
        };

        if (!file) {
            reset();
            return;
        }

        if (typeof file.type === "string" && file.type && !file.type.startsWith("image/")) {
            setImageError("Please choose an image file.");
            reset();
            return;
        }

        if (file.size > MAX_DEMON_IMAGE_BYTES) {
            setImageError("Images must be 2 MB or smaller.");
            reset();
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            handleDraftChange({ image: result });
            setImageError("");
            reset();
        };
        reader.onerror = () => {
            setImageError("Failed to load image. Try a different file.");
            reset();
        };
        reader.readAsDataURL(file);
    };

    const handleImageRemove = () => {
        handleDraftChange({ image: "" });
        setImageError("");
        if (imageInputRef.current) {
            imageInputRef.current.value = "";
        }
    };

    const handleSave = async () => {
        if (!selectedDemon || !draft) return;
        const parsedLevel = Number(draft.level);
        const previousStats = selectedDemon?.stats || {};
        const previousMods = selectedDemon?.mods || {};

        const statsPayload = ABILITY_KEYS.reduce((acc, key) => {
            const raw = draft?.stats?.[key];
            const trimmed = raw === undefined || raw === null ? "" : String(raw).trim();
            const prev = previousStats[key];
            const hasPrev = prev !== undefined && prev !== null;
            const prevNumber = hasPrev ? Number(prev) : null;

            if (trimmed === "") {
                if (hasPrev) {
                    acc[key] = null;
                }
                return acc;
            }

            const num = Number(trimmed);
            if (Number.isFinite(num) && (!hasPrev || num !== prevNumber)) {
                acc[key] = num;
            }
            return acc;
        }, {});

        const modsPayload = ABILITY_KEYS.reduce((acc, key) => {
            const raw = draft?.mods?.[key];
            const trimmed = raw === undefined || raw === null ? "" : String(raw).trim();
            const prev = previousMods[key];
            const hasPrev = prev !== undefined && prev !== null;
            const prevNumber = hasPrev ? Number(prev) : null;

            if (trimmed === "") {
                if (hasPrev) {
                    acc[key] = null;
                }
                return acc;
            }

            const num = Number(trimmed);
            if (Number.isFinite(num) && (!hasPrev || num !== prevNumber)) {
                acc[key] = num;
            }
            return acc;
        }, {});

        const payload = {
            arcana: draft.arcana?.trim() || "",
            level:
                draft.level === ""
                    ? null
                    : Number.isFinite(parsedLevel)
                    ? parsedLevel
                    : selectedDemon.level,
            alignment: draft.alignment?.trim() || "",
            personality: draft.personality?.trim() || "",
            description: draft.description || "",
            image: typeof draft.image === "string" ? draft.image.trim() : "",
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

        if (Object.keys(statsPayload).length > 0) {
            payload.stats = statsPayload;
        }
        if (Object.keys(modsPayload).length > 0) {
            payload.mods = modsPayload;
        }

        try {
            const updated = await ServerAdmin.demons.update(selectedDemon.id, payload);
            setDemons((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
            setDraft(createDemonDraft(updated));
            alert("Demon updated");
        } catch (err) {
            alert(formatError(err));
        }
    };

    const handleReset = () => {
        const demon = demons.find((entry) => Number(entry?.id) === Number(selectedId));
        setDraft(createDemonDraft(demon));
        setImageError("");
        if (imageInputRef.current) {
            imageInputRef.current.value = "";
        }
    };

    const handleCsvUpload = async (file) => {
        if (!file) return;
        try {
            const text = await file.text();
            const uploadWithConfirmation = async (confirmDeletes = false) => {
                const report = await ServerAdmin.demons.uploadCsv(text, { confirmDeletes });
                setCsvReport(report);

                if (report?.requiresConfirmation && !confirmDeletes) {
                    const pending = Array.isArray(report.pendingDeletes) ? report.pendingDeletes : [];
                    const preview = pending.slice(0, 5).map((entry) => entry.name || `ID ${entry.id}`);
                    const more = pending.length > preview.length ? pending.length - preview.length : 0;
                    const messageLines = [
                        `${pending.length} demon${pending.length === 1 ? " is" : "s are"} missing from the CSV and will be removed.`,
                    ];
                    if (preview.length > 0) {
                        messageLines.push(`Examples: ${preview.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`);
                    }
                    messageLines.push("Continue and remove them?");
                    if (window.confirm(messageLines.join("\n"))) {
                        return uploadWithConfirmation(true);
                    }
                    return report;
                }

                if (report?.wrote) {
                    await load();
                }

                const totalChanges =
                    (report?.demonsUpdated || 0) +
                    (report?.demonsCreated || 0) +
                    (report?.demonsDeleted || 0);
                if (totalChanges > 0 && window.confirm("Testing - passed, push to database?")) {
                    const sync = await ServerAdmin.demons.sync();
                    setCsvReport((prev) => ({ ...(prev || {}), synced: sync?.count ?? 0 }));
                }

                return report;
            };

            await uploadWithConfirmation(false);
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
                            <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                                <div
                                    style={{
                                        width: 180,
                                        height: 180,
                                        borderRadius: 12,
                                        background: "#111",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        overflow: "hidden",
                                        flex: "0 0 auto",
                                    }}
                                >
                                    {draft?.image ? (
                                        <DemonImage
                                            src={draft.image}
                                            personaSlug={selectedDemon.slug || selectedDemon.query}
                                            alt={`${selectedDemon.name || "Demon"} artwork`}
                                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                        />
                                    ) : (
                                        <span className="text-muted text-small">No image</span>
                                    )}
                                </div>
                                <div className="col" style={{ gap: 8, flex: "1 1 220px" }}>
                                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                        <button type="button" className="btn ghost btn-small" onClick={handleImageUploadClick}>
                                            Upload image
                                        </button>
                                        {draft?.image && (
                                            <button type="button" className="btn ghost btn-small" onClick={handleImageRemove}>
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Paste image URL…"
                                        value={draft?.image || ""}
                                        onChange={(e) => {
                                            handleDraftChange({ image: e.target.value });
                                            setImageError("");
                                        }}
                                    />
                                    {imageError && <div className="text-error text-small">{imageError}</div>}
                                </div>
                            </div>
                            <input
                                ref={imageInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={handleImageUpload}
                            />
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
                            <div className="col" style={{ gap: 8 }}>
                                <strong>Ability scores</strong>
                                <div
                                    className="grid"
                                    style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
                                >
                                    {ABILITY_DEFS.map((ability) => (
                                        <label key={ability.key} className="col">
                                            <span className="text-muted text-small">{ability.key} score</span>
                                            <input
                                                type="number"
                                                value={draft?.stats?.[ability.key] ?? ""}
                                                onChange={(e) => handleStatChange(ability.key, e.target.value)}
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="col" style={{ gap: 8 }}>
                                <strong>Ability modifiers</strong>
                                <div
                                    className="grid"
                                    style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
                                >
                                    {ABILITY_DEFS.map((ability) => (
                                        <label key={ability.key} className="col">
                                            <span className="text-muted text-small">{ability.key} modifier</span>
                                            <input
                                                type="number"
                                                value={draft?.mods?.[ability.key] ?? ""}
                                                onChange={(e) => handleModChange(ability.key, e.target.value)}
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="col" style={{ gap: 8 }}>
                                <strong>Resistances</strong>
                                <div
                                    className="grid"
                                    style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
                                >
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
                    {typeof csvReport.demonsCreated === "number" && (
                        <div>Demons added: {csvReport.demonsCreated}</div>
                    )}
                    {typeof csvReport.demonsDeleted === "number" && (
                        <div>Demons removed: {csvReport.demonsDeleted}</div>
                    )}
                    {Array.isArray(csvReport.pendingDeletes) && csvReport.pendingDeletes.length > 0 && !csvReport.demonsDeleted && (
                        <div className="alert warn">
                            {csvReport.requiresConfirmation
                                ? `${csvReport.pendingDeletes.length} demon${csvReport.pendingDeletes.length === 1 ? " is" : "s are"} missing from the CSV. Confirm the upload again to remove them.`
                                : `${csvReport.pendingDeletes.length} demon${csvReport.pendingDeletes.length === 1 ? " was" : "s were"} missing from the CSV.`}
                        </div>
                    )}
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
            case "items":
                return <ItemsAdminPanel />;
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
