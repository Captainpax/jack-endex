#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MUSIC_DIR = path.join(PROJECT_ROOT, 'shared', 'music');
const TRACKS_JSON_PATH = path.join(MUSIC_DIR, 'tracks.json');
const INDEX_PATH = path.join(MUSIC_DIR, 'index.js');

function slugify(value) {
    return value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}

async function ensureFileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (err) {
        if (err && err.code === 'ENOENT') return false;
        throw err;
    }
}

async function renameIfNecessary(track) {
    const desiredFilename = track.filename || `${track.id}.mp3`;
    const desiredPath = path.join(MUSIC_DIR, desiredFilename);

    if (await ensureFileExists(desiredPath)) {
        return desiredFilename;
    }

    const candidates = Array.isArray(track.legacyFilenames) ? track.legacyFilenames : [];
    for (const legacy of candidates) {
        const legacyPath = path.join(MUSIC_DIR, legacy);
        if (await ensureFileExists(legacyPath)) {
            await fs.rename(legacyPath, desiredPath);
            return desiredFilename;
        }
    }

    throw new Error(`Missing audio file for track "${track.title}" (${desiredFilename}).`);
}

async function main() {
    const raw = await fs.readFile(TRACKS_JSON_PATH, 'utf8');
    const tracks = JSON.parse(raw);

    if (!Array.isArray(tracks)) {
        throw new Error('tracks.json must export an array of track definitions.');
    }

    const normalized = [];

    for (const entry of tracks) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }

        const title = entry.title && typeof entry.title === 'string' ? entry.title.trim() : '';
        if (!title) {
            throw new Error('Each track must include a non-empty "title" string.');
        }

        const id = (entry.id && typeof entry.id === 'string' ? entry.id : slugify(title)) || slugify(title);
        const info = entry.info && typeof entry.info === 'string' ? entry.info.trim() : undefined;
        const loop = entry.loop === undefined ? true : !!entry.loop;
        const isDefault = !!entry.default;

        const filename = await renameIfNecessary({
            id,
            filename: entry.filename || `${id}.mp3`,
            legacyFilenames: entry.legacyFilenames,
            title,
        });

        normalized.push({
            id,
            title,
            info: info || undefined,
            filename,
            loop,
            default: isDefault,
        });
    }

    normalized.sort((a, b) => a.title.localeCompare(b.title));

    const defaultCount = normalized.filter((track) => track.default).length;
    if (defaultCount === 0 && normalized.length > 0) {
        normalized[0].default = true;
    } else if (defaultCount > 1) {
        let firstDefault = true;
        for (const track of normalized) {
            if (track.default) {
                if (firstDefault) {
                    firstDefault = false;
                } else {
                    track.default = false;
                }
            }
        }
    }

    const trackLines = normalized.map((track) => {
        const lines = [
            '    {',
            `        id: ${JSON.stringify(track.id)},`,
            `        title: ${JSON.stringify(track.title)},`,
        ];

        if (track.info) {
            lines.push(`        info: ${JSON.stringify(track.info)},`);
        }

        lines.push(`        filename: ${JSON.stringify(track.filename)},`);
        lines.push(`        loop: ${track.loop ? 'true' : 'false'},`);

        if (track.default) {
            lines.push('        default: true,');
        }

        lines.push('    },');
        return lines.join('\n');
    });

    const tracksBlock = trackLines.length > 0 ? `\n${trackLines.join('\n')}\n` : '\n';

    const indexSource = `export const MUSIC_TRACKS = [${tracksBlock}];\n\n` +
        'export const MUSIC_TRACK_MAP = new Map(MUSIC_TRACKS.map((track) => [track.id, track]));\n\n' +
        'export function getMusicTrack(trackId) {\n' +
        '    if (!trackId) return null;\n' +
        '    return MUSIC_TRACK_MAP.get(trackId) || null;\n' +
        '}\n\n' +
        'export function getDefaultMusicTrack() {\n' +
        '    const firstDefault = MUSIC_TRACKS.find((track) => track.default);\n' +
        '    return firstDefault || MUSIC_TRACKS[0] || null;\n' +
        '}\n\n' +
        'export const MAIN_MENU_TRACK_ID = getDefaultMusicTrack()?.id || null;\n';

    await fs.writeFile(INDEX_PATH, indexSource);
}

await main();
