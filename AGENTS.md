# Repository Guidelines

Welcome! A few high-level notes to keep future contributions aligned:

- **Client entry point**: The web client lives under `client/` and boots from `client/src/main.ts`. It is a Vue 3 single-page app built with Vite, so prefer `<script setup>` SFCs and Vue composition APIs when adding UI features.
- **Shared code**: Common utilities, data, and type definitions that need to be consumed by both the server and the client belong in the `shared/` workspace. Keep cross-cutting updates in sync and avoid duplicating logic between packages.
- **Testing & linting**: Run `npm run lint` for ESLint (configured for Vue + Node) and `npm run test` for the Vitest suite. For end-to-end smoke checks you can use `npm run preview` after a build.
- **Development servers**: `npm run dev` starts both the Express API (`server/`) and the Vite dev server for the Vue client.

Thanks for helping keep the codex tidy!
