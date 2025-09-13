import React, { useEffect, useState } from 'react';
import { onApiActivity } from './api';

// Simple matrix-style rain shown when API requests are active
export default function MatrixRain() {
    const [active, setActive] = useState(false);

    useEffect(() => onApiActivity(setActive), []);

    if (!active) return null;

    const columns = Array.from({ length: 20 }, (_, i) => (
        <div
            key={i}
            className="matrix-column"
            style={{
                left: `${Math.random() * 100}%`,
                animationDuration: `${1 + Math.random() * 2}s`,
            }}
        >
            {Array.from({ length: 40 }, () => Math.floor(Math.random() * 10)).join('')}
        </div>
    ));

    return <div className="matrix-rain">{columns}</div>;
}

