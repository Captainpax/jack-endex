import React from "react";

function getBadgeLabel(label) {
    if (typeof label !== "string" || !label.trim()) return "";
    const words = label.trim().split(/\s+/);
    if (words.length === 1) {
        return words[0].slice(0, 2).toUpperCase();
    }
    return (words[0][0] + words[1][0]).toUpperCase();
}

function NavigationSidebar({ items, activeKey, onSelect }) {
    if (!Array.isArray(items) || items.length === 0) {
        return (
            <nav className="nav-drawer__nav" aria-label="Game navigation">
                <p className="nav-drawer__empty">No navigation options available.</p>
            </nav>
        );
    }

    return (
        <nav className="nav-drawer__nav" aria-label="Game navigation">
            <ul className="nav-drawer__list">
                {items.map((item) => {
                    if (!item || !item.key) return null;
                    const isActive = item.key === activeKey;
                    const badge = getBadgeLabel(item.label);
                    const handleClick = () => {
                        if (typeof onSelect === "function") {
                            onSelect(item.key);
                        }
                    };

                    return (
                        <li key={item.key} className="nav-drawer__item">
                            <button
                                type="button"
                                className={`nav-drawer__button${isActive ? " is-active" : ""}`}
                                onClick={handleClick}
                                aria-pressed={isActive}
                                aria-current={isActive ? "page" : undefined}
                            >
                                <span className="nav-drawer__badge" aria-hidden>{badge}</span>
                                <span className="nav-drawer__text">
                                    <span className="nav-drawer__label">{item.label}</span>
                                    {item.description && (
                                        <span className="nav-drawer__desc">{item.description}</span>
                                    )}
                                </span>
                                <span className="nav-drawer__chevron" aria-hidden>
                                    <svg viewBox="0 0 20 20" focusable="false" aria-hidden>
                                        <path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}

export default NavigationSidebar;
