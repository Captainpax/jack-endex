export const GEAR_TYPE_KEYWORDS = ["weapon", "armor", "accessory"];
const GEAR_TYPE_PATTERNS = GEAR_TYPE_KEYWORDS.map((keyword) => new RegExp(`\\b${keyword}\\b`, "i"));

export function isGearCategory(type) {
    if (typeof type !== "string") return false;
    return GEAR_TYPE_PATTERNS.some((pattern) => pattern.test(type));
}

export function formatHealingEffect(healing) {
    if (!healing || typeof healing !== "object") return "";
    const parts = [];
    const hasHpPercent = typeof healing.hpPercent === "number" && healing.hpPercent > 0;
    const hasHpFlat = typeof healing.hp === "number" && healing.hp > 0;
    const hasMpPercent = typeof healing.mpPercent === "number" && healing.mpPercent > 0;
    const hasMpFlat = typeof healing.mp === "number" && healing.mp > 0;

    if (healing.revive === "full") {
        parts.push("Revives to full HP");
    } else if (healing.revive === "partial") {
        if (hasHpPercent) {
            parts.push(`Revives with ${healing.hpPercent}% HP`);
        } else if (hasHpFlat) {
            parts.push(`Revives with ${healing.hp} HP`);
        } else {
            parts.push("Revives");
        }
    }

    if (hasHpPercent && (!healing.revive || healing.revive === "full")) {
        parts.push(`Restores ${healing.hpPercent}% HP`);
    }
    if (hasHpFlat && (!healing.revive || healing.revive === "full")) {
        parts.push(`Restores ${healing.hp} HP`);
    }
    if (hasMpPercent) {
        parts.push(`Restores ${healing.mpPercent}% MP`);
    }
    if (hasMpFlat) {
        parts.push(`Restores ${healing.mp} MP`);
    }

    return parts.join(" · ");
}
