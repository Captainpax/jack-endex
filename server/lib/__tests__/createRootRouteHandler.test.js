import { describe, expect, it } from 'vitest';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { createRootRouteHandler } from '../createRootRouteHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SPA_INDEX = path.join(PROJECT_ROOT, 'client', 'index.html');

async function requestApp(app, pathname) {
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        instance.on('error', reject);
    });

    const { port } = server.address();
    const url = `http://127.0.0.1:${port}${pathname}`;

    try {
        const response = await fetch(url, { redirect: 'manual' });
        const text = await response.text();
        return { response, text };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

describe('createRootRouteHandler', () => {
    it('redirects unauthenticated requests to /login', async () => {
        const app = express();
        app.get('/', createRootRouteHandler({ spaIndexPath: SPA_INDEX }));

        const { response } = await requestApp(app, '/');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/login');
    });

    it('serves the SPA shell when a session is present', async () => {
        const app = express();
        app.use((req, _res, next) => {
            req.session = { userId: 'user-123' };
            next();
        });
        app.get('/', createRootRouteHandler({ spaIndexPath: SPA_INDEX }));

        const { response, text } = await requestApp(app, '/');

        expect(response.status).toBe(200);
        expect(text.toLowerCase()).toContain('<!doctype html>');
    });
});
