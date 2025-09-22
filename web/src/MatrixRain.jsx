import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onApiActivity } from './api';

const COLUMN_COUNT = 28;
const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ROWS = 32;

function randomGlyph() {
    return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

function useLocationSignal() {
    const [signal, setSignal] = useState(() => (typeof window !== 'undefined' ? window.location.href : ''));
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let lastHref = window.location.href;
        const notify = () => {
            const current = window.location.href;
            if (current !== lastHref) {
                lastHref = current;
                setSignal(`${current}#${Date.now()}`);
            }
        };
        const handlePop = () => notify();
        window.addEventListener('popstate', handlePop);
        const { pushState, replaceState } = window.history;
        window.history.pushState = function patchedPushState(...args) {
            const result = pushState.apply(this, args);
            notify();
            return result;
        };
        window.history.replaceState = function patchedReplaceState(...args) {
            const result = replaceState.apply(this, args);
            notify();
            return result;
        };
        return () => {
            window.removeEventListener('popstate', handlePop);
            window.history.pushState = pushState;
            window.history.replaceState = replaceState;
        };
    }, []);
    return signal;
}

function createColumns() {
    return Array.from({ length: COLUMN_COUNT }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        duration: 1.6 + Math.random() * 1.8,
        delay: Math.random() * 1.5,
        chars: Array.from({ length: ROWS }, randomGlyph),
    }));
}

// Simple matrix-style rain shown when API requests are active
export default function MatrixRain() {
    const [active, setActive] = useState(false);
    const [visible, setVisible] = useState(false);
    const [columns, setColumns] = useState(() => []);
    const fadeTimer = useRef(null);
    const locationSignal = useLocationSignal();

    useEffect(() => {
        const unsubscribe = onApiActivity(setActive);
        return () => {
            unsubscribe();
            if (fadeTimer.current) {
                clearTimeout(fadeTimer.current);
                fadeTimer.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (active) {
            setVisible(true);
            setColumns(() => createColumns());
        } else {
            if (fadeTimer.current) clearTimeout(fadeTimer.current);
            fadeTimer.current = setTimeout(() => setVisible(false), 400);
        }
        return () => {
            if (fadeTimer.current) {
                clearTimeout(fadeTimer.current);
                fadeTimer.current = null;
            }
        };
    }, [active]);

    useEffect(() => {
        if (!visible) return;
        setColumns(() => createColumns());
    }, [locationSignal, visible]);

    useEffect(() => {
        if (!active) return undefined;
        const interval = setInterval(() => {
            setColumns((cols) =>
                cols.map((col) => ({
                    ...col,
                    chars: [randomGlyph(), ...col.chars.slice(0, ROWS - 1)],
                }))
            );
        }, 95);
        return () => clearInterval(interval);
    }, [active]);

    const content = useMemo(() => (
        columns.map((col) => (
            <div
                key={col.id}
                className="matrix-column"
                style={{
                    left: `${col.left}%`,
                    animationDuration: `${col.duration}s`,
                    animationDelay: `${col.delay}s`,
                }}
            >
                {col.chars.map((char, idx) => (
                    <span key={idx} className="matrix-char" style={{ opacity: Math.max(0.25, idx / ROWS) }}>
                        {char}
                    </span>
                ))}
            </div>
        ))
    ), [columns]);

    if (!visible) return null;

    return (
        <div className={`matrix-rain${active ? ' active' : ''}`} aria-hidden>
            {content}
        </div>
    );
}

