import { Router } from 'express';
import { generateCharacterImage, enhanceBackgroundAndNotes } from '../services/localAi.js';

const router = Router();

function normalizeCharacterPayload(value) {
    if (!value || typeof value !== 'object') return {};
    return value;
}

router.post('/portrait', async (req, res) => {
    try {
        const character = normalizeCharacterPayload(req.body?.character);
        const overrides = req.body?.overrides && typeof req.body.overrides === 'object' ? req.body.overrides : {};
        const result = await generateCharacterImage(character, overrides);
        res.json(result);
    } catch (err) {
        console.error('Failed to generate portrait', err);
        const status = err?.status || 502;
        res.status(status).json({ error: err?.message || 'Image generation failed' });
    }
});

router.post('/background', async (req, res) => {
    try {
        const character = normalizeCharacterPayload(req.body?.character);
        const background = typeof req.body?.background === 'string' ? req.body.background : '';
        const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
        const result = await enhanceBackgroundAndNotes(character, background, notes);
        res.json(result);
    } catch (err) {
        console.error('Failed to enhance background', err);
        const status = err?.status || 502;
        res.status(status).json({ error: err?.message || 'Background enhancement failed' });
    }
});

export default router;
