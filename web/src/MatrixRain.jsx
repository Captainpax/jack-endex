import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onApiActivity } from './api';

const COLUMN_COUNT = 28;
const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ROWS = 32;

function randomGlyph() {
    return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

// Simple matrix-style rain shown when API requests are active
export default function MatrixRain() {
    const [active, setActive] = useState(false);
    const [visible, setVisible] = useState(false);
    const [columns, setColumns] = useState(() => []);
    const fadeTimer = useRef(null);

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
            setColumns(() =>
                Array.from({ length: COLUMN_COUNT }, (_, i) => ({
                    id: i,
                    left: Math.random() * 100,
                    duration: 1.6 + Math.random() * 1.8,
                    delay: Math.random() * 1.5,
                    chars: Array.from({ length: ROWS }, randomGlyph),
                }))
            );
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

