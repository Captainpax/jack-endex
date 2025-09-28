import { PromptTemplate, ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { envString } from "../config/env.js";

const DEFAULT_BASE_URL = "https://jack-ai.darkmatterservers.com";
const DEFAULT_CHAT_PATH = "/chat/all-hands_openhands-lm-7b-v0.1";
const DEFAULT_IMAGE_MODEL = "dreamshaper";
const DEFAULT_IMAGE_PATHS = ["/v1/images/generations", "/text2image/dreamshaper"];
const DEFAULT_NEGATIVE_PROMPT =
    "blurry, distorted, extra limbs, duplicate face, deformed, low quality, watermark, signature";
const OPENAI_IMAGE_SIZE = "512x512";
const LEGACY_IMAGE_WIDTH = 512;
const LEGACY_IMAGE_HEIGHT = 521;
const LEGACY_GUIDANCE_SCALE = 7.5;
const LEGACY_STEPS = 28;

const portraitTemplate = PromptTemplate.fromTemplate(
    "Portrait of a {race} {role}, wearing {armor}, in a {setting} background, with {expression} expression."
);

function getBaseUrl() {
    const base = envString("LOCAL_AI_BASE_URL", DEFAULT_BASE_URL).trim();
    if (!base) {
        return "";
    }
    return base.replace(/\/+$/, "");
}

function toAbsoluteUrl(pathOrUrl, defaultPath = "") {
    const raw = (pathOrUrl || "").trim();
    if (raw) {
        if (/^https?:\/\//i.test(raw)) {
            return raw;
        }
        const base = getBaseUrl();
        if (!base) {
            throw new Error("LOCAL_AI_BASE_URL is not configured.");
        }
        const normalizedPath = raw.startsWith("/") ? raw : `/${raw}`;
        return `${base}${normalizedPath}`;
    }
    if (defaultPath) {
        return toAbsoluteUrl(defaultPath, "");
    }
    return "";
}

function getChatEndpoint() {
    const explicit = envString("LOCAL_AI_CHAT_ENDPOINT", "");
    if (explicit) {
        return toAbsoluteUrl(explicit, explicit);
    }
    const path = envString("LOCAL_AI_CHAT_PATH", DEFAULT_CHAT_PATH) || DEFAULT_CHAT_PATH;
    return toAbsoluteUrl(path, DEFAULT_CHAT_PATH);
}

function detectImageApiStyle(url) {
    try {
        const parsed = new URL(url);
        if (/\/v1\/images\//.test(parsed.pathname)) {
            return "openai";
        }
    } catch {
        // ignore URL parsing issues and assume legacy behaviour
    }
    return "legacy";
}

function getImageEndpointConfigs() {
    const explicit = envString("LOCAL_AI_IMAGE_ENDPOINT", "");
    const configuredPath = envString("LOCAL_AI_IMAGE_PATH", "");
    const candidates = [];
    if (explicit) {
        candidates.push(explicit);
    }
    if (configuredPath && configuredPath !== explicit) {
        candidates.push(configuredPath);
    }
    for (const fallback of DEFAULT_IMAGE_PATHS) {
        if (!candidates.includes(fallback)) {
            candidates.push(fallback);
        }
    }

    const seen = new Set();
    const configs = [];
    for (const candidate of candidates) {
        const url = toAbsoluteUrl(candidate, candidate);
        if (!url || seen.has(url)) continue;
        configs.push({ url, style: detectImageApiStyle(url) });
        seen.add(url);
    }
    return configs;
}

function getImageModel() {
    return envString("LOCAL_AI_IMAGE_MODEL", DEFAULT_IMAGE_MODEL) || DEFAULT_IMAGE_MODEL;
}

function getImageBackend() {
    return envString("LOCAL_AI_IMAGE_BACKEND", "").trim();
}

function getNegativePrompt() {
    return envString("LOCAL_AI_NEGATIVE_PROMPT", DEFAULT_NEGATIVE_PROMPT) || DEFAULT_NEGATIVE_PROMPT;
}

const backgroundPrompt = ChatPromptTemplate.fromMessages([
    [
        "system",
        "You are a creative tabletop RPG assistant. Use the provided character data to enhance their background and notes. " +
            "Respond with valid JSON containing two keys: background and notes. Each value should be multi-paragraph prose that " +
            "fits the tone of the original material, avoids contradicting established facts, and stays suitable for a teen-friendly campaign."
    ],
    [
        "user",
        "Help enhance this character's background and notes using the following data. " +
            "Return only JSON.\n\nCharacter summary:\n{summary}\n\nCurrent background:\n{background}\n\nCurrent notes:\n{notes}"
    ],
]);

const callChatEndpoint = new RunnableLambda({
    func: async (messages) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        try {
            const endpoint = getChatEndpoint();
            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                signal: controller.signal,
                body: JSON.stringify({
                    messages,
                    temperature: 0.8,
                    max_tokens: 600,
                    stream: false,
                }),
            });

            if (!response.ok) {
                const text = await response.text().catch(() => "");
                throw new Error(`Chat model request failed (${response.status}): ${text || response.statusText}`);
            }

            const payload = await response.json();
            const content =
                payload?.choices?.[0]?.message?.content || payload?.message?.content || payload?.content || "";
            if (!content) {
                throw new Error("Chat model returned an empty response.");
            }
            return content;
        } finally {
            clearTimeout(timeout);
        }
    },
});

const parseJsonOutput = new RunnableLambda({
    func: async (raw) => {
        const text = typeof raw === "string" ? raw.trim() : "";
        if (!text) {
            throw new Error("Model response was empty.");
        }
        const candidate = extractJsonBlock(text);
        try {
            const parsed = JSON.parse(candidate);
            const background = safeString(parsed.background);
            const notes = safeString(parsed.notes);
            if (!background && !notes) {
                throw new Error("Model response did not include background or notes.");
            }
            return { background, notes };
        } catch (err) {
            throw new Error(`Failed to parse model response as JSON: ${err.message}`);
        }
    },
});

const backgroundChain = RunnableSequence.from([
    backgroundPrompt,
    callChatEndpoint,
    new StringOutputParser(),
    parseJsonOutput,
]);

function safeString(value) {
    if (typeof value === "string") {
        return value.trim();
    }
    if (Array.isArray(value)) {
        return value.map((item) => safeString(item)).filter(Boolean).join("\n");
    }
    if (value && typeof value === "object") {
        return Object.values(value)
            .map((item) => safeString(item))
            .filter(Boolean)
            .join("\n");
    }
    return "";
}

function extractJsonBlock(text) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```json\s*([\s\S]+?)```/i);
    if (fenced) {
        return fenced[1].trim();
    }
    const braceStart = trimmed.indexOf("{");
    const braceEnd = trimmed.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
        return trimmed.slice(braceStart, braceEnd + 1);
    }
    return trimmed;
}

function summarizeCharacter(character) {
    if (!character || typeof character !== "object") {
        return "Unknown character";
    }

    const profile = character.profile && typeof character.profile === "object" ? character.profile : {};
    const resources = character.resources && typeof character.resources === "object" ? character.resources : {};
    const gear = character.gear && typeof character.gear === "object" ? character.gear : {};

    const lines = [];
    const name = safeString(character.name) || "Unnamed adventurer";
    lines.push(`Name: ${name}`);

    const role = safeString(profile.class) || safeString(profile.concept) || "Adventurer";
    lines.push(`Role: ${role}`);

    const race = safeString(profile.race);
    if (race) lines.push(`Race: ${race}`);

    const alignment = safeString(profile.alignment);
    if (alignment) lines.push(`Alignment: ${alignment}`);

    const arcana = safeString(profile.arcana);
    if (arcana) lines.push(`Arcana: ${arcana}`);

    const level = Number.parseInt(resources.level, 10);
    if (Number.isFinite(level)) {
        lines.push(`Level: ${level}`);
    }

    const homeland = safeString(profile.nationality);
    if (homeland) lines.push(`Origin: ${homeland}`);

    const traits = [profile.eye, profile.hair, profile.skinTone, profile.notes]
        .map((entry) => safeString(entry))
        .filter(Boolean);
    if (traits.length > 0) {
        lines.push(`Physical traits: ${traits.join(", ")}`);
    }

    const equipment = summarizeEquipment(gear);
    if (equipment) {
        lines.push(`Notable equipment: ${equipment}`);
    }

    const hooks = safeString(profile.background);
    if (hooks) {
        lines.push(`Background hooks: ${hooks}`);
    }

    return lines.join("\n");
}

function summarizeEquipment(gear) {
    if (!gear || typeof gear !== "object") return "";
    const equipped = [];
    const slots = gear.equipped && typeof gear.equipped === "object" ? gear.equipped : gear;
    for (const value of Object.values(slots)) {
        if (!value || typeof value !== "object") continue;
        const name = safeString(value.name || value.label || value.title);
        if (name) equipped.push(name);
    }
    const extras = Array.isArray(gear.bag)
        ? gear.bag
              .map((entry) => safeString(entry?.name || entry?.label))
              .filter(Boolean)
              .slice(0, 4)
        : [];
    const unique = Array.from(new Set([...equipped, ...extras]));
    return unique.slice(0, 6).join(", ");
}

function buildPortraitVariables(character, overrides = {}) {
    const profile = character?.profile && typeof character.profile === "object" ? character.profile : {};
    const gear = character?.gear && typeof character.gear === "object" ? character.gear : {};

    const race = safeString(profile.race) || "mysterious adventurer";
    const role = safeString(profile.class) || safeString(profile.concept) || "hero";
    const armor = overrides.armor || inferArmor(gear) || "signature battle attire";
    const setting = overrides.setting || safeString(profile.backgroundLocale || profile.nationality) || "dramatic fantasy scene";
    const expression = overrides.expression || safeString(profile.expression) || "determined";
    const style = overrides.style || safeString(profile.style);

    return {
        race,
        role,
        armor,
        setting,
        expression,
        style,
    };
}

function inferArmor(gear) {
    if (!gear || typeof gear !== "object") return "";
    const slots = gear.equipped && typeof gear.equipped === "object" ? gear.equipped : {};
    for (const key of ["armor", "body", "torso", "outfit", "clothing"]) {
        const item = slots[key];
        const name = safeString(item?.name || item?.label);
        if (name) return name;
    }
    const bag = Array.isArray(gear.bag) ? gear.bag : [];
    for (const entry of bag) {
        const name = safeString(entry?.name || entry?.label);
        if (name) return name;
    }
    return "";
}

const imageChain = RunnableSequence.from([
    new RunnableLambda({
        func: async ({ character, overrides }) => ({
            variables: buildPortraitVariables(character, overrides),
        }),
    }),
    new RunnableLambda({
        func: async ({ variables }) => ({
            variables,
            prompt: await portraitTemplate.format(variables),
        }),
    }),
    new RunnableLambda({
        func: async ({ prompt, variables }) => ({
            prompt,
            variables,
            image: await callImageEndpoint(prompt, variables?.style),
        }),
    }),
]);

async function callImageEndpoint(prompt, style) {
    const finalPrompt = style ? `${prompt} Art style: ${style}.`.trim() : prompt;
    const negativePrompt = getNegativePrompt();
    const backend = getImageBackend();
    const configs = getImageEndpointConfigs();

    if (configs.length === 0) {
        throw new Error("No image endpoint is configured for LocalAI.");
    }

    const errors = [];
    for (const config of configs) {
        const payload = buildImagePayload({
            apiStyle: config.style,
            prompt: finalPrompt,
            negativePrompt,
            backend,
        });

        try {
            const response = await fetch(config.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const text = await response.text().catch(() => "");
                throw new Error(
                    `Image request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})${
                        text ? `: ${text}` : ""
                    }`,
                );
            }

            const image = await extractImageFromResponse(response);
            if (!image) {
                throw new Error("Image response did not include image data.");
            }
            return image;
        } catch (error) {
            errors.push({ url: config.url, error });
        }
    }

    const detail = errors
        .map(({ url, error }) => `${url}: ${error?.message || String(error)}`)
        .join("; ");
    throw new Error(`Image generation failed after ${errors.length} attempt(s): ${detail || "unknown error"}`);
}

function buildImagePayload({ apiStyle, prompt, negativePrompt, backend }) {
    if (apiStyle === "openai") {
        const payload = {
            model: getImageModel(),
            prompt,
            negative_prompt: negativePrompt,
            size: OPENAI_IMAGE_SIZE,
            response_format: "b64_json",
            n: 1,
        };
        if (backend) payload.backend = backend;
        return payload;
    }

    const payload = {
        prompt,
        negative_prompt: negativePrompt,
        width: LEGACY_IMAGE_WIDTH,
        height: LEGACY_IMAGE_HEIGHT,
        guidance_scale: LEGACY_GUIDANCE_SCALE,
        steps: LEGACY_STEPS,
    };
    if (backend) payload.backend = backend;
    return payload;
}

async function extractImageFromResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        const data = await response.json();
        const { raw, format } = extractImageFromJson(data);
        if (!raw) {
            return "";
        }
        return normalizeImageData(raw, format);
    }

    const buffer = await response.arrayBuffer();
    const mime = contentType || "image/png";
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${mime};base64,${base64}`;
}

function extractImageFromJson(data) {
    if (!data || typeof data !== "object") {
        return { raw: "", format: "" };
    }

    const entries = [];

    if (typeof data.image === "string") {
        entries.push({ raw: data.image, format: data.format || data.mime_type || "" });
    }

    if (Array.isArray(data.images)) {
        for (const item of data.images) {
            if (typeof item === "string") {
                entries.push({ raw: item, format: data.format || data.mime_type || "" });
            } else if (item && typeof item === "object") {
                const raw = typeof item.image === "string" ? item.image : typeof item.base64 === "string" ? item.base64 : "";
                if (raw) {
                    entries.push({ raw, format: item.format || item.mime_type || data.format || data.mime_type || "" });
                }
            }
        }
    }

    if (Array.isArray(data.data)) {
        for (const item of data.data) {
            if (!item || typeof item !== "object") continue;
            if (typeof item.b64_json === "string") {
                entries.push({ raw: item.b64_json, format: item.mime_type || item.format || data.format || "image/png" });
            } else if (typeof item.base64 === "string") {
                entries.push({ raw: item.base64, format: item.mime_type || item.format || data.format || "image/png" });
            } else if (typeof item.image === "string") {
                entries.push({ raw: item.image, format: item.mime_type || item.format || data.format || "image/png" });
            } else if (typeof item.url === "string") {
                entries.push({ raw: item.url, format: item.mime_type || item.format || data.format || "" });
            }
        }
    }

    if (typeof data.b64_json === "string") {
        entries.push({ raw: data.b64_json, format: data.mime_type || data.format || "image/png" });
    }

    if (typeof data.url === "string") {
        entries.push({ raw: data.url, format: data.mime_type || data.format || "" });
    }

    for (const entry of entries) {
        if (entry.raw) {
            return entry;
        }
    }

    return { raw: "", format: "" };
}

function normalizeImageData(raw, format = "image/png") {
    if (!raw || typeof raw !== "string") {
        return "";
    }
    if (raw.startsWith("data:")) {
        return raw;
    }
    if (/^https?:\/\//i.test(raw)) {
        return raw;
    }
    const safeFormat = format || "image/png";
    return `data:${safeFormat};base64,${raw}`;
}

export async function generateCharacterImage(character, overrides = {}) {
    const { prompt, image } = await imageChain.invoke({ character, overrides });
    return { prompt, image };
}

export async function enhanceBackgroundAndNotes(character, background = "", notes = "") {
    const summary = summarizeCharacter(character);
    const { background: nextBackground, notes: nextNotes } = await backgroundChain.invoke({
        summary,
        background,
        notes,
    });
    return {
        summary,
        background: nextBackground || background,
        notes: nextNotes || notes,
    };
}

