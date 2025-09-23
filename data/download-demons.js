// data/download-demons-playwright.js
/* eslint-env node */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pLimit from "p-limit";           // npm i p-limit
import { chromium } from "playwright";  // npm i -D playwright

const MIN_HUMAN_DELAY_MS = 1_200;
const MAX_HUMAN_DELAY_MS = 3_400;
const POST_SAVE_DELAY_MS = [600, 1_200];
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_BASE_MS = 2_000;
const RETRY_DELAY_JITTER_MS = 2_500;
const RETRY_GROWTH_MS = 1_500;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, "demon_images");
const CONCURRENCY = 4; // polite + stable
const TIMEOUT_MS = 45_000;

// --- load demons.json without import assertions ---
const DEMONS_JSON_PATH = path.resolve(__dirname, "demons.json");
const demons = JSON.parse(fs.readFileSync(DEMONS_JSON_PATH, "utf8"));

function slugify(name) {
    return String(name)
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
        .replace(/\s+/g, " ")
        .replace(/^\.+$/, "_")
        .slice(0, 120);
}

function extFromContentType(ct) {
    if (!ct) return null;
    const m = ct.toLowerCase();
    if (m.includes("image/png")) return ".png";
    if (m.includes("image/jpeg")) return ".jpg";
    if (m.includes("image/webp")) return ".webp";
    if (m.includes("image/gif")) return ".gif";
    if (m.includes("image/svg")) return ".svg";
    return null;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

async function humanDelay(min = MIN_HUMAN_DELAY_MS, max = MAX_HUMAN_DELAY_MS) {
    const delay = randomBetween(min, max);
    await sleep(delay);
    return delay;
}

function shouldRetry(status, reason) {
    if (!status && !reason) return false;
    const retryableStatuses = new Set([403, 408, 409, 425, 429, 500, 502, 503, 504]);
    if (status && retryableStatuses.has(status)) return true;

    if (reason) {
        const lower = reason.toLowerCase();
        if (
            lower.includes("cloudflare") ||
            lower.includes("timeout") ||
            lower.includes("etimedout") ||
            lower.includes("navigation") ||
            lower.includes("net::err")
        ) {
            return true;
        }
    }

    return false;
}

async function attemptDownload(context, demon) {
    const { name, image } = demon || {};
    if (!name || !image) return { ok: false, name, reason: "missing fields" };

    const safeName = slugify(name);
    const demonDir = path.join(OUTPUT_DIR, safeName);
    if (!fs.existsSync(demonDir)) fs.mkdirSync(demonDir, { recursive: true });

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    let status = null;

    try {
        await page.setExtraHTTPHeaders({
            Referer: "https://megatenwiki.com/",
            Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Cache-Control": "no-cache",
        });

        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/120.0.0.0 Safari/537.36"
        );

        await humanDelay();

        const resp = await page.goto(image, { waitUntil: "networkidle" });
        if (!resp) throw new Error("No response");

        status = resp.status();
        if (status !== 200) {
            const err = new Error(`HTTP ${status}`);
            err.status = status;
            throw err;
        }

        await page.waitForLoadState("networkidle").catch(() => {});
        await humanDelay(650, 1_500);

        let ext = extFromContentType(resp.headers()["content-type"]);
        if (!ext) {
            const urlPath = new URL(image).pathname;
            ext = path.extname(urlPath) || ".png";
        }

        const outPath = path.join(demonDir, `${safeName}${ext}`);
        const buff = await resp.body();
        fs.writeFileSync(outPath, buff);

        return { ok: true, name, path: outPath };
    } catch (err) {
        return {
            ok: false,
            name,
            reason: err?.message || "unknown error",
            status: err?.status ?? status,
        };
    } finally {
        await page.close().catch(() => {});
    }
}

async function downloadDemon(context, demon) {
    const { name } = demon || {};
    if (!name || !demon?.image) {
        return { ok: false, name, reason: "missing fields" };
    }

    let lastResult = { ok: false, name, reason: "unknown" };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        await humanDelay();
        const result = await attemptDownload(context, demon);

        if (result.ok) {
            console.log(`✅ Saved ${result.name} -> ${result.path}`);
            await humanDelay(...POST_SAVE_DELAY_MS);
            return result;
        }

        const { reason, status } = result;
        const retry = attempt < MAX_ATTEMPTS && shouldRetry(status, reason);
        const statusInfo = status ? ` [${status}]` : "";
        const prefix = retry ? "⚠️" : "❌";
        console.warn(`${prefix} Failed for ${result.name} (attempt ${attempt}/${MAX_ATTEMPTS}): ${reason}${statusInfo}`);

        lastResult = result;

        if (!retry) {
            return result;
        }

        const waitMs =
            RETRY_DELAY_BASE_MS +
            attempt * RETRY_GROWTH_MS +
            Math.floor(Math.random() * RETRY_DELAY_JITTER_MS);
        console.warn(`   Waiting ${(waitMs / 1000).toFixed(1)}s before retry...`);
        await sleep(waitMs);
    }

    return lastResult;
}

async function main() {
    if (!Array.isArray(demons)) {
        console.error("demons.json is not an array.");
        process.exit(1);
    }
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        baseURL: "https://megatenwiki.com",
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/120.0.0.0 Safari/537.36",
    });

    // Warm-up to pick up cookies/tokens if needed
    try {
        const warm = await context.newPage();
        await warm.goto("https://megatenwiki.com/", { waitUntil: "domcontentloaded" });
        await warm.close();
    } catch {}

    const limit = pLimit(CONCURRENCY);
    const tasks = demons.map((d) => limit(() => downloadDemon(context, d)));
    const results = await Promise.all(tasks);

    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    console.log(`\nDone. ✅ ${ok} succeeded, ❌ ${fail} failed.`);

    await context.close();
    await browser.close();
}

main().catch((e) => {
    console.error("Unexpected error:", e);
    process.exit(1);
});
