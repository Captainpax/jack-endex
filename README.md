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

## Deploying behind custom domains

When hosting the API and frontend on different domains (for example,
`https://jack-api.darkmatterservers.com` and
`https://jack-endex.darkmatterservers.com`) update your `.env` file with the
additional settings introduced in `.env.example`:

```ini
# Allow the production SPA to call the API with cookies
CORS_ORIGINS=https://jack-endex.darkmatterservers.com

# Required when the API sits behind a TLS-terminating proxy
TRUST_PROXY=1

# Cookies must be secure + SameSite "none" for cross-origin XHR/fetch
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=none
# Optional: share cookies across subdomains
SESSION_COOKIE_DOMAIN=.darkmatterservers.com

# Tell the Vite build where to find the API in production
VITE_API_BASE=https://jack-api.darkmatterservers.com
```

After rebuilding the frontend (`npm run build`) and restarting the API server,
the hosted client will authenticate against the remote API using secure
cookies.

### Issuing an HTTPS certificate with Let's Encrypt

The Node API does not terminate TLS directly; instead, place it behind a
reverse proxy (for example, Nginx or Caddy) that can obtain and renew HTTPS
certificates automatically. The example below uses Nginx together with
[Certbot](https://certbot.eff.org/) to secure `https://jack-api.darkmatterservers.com`.

1. **Install Nginx and Certbot** on the server that will host the API. The
   Certbot site provides OS-specific instructions. Make sure ports 80 and 443
   are reachable from the internet.

2. **Stop anything that might be listening on port 80**, then request a
   certificate:

   ```bash
   sudo certbot certonly --standalone -d jack-api.darkmatterservers.com
   ```

   Certbot stores the certificate and private key in `/etc/letsencrypt/live/…`.
   Renewal is automatic; Certbot installs a systemd timer/cron job that runs
   `certbot renew`. You can dry-run the renewal with `sudo certbot renew --dry-run`.

3. **Create an Nginx site** that forwards HTTPS traffic to the Node process.
   Replace the `proxy_pass` target if your API runs on a non-default port.

   ```nginx
   server {
       listen 80;
       server_name jack-api.darkmatterservers.com;
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name jack-api.darkmatterservers.com;

       ssl_certificate /etc/letsencrypt/live/jack-api.darkmatterservers.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/jack-api.darkmatterservers.com/privkey.pem;
       include /etc/letsencrypt/options-ssl-nginx.conf;
       ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto https;
       }
   }
   ```

4. **Enable the site and reload Nginx**. On Debian/Ubuntu this is:

   ```bash
   sudo ln -s /etc/nginx/sites-available/jack-endex.conf /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

5. **Restart the API server** so it reads the production `.env` values shown
   above (`CORS_ORIGINS`, `TRUST_PROXY`, `SESSION_COOKIE_SECURE`, etc.). The
   proxy sets `X-Forwarded-Proto: https`, letting Express know that requests are
   already encrypted.

With this setup the frontend continues to load over HTTPS, and all API calls
to `https://jack-api.darkmatterservers.com` stay encrypted end-to-end.

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
