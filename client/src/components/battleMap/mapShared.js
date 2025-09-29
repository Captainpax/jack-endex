const MAP_DEFAULT_SETTINGS = Object.freeze({
    allowPlayerDrawing: true,
    allowPlayerTokenMoves: true,
});

function mapReadBoolean(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return fallback;
        if (["true", "1", "yes", "on"].includes(normalized)) return true;
        if (["false", "0", "no", "off"].includes(normalized)) return false;
    }
    if (value === null || value === undefined) return fallback;
    return Boolean(value);
}

function describePlayerName(player) {
    if (!player) return "Player";
    const name = player.character?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
    if (player.username) return player.username;
    if (player.userId) return `Player ${player.userId.slice(0, 6)}`;
    return "Player";
}

export { MAP_DEFAULT_SETTINGS, mapReadBoolean, describePlayerName };
