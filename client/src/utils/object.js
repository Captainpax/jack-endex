/**
 * Safely read a nested property from an object using dot notation.
 * @template T
 * @param {T} obj - The object to traverse.
 * @param {string} path - Dot-separated property path (e.g. "profile.name").
 * @returns {any} The resolved value or `undefined` when the path is missing.
 */
export function get(obj, path) {
    if (!obj || typeof obj !== "object" || typeof path !== "string") return undefined;
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
        if (!current || typeof current !== "object") return undefined;
        if (!(part in current)) return undefined;
        current = current[part];
    }
    return current;
}
