#!/usr/bin/env node
/* eslint-env node */
import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';
import { fileURLToPath } from 'url';
import { setTimeout as sleep } from 'node:timers/promises';

const MAX_CONCURRENT_DOWNLOADS = 4;
const HUMAN_DELAY_MIN_MS = 1200;
const HUMAN_DELAY_MAX_MS = 3200;
const BETWEEN_BATCH_DELAY_MIN_MS = 350;
const BETWEEN_BATCH_DELAY_MAX_MS = 900;
const MAX_RETRIES = 5;
const RETRY_BACKOFF_BASE_MS = 2500;
const OUTPUT_SUBDIR = ['public', 'images', 'personas'];
const KNOWN_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp'];

const HUMAN_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://megatenwiki.com/wiki/Main_Page',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
};

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanDelay(min = HUMAN_DELAY_MIN_MS, max = HUMAN_DELAY_MAX_MS) {
    const duration = randomBetween(min, max);
    await sleep(duration);
}

function toSlug(value, fallback = 'demon') {
    if (typeof value === 'string') {
        const normalized = value
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        if (normalized) {
            return normalized;
        }
    }
    return fallback;
}

function guessExtensionFromUrl(rawUrl) {
    if (!rawUrl) return '';
    try {
        const parsed = new URL(rawUrl);
        const pathname = parsed.pathname || '';
        const ext = path.extname(pathname.split(/[?#]/)[0]);
        if (ext && KNOWN_EXTENSIONS.includes(ext.toLowerCase())) {
            return ext.toLowerCase();
        }
    } catch {}
    const fallback = String(rawUrl).split(/[?#]/)[0];
    const match = fallback.match(/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i);
    if (match) {
        return `.${match[1].toLowerCase().replace('jpeg', 'jpg')}`;
    }
    return '';
}

function extensionFromContentType(contentType, current = '') {
    if (typeof contentType !== 'string' || !contentType) {
        return current;
    }
    const type = contentType.split(';')[0].trim().toLowerCase();
    const map = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/pjpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'image/avif': '.avif',
        'image/bmp': '.bmp',
    };
    return map[type] || current;
}

async function ensureOutputDir(repoRoot) {
    const target = path.join(repoRoot, ...OUTPUT_SUBDIR);
    await fs.mkdir(target, { recursive: true });
    return target;
}

async function findExistingFile(basePath) {
    for (const ext of KNOWN_EXTENSIONS) {
        const candidate = `${basePath}${ext}`;
        try {
            const stats = await fs.stat(candidate);
            if (stats.isFile() && stats.size > 0) {
                return candidate;
            }
        } catch {}
    }
    return null;
}

async function saveBuffer(targetBasePath, buffer, extension) {
    const finalExt = extension && KNOWN_EXTENSIONS.includes(extension) ? extension : '.png';
    const finalPath = `${targetBasePath}${finalExt}`;
    await fs.writeFile(finalPath, buffer);
    return finalPath;
}

async function downloadImage(demon, targetDir) {
    const trimmedUrl = typeof demon.image === 'string' ? demon.image.trim() : '';
    if (!trimmedUrl) {
        console.warn(`⚠️  ${demon.name ?? 'Unknown demon'} has no image URL, skipping.`);
        return { status: 'skipped', demon };
    }

    const idPart = String(demon.id ?? demon.index ?? demon.name ?? 'unknown');
    const paddedId = idPart.replace(/\D/g, '').padStart(4, '0') || idPart;
    const slug = toSlug(demon.name ?? demon.query ?? paddedId, `demon-${paddedId}`);
    const baseName = `${paddedId}-${slug}`.replace(/-+/g, '-');
    const targetBasePath = path.join(targetDir, baseName);

    const existing = await findExistingFile(targetBasePath);
    if (existing) {
        console.log(`✓ ${demon.name ?? slug} already downloaded (${path.basename(existing)})`);
        return { status: 'skipped-existing', demon, file: existing };
    }

    let extension = guessExtensionFromUrl(trimmedUrl);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        if (attempt > 1) {
            const backoff = RETRY_BACKOFF_BASE_MS * attempt + randomBetween(500, 1500);
            console.log(
                `⏳ Waiting ${Math.round(backoff / 1000)}s before retry ${attempt} for ${demon.name ?? slug}...`,
            );
            await sleep(backoff);
        }

        await humanDelay();

        try {
            const response = await globalThis.fetch(trimmedUrl, {
                method: 'GET',
                redirect: 'follow',
                signal: globalThis.AbortSignal.timeout(45000),
                headers: HUMAN_HEADERS,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            if (buffer.length === 0) {
                throw new Error('empty response body');
            }

            const contentType = response.headers.get('content-type');
            extension = extensionFromContentType(contentType, extension);
            if (!extension || !KNOWN_EXTENSIONS.includes(extension)) {
                extension = extension || '.png';
                if (!KNOWN_EXTENSIONS.includes(extension)) {
                    extension = '.png';
                }
            }

            const savedPath = await saveBuffer(targetBasePath, buffer, extension);
            await sleep(randomBetween(BETWEEN_BATCH_DELAY_MIN_MS, BETWEEN_BATCH_DELAY_MAX_MS));
            console.log(`✅ Downloaded ${demon.name ?? slug} -> ${path.relative(process.cwd(), savedPath)}`);
            return { status: 'downloaded', demon, file: savedPath };
        } catch (error) {
            console.warn(`❌ Failed to download ${demon.name ?? slug} (attempt ${attempt}): ${error.message}`);
        }
    }

    console.error(`🚫 Giving up on ${demon.name ?? slug} after ${MAX_RETRIES} attempts.`);
    return { status: 'failed', demon };
}

async function runQueue(demons, targetDir) {
    let index = 0;
    const results = [];

    async function next() {
        const currentIndex = index;
        if (currentIndex >= demons.length) {
            return null;
        }
        index += 1;
        const demon = demons[currentIndex];
        const result = await downloadImage(demon, targetDir);
        results.push(result);
        return next();
    }

    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_DOWNLOADS, demons.length) }, () => next());
    await Promise.all(workers);
    return results;
}

async function main() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(dirname, '..');
    const demonsPath = path.join(repoRoot, 'data', 'demons.json');

    const outputDir = await ensureOutputDir(repoRoot);
    console.log(`📁 Downloading demon images into ${path.relative(repoRoot, outputDir)}`);

    const raw = await fs.readFile(demonsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('Expected data/demons.json to contain an array of demons.');
    }

    const demonsWithImages = parsed
        .map((demon, idx) => ({ ...demon, index: idx }))
        .filter((demon) => typeof demon.image === 'string' && demon.image.trim().length > 0);

    console.log(`🧾 Found ${demonsWithImages.length} demons with image URLs.`);

    const results = await runQueue(demonsWithImages, outputDir);

    const succeeded = results.filter((result) => result.status === 'downloaded').length;
    const skipped = results.filter((result) => result.status === 'skipped-existing').length;
    const failed = results.filter((result) => result.status === 'failed').length;

    console.log('--- Summary ---');
    console.log(`✅ Downloaded: ${succeeded}`);
    console.log(`⏭️  Skipped (existing): ${skipped}`);
    console.log(`⚠️  Failed: ${failed}`);

    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
