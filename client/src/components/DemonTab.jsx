import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, Games, Personas } from "../api";
import DemonImage from "./DemonImage";
import {
    ABILITY_DEFS,
    COMBAT_CATEGORY_LABELS,
    COMBAT_TIER_LABELS,
    DEMON_RESISTANCE_SORTS,
    RESISTANCE_FIELDS,
    abilityModifier,
    collectResistanceTerms,
    createAbilityMap,
    formatModifier,
    formatResistanceList,
    getDemonSkillList,
    getResistanceCount,
    getResistanceValues,
    normalizeCombatSkillDefs,
    normalizeStringList,
    resolveAbilityState,
} from "../constants/gameData";
import { EMPTY_ARRAY, EMPTY_OBJECT } from "../utils/constants";
import {
    MOON_PHASE_OPTIONS,
    createFusionPlan,
    describeFusionPair,
    formatMoonPhaseLabel,
    getArcanaLabel,
    normalizeMoonPhase,
    resolveFusionResult,
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
    const leftSlot = useFusionSlot();
    const rightSlot = useFusionSlot();
    const [moonPhase, setMoonPhase] = useState(() => MOON_PHASE_OPTIONS[2]?.value || "other");
    const [plan, setPlan] = useState(null);
    const [rosterState, setRosterState] = useState({
        arcanaKey: "",
        arcanaLabel: "",
        demons: [],
        loading: false,
        error: "",
        candidateIndex: 0,
    });
    const [fusionResult, setFusionResult] = useState(null);
    const [history, setHistory] = useState([]);
    const lastHistoryRef = useRef("");

    const fusionPairLabel = describeFusionPair(leftSlot.selected?.arcana, rightSlot.selected?.arcana);
    const fusionReady = Boolean(leftSlot.selected && rightSlot.selected && game?.fuseSeed);

    useEffect(() => {
        if (!fusionReady) {
            setPlan(null);
            setFusionResult(null);
            setRosterState({ arcanaKey: "", arcanaLabel: "", demons: [], loading: false, error: "", candidateIndex: 0 });
            return;
        }
        const nextPlan = createFusionPlan({
            demonA: leftSlot.selected,
            demonB: rightSlot.selected,
            fuseSeed: game.fuseSeed,
            moonPhase,
        });
        setPlan(nextPlan);
    }, [fusionReady, leftSlot.selected, rightSlot.selected, game?.fuseSeed, moonPhase]);

    useEffect(() => {
        let cancelled = false;
        if (!plan || !Array.isArray(plan.arcanaCandidates) || plan.arcanaCandidates.length === 0) {
            setRosterState({ arcanaKey: "", arcanaLabel: "", demons: [], loading: false, error: plan ? "No fusion arcana available." : "", candidateIndex: 0 });
            return;
        }

        const run = async () => {
            for (let index = 0; index < plan.arcanaCandidates.length; index += 1) {
                const arcanaKey = plan.arcanaCandidates[index];
                const arcanaLabel = getArcanaLabel(arcanaKey) || arcanaKey;
                if (!cancelled) {
                    setRosterState({ arcanaKey, arcanaLabel, demons: [], loading: true, error: "", candidateIndex: index });
                }
                try {
                    const list = await Personas.list({ arcana: arcanaLabel, limit: 200 });
                    if (cancelled) return;
                    const demons = Array.isArray(list) ? list : [];
                    if (demons.length > 0) {
                        setRosterState({ arcanaKey, arcanaLabel, demons, loading: false, error: "", candidateIndex: index });
                        return;
                    }
                } catch (err) {
                    if (cancelled) return;
                    const message = err instanceof ApiError ? err.message : "Failed to load arcana roster";
                    setRosterState({ arcanaKey, arcanaLabel, demons: [], loading: false, error: message, candidateIndex: index });
                    return;
                }
            }

            if (!cancelled) {
                const fallbackKey = plan.arcanaCandidates[0];
                const fallbackLabel = getArcanaLabel(fallbackKey) || fallbackKey;
                setRosterState({
                    arcanaKey: fallbackKey,
                    arcanaLabel: fallbackLabel,
                    demons: [],
                    loading: false,
                    error: "No demons available for the selected arcana.",
                    candidateIndex: plan.arcanaCandidates.length - 1,
                });
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [plan]);

    useEffect(() => {
        if (!plan || !rosterState.arcanaKey || rosterState.loading || rosterState.error) {
            setFusionResult(null);
            return;
        }
        const outcome = resolveFusionResult({
            plan,
            demons: rosterState.demons,
            arcanaKey: rosterState.arcanaKey,
            arcanaLabel: rosterState.arcanaLabel,
            demonA: leftSlot.selected,
            demonB: rightSlot.selected,
        });
        setFusionResult(outcome);
    }, [plan, rosterState, leftSlot.selected, rightSlot.selected]);

    useEffect(() => {
        if (!plan || !fusionResult?.demon || !leftSlot.selected || !rightSlot.selected) return;
        const signature = [
            plan.pairKey,
            plan.moonPhase,
            rosterState.arcanaKey,
            fusionResult.demon.id || fusionResult.demon.slug || fusionResult.demon.name || "",
        ].join("|");
        if (lastHistoryRef.current === signature) return;
        lastHistoryRef.current = signature;
        const pairLabel = describeFusionPair(leftSlot.selected?.arcana, rightSlot.selected?.arcana);
        setHistory((prev) => {
            const entry = {
                id: signature,
                timestamp: Date.now(),
                arcanaKey: rosterState.arcanaKey,
                arcanaLabel: rosterState.arcanaLabel,
                result: fusionResult.demon,
                averageLevel: fusionResult.averageLevel,
                moonPhase: plan.moonPhase,
                roll: plan.roll,
                notifications: plan.notifications,
                pairLabel,
                leftName: leftSlot.selected?.name || "Unknown",
                rightName: rightSlot.selected?.name || "Unknown",
            };
            const next = [entry, ...prev];
            return next.slice(0, 12);
        });
    }, [plan, fusionResult, rosterState.arcanaKey, rosterState.arcanaLabel, leftSlot.selected, rightSlot.selected]);

    const fusionArcanaLabel = rosterState.arcanaLabel;
    const fusionResultDemon = fusionResult?.demon || null;
    const averageLevelDisplay =
        fusionResult?.averageLevel !== null && fusionResult?.averageLevel !== undefined
            ? fusionResult.averageLevel.toFixed(1)
            : "—";
    const roundingLabel = fusionResult?.rounding?.label || "—";
    const moonPhaseLabel = formatMoonPhaseLabel(moonPhase);
    const isRandomArcana = plan?.arcanaSource === "random";

    const resultStats = useMemo(() => resolveAbilityState(fusionResultDemon?.stats), [fusionResultDemon]);
    const resultResistances = useMemo(() => {
        const map = {};
        for (const field of RESISTANCE_FIELDS) {
            map[field.key] = getResistanceValues(fusionResultDemon, field.key);
        }
        return map;
    }, [fusionResultDemon]);
    const resultSkills = useMemo(() => {
        if (!Array.isArray(fusionResultDemon?.skills)) return EMPTY_ARRAY;
        return fusionResultDemon.skills
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
    }, [fusionResultDemon]);

    const poolUsed = Number(game?.demonPool?.used ?? 0);
    const rawMax = game?.demonPool?.max;
    const poolMax = Number.isFinite(Number(rawMax)) ? Number(rawMax) : null;
    const poolFull = poolMax !== null && poolMax > 0 && poolUsed >= poolMax;

    const [busyAdd, setBusyAdd] = useState(false);

    const handleAddToPool = useCallback(async () => {
        if (!fusionResultDemon) return;
        try {
            setBusyAdd(true);
            const resistancePayload = RESISTANCE_FIELDS.reduce((acc, field) => {
                const values = resultResistances[field.key];
                acc[field.key] = Array.isArray(values) ? values : [];
                return acc;
            }, {});
            const payload = {
                name: fusionResultDemon.name,
                arcana: fusionResultDemon.arcana,
                alignment: fusionResultDemon.alignment,
                level: Number(fusionResultDemon.level) || 0,
                stats: resolveAbilityState(fusionResultDemon.stats),
                resistances: resistancePayload,
                skills: Array.isArray(fusionResultDemon.skills)
                    ? fusionResultDemon.skills
                        .map((skill) => (typeof skill === "string" ? skill : skill?.name))
                        .filter((skill) => typeof skill === "string" && skill.trim().length > 0)
                    : [],
                notes: [
                    `Fusion of ${leftSlot.selected?.name || "Unknown"} + ${rightSlot.selected?.name || "Unknown"}.`,
                    typeof fusionResultDemon.description === "string" ? fusionResultDemon.description.trim() : "",
                ]
                    .filter(Boolean)
                    .join("\n\n"),
                image: fusionResultDemon.image || "",
            };
            await Games.addDemon(game.id, payload);
            await onRefresh?.();
            alert(`${fusionResultDemon.name} added to the shared pool.`);
        } catch (err) {
            const message = err instanceof ApiError ? err.message : "Failed to add fused demon.";
            alert(message);
        } finally {
            setBusyAdd(false);
        }
    }, [fusionResultDemon, resultResistances, leftSlot.selected, rightSlot.selected, game.id, onRefresh]);

    const handleSendToEditor = useCallback(async () => {
        if (!fusionResultDemon?.slug || !onUsePersona) return;
        try {
            await onUsePersona(fusionResultDemon.slug);
        } catch (err) {
            const message = err instanceof ApiError ? err.message : "Failed to load demon.";
            alert(message);
        }
    }, [fusionResultDemon, onUsePersona]);

    const arcanaLoading = rosterState.loading;
    const arcanaError = rosterState.error;

    return (
        <div className="demon-fusion">
            <div className="demon-fusion__intro">
                <h4>Demon fusion planner</h4>
                <p className="text-small text-muted">
                    Select two demons to preview the automatic fusion result. The current moon phase can twist the arcana
                    and ranking that emerge.
                </p>
            </div>
            <div className="demon-fusion__grid">
                <FusionSlot title="Ingredient A" slot={leftSlot} onUsePersona={onUsePersona} />
                <FusionSlot title="Ingredient B" slot={rightSlot} onUsePersona={onUsePersona} />
                <section className="demon-fusion__summary">
                    <div className="demon-fusion__summary-header">
                        <div>
                            <h4>Fusion result</h4>
                            {isRandomArcana && (
                                <p className="text-small text-muted">Arcana chosen at random due to the {moonPhaseLabel.toLowerCase()}.</p>
                            )}
                        </div>
                    </div>
                    <div className="demon-fusion__summary-grid">
                        <div className="demon-fusion__summary-row">
                            <span>Materials</span>
                            <span>{fusionReady ? fusionPairLabel || "—" : "—"}</span>
                        </div>
                        <label className="field demon-fusion__summary-row">
                            <span className="field__label">Moon phase</span>
                            <select
                                id="fusion-moon-phase"
                                value={moonPhase}
                                onChange={(event) => setMoonPhase(normalizeMoonPhase(event.target.value))}
                            >
                                {MOON_PHASE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="demon-fusion__summary-row">
                            <span>Result arcana</span>
                            <span>{fusionArcanaLabel ? `${fusionArcanaLabel}${isRandomArcana ? " · Randomized" : ""}` : "—"}</span>
                        </div>
                        <div className="demon-fusion__summary-row">
                            <span>Average level</span>
                            <span>{averageLevelDisplay}</span>
                        </div>
                        <div className="demon-fusion__summary-row">
                            <span>Selection rule</span>
                            <span>{roundingLabel}</span>
                        </div>
                        {fusionResult?.targetLevel !== null && fusionResult?.targetLevel !== undefined && (
                            <div className="demon-fusion__summary-row">
                                <span>Target demon level</span>
                                <span>LV {fusionResult.targetLevel}</span>
                            </div>
                        )}
                    </div>
                    {plan?.roll && (
                        <div className="demon-fusion__summary-note text-small">
                            Moon roll: {plan.roll.value}/20
                            {plan.roll.isCriticalHigh
                                ? " · Critical success"
                                : plan.roll.isCriticalLow
                                    ? " · Critical failure"
                                    : ""}
                        </div>
                    )}
                    {Array.isArray(plan?.notifications) && plan.notifications.length > 0 && (
                        <div className="demon-fusion__summary-note text-small">
                            {plan.notifications.map((note) => (
                                <div key={note}>{note}</div>
                            ))}
                        </div>
                    )}
                    {!fusionReady && (
                        <div className="demon-fusion__empty text-small text-muted">
                            Choose two ingredient demons to preview a fusion.
                        </div>
                    )}
                    {fusionReady && arcanaError && (
                        <div className="text-small text-error">{arcanaError}</div>
                    )}
                    {fusionReady && !arcanaError && arcanaLoading && (
                        <div className="text-small text-muted">
                            Loading {fusionArcanaLabel || "fusion"} roster…
                        </div>
                    )}
                    {fusionReady && !arcanaLoading && !fusionResultDemon && !arcanaError && (
                        <div className="demon-fusion__empty text-small text-muted">
                            No demons found for the {fusionArcanaLabel || "selected"} arcana in the codex.
                        </div>
                    )}
                    {fusionReady && fusionResultDemon && (
                        <div className="demon-fusion__result-card">
                            <div className="demon-fusion__result-meta">
                                <strong>{fusionResultDemon.name}</strong>
                                <span className="text-small text-muted">
                                    {(fusionResultDemon.arcana || "—")} · {(fusionResultDemon.alignment || "—")} · LV {fusionResultDemon.level ?? "—"}
                                </span>
                                {fusionResultDemon.description && (
                                    <p className="text-small">{fusionResultDemon.description}</p>
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
                                {RESISTANCE_FIELDS.map((field) => (
                                    <div key={field.key}>
                                        <strong>{field.label}:</strong>{" "}
                                        {formatResistanceList(resultResistances[field.key])}
                                    </div>
                                ))}
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
                            <div className="demon-fusion__actions">
                                {fusionResultDemon.slug && (
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
                    {fusionReady && rosterState.demons.length > 0 && (
                        <div className="demon-fusion__candidate-list">
                            <div className="text-small text-muted">{fusionArcanaLabel || "Arcana"} lineup</div>
                            <div className="demon-fusion__candidate-scroll">
                                {rosterState.demons.map((entry, index) => (
                                    <div
                                        key={entry.slug || `${entry.name}-${index}`}
                                        className={`demon-fusion__candidate${fusionResult?.selectedIndex === index ? " is-active" : ""}`}
                                    >
                                        <span>{entry.name}</span>
                                        <span className="text-small text-muted">LV {entry.level ?? "—"}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </section>
            </div>
            {history.length > 0 && (
                <section className="demon-fusion__history">
                    <h5>Fusion history</h5>
                    <div className="demon-fusion__history-list">
                        {history.map((entry) => {
                            const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                            return (
                                <article key={entry.id} className="demon-fusion__history-entry">
                                    <div className="demon-fusion__history-header-row">
                                        <div>
                                            <strong>{entry.result?.name || "Unknown"}</strong>
                                            <span className="text-small text-muted">
                                                {entry.arcanaLabel || "—"} · LV {entry.result?.level ?? "—"}
                                            </span>
                                        </div>
                                        <span className="text-small text-muted">{time}</span>
                                    </div>
                                    <div className="text-small">
                                        Materials: {entry.pairLabel || "—"}
                                    </div>
                                    <div className="text-small text-muted">
                                        {formatMoonPhaseLabel(entry.moonPhase)}
                                        {entry.roll ? ` · Roll ${entry.roll.value}/20` : ""}
                                    </div>
                                    {entry.notifications?.length > 0 && (
                                        <div className="text-small">
                                            {entry.notifications.map((note) => (
                                                <div key={note}>{note}</div>
                                            ))}
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}


function DemonTab({ game, me, onUpdate }) {
    const [name, setName] = useState("");
    const [arcana, setArc] = useState("");
    const [align, setAlign] = useState("");
    const [level, setLevel] = useState(1);
    const [stats, setStats] = useState(() => createAbilityMap(0));
    const [resist, setResist] = useState({ weak: "", resist: "", block: "", drain: "", reflect: "" });
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
        setResist({ weak: "", resist: "", block: "", drain: "", reflect: "" });
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
            const resistanceText = RESISTANCE_FIELDS.reduce((acc, field) => {
                const values = getResistanceValues(p, field.key);
                acc[field.key] = values.length > 0 ? values.join(', ') : '';
                return acc;
            }, {});
            setResist(resistanceText);
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
        const resistanceText = RESISTANCE_FIELDS.reduce((acc, field) => {
            const values = getResistanceValues(demon, field.key);
            acc[field.key] = values.length > 0 ? values.join(', ') : '';
            return acc;
        }, {});
        setResist(resistanceText);
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
                        <option value="resist:block">Block resist count</option>
                        <option value="resist:drain">Drain resist count</option>
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
                                            enablePreview
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
                                            {RESISTANCE_FIELDS.map((field) => (
                                                <div key={field.key} className="demon-card__resist">
                                                    <span className="demon-card__resist-label">{field.label}</span>
                                                    <span className="demon-card__resist-values">
                                                        {formatResistanceList(getResistanceValues(d, field.key))}
                                                    </span>
                                                </div>
                                            ))}
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
    const previewResistanceText = useMemo(() => {
        const source = selected || editing;
        const map = {};
        for (const field of RESISTANCE_FIELDS) {
            const typed = normalizeStringList(resist[field.key]);
            const fallback = getResistanceValues(source, field.key);
            map[field.key] = formatResistanceList(typed, fallback);
        }
        return map;
    }, [editing, resist, selected]);
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
                    {RESISTANCE_FIELDS.map((field) => (
                        <label key={field.key} className="field demon-editor__resist-field">
                            <span className="field__label">{field.label}</span>
                            <textarea
                                rows={2}
                                value={resist[field.key]}
                                placeholder="Comma or newline separated"
                                onChange={(event) =>
                                    setResist((prev) => ({ ...prev, [field.key]: event.target.value }))
                                }
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
                                enablePreview
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
                                {RESISTANCE_FIELDS.map((field) => (
                                    <div key={field.key}>
                                        <b>{field.label}:</b> {previewResistanceText[field.key] ?? '—'}
                                    </div>
                                ))}
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

