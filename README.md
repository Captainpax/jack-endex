# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Discord story log sync

The in-app **Story Logs** tab now reads messages through the backend. Provide a Discord bot token with permission to view the story log channel and configure the server with the following environment variables before starting `node server.js`:

```
DISCORD_BOT_TOKEN=<bot token with access to the channel>
DISCORD_CHANNEL_ID=<channel id to watch>

# Optional
DISCORD_GUILD_ID=<guild id used to sanity-check the channel>
DISCORD_POLL_INTERVAL_MS=15000   # how often to poll the channel (default 15s)
DISCORD_MAX_MESSAGES=50          # how many recent messages to keep in memory (max 100)
```

Invite the bot to your server with the `Read Messages/View Channel` and `Read Message History` permissions so the sync can succeed.
