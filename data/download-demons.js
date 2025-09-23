/* eslint-env node */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==== CONFIG ====
const DEFAULT_API_BASE = "http://localhost:3000/api/personas";
const OUTPUT_DIR = path.resolve(__dirname, "demon_images");
const CONCURRENCY = 6;
const DEMON_IMAGE_REFERER =
    process.env.DEMON_IMAGE_REFERER || "https://megatenwiki.com/wiki/Main_Page";

function stripTrailingSlashes(value) {
    if (typeof value !== "string") return "";
    let out = value;
    while (out.endsWith("/")) {
        out = out.slice(0, -1);
    }
    return out;
}

const personaApiBaseRaw = process.env.PERSONA_API_BASE || DEFAULT_API_BASE;
const PERSONA_API_BASE = stripTrailingSlashes(personaApiBaseRaw) || DEFAULT_API_BASE;
const imageProxyBaseRaw = process.env.PERSONA_IMAGE_PROXY || `${PERSONA_API_BASE}/image-proxy`;
const IMAGE_PROXY_ENDPOINT = stripTrailingSlashes(imageProxyBaseRaw) || `${PERSONA_API_BASE}/image-proxy`;

const BROWSER_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: DEMON_IMAGE_REFERER,
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "same-origin",
};

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
    const url = `${PERSONA_API_BASE}/${encodeURIComponent(slug)}`;
    const r = await axios.get(url, { timeout: 30000 });
    return r.data;
}

function normalizeImageUrl(raw) {
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        const url = new URL(trimmed, "https://megatenwiki.com/");
        if (!/^https?:$/i.test(url.protocol)) return null;
        return url.toString();
    } catch {
        return null;
    }
}

async function downloadImage(name, imageUrl) {
    const safe = slugify(name);
    const dir = path.join(OUTPUT_DIR, safe);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const normalizedUrl = normalizeImageUrl(imageUrl);
    if (!normalizedUrl) {
        throw new Error("invalid or unsupported image url");
    }

    const attempts = [];

    async function attemptDirect() {
        const resp = await axios.get(normalizedUrl, {
            responseType: "arraybuffer",
            timeout: 60000,
            maxRedirects: 5,
            headers: BROWSER_HEADERS,
            decompress: true,
            validateStatus: () => true,
        });

        if (resp.status !== 200 || !resp.data) {
            throw new Error(`direct HTTP ${resp.status}`);
        }
        return {
            buffer: resp.data,
            contentType: resp.headers["content-type"] || "",
            source: "direct",
        };
    }

    async function attemptProxy() {
        if (!IMAGE_PROXY_ENDPOINT) {
            throw new Error("image proxy disabled");
        }
        const qs = new URLSearchParams({ src: normalizedUrl });
        const proxyUrl = `${IMAGE_PROXY_ENDPOINT}?${qs.toString()}`;
        const resp = await axios.get(proxyUrl, {
            responseType: "arraybuffer",
            timeout: 60000,
            headers: BROWSER_HEADERS,
            decompress: true,
            validateStatus: () => true,
        });
        if (resp.status !== 200 || !resp.data) {
            throw new Error(`proxy HTTP ${resp.status}`);
        }
        return {
            buffer: resp.data,
            contentType: resp.headers["content-type"] || "",
            source: "proxy",
        };
    }

    async function tryFetch() {
        try {
            return await attemptDirect();
        } catch (error) {
            attempts.push(error);
            console.warn(`⚠️ Direct fetch failed for ${name}: ${error.message}`);
        }

        try {
            return await attemptProxy();
        } catch (error) {
            attempts.push(error);
            console.warn(`⚠️ Proxy fetch failed for ${name}: ${error.message}`);
        }

        const messages = attempts.map((err) => err.message).join(", ");
        throw new Error(`all fetch attempts failed (${messages || "no attempts"})`);
    }

    const { buffer, contentType, source } = await tryFetch();

    let ext = path.extname(new URL(normalizedUrl).pathname) || "";
    if (!ext) {
        const guess = extFromContentType(contentType);
        if (guess) {
            ext = guess;
        }
    }
    if (!ext) ext = ".png";

    const outPath = path.join(dir, `${safe}${ext}`);
    fs.writeFileSync(outPath, buffer);
    return { outPath, source };
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

    console.log(`API base: ${PERSONA_API_BASE}`);
    if (IMAGE_PROXY_ENDPOINT) {
        console.log(`Image proxy: ${IMAGE_PROXY_ENDPOINT}`);
    }

    console.log("🔎 Fetching persona slugs…");
    const slugs = await fetchAllSlugs();
    console.log(`Found ${slugs.length} personas.`);

    const limit = pLimit(CONCURRENCY);
    let ok = 0;
    let fail = 0;
    let directHits = 0;
    let proxyHits = 0;

    await Promise.all(
        slugs.map((slug) =>
            limit(async () => {
                try {
                    const persona = await fetchPersona(slug);
                    const name = persona?.name || slug;
                    const imageUrl = persona?.image || persona?.img || persona?.picture || null;
                    if (!imageUrl) throw new Error("no image field on persona");

                    const result = await downloadImage(name, imageUrl);
                    if (result.source === "proxy") {
                        proxyHits += 1;
                    } else {
                        directHits += 1;
                    }
                    console.log(`✅ ${name} (${result.source}) -> ${result.outPath}`);
                    ok++;
                } catch (e) {
                    console.warn(`❌ ${slug}: ${e.message}`);
                    fail++;
                }
            })
        )
    );

    console.log(
        `\nDone. ✅ ${ok} succeeded (direct: ${directHits}, proxy: ${proxyHits}), ❌ ${fail} failed.`,
    );
}

main().catch((e) => {
    console.error("Unexpected error:", e);
    process.exit(1);
});
