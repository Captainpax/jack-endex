import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Games } from "../api";
import {
    ABILITY_DEFS,
    ABILITY_KEY_SET,
    NEW_WORLD_SKILL_ID,
    SAVE_DEFS,
    WORLD_SKILL_SORT_OPTIONS,
    WORLD_SKILL_SORTERS,
    abilityModifier,
    clampNonNegative,
    formatModifier,
    makeCustomSkillId,
    normalizeCustomSkills,
    normalizeWorldSkillDefs,
    serializeCustomSkills,
    serializeSkills,
} from "../constants/gameData";
import { WORLD_SKILL_REFERENCE } from "../constants/referenceContent";
import { get } from "../utils/object";
import { deepClone, normalizeCharacter, normalizeSkills } from "../utils/character";
import { idsMatch } from "../utils/ids";

import MathField from "./MathField";
import { createEmptySkillViewPrefs, sanitizeSkillViewPrefs } from "../utils/skillViewPrefs";

function WorldSkillsTab({ game, me, onUpdate }) {
    const isDM = idsMatch(game.dmId, me.id);
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
    const viewPrefKey = useMemo(
        () => `world-skill-view:${game.id || "game"}:${me.id || "user"}`,
        [game.id, me.id]
    );
    const [viewPrefs, setViewPrefs] = useState(() => createEmptySkillViewPrefs());
    const [showHiddenSkills, setShowHiddenSkills] = useState(false);
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
            console.warn("Failed to load world skill view preferences", err);
            setViewPrefs(createEmptySkillViewPrefs());
        }
    }, [viewPrefKey]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem(viewPrefKey, JSON.stringify(viewPrefs));
        } catch (err) {
            console.warn("Failed to save world skill view preferences", err);
        }
    }, [viewPrefKey, viewPrefs]);

    useEffect(() => {
        setShowHiddenSkills(false);
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

    useEffect(() => {
        setViewPrefs((prev) => {
            if (!prev) return createEmptySkillViewPrefs();
            const validIds = new Set(worldSkills.map((skill) => skill.id));
            const favorites = prev.favorites.filter((id) => validIds.has(id));
            const hidden = prev.hidden.filter((id) => validIds.has(id));
            if (favorites.length === prev.favorites.length && hidden.length === prev.hidden.length) {
                return prev;
            }
            return { favorites, hidden };
        });
    }, [worldSkills]);

    const favoriteSkillIds = useMemo(() => new Set(viewPrefs.favorites), [viewPrefs.favorites]);
    const hiddenSkillIds = useMemo(() => new Set(viewPrefs.hidden), [viewPrefs.hidden]);

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
    }, [filteredSkills, favoriteSkillIds, hiddenSkillIds]);

    const displaySkills = useMemo(() => {
        if (!editingSkill) return visibleSkills;
        if (visibleSkills.some((skill) => skill.id === editingSkill.id)) {
            return visibleSkills;
        }
        return [editingSkill, ...visibleSkills];
    }, [editingSkill, visibleSkills]);

    const hiddenSkills = useMemo(
        () => worldSkills.filter((skill) => hiddenSkillIds.has(skill.id)),
        [hiddenSkillIds, worldSkills]
    );

    useEffect(() => {
        if (hiddenSkills.length === 0) {
            setShowHiddenSkills(false);
        }
    }, [hiddenSkills.length]);

    const hasSkillFilters = skillQuery.trim().length > 0 || skillSort !== "default";

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

    const allSkillRows = useMemo(() => {
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

    const skillRowById = useMemo(() => {
        const map = new Map();
        allSkillRows.forEach((row) => {
            if (row?.id) {
                map.set(row.id, row);
            }
        });
        return map;
    }, [allSkillRows]);

    const plannerSkillRows = useMemo(() => {
        return displaySkills
            .map((skill) => (skill ? skillRowById.get(skill.id) : null))
            .filter(Boolean);
    }, [displaySkills, skillRowById]);

    const {
        customSkillRows,
        spentSP,
        rankIssues,
    } = useMemo(() => {
        const rows = customSkills.map((skill) => {
            const ranks = clampNonNegative(skill.ranks);
            const miscRaw = Number(skill.misc);
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            const abilityMod = abilityMods[skill.ability] ?? 0;
            const total = abilityMod + ranks + misc;
            return { ...skill, ranks, misc, abilityMod, total };
        });
        const baseSpent = allSkillRows.reduce((sum, row) => sum + row.ranks, 0);
        const extraSpent = rows.reduce((sum, row) => sum + row.ranks, 0);
        const allIssues = allSkillRows
            .filter((row) => row.ranks > maxSkillRank)
            .map((row) => row.label)
            .concat(rows.filter((row) => row.ranks > maxSkillRank).map((row) => row.label));
        return {
            customSkillRows: rows,
            spentSP: baseSpent + extraSpent,
            rankIssues: allIssues,
        };
    }, [abilityMods, allSkillRows, customSkills, maxSkillRank]);

    const overSpent = spentSP > availableSP;

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
            <div className="card world-skill-reference">
                <div className="world-skill-reference__header">
                    <div>
                        <h3>World skill rules</h3>
                        <p className="text-muted text-small">
                            Summarised from the Character Creation and Battle Math reference docs.
                        </p>
                    </div>
                </div>
                <p className="text-small">{WORLD_SKILL_REFERENCE.summary}</p>
                <div className="world-skill-reference__grid">
                    {WORLD_SKILL_REFERENCE.formulas.map((entry) => (
                        <div key={entry.label} className="world-skill-reference__formula">
                            <span className="text-small">{entry.label}</span>
                            <code>{entry.formula}</code>
                        </div>
                    ))}
                </div>
                <div className="world-skill-reference__callouts">
                    <h4>Guidelines</h4>
                    <ul>
                        {WORLD_SKILL_REFERENCE.guidelines.map((tip, index) => (
                            <li key={index}>{tip}</li>
                        ))}
                    </ul>
                </div>
                {WORLD_SKILL_REFERENCE.disciplines?.length > 0 && (
                    <div className="world-skill-reference__abilities">
                        <h4>Core disciplines</h4>
                        <div className="world-skill-reference__abilities-grid">
                            {WORLD_SKILL_REFERENCE.disciplines.map((group) => (
                                <div
                                    key={group.ability}
                                    className="world-skill-reference__ability"
                                >
                                    <div className="world-skill-reference__ability-header">
                                        <span className="pill light">{group.ability}</span>
                                        <strong>{group.label}</strong>
                                    </div>
                                    {group.summary && (
                                        <p className="text-muted text-small">
                                            {group.summary}
                                        </p>
                                    )}
                                    <ul>
                                        {group.skills.map((skill) => (
                                            <li key={skill.key}>
                                                <strong>{skill.label}</strong>
                                                <span className="text-small">
                                                    {skill.summary}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className="world-skill-reference__callouts">
                    <h4>Table tips</h4>
                    <ul>
                        {WORLD_SKILL_REFERENCE.tips.map((tip, index) => (
                            <li key={index}>{tip}</li>
                        ))}
                    </ul>
                </div>
            </div>
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
                            const isFavorite = favoriteSkillIds.has(skill.id);
                            return (
                                <div
                                    key={skill.id}
                                    className={`world-skill-card${isEditing ? " is-editing" : ""}${
                                        isFavorite ? " is-favorite" : ""
                                    }`}
                                >
                                    <div className="world-skill-card__header">
                                        <span className="world-skill-card__badge">{skill.ability}</span>
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
                                                disabled={skillRowBusy === skill.id || skillBusy || isEditing}
                                                aria-label={`Hide ${skill.label}`}
                                                title="Hide this skill from the grid"
                                            >
                                                Hide
                                            </button>
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
                                                {skill.ability}
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
                            Hidden skills stay tucked away until you restore them.
                        </p>
                    )}
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

                        {!isDM && (
                            <div className="world-skill-manager__tools world-skill-planner__tools">
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
                                {hasSkillFilters && (
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
                        )}

                        {worldSkills.length === 0 ? (
                            <div className="text-muted">
                                No world skills are configured. Add entries above to begin planning ranks.
                            </div>
                        ) : plannerSkillRows.length === 0 ? (
                            <div className="text-muted text-small">
                                {hasSkillFilters
                                    ? "No skills match your filters."
                                    : "Everything is hidden. Use “Show hidden” to bring skills back."}
                            </div>
                        ) : (
                            <div className="world-skill-grid world-skill-grid--planner">
                                {plannerSkillRows.map((row) => {
                                    const abilityInfo = abilityDetails[row.ability] || null;
                                    const isFavorite = favoriteSkillIds.has(row.id);
                                    const rowKey = row.id || row.key || row.label;
                                    return (
                                        <div
                                            key={rowKey}
                                            className={`world-skill-card world-skill-rank-card${
                                                isFavorite ? " is-favorite" : ""
                                            }`}
                                        >
                                            <div className="world-skill-card__header">
                                                <span className="world-skill-card__badge">{row.ability}</span>
                                                <div className="skill-card__toolbar">
                                                    <button
                                                        type="button"
                                                        className={`skill-card__icon-btn skill-card__icon-btn--star${
                                                            isFavorite ? " is-active" : ""
                                                        }`}
                                                        onClick={() => toggleFavoriteSkill(row.id)}
                                                        aria-pressed={isFavorite}
                                                        aria-label={
                                                            isFavorite
                                                                ? `Unstar ${row.label}`
                                                                : `Star ${row.label}`
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
                                                            hideSkillFromView(row.id);
                                                            setShowHiddenSkills(true);
                                                        }}
                                                        aria-label={`Hide ${row.label}`}
                                                        title="Hide this skill from the planner"
                                                    >
                                                        Hide
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="world-skill-card__body world-skill-rank-card__body">
                                                <div className="world-skill-rank-card__heading">
                                                    <h4>{row.label}</h4>
                                                    {abilityInfo?.label && (
                                                        <span className="text-muted text-small">
                                                            {abilityInfo.label}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="world-skill-rank-card__summary">
                                                    <span className="pill light">
                                                        Ability mod {formatModifier(row.abilityMod)}
                                                    </span>
                                                    <span className="world-skill-rank-card__total">
                                                        Total
                                                        <span className="skill-total">{formatModifier(row.total)}</span>
                                                    </span>
                                                </div>
                                                <div className="world-skill-rank-card__fields">
                                                    <MathField
                                                        label="Ranks"
                                                        value={row.ranks}
                                                        onCommit={(val) => updateSkill(row.key, "ranks", val)}
                                                        className="math-inline"
                                                        disabled={disableInputs}
                                                    />
                                                    <MathField
                                                        label="Misc"
                                                        value={row.misc}
                                                        onCommit={(val) => updateSkill(row.key, "misc", val)}
                                                        className="math-inline"
                                                        disabled={disableInputs}
                                                    />
                                                </div>
                                                {isDM && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-small danger world-skill-rank-card__take-away"
                                                        onClick={() => handleTakeAwaySkill(row.key, row.label)}
                                                        disabled={
                                                            disableInputs || (row.ranks === 0 && row.misc === 0)
                                                        }
                                                    >
                                                        Take away
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
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

export default WorldSkillsTab;
