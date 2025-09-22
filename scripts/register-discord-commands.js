import { loadEnv, envString } from '../config/env.js';

const API_BASE = 'https://discord.com/api/v10';

await loadEnv();

const token = envString('DISCORD_PRIMARY_BOT_TOKEN')
    || envString('DISCORD_DEFAULT_BOT_TOKEN')
    || envString('DISCORD_BOT_TOKEN')
    || envString('BOT_TOKEN');
const applicationId = envString('DISCORD_APPLICATION_ID');
const guildId = envString('DISCORD_COMMAND_GUILD_ID')
    || envString('DISCORD_PRIMARY_GUILD_ID')
    || envString('DISCORD_GUILD_ID');

if (!token) {
    console.error('Missing bot token. Set DISCORD_PRIMARY_BOT_TOKEN or DISCORD_BOT_TOKEN.');
    process.exit(1);
}
if (!applicationId) {
    console.error('Missing DISCORD_APPLICATION_ID environment variable.');
    process.exit(1);
}

const command = {
    name: 'lookup',
    description: 'Look up codex information',
    options: [
        {
            type: 1,
            name: 'demon',
            description: 'Look up a demon in the codex',
            options: [
                {
                    type: 3,
                    name: 'name',
                    description: 'Name or slug of the demon',
                    required: true,
                },
            ],
        },
    ],
};

const url = guildId
    ? `${API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`
    : `${API_BASE}/applications/${applicationId}/commands`;

const res = await fetch(url, {
    method: 'PUT',
    headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify([command]),
});

if (!res.ok) {
    const text = await res.text();
    console.error('Failed to register slash command:', res.status, text);
    process.exit(1);
}

console.log(`Registered /lookup demon command${guildId ? ` for guild ${guildId}` : ' globally'}.`);
