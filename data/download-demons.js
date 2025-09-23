/* eslint-env node */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==== CONFIG ====
const LOCAL_API_BASE = process.env.PERSONA_API_BASE || "http://localhost:3000/api/personas";
const OUTPUT_DIR = path.resolve(__dirname, "demon_images");
const CONCURRENCY = 6;

// ========= UTIL =========
function slugify(s) {
    return String(s)
        .trim()
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
        .replace(/\s+/g, " ")
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

// Get the full list of persona slugs from the compendium root (via your proxy or directly)
async function fetchAllSlugs() {
    // We can piggyback your /search route by enumerating the upstream root,
    // but better: call the upstream root exactly like your /search does.
    const rootResp = await axios.get("https://persona-compendium.onrender.com/", { timeout: 30000 });
    const data = rootResp.data || {};
    const list = data["Persona Compendium API is live! Here's a list of all possible endpoints: /personas/"] || [];
    const slugs = list
        .map(String)
        .filter((p) => p.startsWith("/personas/") && p.endsWith("/"))
        .map((p) => p.replace("/personas/", "").replace("/", ""));
    return slugs;
}

async function fetchPersona(slug) {
    // Use your local proxy (preferred) so you can add caching/rate-limits later
    const url = `${LOCAL_API_BASE}/${encodeURIComponent(slug)}`;
    const r = await axios.get(url, { timeout: 30000 });
    return r.data;
}

async function downloadImage(name, imageUrl) {
    const safe = slugify(name);
    const dir = path.join(OUTPUT_DIR, safe);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // HEAD to guess extension (optional)
    let ext = path.extname(new URL(imageUrl).pathname);
    try {
        const head = await axios.head(imageUrl, { timeout: 15000, maxRedirects: 5, validateStatus: () => true });
        const guess = extFromContentType(head.headers["content-type"]);
        if (!ext && guess) ext = guess;
    } catch {
        // ignore
    }
    if (!ext) ext = ".png";

    const outPath = path.join(dir, `${safe}${ext}`);

    const resp = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
        maxRedirects: 5,
        headers: {
            // browser-y headers; most CDNs are fine with this
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Cache-Control": "no-cache",
            Referer: "https://persona-compendium.onrender.com/",
        },
        validateStatus: () => true,
    });

    if (resp.status !== 200 || !resp.data) {
        throw new Error(`HTTP ${resp.status} for ${imageUrl}`);
    }

    fs.writeFileSync(outPath, resp.data);
    return outPath;
}

function pLimit(n) {
    const q = [];
    let active = 0;
    const next = () => {
        active--;
        if (q.length) q.shift()();
    };
    return (fn) =>
        new Promise((res, rej) => {
            const run = () => {
                active++;
                fn().then((v) => {
                    res(v);
                    next();
                }, (e) => {
                    rej(e);
                    next();
                });
            };
            active < n ? run() : q.push(run);
        });
}

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    console.log("🔎 Fetching persona slugs…");
    const slugs = await fetchAllSlugs();
    console.log(`Found ${slugs.length} personas.`);

    const limit = pLimit(CONCURRENCY);
    let ok = 0, fail = 0;

    await Promise.all(
        slugs.map((slug) =>
            limit(async () => {
                try {
                    const persona = await fetchPersona(slug);
                    const name = persona?.name || slug;
                    const imageUrl = persona?.image || persona?.img || persona?.picture || null;
                    if (!imageUrl) throw new Error("no image field on persona");

                    const p = await downloadImage(name, imageUrl);
                    console.log(`✅ ${name} -> ${p}`);
                    ok++;
                } catch (e) {
                    console.warn(`❌ ${slug}: ${e.message}`);
                    fail++;
                }
            })
        )
    );

    console.log(`\nDone. ✅ ${ok} succeeded, ❌ ${fail} failed.`);
}

main().catch((e) => {
    console.error("Unexpected error:", e);
    process.exit(1);
});
