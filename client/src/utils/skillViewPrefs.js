export const EMPTY_SKILL_VIEW_PREFS = Object.freeze({ favorites: [], hidden: [] });

export function createEmptySkillViewPrefs() {
    return { favorites: [], hidden: [] };
}

export function sanitizeSkillViewPrefs(raw) {
    if (!raw || typeof raw !== "object") {
        return createEmptySkillViewPrefs();
    }
    const toIdList = (value) => {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        return value.reduce((list, entry) => {
            if (typeof entry !== "string") return list;
            if (seen.has(entry)) return list;
            seen.add(entry);
            list.push(entry);
            return list;
        }, []);
    };
    const favorites = toIdList(raw.favorites);
    const hidden = toIdList(raw.hidden);
    if (favorites.length === 0 && hidden.length === 0) {
        return createEmptySkillViewPrefs();
    }
    return { favorites, hidden };
}
