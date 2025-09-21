# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Discord story log sync

The in-app **Story Logs** tab now both reads and posts messages through the backend. To wire things up:

1. Invite a Discord bot that can view your campaign channels. Each campaign may use its own bot token, or you can provide a shared fallback token before starting `node server.js`:

   ```bash
   export DISCORD_BOT_TOKEN="<optional fallback bot token with read history access>"
   ```

   Use [the Discord developer portal](https://discord.com/developers/applications) to create a bot and invite it with the `Read Messages/View Channel` and `Read Message History` permissions. If the webhook will post to a different server, also grant it access there.

2. Inside the app, each campaign's **Settings → Discord story integration** panel lets the DM supply:

   - A Discord bot token dedicated to that campaign (falls back to the shared token if omitted).

   - The Discord channel snowflake to watch.
   - An optional guild ID used for validation and jump links.
   - A Discord webhook URL that determines how outbound messages appear.
   - Whether players may post from the dashboard and which players can act as **Scribes**.

Once saved, the Story tab shows live channel activity, allows approved users to speak as the bot, Dungeon Master, Scribe, or specific players, and renders Discord image attachments inline.
