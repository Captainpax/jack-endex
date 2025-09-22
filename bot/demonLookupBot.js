import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { loadEnv, envString } from '../config/env.js';
import mongoose from '../lib/mongoose.js';
import {
    searchDemons,
    findDemonBySlug,
    findClosestDemon,
    summarizeDemon,
    buildDemonDetailString,
} from '../services/demons.js';

const API_BASE = 'https://discord.com/api/v10';
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

await loadEnv({ root: path.resolve(__dirname, '..') });

const token = envString('DISCORD_PRIMARY_BOT_TOKEN')
    || envString('DISCORD_DEFAULT_BOT_TOKEN')
    || envString('DISCORD_BOT_TOKEN')
    || envString('BOT_TOKEN');
const uri = envString('MONGODB_URI');
const dbName = envString('MONGODB_DB_NAME');

if (!token) {
    console.error('Missing bot token. Set DISCORD_PRIMARY_BOT_TOKEN or DISCORD_BOT_TOKEN in your .env file.');
    process.exit(1);
}
if (!uri) {
    console.error('Missing MONGODB_URI environment variable.');
    process.exit(1);
}

await mongoose.connect(uri, { dbName: dbName || undefined });
console.log('[bot] Connected to MongoDB. Starting gateway connection…');

const ABILITY_KEYS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const RESIST_KEYS = [
    ['weak', 'Weak'],
    ['resist', 'Resist'],
    ['null', 'Null'],
    ['absorb', 'Absorb'],
    ['reflect', 'Reflect'],
];

function truncate(text, max = 1024) {
    if (!text) return '';
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatDemonResponse(demon) {
    const lines = [];
    const summary = buildDemonDetailString(demon);
    lines.push(`**${demon.name}**${summary ? ` · ${summary}` : ''}`);
    if (demon.description) {
        lines.push(truncate(demon.description, 400));
    }
    const stats = ABILITY_KEYS.map((key) => `${key} ${demon.stats?.[key] ?? 0}`).join(' · ');
    lines.push(`Stats: ${stats}`);
    const resistParts = RESIST_KEYS.map(([key, label]) => {
        const values = Array.isArray(demon.resistances?.[key]) ? demon.resistances[key] : [];
        return `${label}: ${values.length ? values.join(', ') : '—'}`;
    });
    lines.push(resistParts.join(' · '));
    if (Array.isArray(demon.skills) && demon.skills.length > 0) {
        const skills = demon.skills
            .slice(0, 6)
            .map((skill) => {
                const suffix = [];
                if (skill.element) suffix.push(skill.element);
                if (skill.cost) suffix.push(`${skill.cost}`);
                const meta = suffix.length > 0 ? ` (${suffix.join(' · ')})` : '';
                return `• ${skill.name}${meta}`;
            });
        if (demon.skills.length > skills.length) {
            skills.push(`…and ${demon.skills.length - skills.length} more skills`);
        }
        lines.push(skills.join('\n'));
    }
    if (demon.image) {
        lines.push(demon.image);
    }
    return lines.join('\n');
}

async function resolveDemon(term) {
    const normalized = term.trim();
    if (!normalized) return null;
    const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    let demon = slug ? await findDemonBySlug(slug) : null;
    if (!demon) {
        const [hit] = await searchDemons(normalized, { limit: 1 });
        if (hit) demon = hit;
    }
    return demon ? summarizeDemon(demon) : null;
}

async function respond(interaction, payload) {
    const url = `${API_BASE}/interactions/${interaction.id}/${interaction.token}/callback`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 4, data: { ...payload, flags: 64 } }),
    });
}

async function handleInteraction(interaction) {
    if (interaction.type !== 2) return; // application command
    const name = interaction.data?.name;
    if (name !== 'lookup') return;
    const sub = interaction.data?.options?.[0];
    if (!sub || sub.name !== 'demon') {
        await respond(interaction, { content: 'Unknown subcommand.' });
        return;
    }
    const option = Array.isArray(sub.options)
        ? sub.options.find((opt) => opt.name === 'name')
        : null;
    const term = option?.value || option?.name || '';
    if (!term) {
        await respond(interaction, { content: 'Provide a demon name to look up.' });
        return;
    }
    try {
        const demon = await resolveDemon(String(term));
        if (demon) {
            const message = formatDemonResponse(demon);
            await respond(interaction, { content: message });
        } else {
            const suggestion = await findClosestDemon(String(term));
            if (suggestion) {
                await respond(interaction, {
                    content: `No exact match. Did you mean **${suggestion.name}**? Try \`/lookup demon ${suggestion.name}\`.`,
                });
            } else {
                await respond(interaction, { content: `No demon found matching **${term}**.` });
            }
        }
    } catch (err) {
        console.error('Failed to handle interaction:', err);
        await respond(interaction, { content: 'Something went wrong looking up that demon.' });
    }
}

function startGateway() {
    let ws;
    let heartbeatInterval = null;
    let sequence = null;

    function cleanup() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }

    function connect() {
        ws = new WebSocket(GATEWAY_URL);

        ws.on('message', async (data) => {
            const payload = JSON.parse(data.toString());
            const { op, t, d, s } = payload;
            if (s !== null && s !== undefined) {
                sequence = s;
            }
            switch (op) {
                case 10: { // Hello
                    cleanup();
                    heartbeatInterval = setInterval(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ op: 1, d: sequence }));
                        }
                    }, d.heartbeat_interval);
                    ws.send(JSON.stringify({
                        op: 2,
                        d: {
                            token,
                            intents: 0,
                            properties: {
                                os: process.platform,
                                browser: 'jack-endex',
                                device: 'jack-endex',
                            },
                        },
                    }));
                    break;
                }
                case 0: {
                    if (t === 'READY') {
                        console.log(`[bot] Logged in as ${d.user?.username ?? 'bot'}.`);
                    } else if (t === 'INTERACTION_CREATE') {
                        await handleInteraction(d);
                    }
                    break;
                }
                case 7: { // Reconnect
                    console.log('[bot] Gateway requested reconnect.');
                    cleanup();
                    ws.close(4000, 'Reconnect requested');
                    break;
                }
                case 9: {
                    console.warn('[bot] Invalid session. Re-identifying…');
                    cleanup();
                    ws.close(4001, 'Invalid session');
                    break;
                }
                default:
                    break;
            }
        });

        ws.on('close', (code) => {
            cleanup();
            console.warn(`[bot] Gateway closed (${code}). Reconnecting in 5s…`);
            setTimeout(connect, 5000);
        });

        ws.on('error', (err) => {
            console.error('[bot] Gateway error:', err);
            ws.close(1011, 'error');
        });
    }

    connect();
}

startGateway();

process.on('SIGINT', async () => {
    console.log('\n[bot] Shutting down…');
    await mongoose.disconnect();
    process.exit(0);
});
