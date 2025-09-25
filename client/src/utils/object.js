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
