const LEVEL_STYLES = {
    info: 'color:#2563eb;font-weight:600;',
    warn: 'color:#f59e0b;font-weight:600;',
    error: 'color:#ef4444;font-weight:600;',
    debug: 'color:#0f766e;font-weight:600;',
};

const LABEL_STYLE = 'background:#0f172a;color:#f8fafc;padding:2px 6px;border-radius:6px 6px 0 6px;font-weight:700;';
const TEXT_STYLE = 'color:#111827;font-size:0.95rem;';

function print(level, message, details) {
    const style = LEVEL_STYLES[level] || LEVEL_STYLES.info;
    const timestamp = new Date().toLocaleTimeString();
    const label = `%cJack Endex%c ${timestamp}%c ${message}`;
    if (details !== undefined) {
        console[level === 'debug' ? 'debug' : level](
            label,
            LABEL_STYLE,
            style,
            TEXT_STYLE,
            details,
        );
    } else {
        console[level === 'debug' ? 'debug' : level](
            label,
            LABEL_STYLE,
            style,
            TEXT_STYLE,
        );
    }
}

const clientLogger = {
    info(message, details) {
        print('info', message, details);
    },
    warn(message, details) {
        print('warn', message, details);
    },
    error(message, details) {
        print('error', message, details);
    },
    debug(message, details) {
        print('debug', message, details);
    },
};

export default clientLogger;
