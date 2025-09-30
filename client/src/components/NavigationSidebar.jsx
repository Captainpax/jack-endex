import React from "react";

function NavigationSidebar({ items, activeKey, onSelect }) {
    if (!Array.isArray(items) || items.length === 0) {
        return (
            <nav className="sidebar__nav" aria-label="Game navigation">
                <p className="sidebar__nav-empty">No navigation options available.</p>
            </nav>
        );
    }

    return (
        <nav className="sidebar__nav" aria-label="Game navigation">
            {items.map((item) => {
                if (!item || !item.key) return null;
                const isActive = item.key === activeKey;
                const handleClick = () => {
                    if (typeof onSelect === "function") {
                        onSelect(item.key);
                    }
                };

                return (
                    <button
                        key={item.key}
                        type="button"
                        className={`sidebar__nav-button${isActive ? " is-active" : ""}`}
                        onClick={handleClick}
                        aria-pressed={isActive}
                    >
                        <span className="sidebar__nav-label">{item.label}</span>
                        {item.description && (
                            <span className="sidebar__nav-desc" aria-hidden="true">
                                {item.description}
                            </span>
                        )}
                    </button>
                );
            })}
        </nav>
    );
}

export default NavigationSidebar;
