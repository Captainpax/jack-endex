import React, { useCallback, useEffect, useRef, useState } from "react";
import { onApiActivity } from "./api";

const GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MIN_FONT_SIZE = 16;

function randomGlyph() {
    return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

function useLocationSignal() {
    const [signal, setSignal] = useState(() =>
        typeof window !== "undefined" ? window.location.href : ""
    );

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        let lastHref = window.location.href;
        const notify = () => {
            const current = window.location.href;
            if (current !== lastHref) {
                lastHref = current;
                setSignal(`${current}#${Date.now()}`);
            }
        };
        const handlePop = () => notify();
        window.addEventListener("popstate", handlePop);
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
            window.removeEventListener("popstate", handlePop);
            window.history.pushState = pushState;
            window.history.replaceState = replaceState;
        };
    }, []);

    return signal;
}

export default function MatrixRain() {
    const canvasRef = useRef(null);
    const contextRef = useRef(null);
    const animationRef = useRef(null);
    const runningRef = useRef(false);
    const fadeRef = useRef(0);
    const columnsRef = useRef([]);
    const fontSizeRef = useRef(MIN_FONT_SIZE);
    const canvasSizeRef = useRef({ width: 0, height: 0 });
    const activeRef = useRef(false);

    const [active, setActive] = useState(false);
    const [visible, setVisible] = useState(false);
    const locationSignal = useLocationSignal();

    const setupColumns = useCallback((width, height) => {
        const fontSize = fontSizeRef.current;
        if (fontSize <= 0) return;
        const columnCount = Math.max(1, Math.ceil(width / fontSize));
        columnsRef.current = Array.from({ length: columnCount }, () => -Math.random() * height);
    }, []);

    const setupCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || typeof window === "undefined") {
            return;
        }
        const width = window.innerWidth;
        const height = window.innerHeight;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            contextRef.current = null;
            return;
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const fontSize = Math.max(MIN_FONT_SIZE, Math.floor(width / 60));
        fontSizeRef.current = fontSize;
        canvasSizeRef.current = { width, height };
        setupColumns(width, height);
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(0, 0, width, height);
        ctx.font = `${fontSize}px "JetBrains Mono", "Fira Code", monospace`;
        ctx.textBaseline = "top";
        contextRef.current = ctx;
    }, [setupColumns]);

    const drawFrame = useCallback(() => {
        const ctx = contextRef.current;
        if (!ctx) {
            runningRef.current = false;
            animationRef.current = null;
            return;
        }
        const { width, height } = canvasSizeRef.current;
        if (!width || !height) {
            runningRef.current = false;
            animationRef.current = null;
            return;
        }

        if (!columnsRef.current.length) {
            setupColumns(width, height);
        }

        if (activeRef.current) {
            fadeRef.current = Math.min(1, fadeRef.current + 0.08);
        } else {
            fadeRef.current = Math.max(0, fadeRef.current - 0.05);
        }

        const strength = fadeRef.current;

        if (!activeRef.current && strength <= 0) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
            ctx.fillRect(0, 0, width, height);
            runningRef.current = false;
            animationRef.current = null;
            setVisible(false);
            return;
        }

        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
        ctx.fillRect(0, 0, width, height);

        const fontSize = fontSizeRef.current;
        ctx.font = `${fontSize}px "JetBrains Mono", "Fira Code", monospace`;

        const glyphCount = GLYPHS.length;
        const trailAlpha = 0.35 + strength * 0.45;
        ctx.globalAlpha = trailAlpha;
        ctx.fillStyle = "#64ffb3";
        ctx.shadowColor = `rgba(102, 255, 178, ${0.28 + strength * 0.4})`;
        ctx.shadowBlur = 14 + strength * 20;

        for (let i = 0; i < columnsRef.current.length; i += 1) {
            const y = columnsRef.current[i];
            const x = i * fontSize;
            const glyph = GLYPHS[Math.floor(Math.random() * glyphCount)];
            ctx.fillText(glyph, x, y);
            let nextY = y + fontSize * (0.85 + Math.random() * 0.35);
            if (nextY > height + Math.random() * 240) {
                nextY = -Math.random() * 200;
            }
            columnsRef.current[i] = nextY;
        }

        ctx.shadowBlur = 0;
        ctx.globalAlpha = Math.min(1, 0.28 + strength * 0.5);
        ctx.fillStyle = "#d0ffe9";
        ctx.shadowColor = `rgba(208, 255, 233, ${0.25 + strength * 0.35})`;
        ctx.shadowBlur = 22 * strength;

        for (let i = 0; i < columnsRef.current.length; i += 1) {
            const y = columnsRef.current[i] - fontSize * 0.6;
            if (y < -fontSize) continue;
            const x = i * fontSize;
            ctx.fillText(randomGlyph(), x, y);
        }

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        animationRef.current = requestAnimationFrame(drawFrame);
    }, [setupColumns, setVisible]);

    const startAnimation = useCallback(() => {
        if (runningRef.current) {
            return;
        }
        runningRef.current = true;
        animationRef.current = requestAnimationFrame(drawFrame);
    }, [drawFrame]);

    const stopAnimation = useCallback(() => {
        runningRef.current = false;
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        setupCanvas();
        const handleResize = () => setupCanvas();
        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, [setupCanvas]);

    useEffect(() => {
        if (!visible) return;
        setupCanvas();
    }, [locationSignal, visible, setupCanvas]);

    useEffect(() => {
        const unsubscribe = onApiActivity((value) => setActive(!!value));
        return () => {
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        activeRef.current = active;
        if (active) {
            setVisible(true);
            setupCanvas();
            startAnimation();
        } else if (fadeRef.current > 0 || runningRef.current) {
            startAnimation();
        }
    }, [active, setupCanvas, startAnimation]);

    useEffect(() => () => stopAnimation(), [stopAnimation]);

    if (!visible) {
        return null;
    }

    const className = `matrix-rain${visible ? " is-visible" : ""}${active ? " is-active" : ""}`;

    return (
        <div className={className} aria-hidden>
            <div className="matrix-rain__glow" />
            <canvas ref={canvasRef} />
        </div>
    );
}
