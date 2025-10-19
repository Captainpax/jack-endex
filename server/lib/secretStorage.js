import crypto from 'crypto';

export const SECRET_MASK = '********';

function deriveKey(rawKey) {
    if (typeof rawKey !== 'string' || !rawKey.trim()) {
        return null;
    }
    return crypto.createHash('sha256').update(rawKey.trim(), 'utf8').digest();
}

export function createSecretBox(rawKey = '') {
    const key = deriveKey(rawKey);
    const hasKey = !!key;

    function encrypt(value) {
        if (typeof value !== 'string') {
            return '';
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return '';
        }
        if (!hasKey) {
            return trimmed;
        }
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ciphertext = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return {
            __type: 'secretbox',
            v: 1,
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            ciphertext: ciphertext.toString('base64'),
        };
    }

    function decrypt(payload) {
        if (typeof payload === 'string') {
            return payload.trim();
        }
        if (!hasKey) {
            return '';
        }
        if (!payload || typeof payload !== 'object') {
            return '';
        }
        if (payload.__type !== 'secretbox' || payload.v !== 1) {
            return '';
        }
        try {
            const iv = Buffer.from(payload.iv || '', 'base64');
            const tag = Buffer.from(payload.tag || '', 'base64');
            const ciphertext = Buffer.from(payload.ciphertext || '', 'base64');
            if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
                return '';
            }
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            const output = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            return output.toString('utf8');
        } catch {
            return '';
        }
    }

    function isEncrypted(payload) {
        return !!payload && typeof payload === 'object' && payload.__type === 'secretbox' && payload.v === 1;
    }

    function mask(payload) {
        if (typeof payload === 'string') {
            return payload.trim() ? SECRET_MASK : '';
        }
        if (isEncrypted(payload)) {
            return SECRET_MASK;
        }
        return '';
    }

    return {
        hasKey,
        encrypt,
        decrypt,
        isEncrypted,
        mask,
    };
}
