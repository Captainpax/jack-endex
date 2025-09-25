import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Games, Items } from "../api";
import MathField from "./MathField";
import { formatHealingEffect, isGearCategory } from "../utils/items";

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

export { ItemsTab, GearTab };

