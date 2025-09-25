import React, { useCallback, useEffect, useState } from "react";

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

export default MathField;

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
