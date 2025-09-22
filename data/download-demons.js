// data/download-demons-playwright.js
/* eslint-env node */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pLimit from "p-limit";           // npm i p-limit
import { chromium } from "playwright";  // npm i -D playwright

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
        // eslint-disable-next-line no-control-regex
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

async function downloadWithPage(context, demon) {
    const { name, image } = demon || {};
    if (!name || !image) return { ok: false, name, reason: "missing fields" };

    const safeName = slugify(name);
    const demonDir = path.join(OUTPUT_DIR, safeName);
    if (!fs.existsSync(demonDir)) fs.mkdirSync(demonDir, { recursive: true });

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    try {
        // Look like a real browser visit from their site.
        await page.setExtraHTTPHeaders({
            Referer: "https://megatenwiki.com/",
            Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Cache-Control": "no-cache",
        });

        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/120.0.0.0 Safari/537.36"
        );

        const resp = await page.goto(image, { waitUntil: "networkidle" });
        if (!resp) throw new Error("No response");
        if (resp.status() !== 200) throw new Error(`HTTP ${resp.status()}`);

        let ext = extFromContentType(resp.headers()["content-type"]);
        if (!ext) {
            const urlPath = new URL(image).pathname;
            ext = path.extname(urlPath) || ".png";
        }

        const outPath = path.join(demonDir, `${safeName}${ext}`);
        const buff = await resp.body();
        fs.writeFileSync(outPath, buff);
        console.log(`✅ Saved ${name} -> ${outPath}`);
        return { ok: true, name, path: outPath };
    } catch (err) {
        console.error(`❌ Failed for ${name}: ${err.message}`);
        return { ok: false, name, reason: err.message };
    } finally {
        await page.close().catch(() => {});
    }
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
    } catch { /* empty */ }

    const limit = pLimit(CONCURRENCY);
    const tasks = demons.map((d) => limit(() => downloadWithPage(context, d)));
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
