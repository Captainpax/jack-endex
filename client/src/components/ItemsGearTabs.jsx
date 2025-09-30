import React, { useCallback, useEffect, useMemo, useState, useId, useRef } from "react";

import { Games, Items } from "../api";
import MathField from "./MathField";
import {
    formatHealingEffect,
    formatTriggerEffect,
    isConsumableType,
    isGearCategory,
} from "../utils/items";
import { idsMatch } from "../utils/ids";

const INVENTORY_SORT_OPTIONS = [
    { value: "name", label: "Name" },
    { value: "type", label: "Type" },
    { value: "quantity", label: "Quantity" },
    { value: "recent", label: "Recently updated" },
];

function getItemTimestamp(item) {
    if (!item || typeof item !== "object") return 0;
    const raw = item.updatedAt || item.createdAt;
    const timestamp = raw ? Date.parse(raw) : NaN;
    if (Number.isFinite(timestamp)) return timestamp;
    const numericId = Number.parseInt(String(item.id).replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(numericId) ? numericId : 0;
}

function normalizePlayerLabel(player) {
    if (!player) return "Unnamed Player";
    if (player.character?.name) {
        const name = player.character.name.trim();
        if (name) return name;
    }
    if (player.username) {
        return player.username.trim();
    }
    if (player.userId) {
        return `Player ${player.userId.slice(0, 6)}`;
    }
    return "Unnamed Player";
}

function generateLocalId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeEffectDraft(effect = {}) {
    return {
        id: effect.id || generateLocalId(),
        kind: effect.kind || "",
        trigger: effect.trigger || "",
        value: effect.value || "",
        notes: effect.notes || "",
        interval:
            effect.interval === undefined || effect.interval === null
                ? ""
                : String(effect.interval),
        duration:
            effect.duration === undefined || effect.duration === null
                ? ""
                : String(effect.duration),
    };
}

function prepareEffectsForSave(effects) {
    if (!Array.isArray(effects)) return [];
    const seen = new Set();
    const output = [];
    for (const raw of effects) {
        if (!raw) continue;
        const draft = makeEffectDraft(raw);
        const intervalNum = Number(draft.interval);
        const durationNum = Number(draft.duration);
        const interval = Number.isFinite(intervalNum) && intervalNum > 0 ? Math.round(intervalNum) : null;
        const duration = Number.isFinite(durationNum) && durationNum > 0 ? Math.round(durationNum) : null;
        const normalized = {
            ...(draft.id ? { id: draft.id } : {}),
            kind: draft.kind.trim(),
            trigger: draft.trigger.trim(),
            value: draft.value.trim(),
            notes: draft.notes.trim(),
            ...(interval ? { interval } : {}),
            ...(duration ? { duration } : {}),
        };
        if (
            !normalized.kind &&
            !normalized.trigger &&
            !normalized.value &&
            !normalized.notes &&
            !interval &&
            !duration
        ) {
            continue;
        }
        const key =
            normalized.id ||
            `${normalized.kind}|${normalized.trigger}|${normalized.value}|${interval || ""}|${duration || ""}|${normalized.notes}`;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        output.push(normalized);
    }
    return output;
}

function parseTagInput(value) {
    if (Array.isArray(value)) {
        return value
            .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
            .filter(Boolean)
            .slice(0, 12);
    }
    if (typeof value !== "string") return [];
    return value
        .split(/[,#]/g)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12);
}

function mapEffectDetails(effects, prefix) {
    if (!Array.isArray(effects)) return [];
    return effects
        .map((effect, index) => {
            const label = formatTriggerEffect(effect);
            if (!label) return null;
            const key =
                effect.id ||
                `${prefix}-${effect.kind || "effect"}-${effect.trigger || index}-${effect.value || index}-${index}`;
            return { key, label };
        })
        .filter(Boolean);
}

function useItemFavorites(gameId, userId) {
    const storageKey = useMemo(() => {
        if (!gameId || !userId) return null;
        return `jack-endex:favorites:${gameId}:${userId}`;
    }, [gameId, userId]);
    const [favorites, setFavorites] = useState(() => new Set());

    useEffect(() => {
        if (typeof window === "undefined" || !storageKey) {
            setFavorites(new Set());
            return;
        }
        try {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) {
                setFavorites(new Set());
                return;
            }
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                setFavorites(new Set(parsed.filter((id) => typeof id === "string" && id)));
            } else {
                setFavorites(new Set());
            }
        } catch (err) {
            console.warn("Failed to read item favorites", err);
            setFavorites(new Set());
        }
    }, [storageKey]);

    const persist = useCallback(
        (next) => {
            if (typeof window === "undefined" || !storageKey) return;
            try {
                window.localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
            } catch (err) {
                console.warn("Failed to persist item favorites", err);
            }
        },
        [storageKey],
    );

    const toggleFavorite = useCallback(
        (itemId) => {
            if (!itemId) return;
            setFavorites((prev) => {
                const next = new Set(prev);
                if (next.has(itemId)) {
                    next.delete(itemId);
                } else {
                    next.add(itemId);
                }
                persist(next);
                return next;
            });
        },
        [persist],
    );

    const isFavorite = useCallback((itemId) => favorites.has(itemId), [favorites]);

    const clearMissing = useCallback(
        (validIds) => {
            setFavorites((prev) => {
                const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
                if (next.size !== prev.size) {
                    persist(next);
                }
                return next;
            });
        },
        [persist],
    );

    return { favorites, toggleFavorite, isFavorite, clearMissing };
}

function EffectEditor({ title = "Trigger effects", effects, onChange, disabled }) {
    const handleUpdate = useCallback(
        (index, patch) => {
            if (!onChange) return;
            const list = Array.isArray(effects) ? effects : [];
            const next = list.map((effect, idx) => (idx === index ? { ...effect, ...patch } : effect));
            onChange(next);
        },
        [effects, onChange],
    );

    const handleRemove = useCallback(
        (index) => {
            if (!onChange) return;
            const list = Array.isArray(effects) ? effects : [];
            const next = list.filter((_, idx) => idx !== index);
            onChange(next);
        },
        [effects, onChange],
    );

    const handleAdd = useCallback(() => {
        if (!onChange) return;
        const list = Array.isArray(effects) ? effects : [];
        onChange([...list, makeEffectDraft()]);
    }, [effects, onChange]);

    const list = Array.isArray(effects) ? effects : [];

    return (
        <div className="item-effect-editor">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span className="text-small" style={{ fontWeight: 600 }}>
                    {title}
                </span>
                <button
                    type="button"
                    className="btn ghost btn-small"
                    onClick={handleAdd}
                    disabled={disabled}
                >
                    Add effect
                </button>
            </div>
            {list.length === 0 ? (
                <p className="text-muted text-small" style={{ marginTop: 4 }}>
                    No over-time effects configured.
                </p>
            ) : (
                <div className="item-effect-editor__list">
                    {list.map((effect, index) => (
                        <div key={effect.id || index}>
                            <div className="row wrap" style={{ gap: 8 }}>
                                <label className="field" style={{ flex: "1 1 160px", minWidth: 140 }}>
                                    <span className="field__label">Effect</span>
                                    <input
                                        value={effect.kind || ""}
                                        onChange={(e) => handleUpdate(index, { kind: e.target.value })}
                                        disabled={disabled}
                                        placeholder="Regeneration, Poison…"
                                    />
                                </label>
                                <label className="field" style={{ flex: "1 1 160px", minWidth: 140 }}>
                                    <span className="field__label">Trigger</span>
                                    <input
                                        value={effect.trigger || ""}
                                        onChange={(e) => handleUpdate(index, { trigger: e.target.value })}
                                        disabled={disabled}
                                        placeholder="Start of turn"
                                    />
                                </label>
                                <label className="field" style={{ width: 120 }}>
                                    <span className="field__label">Interval</span>
                                    <input
                                        type="number"
                                        min={0}
                                        value={effect.interval}
                                        onChange={(e) => handleUpdate(index, { interval: e.target.value })}
                                        disabled={disabled}
                                        placeholder="Turns"
                                    />
                                </label>
                                <label className="field" style={{ width: 120 }}>
                                    <span className="field__label">Duration</span>
                                    <input
                                        type="number"
                                        min={0}
                                        value={effect.duration}
                                        onChange={(e) => handleUpdate(index, { duration: e.target.value })}
                                        disabled={disabled}
                                        placeholder="Rounds"
                                    />
                                </label>
                            </div>
                            <label className="field" style={{ marginTop: 8 }}>
                                <span className="field__label">Effect value</span>
                                <input
                                    value={effect.value || ""}
                                    onChange={(e) => handleUpdate(index, { value: e.target.value })}
                                    disabled={disabled}
                                    placeholder="5 HP per turn"
                                />
                            </label>
                            <label className="field" style={{ marginTop: 8 }}>
                                <span className="field__label">Notes</span>
                                <textarea
                                    rows={2}
                                    value={effect.notes || ""}
                                    onChange={(e) => handleUpdate(index, { notes: e.target.value })}
                                    disabled={disabled}
                                    placeholder="Additional reminders or conditions"
                                />
                            </label>
                            <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
                                <button
                                    type="button"
                                    className="btn ghost btn-small"
                                    onClick={() => handleRemove(index)}
                                    disabled={disabled}
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function ItemsTab({ game, me, onUpdate, realtime }) {
    const [premade, setPremade] = useState([]);
    const [form, setForm] = useState({ name: "", type: "", desc: "", libraryItemId: "", tags: [], effects: [] });
    const [editing, setEditing] = useState(null);
    const [busySave, setBusySave] = useState(false);
    const [busyRow, setBusyRow] = useState(null);
    const [busyRowAction, setBusyRowAction] = useState(null);
    const [selectedPlayerId, setSelectedPlayerId] = useState("");
    const [giveBusyId, setGiveBusyId] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [sortMode, setSortMode] = useState(INVENTORY_SORT_OPTIONS[0]?.value || "name");
    const [favoritesOnly, setFavoritesOnly] = useState(false);

    const isDM = idsMatch(game.dmId, me.id);
    const canEdit = isDM || game.permissions?.canEditItems;

    const { favorites, toggleFavorite, isFavorite, clearMissing } = useItemFavorites(game.id, me.id);
    const tradeActions = realtime?.tradeActions || null;

    const libraryCatalog = useMemo(() => {
        const map = new Map();
        for (const item of premade) {
            if (item?.id) map.set(item.id, item);
        }
        return map;
    }, [premade]);

    const resetForm = useCallback(() => {
        setEditing(null);
        setForm({ name: "", type: "", desc: "", libraryItemId: "", tags: [], effects: [] });
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
                    next.tags = parseTagInput(linked.tags);
                    next.effects = Array.isArray(linked.effects)
                        ? linked.effects.map((effect) => makeEffectDraft(effect))
                        : [];
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
        setSearchTerm("");
        setSortMode(INVENTORY_SORT_OPTIONS[0]?.value || "name");
        setFavoritesOnly(false);
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
                tags: parseTagInput(source.tags),
                effects: prepareEffectsForSave(source.effects),
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
                label: normalizePlayerLabel(p),
            })),
        [players],
    );

    const tradeTargets = useMemo(
        () =>
            players
                .filter((p) => p && typeof p.userId === "string" && p.userId)
                .map((p) => ({ id: p.userId, label: normalizePlayerLabel(p) })),
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
        return normalizePlayerLabel(selectedPlayer);
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
                    <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                        <input
                            placeholder="Tags (comma separated)"
                            value={form.tags.join(", ")}
                            onChange={(e) => setForm({ ...form, tags: parseTagInput(e.target.value) })}
                            style={{ flex: 1, minWidth: 220 }}
                            disabled={!canEdit}
                        />
                    </div>
                    <EffectEditor
                        title="Trigger over-time effects"
                        effects={form.effects}
                        onChange={(next) => setForm((prev) => ({ ...prev, effects: next }))}
                        disabled={!canEdit || busySave}
                    />
                    {formLinked ? (
                        <div className="text-muted text-small" style={{ marginTop: -4 }}>
                            Linked to <b>{formLinked.name}</b>
                            {formLinked.type ? ` · ${formLinked.type}` : ""}
                            {formLinkedEffect && <div>Effect: {formLinkedEffect}</div>}
                            {Array.isArray(formLinked.effects) && formLinked.effects.length > 0 && (
                                <div>
                                    Triggers:
                                    <ul className="item-effect-summary">
                                        {formLinked.effects.map((effect) => (
                                            <li key={effect.id || effect.trigger}>
                                                {formatTriggerEffect(effect)}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
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
                            const tags = parseTagInput(it.tags);
                            const combinedEffects = [
                                ...(Array.isArray(linked?.effects) ? linked.effects : []),
                                ...(Array.isArray(it.effects) ? it.effects : []),
                            ];
                            const effectSummaries = combinedEffects
                                .map((effect, idx) => ({
                                    key:
                                        effect.id ||
                                        `${it.id || "custom"}-effect-${effect.kind || "effect"}-${effect.trigger || idx}-${idx}`,
                                    label: formatTriggerEffect(effect),
                                }))
                                .filter((entry) => entry.label);
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
                                        {tags.length > 0 && (
                                            <div className="item-card__tags" style={{ marginTop: 4 }}>
                                                {tags.map((tag) => (
                                                    <span key={`${it.id}-tag-${tag}`} className="item-tag">
                                                        #{tag}
                                                    </span>
                                                ))}
                                            </div>
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
                                        {effectSummaries.length > 0 && (
                                            <div className="item-card__effects" style={{ marginTop: 4 }}>
                                                <span className="item-card__section-title text-small">
                                                    Trigger effects
                                                </span>
                                                <ul className="item-card__effect-list">
                                                    {effectSummaries.map((entry) => (
                                                        <li key={entry.key}>{entry.label}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
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
                                                            tags: parseTagInput(it.tags),
                                                            effects: Array.isArray(it.effects)
                                                                ? it.effects.map((effect) => makeEffectDraft(effect))
                                                                : [],
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
                {players.length > 0 && (
                    <div className="item-filter-bar">
                        <div className="item-filter-bar__field">
                            <input
                                id="player-inventory-search"
                                type="search"
                                placeholder="Search items by name, type, tag, or effect"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                autoComplete="off"
                            />
                        </div>
                        <div className="item-filter-bar__controls">
                            <label className="item-filter-bar__control">
                                <span className="text-small">Sort by</span>
                                <select
                                    value={sortMode}
                                    onChange={(event) => setSortMode(event.target.value)}
                                >
                                    {INVENTORY_SORT_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="item-filter-bar__control item-filter-bar__favorites">
                                <input
                                    type="checkbox"
                                    checked={favoritesOnly}
                                    onChange={(event) => setFavoritesOnly(event.target.checked)}
                                />
                                <span>Favorites only</span>
                            </label>
                        </div>
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
                    <div className="item-card-grid">
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
                                        tradeActions={tradeActions}
                                        tradeTargets={tradeTargets}
                                        searchTerm={searchTerm}
                                        sortMode={sortMode}
                                        favoritesOnly={favoritesOnly}
                                        favorites={favorites}
                                        toggleFavorite={toggleFavorite}
                                        isFavorite={isFavorite}
                                        clearFavorites={clearMissing}
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

function PlayerInventoryCard({
    player,
    canEdit,
    gameId,
    onUpdate,
    libraryItems,
    libraryCatalog,
    isDM,
    currentUserId,
    tradeActions,
    tradeTargets,
    searchTerm,
    sortMode,
    favoritesOnly,
    favorites,
    toggleFavorite,
    isFavorite,
    clearFavorites,
}) {
    const [form, setForm] = useState({
        name: "",
        type: "",
        desc: "",
        amount: "1",
        libraryItemId: "",
        tags: [],
        effects: [],
    });
    const [editing, setEditing] = useState(null);
    const [busySave, setBusySave] = useState(false);
    const [busyRow, setBusyRow] = useState(null);
    const [busyRowAction, setBusyRowAction] = useState(null);
    const [busyUse, setBusyUse] = useState(null);
    const [maccaDraft, setMaccaDraft] = useState("");
    const [maccaBusy, setMaccaBusy] = useState(false);
    const [maccaNotice, setMaccaNotice] = useState(null);

    const inventory = useMemo(
        () => (Array.isArray(player.inventory) ? player.inventory : []),
        [player.inventory],
    );
    const playerId = player?.userId || "";
    const available = Array.isArray(libraryItems) ? libraryItems : [];
    const libraryMap = useMemo(() => {
        if (libraryCatalog instanceof Map) {
            return libraryCatalog;
        }
        return new Map();
    }, [libraryCatalog]);

    const resetForm = useCallback(() => {
        setEditing(null);
        setForm({ name: "", type: "", desc: "", amount: "1", libraryItemId: "", tags: [], effects: [] });
    }, []);

    useEffect(() => {
        resetForm();
        setMaccaDraft("");
        setMaccaBusy(false);
        setMaccaNotice(null);
    }, [playerId, resetForm]);

    const parseAmount = useCallback((value, fallback) => {
        if (value === undefined || value === null || value === "") return fallback;
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        const rounded = Math.round(num);
        return rounded < 0 ? 0 : rounded;
    }, []);

    const formLinked = form.libraryItemId ? libraryMap.get(form.libraryItemId) : null;
    const formLinkedEffect = formLinked ? formatHealingEffect(formLinked.healing) : "";
    const formLinkedTriggers = Array.isArray(formLinked?.effects) ? formLinked.effects : [];

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
                    next.tags = parseTagInput(linked.tags);
                    next.effects = Array.isArray(linked.effects)
                        ? linked.effects.map((effect) => makeEffectDraft(effect))
                        : [];
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
            tags: parseTagInput(form.tags),
            effects: prepareEffectsForSave(form.effects),
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
            tags: parseTagInput(item.tags),
            effects: Array.isArray(item.effects)
                ? item.effects.map((effect) => makeEffectDraft(effect))
                : [],
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

    const canUseItems = isDM || (playerId && currentUserId === playerId);

    const handleUse = useCallback(
        async (item) => {
            if (!canUseItems || !item?.id || !playerId) return;
            try {
                setBusyUse(item.id);
                const result = await Games.consumePlayerItem(gameId, playerId, item.id);
                const headline = `Used ${item.name || "item"}.`;
                const messageParts = [headline];

                if (result?.applied) {
                    const { applied, remaining } = result;
                    const appliedParts = [];
                    if (applied.revived) appliedParts.push("Revived");
                    if (
                        typeof applied.hpBefore === "number" &&
                        typeof applied.hpAfter === "number" &&
                        applied.hpAfter !== applied.hpBefore
                    ) {
                        appliedParts.push(`HP ${applied.hpBefore} → ${applied.hpAfter}`);
                    }
                    if (
                        typeof applied.mpBefore === "number" &&
                        typeof applied.mpAfter === "number" &&
                        applied.mpAfter !== applied.mpBefore
                    ) {
                        appliedParts.push(`MP ${applied.mpBefore} → ${applied.mpAfter}`);
                    }
                    if (typeof remaining === "number") {
                        appliedParts.push(`Remaining: ${remaining}`);
                    }
                    if (appliedParts.length > 0) {
                        messageParts.push(appliedParts.join(", "));
                    }
                }

                if (result?.message) {
                    messageParts.push(result.message);
                } else if (result?.notice === "manual_update_required") {
                    messageParts.push("No effect found. Please update the status manually.");
                }

                if (Array.isArray(result?.effects) && result.effects.length > 0) {
                    const effectLines = result.effects
                        .map((effect) => formatTriggerEffect(effect))
                        .filter(Boolean);
                    if (effectLines.length > 0) {
                        messageParts.push([
                            "Ongoing effects:",
                            ...effectLines.map((line) => `• ${line}`),
                        ].join("\n"));
                    }
                }

                alert(messageParts.join("\n\n"));
                await onUpdate?.();
            } catch (e) {
                alert(e.message);
            } finally {
                setBusyUse(null);
            }
        },
        [canUseItems, gameId, onUpdate, playerId],
    );

    const parseMaccaAmount = useCallback(() => {
        if (maccaDraft === undefined || maccaDraft === null) return null;
        const trimmed = String(maccaDraft).trim();
        if (!trimmed) return null;
        const num = Number(trimmed);
        if (!Number.isFinite(num)) return null;
        const amount = Math.abs(Math.round(num));
        if (!Number.isFinite(amount) || amount <= 0) return null;
        return amount;
    }, [maccaDraft]);

    const handleMaccaAdjust = useCallback(
        async (mode) => {
            if (!isDM || !playerId) return;
            const amount = parseMaccaAmount();
            if (!amount) {
                setMaccaNotice({ type: "error", message: "Enter a positive amount" });
                return;
            }
            const delta = mode === "add" ? amount : -amount;
            try {
                setMaccaBusy(true);
                setMaccaNotice(null);
                const result = await Games.adjustPlayerMacca(gameId, playerId, delta);
                const total = result && typeof result.after === "number" ? result.after : null;
                setMaccaDraft("");
                if (total !== null) {
                    setMaccaNotice({
                        type: "success",
                        message: `Total macca: ${Number(total).toLocaleString()}`,
                    });
                } else {
                    setMaccaNotice({ type: "success", message: "Macca updated." });
                }
                await onUpdate?.();
            } catch (e) {
                setMaccaNotice({ type: "error", message: e.message || "Failed to adjust macca" });
            } finally {
                setMaccaBusy(false);
            }
        },
        [gameId, isDM, onUpdate, parseMaccaAmount, playerId],
    );

    const playerLabel = player.character?.name || `Player ${player.userId?.slice?.(0, 6) || ""}`;
    const subtitleParts = [];
    if (player.character?.profile?.class) subtitleParts.push(player.character.profile.class);
    if (player.character?.resources?.level) subtitleParts.push(`LV ${player.character.resources.level}`);
    const subtitle = subtitleParts.join(" · ");
    const maccaRaw = Number(player.character?.resources?.macca);
    const macca = Number.isFinite(maccaRaw) ? maccaRaw : 0;
    const maccaLabel = Number.isFinite(maccaRaw) ? macca.toLocaleString() : "0";

    const favoritesSet = useMemo(
        () => (favorites instanceof Set ? favorites : new Set()),
        [favorites],
    );

    const filteredTradeTargets = useMemo(() => {
        if (!Array.isArray(tradeTargets)) return [];
        return tradeTargets.filter((target) => target && target.id && target.id !== playerId);
    }, [playerId, tradeTargets]);

    const [tradeTargetId, setTradeTargetId] = useState(() => filteredTradeTargets[0]?.id || "");
    const [tradeFeedback, setTradeFeedback] = useState(null);

    useEffect(() => {
        setTradeFeedback(null);
        const firstId = filteredTradeTargets[0]?.id || "";
        setTradeTargetId((prev) => {
            if (!prev) return firstId;
            const exists = filteredTradeTargets.some((target) => target.id === prev);
            return exists ? prev : firstId;
        });
    }, [filteredTradeTargets]);

    useEffect(() => {
        if (typeof clearFavorites !== "function") return;
        const validIds = new Set(
            inventory
                .map((item) => (item && typeof item.id === "string" ? item.id : null))
                .filter(Boolean),
        );
        clearFavorites(validIds);
    }, [clearFavorites, inventory]);

    const processedItems = useMemo(() => {
        const normalizedSearch = (searchTerm || "").trim().toLowerCase();
        const checkFavorite =
            typeof isFavorite === "function"
                ? isFavorite
                : (itemId) => favoritesSet.has(itemId);
        const entries = inventory
            .filter((item) => item && typeof item === "object")
            .map((item) => {
                const amount = parseAmount(item.amount, 0);
                const linked = item.libraryItemId ? libraryMap.get(item.libraryItemId) : null;
                const linkedEffects = Array.isArray(linked?.effects) ? linked.effects : [];
                const entryEffects = Array.isArray(item.effects) ? item.effects : [];
                const combinedEffects = [...linkedEffects, ...entryEffects];
                const healingLabel = linked ? formatHealingEffect(linked.healing) : "";
                const ownTags = parseTagInput(item.tags);
                const libraryTags = parseTagInput(linked?.tags);
                const tagSet = new Set([...(ownTags || []), ...(libraryTags || [])]);
                const tags = Array.from(tagSet);
                const libraryEffectDetails = mapEffectDetails(linkedEffects, "library");
                const ownEffectDetails = mapEffectDetails(entryEffects, "item");
                const effectDetails = [...libraryEffectDetails, ...ownEffectDetails];
                const effectSummaries = effectDetails.map((detail) => detail.label);
                const searchBlob = [
                    item.name,
                    item.type,
                    item.desc,
                    healingLabel,
                    linked?.name,
                    linked?.type,
                    ...tags,
                    ...effectSummaries,
                ]
                    .filter(Boolean)
                    .join("\n")
                    .toLowerCase();
                return {
                    item,
                    amount,
                    linked,
                    missingLink: !!(item.libraryItemId && !linked),
                    combinedEffects,
                    effectSummaries,
                    effectDetails,
                    ownEffectDetails,
                    libraryEffectDetails,
                    healingLabel,
                    tags,
                    ownTags,
                    libraryTags,
                    searchBlob,
                    isFavorite: checkFavorite(item.id),
                    isConsumable: isConsumableType(item.type),
                };
            });

        let filtered = entries;
        if (favoritesOnly) {
            filtered = filtered.filter((entry) => entry.isFavorite);
        }
        if (normalizedSearch) {
            filtered = filtered.filter((entry) => entry.searchBlob.includes(normalizedSearch));
        }

        const collator = new Intl.Collator(undefined, { sensitivity: "base" });

        const sorted = filtered.slice().sort((a, b) => {
            if (sortMode === "type") {
                const typeCompare = collator.compare(a.item.type || "", b.item.type || "");
                if (typeCompare !== 0) return typeCompare;
                return collator.compare(a.item.name || "", b.item.name || "");
            }
            if (sortMode === "quantity") {
                const diff = b.amount - a.amount;
                if (diff !== 0) return diff;
                return collator.compare(a.item.name || "", b.item.name || "");
            }
            if (sortMode === "recent") {
                const diff = getItemTimestamp(b.item) - getItemTimestamp(a.item);
                if (diff !== 0) return diff;
                return collator.compare(a.item.name || "", b.item.name || "");
            }
            return collator.compare(a.item.name || "", b.item.name || "");
        });

        return sorted;
    }, [favoritesOnly, favoritesSet, inventory, isFavorite, libraryMap, parseAmount, searchTerm, sortMode]);

    const selectedTradeTarget = useMemo(
        () => filteredTradeTargets.find((target) => target.id === tradeTargetId) || null,
        [filteredTradeTargets, tradeTargetId],
    );

    const tradeSelectId = `trade-target-${playerId || "player"}`;
    const totalItems = inventory.length;
    const hasFilteredItems = processedItems.length > 0;
    const [detailEntry, setDetailEntry] = useState(null);

    useEffect(() => {
        if (!detailEntry || typeof window === "undefined") return undefined;
        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                setDetailEntry(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [detailEntry]);

    const handleToggleFavorite = useCallback(
        (itemId) => {
            if (typeof toggleFavorite === "function" && itemId) {
                toggleFavorite(itemId);
            }
        },
        [toggleFavorite],
    );

    const handleStartTrade = useCallback(
        (item) => {
            if (!tradeActions?.start) {
                setTradeFeedback({ type: "error", message: "Trading is unavailable right now." });
                return;
            }
            if (!tradeTargetId) {
                setTradeFeedback({ type: "error", message: "Select a trade partner first." });
                return;
            }
            try {
                const note = item?.name ? `Proposing trade: ${item.name}` : undefined;
                tradeActions.start(tradeTargetId, note);
                const label = selectedTradeTarget?.label || "your partner";
                setTradeFeedback({
                    type: "success",
                    message: `Trade started with ${label}. Add items from the trade overlay to complete the offer.`,
                });
            } catch (err) {
                setTradeFeedback({ type: "error", message: err.message || "Failed to start trade." });
            }
        },
        [selectedTradeTarget?.label, tradeActions, tradeTargetId],
    );

    useEffect(() => {
        if (!tradeFeedback || typeof window === "undefined") return undefined;
        const timer = window.setTimeout(() => setTradeFeedback(null), 4000);
        return () => window.clearTimeout(timer);
    }, [tradeFeedback]);

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

            {isDM && (
                <>
                    <div
                        className="row"
                        style={{
                            gap: 8,
                            marginTop: 8,
                            flexWrap: "wrap",
                            alignItems: "flex-end",
                        }}
                    >
                        <label className="field" style={{ flex: "1 1 160px", minWidth: 160 }}>
                            <span className="field__label">Adjust macca</span>
                            <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                placeholder="Amount"
                                value={maccaDraft}
                                onChange={(e) => {
                                    setMaccaDraft(e.target.value);
                                    if (maccaNotice?.type === "error") {
                                        setMaccaNotice(null);
                                    }
                                }}
                                disabled={maccaBusy}
                                autoComplete="off"
                            />
                        </label>
                        <button
                            className="btn"
                            onClick={() => handleMaccaAdjust("add")}
                            disabled={!canEdit || maccaBusy}
                        >
                            {maccaBusy ? "…" : "Add"}
                        </button>
                        <button
                            className="btn secondary"
                            onClick={() => handleMaccaAdjust("remove")}
                            disabled={!canEdit || maccaBusy}
                        >
                            {maccaBusy ? "…" : "Remove"}
                        </button>
                    </div>
                    {maccaNotice && (
                        <div
                            className={`text-small${
                                maccaNotice.type === "error" ? " text-error" : " text-muted"
                            }`}
                            style={{ marginTop: 4 }}
                        >
                            {maccaNotice.message}
                        </div>
                    )}
                </>
            )}

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
                    {formLinkedTriggers.length > 0 && (
                        <div>
                            Triggers:
                            <ul className="item-effect-summary">
                                {formLinkedTriggers.map((effect) => (
                                    <li key={effect.id || effect.trigger}>
                                        {formatTriggerEffect(effect)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
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
                <input
                    placeholder="Tags (comma separated)"
                    value={form.tags.join(", ")}
                    onChange={(e) => setForm({ ...form, tags: parseTagInput(e.target.value) })}
                    style={{ flex: 1, minWidth: 200 }}
                    disabled={!canEdit}
                />
            </div>
            <EffectEditor
                effects={form.effects}
                onChange={(next) => setForm((prev) => ({ ...prev, effects: next }))}
                disabled={!canEdit || busySave}
            />
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

            {filteredTradeTargets.length > 0 && (
                <div className="item-trade-bar">
                    <label className="item-trade-bar__label" htmlFor={tradeSelectId}>
                        Trade with
                    </label>
                    <select
                        id={tradeSelectId}
                        value={tradeTargetId}
                        onChange={(event) => setTradeTargetId(event.target.value)}
                    >
                        {filteredTradeTargets.map((target) => (
                            <option key={target.id} value={target.id}>
                                {target.label}
                            </option>
                        ))}
                    </select>
                    {tradeFeedback && (
                        <div
                            className={`item-trade-bar__notice${
                                tradeFeedback.type === "error" ? " is-error" : " is-success"
                            }`}
                        >
                            {tradeFeedback.message}
                        </div>
                    )}
                </div>
            )}

            <div className="item-card-grid" style={{ marginTop: 16 }}>
                {processedItems.map((entry) => {
                    const {
                        item,
                        amount,
                        linked,
                        missingLink,
                        combinedEffects,
                        effectDetails,
                        effectSummaries,
                        healingLabel,
                        tags,
                        isFavorite: isFavorited,
                        isConsumable,
                    } = entry;
                    const itemId = item.id;
                    const rowBusy = busyRow === itemId;
                    const unlinking = rowBusy && busyRowAction === "unlink";
                    const removing = rowBusy && busyRowAction === "remove";
                    const useAllowed =
                        canUseItems && amount > 0 && (isConsumable || healingLabel || combinedEffects.length > 0);
                    const tradeAllowed = filteredTradeTargets.length > 0 && !!tradeActions?.start;
                    const tooltipParts = [item.desc, healingLabel, ...(effectSummaries || [])].filter(Boolean);
                    const tooltip = tooltipParts.join("\n\n");
                    const cardClassName = `item-card${isFavorited ? " is-favorite" : ""}`;
                    const amountLabel = amount > 1 ? `x${amount}` : "x1";

                    return (
                        <div
                            key={itemId || item.name}
                            className={cardClassName}
                            title={tooltip || undefined}
                            role="button"
                            tabIndex={0}
                            aria-haspopup="dialog"
                            onClick={() => setDetailEntry(entry)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setDetailEntry(entry);
                                }
                            }}
                        >
                            <div className="item-card__header">
                                <div className="item-card__title-group">
                                    <div className="item-card__title">{item.name || "Unnamed item"}</div>
                                    <div className="item-card__meta">
                                        {item.type && <span className="pill">{item.type}</span>}
                                        <span className="pill light">{amountLabel}</span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className={`favorite-toggle${isFavorited ? " is-active" : ""}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        handleToggleFavorite(itemId);
                                    }}
                                    aria-pressed={isFavorited}
                                    title={isFavorited ? "Remove from favorites" : "Add to favorites"}
                                >
                                    ★
                                </button>
                            </div>
                            {item.desc && <div className="item-card__desc">{item.desc}</div>}
                            {tags.length > 0 && (
                                <div className="item-card__tags">
                                    {tags.map((tag) => (
                                        <span key={`${itemId}-tag-${tag}`} className="item-tag">
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {linked ? (
                                <div className="item-card__linked text-small">
                                    Linked to <b>{linked.name}</b>
                                    {linked.type ? ` · ${linked.type}` : ""}
                                </div>
                            ) : missingLink ? (
                                <div className="item-card__warning text-small warn">
                                    Linked premade item not found.
                                </div>
                            ) : null}
                            {healingLabel && (
                                <div className="item-card__effect text-small">{healingLabel}</div>
                            )}
                            {effectDetails.length > 0 && (
                                <div className="item-card__effects">
                                    <span className="item-card__section-title text-small">Trigger effects</span>
                                    <ul className="item-card__effect-list">
                                        {effectDetails.map((effect) => (
                                            <li key={effect.key}>{effect.label}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div className="item-card__actions">
                                {useAllowed && (
                                    <button
                                        type="button"
                                        className="btn secondary btn-small"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleUse(item);
                                        }}
                                        disabled={busyUse === itemId}
                                    >
                                        {busyUse === itemId ? "Using…" : "Use"}
                                    </button>
                                )}
                                {tradeAllowed && (
                                    <button
                                        type="button"
                                        className="btn secondary btn-small"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleStartTrade(item);
                                        }}
                                        disabled={!tradeTargetId}
                                    >
                                        Trade
                                    </button>
                                )}
                                {canEdit && item.libraryItemId && (
                                    <button
                                        type="button"
                                        className="btn ghost btn-small"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            unlink(itemId);
                                        }}
                                        disabled={unlinking}
                                    >
                                        {unlinking ? "…" : "Unlink"}
                                    </button>
                                )}
                                {canEdit && (
                                    <>
                                        <button
                                            type="button"
                                            className="btn btn-small"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                startEdit(item);
                                            }}
                                            disabled={busySave}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-small"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                remove(itemId);
                                            }}
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
            </div>

            {detailEntry && (
                <ItemDetailDialog entry={detailEntry} onClose={() => setDetailEntry(null)} />
            )}

            {totalItems === 0 && (
                <div className="text-muted" style={{ marginTop: 8 }}>
                    No items in inventory.
                </div>
            )}
            {totalItems > 0 && !hasFilteredItems && (
                <div className="text-muted" style={{ marginTop: 8 }}>
                    No items match your filters.
                </div>
            )}
        </div>
    );
}

function ItemDetailDialog({ entry, onClose }) {
    const titleId = useId();
    const closeButtonRef = useRef(null);

    useEffect(() => {
        closeButtonRef.current?.focus();
    }, []);

    if (!entry) return null;

    const { item, linked, amount, healingLabel, tags, ownEffectDetails, libraryEffectDetails, libraryTags } = entry;
    const itemName = item?.name || linked?.name || "Unnamed item";
    const quantityLabel = amount > 1 ? `×${amount}` : "×1";
    const imageSrc = [item?.image, linked?.image]
        .map((src) => (typeof src === "string" ? src.trim() : ""))
        .find(Boolean);
    const imageAlt = `${itemName} illustration`;
    const showLibraryTags = Array.isArray(libraryTags) && libraryTags.length > 0;
    const showLibraryEffects = Array.isArray(libraryEffectDetails) && libraryEffectDetails.length > 0;
    const showOwnEffects = Array.isArray(ownEffectDetails) && ownEffectDetails.length > 0;
    const hasLibraryDescription = typeof linked?.desc === "string" && linked.desc;
    const hasLibraryHeader = linked?.name || linked?.type;
    const hasLibraryDetails = hasLibraryDescription || showLibraryTags || showLibraryEffects || item.libraryItemId;

    const handleClose = () => {
        onClose?.();
    };

    return (
        <div className="item-detail-overlay" role="presentation" onClick={handleClose}>
            <div
                className="item-detail-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onClick={(event) => event.stopPropagation()}
            >
                <header className="item-detail-modal__header">
                    <div className="item-detail-modal__title-group">
                        <h3 id={titleId}>{itemName}</h3>
                        <div className="item-detail-modal__meta">
                            {item?.type && <span className="pill">{item.type}</span>}
                            <span className="pill light">{quantityLabel}</span>
                            {linked?.name && (
                                <span className="pill ghost">Linked to {linked.name}</span>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn ghost btn-small"
                        onClick={handleClose}
                        ref={closeButtonRef}
                    >
                        Close
                    </button>
                </header>
                <div className="item-detail-modal__body">
                    {imageSrc && (
                        <div className="item-detail-modal__image">
                            <img src={imageSrc} alt={imageAlt} />
                        </div>
                    )}
                    <div className="item-detail-modal__section">
                        {item?.desc && <p className="item-detail-modal__description">{item.desc}</p>}
                        {healingLabel && <p className="item-detail-modal__healing text-small">{healingLabel}</p>}
                        {tags.length > 0 && (
                            <div className="item-detail-modal__tags">
                                <span className="item-detail-modal__section-title text-small">Tags</span>
                                <div className="item-detail-modal__tag-list">
                                    {tags.map((tag) => (
                                        <span key={`detail-tag-${tag}`} className="item-tag">
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {showOwnEffects && (
                            <div className="item-detail-modal__effects">
                                <span className="item-detail-modal__section-title text-small">Item trigger effects</span>
                                <ul>
                                    {ownEffectDetails.map((effect) => (
                                        <li key={`own-${effect.key}`}>{effect.label}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                    {hasLibraryDetails && (
                        <div className="item-detail-modal__section item-detail-modal__section--library">
                            <h4 className="item-detail-modal__section-heading">Linked library item</h4>
                            {hasLibraryHeader && (
                                <p className="item-detail-modal__library-title text-small">
                                    <strong>{linked?.name || "Unnamed entry"}</strong>
                                    {linked?.type ? ` · ${linked.type}` : ""}
                                </p>
                            )}
                            {item.libraryItemId && (
                                <p className="item-detail-modal__library-id text-small text-muted">
                                    ID: {item.libraryItemId}
                                </p>
                            )}
                            {hasLibraryDescription && (
                                <p className="item-detail-modal__library-desc text-small">{linked.desc}</p>
                            )}
                            {showLibraryTags && (
                                <div className="item-detail-modal__tags">
                                    <span className="item-detail-modal__section-title text-small">Library tags</span>
                                    <div className="item-detail-modal__tag-list">
                                        {libraryTags.map((tag) => (
                                            <span key={`library-tag-${tag}`} className="item-tag">
                                                #{tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {showLibraryEffects && (
                                <div className="item-detail-modal__effects">
                                    <span className="item-detail-modal__section-title text-small">Library trigger effects</span>
                                    <ul>
                                        {libraryEffectDetails.map((effect) => (
                                            <li key={`library-${effect.key}`}>{effect.label}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>
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

    const isDM = idsMatch(game.dmId, me.id);
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

