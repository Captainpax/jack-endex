import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, Games, Personas } from "../api";
import {
    ABILITY_DEFS,
    COMBAT_CATEGORY_LABELS,
    COMBAT_TIER_LABELS,
    DEMON_RESISTANCE_SORTS,
    abilityModifier,
    collectResistanceTerms,
    createAbilityMap,
    formatModifier,
    formatResistanceList,
    getDemonSkillList,
    getResistanceCount,
    normalizeCombatSkillDefs,
    resolveAbilityState,
} from "../constants/gameData";
import { EMPTY_ARRAY, EMPTY_OBJECT } from "../utils/constants";
import {
    describeFusionPair,
    getArcanaLabel,
    listArcanaOptions,
    normalizeArcanaKey,
    suggestFusionArcana,
} from "../utils/fusion";

const FUSION_SEARCH_DEBOUNCE_MS = 350;

function DemonCombatSkillDialog({ demon, skills, onClose }) {
    const [query, setQuery] = useState("");
    const demonSkillList = useMemo(() => getDemonSkillList(demon), [demon]);
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

    useEffect(() => {
        const handleKey = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose?.();
            }
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [onClose]);

    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    if (!demon) return null;

    const demonName = demon.name || "Demon";

    return (
        <div className="demon-skill-overlay" role="dialog" aria-modal="true" aria-labelledby="demon-skill-title">
            <div className="demon-skill-modal">
                <header className="demon-skill-modal__header">
                    <div>
                        <h3 id="demon-skill-title">{demonName} combat skills</h3>
                        <p className="text-small text-muted">
                            Matching entries from the Combat Skills tab.
                        </p>
                    </div>
                    <button type="button" className="btn ghost btn-small" onClick={onClose}>
                        Close
                    </button>
                </header>
                {matchedSkills.length > 0 ? (
                    <>
                        <label className="field">
                            <span className="field__label">Filter skills</span>
                            <input
                                type="search"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search by name, ability, or notes"
                                autoFocus
                            />
                        </label>
                        <div className="demon-skill-modal__list">
                            {filteredSkills.map((skill) => (
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
                            ))}
                            {filteredSkills.length === 0 && (
                                <div className="demon-skill-modal__empty text-small text-muted">
                                    No combat skills match that filter.
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="demon-skill-modal__empty text-small text-muted">
                        {demonSkillList.length === 0
                            ? "This demon does not list any combat skills yet."
                            : "No combat skills in the codex match these names."}
                    </div>
                )}
                {unmatchedSkills.length > 0 && (
                    <div className="demon-skill-modal__unmatched text-small">
                        <strong>Unlinked skills:</strong> {unmatchedSkills.join(', ')}
                    </div>
                )}
            </div>
        </div>
    );
}

function useFusionSlot() {
    const [query, setQueryValue] = useState("");
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const [searching, setSearching] = useState(false);
    const [loading, setLoading] = useState(false);
    const skipSearchRef = useRef(false);
    const searchTicketRef = useRef(0);
    const loadTicketRef = useRef(0);

    const setQuery = useCallback((value, options = {}) => {
        if (options.skipSearch) {
            skipSearchRef.current = true;
        }
        setQueryValue(value);
    }, []);

    const clear = useCallback(() => {
        setSelected(null);
        setResults([]);
        setQuery("", { skipSearch: true });
    }, [setQuery]);

    const adopt = useCallback(
        (demon) => {
            if (!demon) {
                clear();
                return;
            }
            setSelected(demon);
            setResults([]);
            setQuery(demon.name || "", { skipSearch: true });
        },
        [clear, setQuery],
    );

    useEffect(() => {
        if (skipSearchRef.current) {
            skipSearchRef.current = false;
            return;
        }
        const term = query.trim();
        if (!term) {
            setResults([]);
            setSearching(false);
            return;
        }
        const ticket = Date.now();
        searchTicketRef.current = ticket;
        setSearching(true);
        const handle = setTimeout(() => {
            Personas.search(term)
                .then((hits) => {
                    if (searchTicketRef.current === ticket) {
                        setResults(Array.isArray(hits) ? hits : []);
                    }
                })
                .catch((err) => {
                    if (searchTicketRef.current === ticket) {
                        console.warn("Fusion search failed", err);
                    }
                })
                .finally(() => {
                    if (searchTicketRef.current === ticket) {
                        setSearching(false);
                    }
                });
        }, FUSION_SEARCH_DEBOUNCE_MS);
        return () => {
            clearTimeout(handle);
        };
    }, [query]);

    const pick = useCallback(
        async (slug) => {
            const normalized = typeof slug === "string" ? slug.trim() : "";
            if (!normalized) return null;
            const ticket = Date.now();
            loadTicketRef.current = ticket;
            let error = null;
            let demon = null;
            try {
                setLoading(true);
                const fetched = await Personas.get(normalized);
                if (loadTicketRef.current === ticket) {
                    demon = fetched;
                    setSelected(fetched);
                    setResults([]);
                    setQuery(fetched.name || normalized, { skipSearch: true });
                }
            } catch (err) {
                if (loadTicketRef.current === ticket) {
                    error = err;
                }
            } finally {
                if (loadTicketRef.current === ticket) {
                    setLoading(false);
                }
            }
            if (error) throw error;
            return demon;
        },
        [setQuery],
    );

    return {
        query,
        setQuery,
        results,
        searching,
        selected,
        loading,
        pick,
        clear,
        adopt,
    };
}

function FusionSlot({ title, slot, onUsePersona }) {
    const hasSelection = Boolean(slot.selected);

    const handlePick = useCallback(
        async (slug) => {
            try {
                await slot.pick(slug);
            } catch (err) {
                const message = err instanceof ApiError ? err.message : "Failed to load demon.";
                alert(message);
            }
        },
        [slot],
    );

    return (
        <section className="demon-fusion__slot">
            <header className="demon-fusion__slot-header">
                <div>
                    <h4>{title}</h4>
                    <p className="text-small text-muted">Search the codex for fusion material.</p>
                </div>
                {hasSelection && (
                    <button type="button" className="btn ghost btn-small" onClick={slot.clear}>
                        Clear
                    </button>
                )}
            </header>
            <label className="field">
                <span className="field__label">Search compendium</span>
                <input
                    type="search"
                    value={slot.query}
                    onChange={(event) => slot.setQuery(event.target.value)}
                    placeholder="Enter a demon name…"
                />
            </label>
            <div className="demon-fusion__results" role="listbox">
                {slot.searching ? (
                    <div className="text-small text-muted">Searching…</div>
                ) : slot.results.length === 0 ? (
                    slot.query.trim() && !hasSelection ? (
                        <div className="text-small text-muted">No matches yet. Refine your search.</div>
                    ) : (
                        <div className="text-small text-muted">Search to see compendium matches.</div>
                    )
                ) : (
                    slot.results.map((result) => (
                        <button
                            type="button"
                            key={result.slug}
                            className="demon-fusion__result"
                            onClick={() => handlePick(result.slug)}
                        >
                            <div>
                                <div className="demon-fusion__result-name">{result.name}</div>
                                <div className="text-small text-muted">
                                    {(result.arcana || "—")} · LV {result.level ?? "—"}
                                </div>
                            </div>
                            <span className="pill light">Select</span>
                        </button>
                    ))
                )}
            </div>
            {slot.loading && <div className="text-small text-muted">Loading demon details…</div>}
            {hasSelection ? (
                <div className="demon-fusion__selection">
                    <div>
                        <strong>{slot.selected.name}</strong>
                        <div className="text-small text-muted">
                            {(slot.selected.arcana || "—")} · {(slot.selected.alignment || "—")} · LV {slot.selected.level ?? "—"}
                        </div>
                    </div>
                    <div className="demon-fusion__selection-actions">
                        {slot.selected.slug && (
                            <button
                                type="button"
                                className="btn ghost btn-small"
                                onClick={async () => {
                                    if (!onUsePersona) return;
                                    try {
                                        await onUsePersona(slot.selected.slug);
                                    } catch (err) {
                                        const message = err instanceof ApiError ? err.message : "Failed to load demon.";
                                        alert(message);
                                    }
                                }}
                            >
                                Load in editor
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="demon-fusion__empty text-small text-muted">
                    Select a demon to use as fusion material.
                </div>
            )}
        </section>
    );
}

function DemonFusionPlanner({ game, onUsePersona, onRefresh }) {
    const arcanaOptions = useMemo(() => listArcanaOptions(), []);
    const leftSlot = useFusionSlot();
    const rightSlot = useFusionSlot();

    const leftArcana = normalizeArcanaKey(leftSlot.selected?.arcana || "");
    const rightArcana = normalizeArcanaKey(rightSlot.selected?.arcana || "");
    const fusionSuggestion = useMemo(
        () => suggestFusionArcana(leftArcana, rightArcana),
        [leftArcana, rightArcana],
    );

    const [targetArcana, setTargetArcana] = useState("");
    const [targetArcanaManual, setTargetArcanaManual] = useState(false);

    useEffect(() => {
        if (!leftSlot.selected || !rightSlot.selected) {
            setTargetArcana("");
            setTargetArcanaManual(false);
            return;
        }
        if (!targetArcanaManual) {
            setTargetArcana(fusionSuggestion || "");
        }
    }, [fusionSuggestion, leftSlot.selected, rightSlot.selected, targetArcanaManual]);

    const handleArcanaChange = useCallback((event) => {
        setTargetArcanaManual(true);
        setTargetArcana(event.target.value);
    }, []);

    const resetArcanaSuggestion = useCallback(() => {
        setTargetArcanaManual(false);
    }, []);

    const targetArcanaLabel = targetArcana ? getArcanaLabel(targetArcana) || targetArcana : "";
    const fusionPairLabel = describeFusionPair(leftSlot.selected?.arcana, rightSlot.selected?.arcana);

    const [arcanaDemons, setArcanaDemons] = useState([]);
    const [arcanaLoading, setArcanaLoading] = useState(false);
    const [arcanaError, setArcanaError] = useState("");

    useEffect(() => {
        let cancelled = false;
        if (!leftSlot.selected || !rightSlot.selected || !targetArcanaLabel) {
            setArcanaDemons([]);
            setArcanaError("");
            setArcanaLoading(false);
            return;
        }
        setArcanaLoading(true);
        setArcanaError("");
        Personas.list({ arcana: targetArcanaLabel, limit: 200 })
            .then((list) => {
                if (cancelled) return;
                setArcanaDemons(Array.isArray(list) ? list : []);
            })
            .catch((err) => {
                if (cancelled) return;
                console.warn("Failed to load fusion arcana roster", err);
                setArcanaDemons([]);
                setArcanaError(err instanceof ApiError ? err.message : "Failed to load arcana roster");
            })
            .finally(() => {
                if (!cancelled) {
                    setArcanaLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [leftSlot.selected, rightSlot.selected, targetArcanaLabel]);

    const leftLevel = Number(leftSlot.selected?.level);
    const rightLevel = Number(rightSlot.selected?.level);
    const hasLevels = Number.isFinite(leftLevel) && Number.isFinite(rightLevel);
    const averageExact = hasLevels ? (leftLevel + rightLevel) / 2 : null;
    const averageFloor = hasLevels ? Math.floor(averageExact) : null;

    const recommendedIndex = useMemo(() => {
        if (!Array.isArray(arcanaDemons) || arcanaDemons.length === 0 || averageFloor === null) {
            return -1;
        }
        let idx = arcanaDemons.findIndex((entry) => Number(entry?.level) >= averageFloor);
        if (idx === -1) idx = arcanaDemons.length - 1;
        return idx;
    }, [arcanaDemons, averageFloor]);

    const [resultIndex, setResultIndex] = useState(0);
    const [resultManual, setResultManual] = useState(false);

    useEffect(() => {
        if (!Array.isArray(arcanaDemons) || arcanaDemons.length === 0) {
            setResultIndex(0);
            setResultManual(false);
            return;
        }
        if (!resultManual) {
            if (recommendedIndex >= 0) {
                setResultIndex(recommendedIndex);
            } else {
                setResultIndex(0);
            }
        }
    }, [arcanaDemons, recommendedIndex, resultManual]);

    const resultDemon = arcanaDemons[resultIndex] || null;

    const selectResult = useCallback((index) => {
        setResultManual(true);
        setResultIndex(index);
    }, []);

    const stepResult = useCallback(
        (delta) => {
            if (!Array.isArray(arcanaDemons) || arcanaDemons.length === 0) return;
            setResultManual(true);
            setResultIndex((prev) => {
                const next = (prev + delta + arcanaDemons.length) % arcanaDemons.length;
                return next;
            });
        },
        [arcanaDemons],
    );

    const resetResultSelection = useCallback(() => {
        setResultManual(false);
    }, []);

    const resultStats = useMemo(() => resolveAbilityState(resultDemon?.stats), [resultDemon]);
    const resultResistances = useMemo(
        () => (resultDemon?.resistances && typeof resultDemon.resistances === "object"
            ? resultDemon.resistances
            : EMPTY_OBJECT),
        [resultDemon],
    );
    const resultSkills = useMemo(() => {
        if (!Array.isArray(resultDemon?.skills)) return EMPTY_ARRAY;
        return resultDemon.skills
            .map((skill) => {
                if (!skill) return null;
                if (typeof skill === "string") return skill;
                const name = typeof skill.name === "string" ? skill.name : "";
                if (!name) return null;
                const parts = [];
                if (skill.element) parts.push(skill.element);
                if (skill.cost) parts.push(`${skill.cost}`);
                return parts.length > 0 ? `${name} (${parts.join(" · ")})` : name;
            })
            .filter(Boolean);
    }, [resultDemon]);

    const poolUsed = Number(game?.demonPool?.used ?? 0);
    const rawMax = game?.demonPool?.max;
    const poolMax = Number.isFinite(Number(rawMax)) ? Number(rawMax) : null;
    const poolFull = poolMax !== null && poolMax > 0 && poolUsed >= poolMax;

    const [busyAdd, setBusyAdd] = useState(false);

    const handleAddToPool = useCallback(async () => {
        if (!resultDemon) return;
        try {
            setBusyAdd(true);
            const payload = {
                name: resultDemon.name,
                arcana: resultDemon.arcana,
                alignment: resultDemon.alignment,
                level: Number(resultDemon.level) || 0,
                stats: resolveAbilityState(resultDemon.stats),
                resistances: {
                    weak: Array.isArray(resultResistances.weak) ? resultResistances.weak : [],
                    resist: Array.isArray(resultResistances.resist) ? resultResistances.resist : [],
                    null: Array.isArray(resultResistances.null) ? resultResistances.null : [],
                    absorb: Array.isArray(resultResistances.absorb) ? resultResistances.absorb : [],
                    reflect: Array.isArray(resultResistances.reflect) ? resultResistances.reflect : [],
                },
                skills: Array.isArray(resultDemon.skills)
                    ? resultDemon.skills
                        .map((skill) => (typeof skill === "string" ? skill : skill?.name))
                        .filter((skill) => typeof skill === "string" && skill.trim().length > 0)
                    : [],
                notes: [
                    `Fusion of ${leftSlot.selected?.name || "Unknown"} + ${rightSlot.selected?.name || "Unknown"}.`,
                    typeof resultDemon.description === "string" ? resultDemon.description.trim() : "",
                ]
                    .filter(Boolean)
                    .join("\n\n"),
                image: resultDemon.image || "",
            };
            await Games.addDemon(game.id, payload);
            await onRefresh?.();
            alert(`${resultDemon.name} added to the shared pool.`);
        } catch (err) {
            const message = err instanceof ApiError ? err.message : "Failed to add fused demon.";
            alert(message);
        } finally {
            setBusyAdd(false);
        }
    }, [resultDemon, resultResistances, leftSlot.selected, rightSlot.selected, game.id, onRefresh]);

    const handleSendToEditor = useCallback(async () => {
        if (!resultDemon?.slug || !onUsePersona) return;
        try {
            await onUsePersona(resultDemon.slug);
        } catch (err) {
            const message = err instanceof ApiError ? err.message : "Failed to load demon.";
            alert(message);
        }
    }, [resultDemon, onUsePersona]);

    const fusionReady = Boolean(leftSlot.selected && rightSlot.selected);
    const arcanaRosterReady =
        fusionReady && Boolean(targetArcanaLabel) && Array.isArray(arcanaDemons) && arcanaDemons.length > 0;

    return (
        <div className="demon-fusion">
            <div className="demon-fusion__intro">
                <h4>Demon fusion planner</h4>
                <p className="text-small text-muted">
                    Pick two demons to estimate a fusion result. Adjust the target arcana to explore alternate outcomes,
                    then add the fused demon to the shared pool.
                </p>
            </div>
            <div className="demon-fusion__grid">
                <FusionSlot title="Ingredient A" slot={leftSlot} onUsePersona={onUsePersona} />
                <FusionSlot title="Ingredient B" slot={rightSlot} onUsePersona={onUsePersona} />
                <section className="demon-fusion__summary">
                    <div className="demon-fusion__summary-header">
                        <div>
                            <h4>Fusion result</h4>
                            {fusionSuggestion && fusionReady && (
                                <p className="text-small text-muted">
                                    Suggested arcana: {getArcanaLabel(fusionSuggestion) || fusionSuggestion}
                                </p>
                            )}
                        </div>
                        {fusionReady && fusionSuggestion && targetArcanaManual && (
                            <button type="button" className="btn ghost btn-small" onClick={resetArcanaSuggestion}>
                                Reset to suggestion
                            </button>
                        )}
                    </div>
                    <div className="demon-fusion__summary-grid">
                        <div className="demon-fusion__summary-row">
                            <span>Ingredients</span>
                            <span>{fusionReady ? fusionPairLabel || "—" : "—"}</span>
                        </div>
                        <div className="demon-fusion__summary-row">
                            <span>Average level</span>
                            <span>
                                {averageExact !== null
                                    ? `${averageExact.toFixed(1)} (floor ${averageFloor})`
                                    : "—"}
                            </span>
                        </div>
                        <label className="field">
                            <span className="field__label">Target arcana</span>
                            <select
                                value={targetArcana || ""}
                                onChange={handleArcanaChange}
                                disabled={!fusionReady}
                            >
                                <option value="">{fusionReady ? "Select arcana…" : "Select materials first"}</option>
                                {arcanaOptions.map((option) => (
                                    <option key={option.key} value={option.key}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    {!fusionReady && (
                        <div className="demon-fusion__empty text-small text-muted">
                            Choose two ingredient demons to preview a fusion.
                        </div>
                    )}
                    {fusionReady && !targetArcanaLabel && (
                        <div className="demon-fusion__empty text-small text-muted">
                            Pick an arcana to search for fusion candidates.
                        </div>
                    )}
                    {fusionReady && targetArcanaLabel && (
                        <>
                            {arcanaLoading && (
                                <div className="text-small text-muted">Loading {targetArcanaLabel} roster…</div>
                            )}
                            {arcanaError && <div className="text-small text-error">{arcanaError}</div>}
                            {arcanaRosterReady && resultDemon && (
                                <div className="demon-fusion__result-card">
                                    <div className="demon-fusion__result-meta">
                                        <strong>{resultDemon.name}</strong>
                                        <span className="text-small text-muted">
                                            {(resultDemon.arcana || "—")} · {(resultDemon.alignment || "—")} · LV {resultDemon.level ?? "—"}
                                        </span>
                                        {resultDemon.description && (
                                            <p className="text-small">{resultDemon.description}</p>
                                        )}
                                    </div>
                                    <div className="demon-fusion__result-stats">
                                        {ABILITY_DEFS.map((ability) => (
                                            <span key={ability.key} className="pill">
                                                {ability.key} {resultStats[ability.key]} ({formatModifier(abilityModifier(resultStats[ability.key]))})
                                            </span>
                                        ))}
                                    </div>
                                    <div className="demon-fusion__result-resist text-small">
                                        <div><strong>Weak:</strong> {formatResistanceList(resultResistances.weak)}</div>
                                        <div><strong>Resist:</strong> {formatResistanceList(resultResistances.resist)}</div>
                                        <div><strong>Null:</strong> {formatResistanceList(resultResistances.null)}</div>
                                        <div><strong>Absorb:</strong> {formatResistanceList(resultResistances.absorb)}</div>
                                        <div><strong>Reflect:</strong> {formatResistanceList(resultResistances.reflect)}</div>
                                    </div>
                                    {resultSkills.length > 0 && (
                                        <div className="demon-fusion__result-skills">
                                            <strong>Skills</strong>
                                            {resultSkills.slice(0, 6).map((skill) => (
                                                <span key={skill}>&bull; {skill}</span>
                                            ))}
                                            {resultSkills.length > 6 && (
                                                <span className="text-small text-muted">
                                                    …and {resultSkills.length - 6} more
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    <div className="demon-fusion__candidate-nav">
                                        {arcanaDemons.length > 1 && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="btn ghost btn-small"
                                                    onClick={() => stepResult(-1)}
                                                >
                                                    Previous
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn ghost btn-small"
                                                    onClick={() => stepResult(1)}
                                                >
                                                    Next
                                                </button>
                                            </>
                                        )}
                                        {resultManual && (
                                            <button
                                                type="button"
                                                className="btn ghost btn-small"
                                                onClick={resetResultSelection}
                                            >
                                                Use suggested result
                                            </button>
                                        )}
                                    </div>
                                    <div className="demon-fusion__actions">
                                        {resultDemon.slug && (
                                            <button type="button" className="btn ghost" onClick={handleSendToEditor}>
                                                Load result in editor
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="btn"
                                            onClick={handleAddToPool}
                                            disabled={busyAdd || poolFull}
                                        >
                                            {busyAdd ? "Adding…" : "Add fused demon to pool"}
                                        </button>
                                    </div>
                                    {poolFull && (
                                        <div className="text-small text-muted">
                                            Demon pool is full ({poolUsed}/{poolMax}). Remove a demon or increase the limit before adding new allies.
                                        </div>
                                    )}
                                </div>
                            )}
                            {arcanaRosterReady && (
                                <div className="demon-fusion__candidate-list">
                                    <div className="text-small text-muted">{targetArcanaLabel} lineup</div>
                                    <div className="demon-fusion__candidate-scroll">
                                        {arcanaDemons.map((entry, index) => (
                                            <button
                                                key={entry.slug || `${entry.name}-${index}`}
                                                type="button"
                                                className={`demon-fusion__candidate${index === resultIndex ? " is-active" : ""}`}
                                                onClick={() => selectResult(index)}
                                            >
                                                <span>{entry.name}</span>
                                                <span className="text-small text-muted">LV {entry.level ?? "—"}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {fusionReady && targetArcanaLabel && !arcanaLoading && arcanaDemons.length === 0 && (
                                <div className="demon-fusion__empty text-small text-muted">
                                    No demons found for the {targetArcanaLabel} arcana in the codex.
                                </div>
                            )}
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}

function DemonTab({ game, me, onUpdate }) {
    const [name, setName] = useState("");
    const [arcana, setArc] = useState("");
    const [align, setAlign] = useState("");
    const [level, setLevel] = useState(1);
    const [stats, setStats] = useState(() => createAbilityMap(0));
    const [resist, setResist] = useState({ weak: "", resist: "", null: "", absorb: "", reflect: "" });
    const [skills, setSkills] = useState("");
    const [notes, setNotes] = useState("");
    const [image, setImage] = useState("");
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const [editing, setEditing] = useState(null);
    const previewStats = useMemo(() => resolveAbilityState(stats), [stats]);
    const previewMods = useMemo(() => {
        const source = (selected && selected.mods) || (editing && editing.mods);
        return source && typeof source === "object" ? source : EMPTY_OBJECT;
    }, [editing, selected]);
    const [busySave, setBusySave] = useState(false);
    const [busySearch, setBusySearch] = useState(false);
    const [busyDelete, setBusyDelete] = useState(null);
    const [demonSortMode, setDemonSortMode] = useState("name");
    const [demonSearch, setDemonSearch] = useState("");
    const [arcanaFilter, setArcanaFilter] = useState("");
    const [skillFilter, setSkillFilter] = useState("");
    const [resistanceFilter, setResistanceFilter] = useState("");
    const [skillModalDemon, setSkillModalDemon] = useState(null);
    const demonCollator = useMemo(
        () => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }),
        [],
    );
    const combatSkills = useMemo(() => normalizeCombatSkillDefs(game.combatSkills), [game.combatSkills]);

    const isDM = game.dmId === me.id;
    const canEdit = isDM || game.permissions?.canEditDemons;
    const [activeSubTab, setActiveSubTab] = useState("shared");

    const availableSubTabs = useMemo(() => {
        const tabs = [{ key: "shared", label: "Shared demons" }];
        if (isDM) {
            tabs.push({ key: "lookup", label: "Lookup" }, { key: "fusion", label: "Demon fusion" });
        }
        return tabs;
    }, [isDM]);

    useEffect(() => {
        if (!availableSubTabs.some((tab) => tab.key === activeSubTab)) {
            setActiveSubTab(availableSubTabs[0]?.key || "shared");
        }
    }, [activeSubTab, availableSubTabs]);

    const resetForm = useCallback(() => {
        setName("");
        setArc("");
        setAlign("");
        setLevel(1);
        setStats(createAbilityMap(0));
        setResist({ weak: "", resist: "", null: "", absorb: "", reflect: "" });
        setSkills("");
        setNotes("");
        setImage("");
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
            image,
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

    const filteredDemons = useMemo(() => {
        const source = Array.isArray(game.demons) ? game.demons : EMPTY_ARRAY;
        if (source.length === 0) return source;
        const searchTerm = demonSearch.trim().toLowerCase();
        const arcanaTerm = arcanaFilter.trim().toLowerCase();
        const skillTerm = skillFilter.trim().toLowerCase();
        const resistanceTerm = resistanceFilter.trim().toLowerCase();
        if (!searchTerm && !arcanaTerm && !skillTerm && !resistanceTerm) {
            return source;
        }
        return source.filter((demon) => {
            if (!demon) return false;
            const name = (demon.name || "").toLowerCase();
            const arcana = (demon.arcana || "").toLowerCase();
            const alignment = (demon.alignment || "").toLowerCase();
            const notesText = (demon.notes || "").toLowerCase();
            const description = (demon.description || "").toLowerCase();
            const skillsLower = getDemonSkillList(demon).map((skill) => skill.toLowerCase());
            const resistanceTerms = collectResistanceTerms(demon);
            if (arcanaTerm && !arcana.includes(arcanaTerm)) {
                return false;
            }
            if (skillTerm && !skillsLower.some((entry) => entry.includes(skillTerm))) {
                return false;
            }
            if (resistanceTerm && !resistanceTerms.some((entry) => entry.includes(resistanceTerm))) {
                return false;
            }
            if (searchTerm) {
                const matchesSearch =
                    name.includes(searchTerm) ||
                    arcana.includes(searchTerm) ||
                    alignment.includes(searchTerm) ||
                    notesText.includes(searchTerm) ||
                    description.includes(searchTerm) ||
                    skillsLower.some((entry) => entry.includes(searchTerm)) ||
                    resistanceTerms.some((entry) => entry.includes(searchTerm));
                if (!matchesSearch) return false;
            }
            return true;
        });
    }, [arcanaFilter, demonSearch, game.demons, resistanceFilter, skillFilter]);

    const sortedDemons = useMemo(() => {
        if (!Array.isArray(filteredDemons) || filteredDemons.length === 0) {
            return Array.isArray(filteredDemons) ? filteredDemons : EMPTY_ARRAY;
        }
        const list = [...filteredDemons];
        const getName = (d) => (typeof d?.name === "string" ? d.name.trim() : "");
        const getArcana = (d) => (typeof d?.arcana === "string" ? d.arcana.trim() : "");
        const getLevel = (d) => {
            const raw = Number(d?.level);
            return Number.isFinite(raw) ? raw : 0;
        };
        const getStatValue = (d, key) => {
            const raw = Number(d?.stats?.[key]);
            return Number.isFinite(raw) ? raw : 0;
        };
        const getSkillCount = (d) => getDemonSkillList(d).length;

        list.sort((a, b) => {
            if (demonSortMode.startsWith("stat:")) {
                const key = demonSortMode.slice(5);
                const valueA = getStatValue(a, key);
                const valueB = getStatValue(b, key);
                if (valueA !== valueB) {
                    return valueB - valueA;
                }
            } else if (demonSortMode.startsWith("resist:")) {
                const key = demonSortMode.slice(7);
                const config = DEMON_RESISTANCE_SORTS.find((entry) => entry.key === key);
                if (config) {
                    const countA = getResistanceCount(a, key);
                    const countB = getResistanceCount(b, key);
                    if (countA !== countB) {
                        return config.direction === "asc" ? countA - countB : countB - countA;
                    }
                }
            } else if (demonSortMode === "levelHigh" || demonSortMode === "levelLow") {
                const levelA = getLevel(a);
                const levelB = getLevel(b);
                if (levelA !== levelB) {
                    return demonSortMode === "levelHigh" ? levelB - levelA : levelA - levelB;
                }
            } else if (demonSortMode === "arcana") {
                const cmpArc = demonCollator.compare(getArcana(a), getArcana(b));
                if (cmpArc !== 0) return cmpArc;
            } else if (demonSortMode === "skillCount") {
                const countA = getSkillCount(a);
                const countB = getSkillCount(b);
                if (countA !== countB) {
                    return countB - countA;
                }
            }
            return demonCollator.compare(getName(a), getName(b));
        });

        return list;
    }, [demonCollator, demonSortMode, filteredDemons]);

    const hasDemonFilters =
        demonSearch.trim().length > 0 ||
        arcanaFilter.trim().length > 0 ||
        skillFilter.trim().length > 0 ||
        resistanceFilter.trim().length > 0;

    const openSkillModal = useCallback((demon) => {
        if (!demon) return;
        setSkillModalDemon(demon);
    }, []);

    const closeSkillModal = useCallback(() => {
        setSkillModalDemon(null);
    }, []);

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
            setStats(resolveAbilityState(p.stats ?? p));
            const resist = p.resistances || {};
            const formatList = (value, fallback) => {
                const list = value ?? fallback;
                if (Array.isArray(list)) return list.join(', ');
                if (typeof list === 'string') return list;
                return '';
            };
            setResist({
                weak: formatList(resist.weak, p.weak),
                resist: formatList(resist.resist, p.resists),
                null: formatList(resist.null, p.nullifies),
                absorb: formatList(resist.absorb, p.absorbs),
                reflect: formatList(resist.reflect, p.reflects),
            });
            setSkills(Array.isArray(p.skills) ? p.skills.join('\n') : "");
            setNotes(p.description || "");
            setImage(p.image || "");
        } catch (e) {
            if (e instanceof ApiError && (e.code === "persona_not_found" || e.message === "persona_not_found")) {
                const suggestion = e.details?.closeMatch;
                if (suggestion?.slug && suggestion.slug !== slug) {
                    const displayName = suggestion.name || suggestion.slug;
                    const confidence = typeof suggestion.confidence === "number"
                        ? ` (confidence ${(suggestion.confidence * 100).toFixed(1)}%)`
                        : "";
                    if (
                        confirm(
                            `No demon matched "${slug}". Did you mean ${displayName}${confidence}?`
                        )
                    ) {
                        await pick(suggestion.slug);
                        return;
                    }
                }
                alert(`No demon matched "${slug}".`);
                return;
            }
            alert(e.message);
        }
    };

    const startEdit = (demon) => {
        setEditing(demon);
        setName(demon.name || "");
        setArc(demon.arcana || "");
        setAlign(demon.alignment || "");
        setLevel(demon.level ?? 0);
        setStats(resolveAbilityState(demon.stats));
        const listToText = (primary, fallback) => {
            const formatted = formatResistanceList(primary, fallback);
            return formatted === '—' ? '' : formatted;
        };
        setResist({
            weak: listToText(demon.resistances?.weak, demon.weak),
            resist: listToText(demon.resistances?.resist, demon.resists),
            null: listToText(demon.resistances?.null, demon.nullifies),
            absorb: listToText(demon.resistances?.absorb, demon.absorbs),
            reflect: listToText(demon.resistances?.reflect, demon.reflects),
        });
        setSkills(Array.isArray(demon.skills) ? demon.skills.join('\n') : "");
        setNotes(demon.notes || "");
        setImage(demon.image || "");
        setSelected(null);
    };

    const sharedContent = (
        <>
            <p className="text-muted text-small">
                Browse the shared demon roster. Edit a card to update stats, resistances, or notes.
            </p>
            <div className="demon-codex__filters">
                <label className="field demon-codex__filter">
                    <span className="field__label">Search demons</span>
                    <input
                        type="search"
                        value={demonSearch}
                        onChange={(event) => setDemonSearch(event.target.value)}
                        placeholder="Name, alignment, notes…"
                    />
                </label>
                <label className="field demon-codex__filter">
                    <span className="field__label">Arcana</span>
                    <input
                        type="search"
                        value={arcanaFilter}
                        onChange={(event) => setArcanaFilter(event.target.value)}
                        placeholder="e.g., Fool"
                    />
                </label>
                <label className="field demon-codex__filter">
                    <span className="field__label">Skill contains</span>
                    <input
                        type="search"
                        value={skillFilter}
                        onChange={(event) => setSkillFilter(event.target.value)}
                        placeholder="e.g., Agidyne"
                    />
                </label>
                <label className="field demon-codex__filter">
                    <span className="field__label">Resistance contains</span>
                    <input
                        type="search"
                        value={resistanceFilter}
                        onChange={(event) => setResistanceFilter(event.target.value)}
                        placeholder="e.g., Fire"
                    />
                </label>
                <label className="field demon-codex__filter">
                    <span className="field__label">Sort demons</span>
                    <select value={demonSortMode} onChange={(event) => setDemonSortMode(event.target.value)}>
                        <option value="name">Name (A to Z)</option>
                        <option value="nameDesc">Name (Z to A)</option>
                        <option value="arcana">Arcana</option>
                        <option value="levelHigh">Level (high to low)</option>
                        <option value="levelLow">Level (low to high)</option>
                        <option value="skillCount">Skill count</option>
                        <option value="resist:weak">Weak resist count</option>
                        <option value="resist:resist">Resist count</option>
                        <option value="resist:null">Null resist count</option>
                        <option value="resist:absorb">Absorb resist count</option>
                        <option value="resist:reflect">Reflect resist count</option>
                        {ABILITY_DEFS.map((ability) => (
                            <option key={ability.key} value={`stat:${ability.key}`}>
                                {ability.key} score
                            </option>
                        ))}
                    </select>
                </label>
                {hasDemonFilters && (
                    <button
                        type="button"
                        className="btn ghost btn-small demon-codex__clear"
                        onClick={() => {
                            setDemonSortMode("name");
                            setDemonSearch("");
                            setArcanaFilter("");
                            setSkillFilter("");
                            setResistanceFilter("");
                        }}
                    >
                        Clear filters
                    </button>
                )}
            </div>

            {sortedDemons.length === 0 ? (
                <div className="demon-codex__empty text-muted">
                    {Array.isArray(game.demons) && game.demons.length > 0
                        ? "No demons match the current filters."
                        : "No demons in the pool yet."}
                </div>
            ) : (
                <div className="demon-codex__grid">
                    {sortedDemons.map((d) => {
                        const skillList = getDemonSkillList(d);
                        const canShowSkillModal = skillList.length > 0 && combatSkills.length > 0;
                        return (
                            <article key={d.id || d.name} className="card demon-card">
                                <header className="demon-card__top">
                                    <div className="demon-card__identity">
                                        <h4 className="demon-card__name">{d.name}</h4>
                                        <div className="demon-card__chips">
                                            <span className="demon-card__chip">{d.arcana ?? '—'}</span>
                                            <span className="demon-card__chip">{d.alignment ?? '—'}</span>
                                        </div>
                                    </div>
                                    <div className="demon-card__actions">
                                        <span className="demon-card__level">LV {d.level ?? 0}</span>
                                        {canEdit && (
                                            <div className="demon-card__buttons">
                                                <button
                                                    type="button"
                                                    className="btn ghost btn-small"
                                                    onClick={() => startEdit(d)}
                                                    disabled={busySave}
                                                >
                                                    Edit
                                                </button>
                                                {isDM && (
                                                    <button
                                                        type="button"
                                                        className="btn ghost btn-small"
                                                        onClick={() => remove(d.id)}
                                                        disabled={busyDelete === d.id}
                                                    >
                                                        {busyDelete === d.id ? '…' : 'Remove'}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </header>
                                {d.description && <p className="demon-card__description">{d.description}</p>}
                                <div className="demon-card__body">
                                    {d.image && (
                                        <DemonImage
                                            src={d.image}
                                            personaSlug={d.slug || d.query}
                                            alt={`${d.name} artwork`}
                                            loading="lazy"
                                            decoding="async"
                                            className="demon-card__portrait"
                                        />
                                    )}
                                    <div className="demon-card__info">
                                        <div className="demon-card__stats-row">
                                            {ABILITY_DEFS.map((ability) => {
                                                const score = Number((d.stats || {})[ability.key]) || 0;
                                                const mod = d.mods?.[ability.key] ?? abilityModifier(score);
                                                return (
                                                    <span key={ability.key} className="demon-card__stat">
                                                        <span className="demon-card__stat-key">{ability.key}</span>
                                                        <span className="demon-card__stat-value">{score} ({formatModifier(mod)})</span>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                        <div className="demon-card__resist-grid">
                                            <div className="demon-card__resist">
                                                <span className="demon-card__resist-label">Weak</span>
                                                <span className="demon-card__resist-values">{formatResistanceList(d.resistances?.weak, d.weak)}</span>
                                            </div>
                                            <div className="demon-card__resist">
                                                <span className="demon-card__resist-label">Resist</span>
                                                <span className="demon-card__resist-values">{formatResistanceList(d.resistances?.resist, d.resists)}</span>
                                            </div>
                                            <div className="demon-card__resist">
                                                <span className="demon-card__resist-label">Null</span>
                                                <span className="demon-card__resist-values">{formatResistanceList(d.resistances?.null, d.nullifies)}</span>
                                            </div>
                                            <div className="demon-card__resist">
                                                <span className="demon-card__resist-label">Absorb</span>
                                                <span className="demon-card__resist-values">{formatResistanceList(d.resistances?.absorb, d.absorbs)}</span>
                                            </div>
                                            <div className="demon-card__resist">
                                                <span className="demon-card__resist-label">Reflect</span>
                                                <span className="demon-card__resist-values">{formatResistanceList(d.resistances?.reflect, d.reflects)}</span>
                                            </div>
                                        </div>
                                        <div className="demon-card__skills">
                                            <span className="demon-card__section-label">Skills</span>
                                            <div className="demon-card__skill-list">
                                                {skillList.slice(0, 5).map((skill) => (
                                                    <span key={skill} className="demon-card__skill-chip">{skill}</span>
                                                ))}
                                                {skillList.length > 5 && (
                                                    <span className="demon-card__skill-chip">+{skillList.length - 5} more</span>
                                                )}
                                                {canShowSkillModal && (
                                                    <button
                                                        type="button"
                                                        className="btn ghost btn-small demon-card__skills-btn"
                                                        onClick={() => openSkillModal(d)}
                                                    >
                                                        Combat skill details
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {d.notes && <div className="demon-card__notes text-small">{d.notes}</div>}
                            </article>
                        );
                    })}
                </div>
            )}
        </>
    );

    const lookupContent = (
        <div className="demon-lookup">
            <p className="text-muted text-small">
                Search the compendium to pre-fill the editor with persona stats, resistances, and skills.
            </p>
            <div className="demon-lookup__controls">
                <label className="field demon-lookup__field">
                    <span className="field__label">Compendium search</span>
                    <input
                        type="search"
                        placeholder="Search name, e.g., jack frost"
                        value={q}
                        onChange={(event) => setQ(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && runSearch()}
                    />
                </label>
                <button className="btn" onClick={runSearch} disabled={busySearch}>
                    {busySearch ? "…" : "Search"}
                </button>
            </div>
            <div className="demon-lookup__results">
                {results.length === 0 ? (
                    <div className="demon-lookup__empty text-muted">
                        {busySearch ? "Searching…" : "No results yet. Try a demon name to load stats."}
                    </div>
                ) : (
                    results.map((r) => (
                        <div key={r.slug} className="demon-lookup__result">
                            <div>
                                <div className="demon-lookup__name">{r.name}</div>
                                {r.arcana && <div className="text-small text-muted">{r.arcana}</div>}
                            </div>
                            <button className="btn ghost btn-small" onClick={() => pick(r.slug)}>
                                Use
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const fusionContent = (
        <DemonFusionPlanner game={game} onUsePersona={pick} onRefresh={onUpdate} />
    );

    const previewImage = image.trim() || selected?.image || "";
    const previewName = name || selected?.name || "";
    const previewArcana = arcana || selected?.arcana || "—";
    const previewAlignment = align || selected?.alignment || "—";
    const previewLevel = Number.isFinite(level) ? level : selected?.level ?? 0;
    const previewDescription = notes || selected?.description || "";
    const previewSlug = selected?.slug || selected?.query || "";
    const weakText = formatResistanceList(resist.weak, selected?.resistances?.weak ?? selected?.weak);
    const resistText = formatResistanceList(resist.resist, selected?.resistances?.resist ?? selected?.resists);
    const nullText = formatResistanceList(resist.null, selected?.resistances?.null ?? selected?.nullifies);
    const absorbText = formatResistanceList(resist.absorb, selected?.resistances?.absorb ?? selected?.absorbs);
    const reflectText = formatResistanceList(resist.reflect, selected?.resistances?.reflect ?? selected?.reflects);
    const hasPreview = Boolean(previewImage || previewName || previewDescription || selected);

    const editorContent = (
        <div className="demon-editor__content">
            <header className="demon-editor__header">
                <div>
                    <h3 className="demon-editor__title">{editing ? `Edit ${editing.name || "demon"}` : "Demon editor"}</h3>
                    <p className="text-muted text-small">
                        {isDM
                            ? "Add new summons or update allies in the shared pool."
                            : "Update demons you've been allowed to manage."}
                    </p>
                </div>
            </header>
            <div className="demon-editor__actions">
                <button
                    type="button"
                    className="btn"
                    onClick={save}
                    disabled={!canEdit || busySave || (!editing && !isDM)}
                >
                    {busySave ? "…" : editing || !isDM ? "Save Demon" : "Add Demon"}
                </button>
                {editing && (
                    <button type="button" className="btn ghost" onClick={resetForm} disabled={busySave}>
                        Cancel
                    </button>
                )}
            </div>
            <div className="demon-editor__section">
                <div className="demon-editor__row">
                    <label className="field demon-editor__field">
                        <span className="field__label">Name</span>
                        <input placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
                    </label>
                    <label className="field demon-editor__field">
                        <span className="field__label">Arcana</span>
                        <input placeholder="Arcana" value={arcana} onChange={(event) => setArc(event.target.value)} />
                    </label>
                    <label className="field demon-editor__field">
                        <span className="field__label">Alignment</span>
                        <input placeholder="Alignment" value={align} onChange={(event) => setAlign(event.target.value)} />
                    </label>
                </div>
                <div className="demon-editor__row">
                    <label className="field demon-editor__field demon-editor__field--compact">
                        <span className="field__label">Level</span>
                        <input
                            type="number"
                            inputMode="numeric"
                            value={level}
                            onChange={(event) => setLevel(Number(event.target.value || 0))}
                        />
                    </label>
                    <label className="field demon-editor__field demon-editor__field--wide">
                        <span className="field__label">Image URL</span>
                        <input
                            type="url"
                            placeholder="https://example.com/artwork.png"
                            value={image}
                            onChange={(event) => setImage(event.target.value)}
                        />
                    </label>
                </div>
            </div>
            <div className="demon-editor__section">
                <span className="field__label">Ability scores</span>
                <div className="demon-editor__stats-grid">
                    {ABILITY_DEFS.map((ability) => {
                        const value = Number(stats[ability.key]) || 0;
                        const mod = abilityModifier(value);
                        return (
                            <label key={ability.key} className="field demon-editor__stat-field">
                                <span className="field__label">{ability.key}</span>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    value={value}
                                    onChange={(event) =>
                                        setStats((prev) => ({
                                            ...prev,
                                            [ability.key]: Number(event.target.value || 0),
                                        }))
                                    }
                                />
                                <span className="text-small text-muted">Mod {formatModifier(mod)}</span>
                            </label>
                        );
                    })}
                </div>
            </div>
            <div className="demon-editor__section">
                <span className="field__label">Resistances</span>
                <div className="demon-editor__resist-grid">
                    {[
                        ["weak", "Weak"],
                        ["resist", "Resist"],
                        ["null", "Null"],
                        ["absorb", "Absorb"],
                        ["reflect", "Reflect"],
                    ].map(([key, label]) => (
                        <label key={key} className="field demon-editor__resist-field">
                            <span className="field__label">{label}</span>
                            <textarea
                                rows={2}
                                value={resist[key]}
                                placeholder="Comma or newline separated"
                                onChange={(event) => setResist((prev) => ({ ...prev, [key]: event.target.value }))}
                            />
                        </label>
                    ))}
                </div>
            </div>
            <div className="demon-editor__section">
                <div className="demon-editor__row">
                    <label className="field demon-editor__field">
                        <span className="field__label">Skills (one per line)</span>
                        <textarea
                            rows={3}
                            value={skills}
                            onChange={(event) => setSkills(event.target.value)}
                        />
                    </label>
                    <label className="field demon-editor__field">
                        <span className="field__label">Notes</span>
                        <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
                    </label>
                </div>
            </div>
            <div className="demon-editor__preview">
                <h4>Preview</h4>
                {!hasPreview ? (
                    <div className="text-muted text-small">Fill in details or pick a persona to preview.</div>
                ) : (
                    <div className="demon-editor__preview-body">
                        {(previewImage || previewSlug) && (
                            <DemonImage
                                src={previewImage}
                                personaSlug={previewSlug}
                                alt={previewName || "Demon artwork"}
                                loading="lazy"
                                decoding="async"
                                className="demon-editor__preview-image"
                            />
                        )}
                        <div className="demon-editor__preview-meta">
                            <div>
                                <strong>{previewName || "Unnamed demon"}</strong> · {previewArcana || "—"} · {previewAlignment || "—"} ·
                                LV {previewLevel}
                            </div>
                            {previewDescription && <div className="text-small">{previewDescription}</div>}
                            <div className="demon-editor__preview-stats">
                                {ABILITY_DEFS.map((ability) => (
                                    <span key={ability.key} className="pill">
                                        {ability.key} {previewStats[ability.key]} ({formatModifier(previewMods[ability.key] ?? abilityModifier(previewStats[ability.key]))})
                                    </span>
                                ))}
                            </div>
                            <div className="demon-editor__preview-resists text-small">
                                <div><b>Weak:</b> {weakText}</div>
                                <div><b>Resist:</b> {resistText}</div>
                                <div><b>Null:</b> {nullText}</div>
                                <div><b>Absorb:</b> {absorbText}</div>
                                <div><b>Reflect:</b> {reflectText}</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="demon-codex">
            <div className="demon-codex__layout">
                <section className="demon-codex__main">
                    <div className="card demon-codex__panel">
                        <header className="demon-codex__panel-header">
                            <div>
                                <h3>Shared Demon Pool</h3>
                                <p className="text-muted text-small">
                                    Summoned allies, compendium lookup, and fusion planning tools.
                                </p>
                            </div>
                            <span className="pill demon-codex__pool-usage">
                                {game.demonPool?.used ?? 0}/{game.demonPool?.max ?? 0} used
                            </span>
                        </header>
                        {availableSubTabs.length > 1 && (
                            <nav className="demon-codex__tabs" aria-label="Demon codex subtabs">
                                {availableSubTabs.map((tab) => {
                                    const isActive = tab.key === activeSubTab;
                                    return (
                                        <button
                                            key={tab.key}
                                            type="button"
                                            className={`demon-codex__tab-btn${isActive ? " is-active" : ""}`}
                                            onClick={() => setActiveSubTab(tab.key)}
                                        >
                                            {tab.label}
                                        </button>
                                    );
                                })}
                            </nav>
                        )}
                        <div className="demon-codex__content">
                            {activeSubTab === "shared" && sharedContent}
                            {activeSubTab === "lookup" && isDM && lookupContent}
                            {activeSubTab === "fusion" && isDM && fusionContent}
                        </div>
                    </div>
                </section>
                <aside className="demon-codex__aside">
                    <div className="card demon-editor">
                        <div className="demon-codex__pool-mobile pill">
                            {game.demonPool?.used ?? 0}/{game.demonPool?.max ?? 0} used
                        </div>
                        {editorContent}
                    </div>
                </aside>
            </div>
            {skillModalDemon && (
                <DemonCombatSkillDialog demon={skillModalDemon} skills={combatSkills} onClose={closeSkillModal} />
            )}
        </div>
    );
}


export default DemonTab;

