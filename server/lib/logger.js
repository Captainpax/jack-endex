const LEVEL_PRIORITY = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const MODE_CONFIG = {
    debug: { min: LEVEL_PRIORITY.debug, console: true, webhook: true },
    normal: { min: LEVEL_PRIORITY.info, console: true, webhook: true },
    limited: { min: LEVEL_PRIORITY.info, console: true, webhook: false },
    webhook: { min: LEVEL_PRIORITY.info, console: false, webhook: true },
};

const LEVEL_COLORS = {
    info: "\x1b[36m",
    warn: "\x1b[33m",
    error: "\x1b[31m",
    debug: "\x1b[32m",
};

const RESET_COLOR = "\x1b[0m";
const TIMESTAMP = new Intl.DateTimeFormat("en-US", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

const rawLevel = (process.env.LOGGER_LEVEL || "normal").trim().toLowerCase();
const activeMode = MODE_CONFIG[rawLevel] || MODE_CONFIG.normal;
const webhookUrl = process.env.DISCORD_WEBHOOK_URL || "";
const fetchFn = typeof fetch === "function" ? fetch.bind(globalThis) : null;
const webhookEnabled = !!(activeMode.webhook && webhookUrl && fetchFn);

function safeDetails(details) {
    if (details === undefined || details === null) return null;
    if (typeof details === "string") return details;
    try {
        return JSON.stringify(details, null, 2);
    } catch (err) {
        return `[unserializable details: ${String(err)}]`;
    }
}

function formatLine(level, message, scope) {
    const ts = TIMESTAMP.format(new Date());
    const scopeText = scope ? ` (${scope})` : "";
    return `[${ts}] ${level.toUpperCase()}${scopeText}: ${message}`;
}

function consoleMethod(level) {
    if (level === "error") return console.error.bind(console);
    if (level === "warn") return console.warn.bind(console);
    if (level === "debug") return console.debug.bind(console);
    return console.log.bind(console);
}

async function postWebhook(level, message, details, scope) {
    if (!webhookEnabled) return;
    const color = level === "error" ? 0xef4444
        : level === "warn" ? 0xf59e0b
            : level === "info" ? 0x3b82f6
                : 0x22c55e;

    const payload = {
        username: "Server Logger",
        embeds: [
            {
                title: `${level.toUpperCase()}${scope ? ` • ${scope}` : ""}`,
                description: message || "\u200b",
                color,
                timestamp: new Date().toISOString(),
                ...(details
                    ? {
                        fields: [
                            {
                                name: "Details",
                                value: `\u0060\u0060\u0060json\n${details.slice(0, 1800)}\n\u0060\u0060\u0060`,
                            },
                        ],
                    }
                    : {}),
            },
        ],
    };

    try {
        await fetchFn(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        if (activeMode.console !== false) {
            console.warn("[logger] Failed to send webhook log:", err);
        }
    }
}

class Logger {
    static level = rawLevel;
    static webhookEnabled = webhookEnabled;

    static initialize() {
        if (this.#initialized) return;
        this.#initialized = true;
        this.info("Server logger ready", {
            level: this.level,
            webhook: this.webhookEnabled,
        }, "logger");
    }

    static child(scope) {
        const normalized = scope ? String(scope) : "";
        return Object.freeze({
            info: (message, details) => Logger.info(message, details, normalized),
            warn: (message, details) => Logger.warn(message, details, normalized),
            error: (message, details) => Logger.error(message, details, normalized),
            debug: (message, details) => Logger.debug(message, details, normalized),
        });
    }

    static info(message, details = null, scope = "") {
        this.#emit("info", message, details, scope);
    }

    static warn(message, details = null, scope = "") {
        this.#emit("warn", message, details, scope);
    }

    static error(message, details = null, scope = "") {
        const normalizedDetails =
            details instanceof Error
                ? {
                    name: details.name,
                    message: details.message,
                    stack: details.stack,
                }
                : details;
        this.#emit("error", message, normalizedDetails, scope);
    }

    static debug(message, details = null, scope = "") {
        this.#emit("debug", message, details, scope);
    }

    static #initialized = false;

    static #emit(level, message, details, scope) {
        const priority = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info;
        if (priority < activeMode.min) return;

        const line = formatLine(level, message, scope);
        const color = LEVEL_COLORS[level] || LEVEL_COLORS.info;
        const printer = consoleMethod(level);
        const detailText = safeDetails(details);

        if (activeMode.console !== false) {
            printer(`${color}${line}${RESET_COLOR}`);
            if (detailText) {
                printer(`${color}  ↳ ${detailText}${RESET_COLOR}`);
            }
        }

        if (webhookEnabled) {
            void postWebhook(level, message, detailText, scope);
        }
    }
}

Logger.initialize();

export default Logger;
