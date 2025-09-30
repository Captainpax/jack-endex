export function normalizeId(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        return String(value);
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    return null;
}

export function idsMatch(a, b) {
    const left = normalizeId(a);
    const right = normalizeId(b);
    if (!left || !right) return false;
    return left === right;
}
