import path from 'path';
import { fileURLToPath } from 'url';
import {
    ActivityType,
    Client,
    Events,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
} from 'discord.js';
import { loadEnv, envString, envNumber } from '../config/env.js';
import mongoose from '../lib/mongoose.js';
import User from '../models/User.js';
import {
    searchDemons,
    findDemonBySlug,
    findClosestDemon,
    summarizeDemon,
    buildDemonDetailString,
} from '../services/demons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await loadEnv({ root: path.resolve(__dirname, '..', '..') });

const token = envString('DISCORD_PRIMARY_BOT_TOKEN')
    || envString('DISCORD_DEFAULT_BOT_TOKEN')
    || envString('DISCORD_BOT_TOKEN')
    || envString('BOT_TOKEN');
const uri = envString('MONGODB_URI');
const dbName = envString('MONGODB_DB_NAME');
const applicationId = envString('DISCORD_APPLICATION_ID');
const commandGuildId = envString('DISCORD_COMMAND_GUILD_ID')
    || envString('DISCORD_PRIMARY_GUILD_ID')
    || envString('DISCORD_GUILD_ID')
    || envString('DISCORD_SERVER_ID');
const DB_CONNECT_MAX_ATTEMPTS = Math.max(1, envNumber('BOT_MONGODB_CONNECT_MAX_ATTEMPTS', 5) || 5);
const DB_CONNECT_RETRY_DELAY_MS = Math.max(500, envNumber('BOT_MONGODB_CONNECT_RETRY_MS', 2000) || 2000);
const COMMAND_REGISTER_MAX_ATTEMPTS = Math.max(1, envNumber('BOT_COMMAND_REGISTER_MAX_ATTEMPTS', 3) || 3);
const COMMAND_REGISTER_RETRY_DELAY_MS = Math.max(
    1_000,
    envNumber('BOT_COMMAND_REGISTER_RETRY_MS', 2_000) || 2_000,
);

if (!token) {
    console.error('Missing bot token. Set DISCORD_PRIMARY_BOT_TOKEN or DISCORD_BOT_TOKEN in your .env file.');
    process.exit(1);
}
if (!uri) {
    console.error('Missing MONGODB_URI environment variable.');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectToDatabaseWithRetry(
    connectionUri,
    options = {},
    { attempts = DB_CONNECT_MAX_ATTEMPTS, delayMs = DB_CONNECT_RETRY_DELAY_MS } = {},
) {
    const totalAttempts = Math.max(1, Math.floor(attempts));
    const baseDelay = Math.max(500, Math.floor(delayMs));
    let lastError = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        try {
            await mongoose.connect(connectionUri, options);
            console.log(`[bot] Connected to MongoDB (attempt ${attempt}/${totalAttempts}).`);
            return;
        } catch (err) {
            lastError = err;
            console.error(`[bot] MongoDB connection attempt ${attempt} failed:`, err);
            if (attempt >= totalAttempts) break;
            const waitMs = Math.min(baseDelay * 2 ** (attempt - 1), 30_000);
            console.log(`[bot] Retrying MongoDB connection in ${waitMs}ms…`);
            await delay(waitMs);
        }
    }

    throw lastError ?? new Error('Bot failed to connect to MongoDB.');
}

const slashCommandBuilders = [
    new SlashCommandBuilder()
        .setName('codex')
        .setDescription('Look up codex information for a demon.')
        .addStringOption((option) => option
            .setName('name')
            .setDescription('Name of the demon to search for.')
            .setRequired(true)),
    new SlashCommandBuilder()
        .setName('demonlookup')
        .setDescription('Legacy alias for /codex.')
        .addStringOption((option) => option
            .setName('name')
            .setDescription('Name of the demon to search for.')
            .setRequired(true)),
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord account to your Jack Endex profile.')
        .addStringOption((option) => option
            .setName('username')
            .setDescription('Your Jack Endex username.')
            .setRequired(true)),
    new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Unlink your Discord account from Jack Endex.'),
    new SlashCommandBuilder()
        .setName('whoami')
        .setDescription('Show which Jack Endex account is linked to this Discord user.'),
];

const COMMAND_DEFINITIONS = slashCommandBuilders.map((builder) => builder.toJSON());

const ABILITY_KEYS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const RESIST_KEYS = [
    ['weak', 'Weak'],
    ['resist', 'Resist'],
    ['block', 'Block'],
    ['drain', 'Drain'],
    ['reflect', 'Reflect'],
];

const RESISTANCE_ALIAS_MAP = {
    weak: ['weak', 'weaks'],
    resist: ['resist', 'resists'],
    block: ['block', 'blocks', 'null', 'nullify', 'nullifies'],
    drain: ['drain', 'drains', 'absorb', 'absorbs'],
    reflect: ['reflect', 'reflects'],
};

function getResistanceValues(demon, key) {
    if (!demon) return [];
    const aliases = RESISTANCE_ALIAS_MAP[key] || [key];
    const values = new Set();
    for (const alias of aliases) {
        const list = demon.resistances?.[alias];
        if (Array.isArray(list)) {
            for (const entry of list) {
                if (!entry) continue;
                values.add(entry);
            }
        } else if (typeof list === 'string' && list.trim()) {
            values.add(list.trim());
        }
        const fallback = demon[alias];
        if (Array.isArray(fallback)) {
            for (const entry of fallback) {
                if (!entry) continue;
                values.add(entry);
            }
        } else if (typeof fallback === 'string' && fallback.trim()) {
            values.add(fallback.trim());
        }
    }
    return Array.from(values);
}

function truncate(text, max = 1024) {
    if (!text) return '';
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        const values = getResistanceValues(demon, key);
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

async function registerSlashCommands() {
    if (!applicationId) {
        console.warn('[bot] Missing DISCORD_APPLICATION_ID; skipping command registration.');
        return;
    }
    const scopeDescription = commandGuildId ? `guild ${commandGuildId}` : 'global';
    const route = commandGuildId
        ? Routes.applicationGuildCommands(applicationId, commandGuildId)
        : Routes.applicationCommands(applicationId);
    await rest.put(route, { body: COMMAND_DEFINITIONS });
    console.log(`[bot] Registered ${COMMAND_DEFINITIONS.length} slash command(s) for ${scopeDescription}.`);
}

async function registerSlashCommandsWithRetry({
    attempts = COMMAND_REGISTER_MAX_ATTEMPTS,
    delayMs = COMMAND_REGISTER_RETRY_DELAY_MS,
} = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await registerSlashCommands();
            return;
        } catch (err) {
            if (attempt >= attempts) {
                throw err;
            }
            const waitMs = Math.min(delayMs * 2 ** (attempt - 1), 30_000);
            console.warn(
                `[bot] Failed to register slash commands (attempt ${attempt}/${attempts}). Retrying in ${waitMs}ms…`,
            );
            await delay(waitMs);
        }
    }
}

async function respond(interaction, payload) {
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
    } else {
        await interaction.reply({ ...payload, ephemeral: true });
    }
}

async function ensureDeferred(interaction) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
    }
}

async function handleDemonLookupCommand(interaction) {
    const term = interaction.options.getString('name');
    if (!term || !String(term).trim()) {
        await interaction.reply({ content: 'Provide a demon name to look up.', ephemeral: true });
        return;
    }
    const query = String(term).trim();
    await ensureDeferred(interaction);
    try {
        const demon = await resolveDemon(query);
        if (demon) {
            const message = formatDemonResponse(demon);
            await respond(interaction, { content: message });
            return;
        }
        const suggestion = await findClosestDemon(query);
        if (suggestion) {
            await respond(interaction, {
                content: `No exact match. Did you mean **${suggestion.name}**? Try \`/codex ${suggestion.name}\`.`,
            });
        } else {
            await respond(interaction, { content: `No demon found matching **${query}**.` });
        }
    } catch (err) {
        console.error('[bot] Failed to process demon lookup:', err);
        await respond(interaction, { content: 'Something went wrong looking up that demon.' });
    }
}

async function handleLinkCommand(interaction) {
    const discordUserId = interaction.user?.id || interaction.member?.user?.id;
    if (!discordUserId) {
        await interaction.reply({ content: 'Unable to determine your Discord user ID.', ephemeral: true });
        return;
    }
    const usernameInput = interaction.options.getString('username');
    const normalized = typeof usernameInput === 'string' ? usernameInput.trim() : '';
    if (!normalized) {
        await interaction.reply({ content: 'Provide the Jack Endex username you want to link.', ephemeral: true });
        return;
    }
    await ensureDeferred(interaction);
    try {
        const user = await User.findOne({
            username: { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' },
        }).exec();
        if (!user) {
            await respond(interaction, {
                content: `No Jack Endex account found for **${normalized}**. Check the spelling and try again.`,
            });
            return;
        }
        if (user.discordId && user.discordId !== discordUserId) {
            await respond(interaction, {
                content: 'That Jack Endex account is already linked to a different Discord user.',
            });
            return;
        }
        const existingLink = await User.findOne({
            _id: { $ne: user._id },
            discordId: discordUserId,
        }).exec();
        if (existingLink) {
            await respond(interaction, {
                content: `Your Discord account is already linked to **${existingLink.username}**.`,
            });
            return;
        }
        if (user.discordId === discordUserId) {
            await respond(interaction, {
                content: `Your Discord account is already linked to **${user.username}**.`,
            });
            return;
        }
        user.discordId = discordUserId;
        await user.save();
        await respond(interaction, {
            content: `Success! Your Discord account is now linked to **${user.username}**.`,
        });
    } catch (err) {
        console.error('[bot] Failed to link Discord account:', err);
        await respond(interaction, {
            content: 'Something went wrong while linking your account. Please try again later.',
        });
    }
}

async function handleUnlinkCommand(interaction) {
    const discordUserId = interaction.user?.id || interaction.member?.user?.id;
    if (!discordUserId) {
        await interaction.reply({ content: 'Unable to determine your Discord user ID.', ephemeral: true });
        return;
    }
    await ensureDeferred(interaction);
    try {
        const user = await User.findOne({ discordId: discordUserId }).exec();
        if (!user) {
            await respond(interaction, { content: 'Your Discord account is not linked to any Jack Endex profile.' });
            return;
        }
        user.discordId = undefined;
        await user.save();
        await respond(interaction, {
            content: `Your Discord account is no longer linked to **${user.username}**.`,
        });
    } catch (err) {
        console.error('[bot] Failed to unlink Discord account:', err);
        await respond(interaction, {
            content: 'Something went wrong while unlinking your account. Please try again later.',
        });
    }
}

async function handleWhoAmICommand(interaction) {
    const discordUserId = interaction.user?.id || interaction.member?.user?.id;
    if (!discordUserId) {
        await interaction.reply({ content: 'Unable to determine your Discord user ID.', ephemeral: true });
        return;
    }
    await ensureDeferred(interaction);
    try {
        const user = await User.findOne({ discordId: discordUserId }).exec();
        if (!user) {
            await respond(interaction, {
                content: 'Your Discord account is not linked to any Jack Endex profile yet. Try `/link <username>`.',
            });
            return;
        }
        await respond(interaction, {
            content: `Your Discord account is linked to **${user.username}**.`,
        });
    } catch (err) {
        console.error('[bot] Failed to read link status:', err);
        await respond(interaction, {
            content: 'Something went wrong while checking your link status. Please try again later.',
        });
    }
}

const COMMAND_HANDLERS = new Map([
    ['codex', handleDemonLookupCommand],
    ['demonlookup', handleDemonLookupCommand],
    ['link', handleLinkCommand],
    ['unlink', handleUnlinkCommand],
    ['whoami', handleWhoAmICommand],
]);

let client = null;
let shuttingDown = false;

function startClient() {
    client = new Client({
        intents: [GatewayIntentBits.Guilds],
    });

    client.once(Events.ClientReady, (readyClient) => {
        const tag = readyClient.user?.tag || readyClient.user?.username || 'bot';
        console.log(`[bot] Ready as ${tag}.`);
        if (readyClient.user) {
            readyClient.user.setPresence({
                activities: [{ name: '/codex <demon>', type: ActivityType.Listening }],
                status: 'online',
            }).catch((err) => {
                console.warn('[bot] Failed to set presence:', err);
            });
        }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        const handler = COMMAND_HANDLERS.get(interaction.commandName);
        if (!handler) {
            await interaction.reply({
                content: 'That command is not supported yet.',
                ephemeral: true,
            }).catch((err) => {
                console.error('[bot] Failed to respond to unknown command:', err);
            });
            return;
        }
        try {
            await handler(interaction);
        } catch (err) {
            console.error('[bot] Unexpected error handling interaction:', err);
            try {
                await respond(interaction, {
                    content: 'Something went wrong while handling that command.',
                });
            } catch (respondErr) {
                console.error('[bot] Failed to send error response:', respondErr);
            }
        }
    });

    client.on('error', (err) => {
        console.error('[bot] Client error:', err);
    });

    client.on('shardError', (err, shardId) => {
        console.error(`[bot] Shard ${shardId} error:`, err);
    });

    client.on('warn', (message) => {
        console.warn('[bot] Warning:', message);
    });

    return client.login(token).catch((err) => {
        console.error('[bot] Failed to log in:', err);
        throw err;
    });
}

async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[bot] Received ${signal}. Shutting down…`);
    try {
        if (client) {
            await client.destroy();
        }
    } catch (err) {
        console.error('[bot] Error destroying Discord client:', err);
    }
    try {
        await mongoose.disconnect();
    } catch (err) {
        console.error('[bot] Error during shutdown:', err);
    }
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
    console.error('[bot] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('[bot] Unhandled rejection:', reason);
});

async function main() {
    try {
        await connectToDatabaseWithRetry(uri, { dbName: dbName || undefined });
        await registerSlashCommandsWithRetry();
        console.log('[bot] Connected to MongoDB. Starting Discord client…');
        await startClient();
    } catch (err) {
        console.error('[bot] Failed to start bot. Exiting.', err);
        process.exit(1);
    }
}

await main();
