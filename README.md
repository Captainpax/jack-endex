# Jack Endex Campaign Dashboard

Jack Endex is a full-stack toolkit for running tabletop campaigns with a digital codex, combat tracker, and Discord integration. The backend is powered by Express and MongoDB, while the client is a React + Vite single-page app.

## Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [MongoDB](https://www.mongodb.com/) connection that the server can reach

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the required values. At minimum you must provide:

   ```ini
   MONGODB_URI=mongodb://localhost:27017/jack-endex
   SESSION_SECRET=use-a-strong-secret
   ```

   You can optionally supply a shared Discord bot token and invite link so every campaign can fall back to the same bot. Dungeon Masters may still provide their own tokens per campaign inside the app.

3. Import the demon codex into MongoDB (run with `--dry-run` first if you want to preview changes):

   ```bash
   npm run import:demons -- --dry-run
   npm run import:demons
   ```

4. Start the development servers (REST API + Vite dev client):

   ```bash
   npm run dev
   ```

   The API listens on `http://localhost:3000` and the React client on `http://localhost:5173`.

## Discord integration

### Story synchronization

Each campaign can read and post to a dedicated Discord channel. In **Settings → Discord story integration** the DM can set:

- A per-campaign bot token (optional if you configure a shared token in `.env`).
- Channel and guild snowflakes to watch.
- A webhook URL for posting as the bot, DM, scribe, or specific players.
- Player permissions and scribe access.

If no per-campaign token is supplied, the server falls back to `DISCORD_PRIMARY_BOT_TOKEN` (or the legacy keys) defined in your environment.

### Slash command codex lookup

A lightweight gateway client powers the `/lookup demon <name>` slash command. To enable it:

1. Set `DISCORD_APPLICATION_ID` and `DISCORD_PRIMARY_BOT_TOKEN` in your `.env`. Optionally set `DISCORD_COMMAND_GUILD_ID` for per-guild registration and `DISCORD_PRIMARY_BOT_INVITE` so DMs can invite the shared bot to their own servers.

2. Register the command with Discord:

   ```bash
   npm run register:discord
   ```

3. Run the lookup bot (ensure MongoDB is reachable so it can query the codex):

   ```bash
   npm run bot:demon
   ```

The bot listens for slash-command interactions and responds with a formatted codex summary, including close-match suggestions for typos.

## Helpful scripts

| Command | Description |
| --- | --- |
| `npm run import:demons` | Convert `data/demons.json` into MongoDB documents (use `--dry-run` to preview). |
| `npm run test:import` | Runs the demon import in dry-run mode to confirm the mapping step. |
| `npm run register:discord` | Registers or updates the `/lookup demon` slash command. |
| `npm run bot:demon` | Starts the Discord gateway bot that powers the slash command. |
| `npm run dev` | Runs the API server and Vite dev client together. |
| `npm run start` | Launches the API server only (expects a built client in `dist/`). |
| `npm run build` | Builds the production React bundle. |
| `npm run lint` | Lints the entire project. |

## Importing additional data

The importer lives in `scripts/import-demons.js`. The module exports `importDemons()` so you can integrate it into other build pipelines if needed. Pass `{ dropMissing: false }` to keep existing MongoDB entries that are not present in the JSON source.

## Matrix rain and UI polish

The background activity indicator (matrix rain) now reacts to both API traffic and URL changes, keeping the motion synced as you navigate between campaign views. The demon codex tab has also been refreshed with a new card layout for faster scanning of stats, resistances, and skill loads.

Happy demon wrangling!
