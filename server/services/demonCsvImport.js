import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEMONS_JSON_PATH = path.join(__dirname, '..', 'data', 'demons.json');

function splitCSV(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}

function toLines(csvContent) {
    if (typeof csvContent !== 'string') return [];
    return csvContent
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n');
}

function parseHeaderCSV(lines) {
    let headers = null;
    const rows = [];
    for (const raw of lines) {
        const trimmed = raw.trimEnd();
        if (!trimmed) continue;
        const cells = splitCSV(trimmed).map((cell) => cell.trim());
        if (!headers) {
            headers = cells;
            continue;
        }
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = cells[idx] ?? '';
        });
        rows.push(row);
    }
    return { mode: 'header', headers: headers ?? [], rows };
}

function parseCompendiumSheet(lines) {
    const rows = [];
    const sectionHeaderRe = /^\s*([0-9IVXLCDM]+)\.\s*([A-Za-z][\w\s\-']*)/i;
    let currentArcana = null;

    for (const raw of lines) {
        const trimmed = raw.trimEnd();
        if (!trimmed) continue;
        const cells = splitCSV(trimmed).map((cell) => cell.trim());

        const headerMatch = cells[0]?.match(sectionHeaderRe);
        if (headerMatch) {
            currentArcana = headerMatch[2].trim();
            continue;
        }

        if (cells.every((cell) => cell === '')) continue;

        const name = (cells[0] || '').trim();
        if (!name) continue;

        const levelStr = (cells[1] || '').trim();
        const level = levelStr ? Number(levelStr) : null;
        const skillsRaw = (cells[2] || '').trim();
        const resistRaw = cells.find((cell) =>
            /Weak\s*:|Resist\s*:|Null\s*:|Drain\s*:|Absorb\s*:|Repel\s*:|Reflect\s*:/i.test(cell),
        ) || '';

        rows.push({
            name,
            arcana: currentArcana || null,
            level: Number.isFinite(level) ? level : null,
            skillsRaw,
            resistRaw,
        });
    }

    return { mode: 'compendium', rows };
}

function parseFlexibleCsv(csvContent) {
    const lines = toLines(csvContent);
    const headerParsed = parseHeaderCSV(lines);
    const hasNameOrId = headerParsed.headers.some((h) => /^(name|id)$/i.test(h));
    if (hasNameOrId) return headerParsed;
    return parseCompendiumSheet(lines);
}

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneDeep(value) {
    if (Array.isArray(value)) return value.map(cloneDeep);
    if (isObject(value)) {
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = cloneDeep(value[key]);
        }
        return out;
    }
    return value;
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }
    if (isObject(a) && isObject(b)) {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        for (const key of aKeys) {
            if (!deepEqual(a[key], b[key])) return false;
        }
        return true;
    }
    return false;
}

function typeKey(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
}

function coerceToType(targetSample, incoming) {
    if (targetSample === undefined) return incoming;
    const targetType = Array.isArray(targetSample) ? 'array' : typeof targetSample;
    if (targetSample === null) {
        return String(incoming).trim().toLowerCase() === 'null' ? null : targetSample;
    }

    try {
        switch (targetType) {
            case 'number': {
                if (typeof incoming === 'number') return incoming;
                const num = Number(String(incoming).trim());
                return Number.isFinite(num) ? num : targetSample;
            }
            case 'boolean': {
                if (typeof incoming === 'boolean') return incoming;
                const normalized = String(incoming).trim().toLowerCase();
                if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
                if (['false', '0', 'no', 'n'].includes(normalized)) return false;
                return targetSample;
            }
            case 'string':
                return String(incoming);
            case 'array': {
                if (Array.isArray(incoming)) return incoming;
                const serialized = String(incoming).trim();
                if (!serialized) return targetSample;
                if (serialized.startsWith('[') && serialized.endsWith(']')) {
                    try {
                        const parsed = JSON.parse(serialized);
                        return Array.isArray(parsed) ? parsed : targetSample;
                    } catch {
                        return targetSample;
                    }
                }
                const parts = serialized.split(/\s*[|;]\s*/).filter(Boolean);
                return parts.length ? parts : targetSample;
            }
            case 'object': {
                if (isObject(incoming)) return incoming;
                const serialized = String(incoming).trim();
                if (serialized.startsWith('{') && serialized.endsWith('}')) {
                    try {
                        const parsed = JSON.parse(serialized);
                        return isObject(parsed) ? parsed : targetSample;
                    } catch {
                        return targetSample;
                    }
                }
                return targetSample;
            }
            default:
                return incoming;
        }
    } catch {
        return targetSample;
    }
}

function resolveKeyCI(obj, segment) {
    if (!obj || typeof obj !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(obj, segment)) return segment;
    const lower = segment.toLowerCase();
    for (const key of Object.keys(obj)) {
        if (key.toLowerCase() === lower) return key;
    }
    return null;
}

function setByPath(schemaRoot, targetRoot, pathStr, newValue, { strict = false } = {}) {
    const segments = pathStr.split('.');
    let schemaCursor = schemaRoot;
    let targetCursor = targetRoot;

    for (let i = 0; i < segments.length; i += 1) {
        const desired = segments[i];
        const resolved = resolveKeyCI(schemaCursor ?? {}, desired);
        const key = resolved ?? desired;
        const last = i === segments.length - 1;

        if (strict && (schemaCursor == null || !(key in schemaCursor))) {
            return { changed: false, reason: `Skipped (strict): "${pathStr}" not in schema` };
        }
        if (!strict && i === 0 && !Object.prototype.hasOwnProperty.call(schemaCursor ?? {}, key)) {
            return { changed: false, reason: `Skipped: top-level "${desired}" not in schema` };
        }

        if (!(key in targetCursor)) {
            if (schemaCursor && key in schemaCursor) {
                targetCursor[key] = Array.isArray(schemaCursor[key])
                    ? []
                    : isObject(schemaCursor[key])
                    ? {}
                    : schemaCursor[key];
            } else {
                return { changed: false, reason: `Skipped: "${pathStr}" missing in target` };
            }
        }

        if (last) {
            const before = targetCursor[key];
            const after = coerceToType(schemaCursor ? schemaCursor[key] : undefined, newValue);
            if (!deepEqual(before, after)) {
                if (typeKey(before) !== typeKey(after)) {
                    return {
                        changed: false,
                        reason: `Skipped: type mismatch on "${pathStr}" (${typeKey(before)} -> ${typeKey(after)})`,
                    };
                }
                targetCursor[key] = after;
                return { changed: true };
            }
            return { changed: false, reason: `Unchanged: "${pathStr}"` };
        }

        schemaCursor = schemaCursor ? schemaCursor[key] : undefined;
        targetCursor = targetCursor[key];
        if (!isObject(targetCursor) && !Array.isArray(targetCursor)) {
            return {
                changed: false,
                reason: `Skipped: "${segments.slice(0, i + 1).join('.')}" not an object/array`,
            };
        }
    }

    return { changed: false, reason: 'Skipped: unknown' };
}

function parseSkills(skillsRaw) {
    if (!skillsRaw) return null;
    const parts = skillsRaw
        .split('|')
        .flatMap((chunk) => chunk.split(','))
        .map((part) => part.trim())
        .filter(Boolean);
    return parts.length ? parts : null;
}

function parseResistances(resistRaw) {
    if (!resistRaw) return null;
    const clauses = resistRaw.split('|').map((part) => part.trim()).filter(Boolean);
    const out = { weak: [], resist: [], block: [], drain: [], reflect: [] };

    for (const clause of clauses) {
        const match = clause.match(/^([A-Za-z ]+)\s*:\s*(.+)$/);
        if (!match) continue;
        const label = match[1].trim().toLowerCase();
        const values = match[2]
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);

        let bucket = null;
        if (label.startsWith('weak')) bucket = 'weak';
        else if (label.startsWith('resist')) bucket = 'resist';
        else if (label.startsWith('null') || label.startsWith('block')) bucket = 'block';
        else if (label.startsWith('drain') || label.startsWith('absorb')) bucket = 'drain';
        else if (label.startsWith('repel') || label.startsWith('reflect')) bucket = 'reflect';

        if (!bucket) continue;
        for (const value of values) {
            if (!out[bucket].includes(value)) out[bucket].push(value);
        }
    }

    const total = out.weak.length + out.resist.length + out.block.length + out.drain.length + out.reflect.length;
    return total ? out : null;
}

function normalizeDemonsInput(demons) {
    if (!Array.isArray(demons)) {
        throw new Error('demons dataset must be an array');
    }
    return demons.map((entry) => (entry && typeof entry === 'object' ? cloneDeep(entry) : entry));
}

function detectDuplicateNames(parsed) {
    if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) return [];

    const warnings = [];
    const seen = new Map();

    if (parsed.mode === 'header') {
        const headers = Array.isArray(parsed.headers) ? parsed.headers : [];
        const nameKey = headers.find((header) => header && header.toLowerCase() === 'name');
        if (!nameKey) return warnings;
        const arcanaKey = headers.find((header) => header && header.toLowerCase() === 'arcana');

        for (const row of parsed.rows) {
            const rawName = row?.[nameKey];
            if (typeof rawName !== 'string') continue;
            const name = rawName.trim();
            if (!name) continue;
            const key = name.toLowerCase();
            const entry = seen.get(key) || { name, count: 0, arcanas: new Set() };
            entry.count += 1;
            if (arcanaKey) {
                const rawArcana = row?.[arcanaKey];
                if (typeof rawArcana === 'string' && rawArcana.trim()) {
                    entry.arcanas.add(rawArcana.trim());
                }
            }
            seen.set(key, entry);
        }
    } else {
        for (const row of parsed.rows) {
            const rawName = row?.name;
            if (typeof rawName !== 'string') continue;
            const name = rawName.trim();
            if (!name) continue;
            const key = name.toLowerCase();
            const entry = seen.get(key) || { name, count: 0, arcanas: new Set() };
            entry.count += 1;
            if (typeof row.arcana === 'string' && row.arcana.trim()) {
                entry.arcanas.add(row.arcana.trim());
            }
            seen.set(key, entry);
        }
    }

    for (const entry of seen.values()) {
        if (entry.count <= 1) continue;
        const arcanas = Array.from(entry.arcanas);
        if (arcanas.length > 1) {
            warnings.push(`Duplicate demon "${entry.name}" appears across multiple Arcanas: ${arcanas.join(', ')}.`);
        } else if (arcanas.length === 1) {
            warnings.push(`Duplicate demon "${entry.name}" appears multiple times in Arcana ${arcanas[0]}.`);
        } else {
            warnings.push(`Duplicate demon "${entry.name}" appears multiple times in the CSV input.`);
        }
    }

    return warnings;
}

export function applyCsvToDemons({ csvContent, demons, strict = false }) {
    const dataset = normalizeDemonsInput(demons);
    const parsed = parseFlexibleCsv(csvContent);
    const warnings = detectDuplicateNames(parsed);
    const mapByName = new Map();
    const mapById = new Map();

    for (const entry of dataset) {
        if (entry && typeof entry === 'object') {
            if (typeof entry.name === 'string') {
                mapByName.set(entry.name.toLowerCase(), entry);
            }
            if (Number.isFinite(Number(entry.id))) {
                mapById.set(Number(entry.id), entry);
            }
        }
    }

    const changeLog = [];
    let touched = 0;

    if (parsed.mode === 'header') {
        const headersLower = (parsed.headers || []).map((header) => header.toLowerCase());
        let key = headersLower.includes('id') ? 'id' : headersLower.includes('name') ? 'name' : null;
        if (!key) {
            throw new Error('CSV must contain "id" or "name" column.');
        }

        for (const row of parsed.rows) {
            const matchValue = row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
            if (matchValue == null || String(matchValue).trim() === '') {
                changeLog.push({ who: null, note: `Skipped row: missing ${key}` });
                continue;
            }

            const demon = key === 'id' ? mapById.get(Number(matchValue)) : mapByName.get(String(matchValue).toLowerCase());
            if (!demon) {
                changeLog.push({ who: matchValue, note: 'No match in demons.json' });
                continue;
            }

            const schema = demon;
            const target = demon;
            const before = cloneDeep(demon);
            const perRowChanges = [];

            for (const [column, rawValue] of Object.entries(row)) {
                if (column.toLowerCase() === key) continue;
                if (rawValue == null || String(rawValue).trim() === '') continue;
                const res = setByPath(schema, target, column.trim(), rawValue, { strict });
                if (res.changed) perRowChanges.push(`✓ ${column.trim()}`);
                else if (res.reason) perRowChanges.push(`- ${column.trim()} (${res.reason})`);
            }

            const changed = !deepEqual(before, target);
            if (changed) touched += 1;
            changeLog.push({
                who: key === 'id' ? `id=${matchValue}` : `name="${matchValue}"`,
                changes: perRowChanges,
            });
        }
    } else {
        for (const row of parsed.rows) {
            const demon = mapByName.get(row.name.toLowerCase());
            if (!demon) {
                changeLog.push({ who: row.name, note: 'No match in demons.json' });
                continue;
            }

            const schema = demon;
            const target = demon;
            const before = cloneDeep(demon);
            const perRowChanges = [];

            if (row.arcana) {
                const res = setByPath(schema, target, 'arcana', row.arcana, { strict });
                if (res.changed) perRowChanges.push('✓ arcana');
                else if (res.reason) perRowChanges.push(`- arcana (${res.reason})`);
            }

            if (row.level != null) {
                const res = setByPath(schema, target, 'level', row.level, { strict });
                if (res.changed) perRowChanges.push('✓ level');
                else if (res.reason) perRowChanges.push(`- level (${res.reason})`);
            }

            const skills = parseSkills(row.skillsRaw);
            if (skills && Array.isArray(schema.skills)) {
                const res = setByPath(schema, target, 'skills', skills, { strict });
                if (res.changed) perRowChanges.push('✓ skills');
                else if (res.reason) perRowChanges.push(`- skills (${res.reason})`);
            }

            const resistances = parseResistances(row.resistRaw);
            if (resistances && isObject(schema.resistances)) {
                for (const bucket of ['weak', 'resist', 'block', 'drain', 'reflect']) {
                    if (Array.isArray(schema.resistances[bucket]) && Array.isArray(resistances[bucket])) {
                        const res = setByPath(schema, target, `resistances.${bucket}`, resistances[bucket], { strict });
                        if (res.changed) perRowChanges.push(`✓ resistances.${bucket}`);
                        else if (res.reason) perRowChanges.push(`- resistances.${bucket} (${res.reason})`);
                    }
                }
            }

            const changed = !deepEqual(before, target);
            if (changed) touched += 1;
            changeLog.push({ who: `name="${row.name}"`, changes: perRowChanges });
        }
    }

    return {
        demons: dataset,
        rowsProcessed: parsed.rows.length,
        demonsUpdated: touched,
        changeLog,
        mode: parsed.mode,
        warnings,
    };
}

export async function loadDemonsFile(filePath = DEMONS_JSON_PATH) {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('Expected demons.json to contain an array.');
    }
    return parsed;
}

export async function writeDemonsFile(demons, filePath = DEMONS_JSON_PATH) {
    await fs.writeFile(filePath, `${JSON.stringify(demons, null, 2)}\n`, 'utf8');
}

export async function applyCsvFileToDemons({ csvPath, jsonPath = DEMONS_JSON_PATH, strict = false }) {
    const [csvContent, demons] = await Promise.all([
        fs.readFile(csvPath, 'utf8'),
        loadDemonsFile(jsonPath),
    ]);
    const result = applyCsvToDemons({ csvContent, demons, strict });
    return { ...result, demons: result.demons };
}

export function updateDemonEntry(entry, updates) {
    if (!entry || typeof entry !== 'object') {
        throw new Error('Invalid demon entry');
    }
    const allowedKeys = new Set([
        'name',
        'arcana',
        'alignment',
        'personality',
        'strategy',
        'level',
        'description',
        'image',
        'query',
        'skills',
        'resistances',
        'stats',
        'mods',
        'dlc',
        'tags',
    ]);

    const next = cloneDeep(entry);
    for (const [key, value] of Object.entries(updates || {})) {
        if (!allowedKeys.has(key)) continue;
        if (key === 'level') {
            const num = Number(value);
            next.level = Number.isFinite(num) ? num : next.level;
            continue;
        }
        if (key === 'skills') {
            next.skills = Array.isArray(value)
                ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
                : next.skills;
            continue;
        }
        if (key === 'resistances') {
            const payload = value && typeof value === 'object' ? value : {};
            next.resistances = {
                weak: Array.isArray(payload.weak) ? payload.weak.map((item) => String(item).trim()).filter(Boolean) : next.resistances?.weak ?? [],
                resist: Array.isArray(payload.resist)
                    ? payload.resist.map((item) => String(item).trim()).filter(Boolean)
                    : next.resistances?.resist ?? [],
                block: Array.isArray(payload.block)
                    ? payload.block.map((item) => String(item).trim()).filter(Boolean)
                    : next.resistances?.block ?? [],
                drain: Array.isArray(payload.drain)
                    ? payload.drain.map((item) => String(item).trim()).filter(Boolean)
                    : next.resistances?.drain ?? [],
                reflect: Array.isArray(payload.reflect)
                    ? payload.reflect.map((item) => String(item).trim()).filter(Boolean)
                    : next.resistances?.reflect ?? [],
            };
            continue;
        }
        if (key === 'stats' || key === 'mods') {
            const source = value && typeof value === 'object' ? value : {};
            const template = next[key] && typeof next[key] === 'object' ? next[key] : {};
            const updated = { ...template };
            for (const statKey of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
                const raw = Number(source[statKey]);
                if (Number.isFinite(raw)) {
                    updated[statKey] = raw;
                }
            }
            next[key] = updated;
            continue;
        }
        if (key === 'tags') {
            if (Array.isArray(value)) {
                next.tags = value.map((tag) => String(tag).trim()).filter(Boolean);
            }
            continue;
        }
        next[key] = typeof value === 'string' ? value : value ?? next[key];
    }
    return next;
}

export function replaceDemonInList(demons, id, updated) {
    const list = normalizeDemonsInput(demons);
    const index = list.findIndex((entry) => Number(entry?.id) === Number(id));
    if (index === -1) return { demons: list, updated: null };
    const next = cloneDeep(list);
    next[index] = updated;
    return { demons: next, updated: next[index] };
}
