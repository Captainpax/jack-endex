import React, { useEffect, useRef, useState } from "react";
import { onApiActivity } from "../api";

const HIDE_DELAY = 240;

export default function LoadingBar() {
    const [active, setActive] = useState(false);
    const [visible, setVisible] = useState(false);
    const hideTimeoutRef = useRef(null);
    const hasInteractedRef = useRef(false);

    useEffect(() => onApiActivity((value) => setActive(Boolean(value))), []);

    useEffect(() => {
        if (active) {
            hasInteractedRef.current = true;
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
                hideTimeoutRef.current = null;
            }
            setVisible(true);
            return undefined;
        }

        if (!hasInteractedRef.current) {
            return undefined;
        }

        hideTimeoutRef.current = window.setTimeout(() => {
            setVisible(false);
            hideTimeoutRef.current = null;
        }, HIDE_DELAY);

        return () => {
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
                hideTimeoutRef.current = null;
            }
        };
    }, [active]);

    useEffect(
        () => () => {
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
        },
        []
    );

    const finishing = visible && !active;
    const className = [
        "loading-bar",
        visible ? "loading-bar--visible" : "",
        active ? "loading-bar--active" : "",
        finishing ? "loading-bar--finishing" : "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div className={className} role="presentation" aria-hidden="true">
            <div className="loading-bar__track">
                <div className="loading-bar__indicator" />
            </div>
        </div>
    );
}
