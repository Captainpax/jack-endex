# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Discord story log embed

The in-app **Story Logs** tab displays a live Discord channel feed. Configure the following environment variables (e.g. in a `.env` file loaded by Vite) so the widget knows which guild and channel to show:

```
VITE_DISCORD_SERVER_ID=<your discord guild/server id>
VITE_DISCORD_CHANNEL_ID=<the story log channel id>

# Optional overrides
VITE_DISCORD_WIDGET_BASE=https://e.widgetbot.io/channels
VITE_DISCORD_WIDGET_THEME=dark
```

Restart the Vite dev server after editing the variables so the client receives the updated values.
