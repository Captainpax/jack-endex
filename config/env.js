import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const loadedEnvKeys = new Set();

function parseEnvFile(content) {
    const entries = new Map();
    if (typeof content !== 'string' || !content) return entries;
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const withoutExport = line.startsWith('export ')
            ? line.slice(7).trim()
            : line;
        const eqIndex = withoutExport.indexOf('=');
        if (eqIndex === -1) continue;
        const key = withoutExport.slice(0, eqIndex).trim();
        if (!key) continue;
        let value = withoutExport.slice(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        } else {
            const commentIndex = value.indexOf(' #');
            if (commentIndex !== -1) {
                value = value.slice(0, commentIndex).trimEnd();
            }
        }
        entries.set(key, value);
    }
    return entries;
}

function applyEnv(entries, { overrideLoaded = false } = {}) {
    for (const [key, value] of entries) {
        const hasExisting = Object.prototype.hasOwnProperty.call(process.env, key);
        if (!hasExisting || (overrideLoaded && loadedEnvKeys.has(key))) {
            process.env[key] = value;
            loadedEnvKeys.add(key);
        }
    }
}

export async function loadEnv({ root = PROJECT_ROOT, files = ['.env', '.env.local'] } = {}) {
    for (const file of files) {
        const filePath = path.join(root, file);
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const entries = parseEnvFile(content.replace(/^\uFEFF/, ''));
            applyEnv(entries, { overrideLoaded: file.endsWith('.local') });
        } catch (err) {
            if (err && err.code !== 'ENOENT') {
                console.warn(`Failed to read ${file}:`, err);
            }
        }
    }
}

export function envString(key, fallback = '') {
    const value = process.env[key];
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
    }
    return fallback;
}

export function envNumber(key, fallback = null) {
    const raw = envString(key, '');
    if (!raw) return fallback;
    const num = Number(raw);
    if (!Number.isFinite(num)) return fallback;
    return num;
}

export function envBoolean(key, fallback = false) {
    const raw = envString(key, '').toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
}

