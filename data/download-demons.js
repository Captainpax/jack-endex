/* eslint-env node */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

let httpCrawlerLoader;

async function ensureHttpCrawler() {
    if (!httpCrawlerLoader) {
        httpCrawlerLoader = (async () => {
            try {
                const mod = await import("crawlee");
                if (mod?.HttpCrawler) {
                    console.log("🕷️ Using Crawlee HttpCrawler for image downloads.");
                    return mod.HttpCrawler;
                }
                console.warn("⚠️ Crawlee was imported but HttpCrawler was not found. Falling back to axios downloads.");
                return null;
            } catch (error) {
                const reason = error?.message || "unknown error";
                console.warn(
                    `⚠️ Crawlee is not available (${reason}). Falling back to axios for image downloads.\n` +
                        "   Install the 'crawlee' package to enable crawler-based downloads.",
                );
                return null;
            }
        })();
    }
    return httpCrawlerLoader;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==== CONFIG ====
const DEFAULT_API_BASE = "http://localhost:3000/api/personas";
const DEFAULT_FALLBACK_BASE = "https://persona-compendium.onrender.com/personas";
const OUTPUT_DIR = path.resolve(__dirname, "demon_images");
const LOCAL_DEMONS_PATH = path.resolve(__dirname, "demons.json");
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
const personaFallbackBaseRaw =
    process.env.PERSONA_FALLBACK_BASE || DEFAULT_FALLBACK_BASE;
const PERSONA_FALLBACK_BASE =
    stripTrailingSlashes(personaFallbackBaseRaw) || DEFAULT_FALLBACK_BASE;
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

function normalizePersonaSlug(value) {
    if (!value) return null;
    const normalized = String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || null;
}

function loadFallbackSlugs() {
    if (!fs.existsSync(LOCAL_DEMONS_PATH)) return [];

    try {
        const raw = fs.readFileSync(LOCAL_DEMONS_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        const seen = new Set();
        const slugs = [];
        for (const entry of parsed) {
            const slug = normalizePersonaSlug(entry?.query || entry?.slug || entry?.name);
            if (!slug || seen.has(slug)) continue;
            seen.add(slug);
            slugs.push(slug);
        }
        return slugs;
    } catch (error) {
        console.warn(`⚠️ Failed to load fallback slugs from ${LOCAL_DEMONS_PATH}: ${error.message}`);
        return [];
    }
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
    try {
        const rootResp = await axios.get("https://persona-compendium.onrender.com/", { timeout: 30000 });
        const data = rootResp.data || {};
        const list = data["Persona Compendium API is live! Here's a list of all possible endpoints: /personas/"] || [];
        const slugs = list
            .map(String)
            .filter((p) => p.startsWith("/personas/") && p.endsWith("/"))
            .map((p) => p.replace("/personas/", "").replace("/", ""));
        if (slugs.length > 0) {
            return slugs;
        }
        throw new Error("remote persona slug list was empty");
    } catch (error) {
        const message = error?.message || "unknown error";
        console.warn(`⚠️ Failed to fetch persona slugs from persona-compendium.onrender.com: ${message}`);
        const fallback = loadFallbackSlugs();
        if (fallback.length > 0) {
            console.log(`Using ${fallback.length} local persona entries from data/demons.json as a fallback.`);
            return fallback;
        }
        throw new Error(`Unable to load persona slugs (remote + fallback failed). Last error: ${message}`);
    }
}

async function fetchPersona(slug) {
    // Prefer the local API when available but fall back to the upstream source
    const attempts = [];

    async function tryFetch(base, label) {
        if (!base) return null;
        const url = `${base}/${encodeURIComponent(slug)}`;
        try {
            const response = await axios.get(url, { timeout: 30000 });
            if (response?.data) {
                if (label === "fallback") {
                    console.warn(`ℹ️ Using fallback persona API for ${slug}.`);
                }
                return response.data;
            }
            throw new Error("empty response body");
        } catch (error) {
            const status = error?.response?.status;
            const statusText = error?.response?.statusText;
            const message =
                status && statusText
                    ? `${status} ${statusText}`
                    : status
                      ? `HTTP ${status}`
                      : error?.message || "unknown error";
            attempts.push(`${label}: ${message}`);
            return null;
        }
    }

    const local = await tryFetch(PERSONA_API_BASE, "local");
    if (local) return local;

    if (PERSONA_FALLBACK_BASE && PERSONA_FALLBACK_BASE !== PERSONA_API_BASE) {
        const fallback = await tryFetch(PERSONA_FALLBACK_BASE, "fallback");
        if (fallback) return fallback;
    }

    const details = attempts.length > 0 ? ` (${attempts.join(", ")})` : "";
    throw new Error(`failed to fetch persona${details}`);
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

function resolveContentType(headers) {
    if (!headers) return "";
    if (typeof headers.get === "function") {
        return headers.get("content-type") || headers.get("Content-Type") || "";
    }
    if (typeof headers === "object") {
        const lowered = Object.create(null);
        for (const [key, value] of Object.entries(headers)) {
            lowered[String(key).toLowerCase()] = value;
        }
        return lowered["content-type"] || "";
    }
    return "";
}

async function fetchWithCrawlee(HttpCrawler, url, source) {
    let outcome = null;
    const errors = [];

    const crawler = new HttpCrawler({
        maxConcurrency: 1,
        maxRequestRetries: 0,
        requestHandler: async ({ sendRequest }) => {
            const response = await sendRequest({
                headers: BROWSER_HEADERS,
                responseType: "buffer",
                throwHttpErrors: false,
            });

            const status = response?.statusCode ?? response?.status ?? 0;
            const body = response?.body ?? response?.rawBody;
            if (status !== 200 || !body || body.length === 0) {
                throw new Error(`HTTP ${status || "unknown"}`);
            }

            const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
            const contentType = resolveContentType(response?.headers);
            outcome = { buffer, contentType, source };
        },
        failedRequestHandler: async ({ error }) => {
            errors.push(error);
        },
    });

    await crawler.run([{ url }]).catch((error) => {
        errors.push(error);
    });

    if (!outcome) {
        const message = errors
            .map((err) => err?.message)
            .filter(Boolean)
            .join(", ") || "request failed";
        throw new Error(message);
    }

    return outcome;
}

async function fetchWithAxios(url, source) {
    const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 60000,
        maxRedirects: 5,
        headers: BROWSER_HEADERS,
        decompress: true,
        validateStatus: () => true,
    });

    if (response.status !== 200 || !response.data) {
        throw new Error(`HTTP ${response.status}`);
    }

    const buffer = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data);
    const contentType = resolveContentType(response.headers);
    return { buffer, contentType, source };
}

async function tryFetchImage(url, source) {
    const HttpCrawler = await ensureHttpCrawler();
    if (HttpCrawler) {
        return fetchWithCrawlee(HttpCrawler, url, source);
    }
    return fetchWithAxios(url, source);
}

async function downloadImage(name, imageUrl) {
    const safe = slugify(name);
    const dir = path.join(OUTPUT_DIR, safe);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const normalizedUrl = normalizeImageUrl(imageUrl);
    if (!normalizedUrl) {
        throw new Error("invalid or unsupported image url");
    }

    const attemptMessages = [];
    let result = null;

    try {
        result = await tryFetchImage(normalizedUrl, "direct");
    } catch (error) {
        attemptMessages.push(`direct: ${error.message}`);
        console.warn(`⚠️ Direct fetch failed for ${name}: ${error.message}`);
    }

    if (!result && IMAGE_PROXY_ENDPOINT) {
        const qs = new URLSearchParams({ src: normalizedUrl });
        const proxyUrl = `${IMAGE_PROXY_ENDPOINT}?${qs.toString()}`;
        try {
            result = await tryFetchImage(proxyUrl, "proxy");
        } catch (error) {
            attemptMessages.push(`proxy: ${error.message}`);
            console.warn(`⚠️ Proxy fetch failed for ${name}: ${error.message}`);
        }
    }

    if (!result) {
        const summary = attemptMessages.join(", ") || "no attempts";
        throw new Error(`all fetch attempts failed (${summary})`);
    }

    const { buffer, contentType, source } = result;

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
