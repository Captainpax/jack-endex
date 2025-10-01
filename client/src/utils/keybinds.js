/**
 * Build a normalized list of global keyboard shortcuts exposed to external scripts.
 * The manifest describes the core combinations supported by the application.
 *
 * @param {Array<{ key: string, label: string }>} navItems
 * @returns {Array<{ id: string, category: string, combo: string, keys: string[], description: string, tab?: string }>}
 */
export function buildKeybindManifest(navItems) {
    const bindings = [];

    bindings.push({
        id: "refresh",
        category: "Global",
        keys: ["Ctrl", "Alt", "R"],
        combo: "Ctrl + Alt + R",
        description: "Refresh campaign data",
    });

    if (Array.isArray(navItems)) {
        navItems.forEach((item, index) => {
            if (!item || typeof item !== "object") return;
            const key = typeof item.key === "string" ? item.key : "";
            const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : key || "Tab";
            if (!key) return;
            const digit = index + 1;
            if (digit > 9) return;
            bindings.push({
                id: `nav-${key}`,
                category: "Navigation",
                keys: ["Ctrl", "Alt", String(digit)],
                combo: `Ctrl + Alt + ${digit}`,
                description: `Open the ${label} tab`,
                tab: key,
            });
        });
    }

    return bindings;
}

function freezeBinding(binding) {
    const keys = Array.isArray(binding.keys) ? [...binding.keys] : [];
    return Object.freeze({
        id: binding.id,
        category: binding.category,
        combo: binding.combo,
        description: binding.description,
        tab: binding.tab,
        keys: Object.freeze(keys),
    });
}

function cloneBinding(binding) {
    return {
        id: binding.id,
        category: binding.category,
        combo: binding.combo,
        description: binding.description,
        tab: binding.tab,
        keys: [...binding.keys],
    };
}

/**
 * Expose the provided keybind manifest on the global window object so that
 * campaign customization scripts (for example, `index_<campaign>.js`) can
 * introspect the supported shortcuts without crashing when the API is missing.
 *
 * @param {ReturnType<typeof buildKeybindManifest>} manifest
 * @returns {() => void} cleanup function to restore the previous global state
 */
export function installGlobalKeybindManifest(manifest) {
    if (typeof window === "undefined") {
        return () => {};
    }

    const normalized = Array.isArray(manifest) ? manifest.filter(Boolean).map(freezeBinding) : [];
    const previousGetter = typeof window.getKeybinds === "function" ? window.getKeybinds : null;
    const previousManifest = window.__jackEndexKeybinds || null;

    window.__jackEndexKeybinds = normalized;

    const getter = () => window.__jackEndexKeybinds.map(cloneBinding);
    window.getKeybinds = getter;

    return () => {
        if (typeof window === "undefined") return;
        if (window.getKeybinds === getter) {
            if (previousGetter) {
                window.getKeybinds = previousGetter;
            } else {
                delete window.getKeybinds;
            }
        }
        if (window.__jackEndexKeybinds === normalized) {
            if (previousManifest) {
                window.__jackEndexKeybinds = previousManifest;
            } else {
                delete window.__jackEndexKeybinds;
            }
        }
    };
}

