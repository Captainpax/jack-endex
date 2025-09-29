import { PromptTemplate, ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { envString } from "../config/env.js";

const DEFAULT_BASE_URL = "https://jack-ai.darkmatterservers.com";
const DEFAULT_CHAT_PATHS = [
    "/chat/all-hands_openhands-lm-7b-v0.1",
    "/v1/chat/completions",
    "/chat/completions",
];
const DEFAULT_CHAT_MODEL = "all-hands_openhands-lm-7b-v0.1";
const DEFAULT_IMAGE_MODEL = "dreamshaper";
const DEFAULT_IMAGE_PATHS = ["/v1/images/generations", "/text2image/dreamshaper"];
const DEFAULT_NEGATIVE_PROMPT =
    "blurry, distorted, extra limbs, duplicate face, deformed, low quality, watermark, signature";
const OPENAI_IMAGE_SIZE = "512x512";
const LEGACY_IMAGE_WIDTH = 512;
const LEGACY_IMAGE_HEIGHT = 521;
const LEGACY_GUIDANCE_SCALE = 7.5;
const LEGACY_STEPS = 28;
const MAX_IMAGE_COUNT = 4;

const portraitTemplate = PromptTemplate.fromTemplate(
    [
        "Highly detailed portrait of a {race} {role} wearing {armor}.",
        "Set in a {setting} background with a {expression} expression.",
        "{details}",
    ].join(" "),
);

const MESSAGE_TYPE_ROLE_MAP = {
    human: "user",
    ai: "assistant",
    system: "system",
    function: "function",
    tool: "tool",
};

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

function normalizeMessages(rawMessages) {
    if (!rawMessages) {
        return [];
    }

    if (typeof rawMessages.toChatMessages === "function") {
        return normalizeMessages(rawMessages.toChatMessages());
    }

    if (Array.isArray(rawMessages)) {
        return rawMessages
            .map((message) => normalizeMessage(message))
            .filter((message) => message !== null);
    }

    if (typeof rawMessages === "object" && Array.isArray(rawMessages.messages)) {
        return normalizeMessages(rawMessages.messages);
    }

    return [];
}

function normalizeMessage(message) {
    if (!message) return null;

    if (typeof message.toJSON === "function") {
        const json = message.toJSON();
        if (json && typeof json === "object") {
            return normalizeMessage({
                ...json.kwargs,
                type: json.type,
                role: json.type || json.kwargs?.role,
            });
        }
    }

    const type = typeof message._getType === "function" ? message._getType() : message.type;
    const role = MESSAGE_TYPE_ROLE_MAP[type] || message.role || "user";
    const content = normalizeMessageContent(message.content ?? message.text ?? "");

    const normalized = {
        role,
        content,
    };

    if (message.name) {
        normalized.name = message.name;
    }

    const additional = message.additional_kwargs || {};
    if (additional.function_call) {
        normalized.function_call = additional.function_call;
    }
    if (Array.isArray(additional.tool_calls) && additional.tool_calls.length > 0) {
        normalized.tool_calls = additional.tool_calls;
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        normalized.tool_calls = message.tool_calls;
    }

    if (typeof message.function_call === "object" && message.function_call !== null) {
        normalized.function_call = message.function_call;
    }

    return normalized;
}

function normalizeMessageContent(content) {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((entry) => {
                if (!entry) return "";
                if (typeof entry === "string") return entry;
                if (typeof entry.text === "string") return entry.text;
                if (typeof entry.content === "string") return entry.content;
                if (typeof entry.message === "string") return entry.message;
                return "";
            })
            .filter(Boolean)
            .join("\n");
    }
    if (content && typeof content === "object") {
        if (typeof content.text === "string") return content.text;
        if (typeof content.content === "string") return content.content;
        if (typeof content.message === "string") return content.message;
        try {
            return JSON.stringify(content);
        } catch {
            return String(content);
        }
    }
    if (content == null) {
        return "";
    }
    return String(content);
}

function getChatEndpoints() {
    const explicit = envString("LOCAL_AI_CHAT_ENDPOINT", "");
    if (explicit) {
        return [toAbsoluteUrl(explicit, explicit)];
    }

    const configuredPath = envString("LOCAL_AI_CHAT_PATH", "");
    const candidates = [];
    if (configuredPath) {
        candidates.push(configuredPath);
    }
    for (const fallback of DEFAULT_CHAT_PATHS) {
        if (!candidates.includes(fallback)) {
            candidates.push(fallback);
        }
    }

    const seen = new Set();
    const endpoints = [];
    for (const candidate of candidates) {
        const url = toAbsoluteUrl(candidate, candidate);
        if (!url || seen.has(url)) continue;
        endpoints.push(url);
        seen.add(url);
    }
    return endpoints;
}

function getChatModel() {
    return envString("LOCAL_AI_CHAT_MODEL", DEFAULT_CHAT_MODEL) || DEFAULT_CHAT_MODEL;
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
        const endpoints = getChatEndpoints();
        if (endpoints.length === 0) {
            throw new Error("No chat endpoint is configured.");
        }

        const normalizedMessages = normalizeMessages(messages);
        if (normalizedMessages.length === 0) {
            throw new Error("Chat prompt did not produce any messages.");
        }

        const payload = {
            model: getChatModel(),
            messages: normalizedMessages,
            temperature: 0.8,
            max_tokens: 600,
            stream: false,
        };

        const errors = [];
        for (const endpoint of endpoints) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60_000);
            try {
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    signal: controller.signal,
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    const text = await response.text().catch(() => "");
                    throw new Error(`Chat model request failed (${response.status}): ${text || response.statusText}`);
                }

                const data = await response.json();
                const content =
                    data?.choices?.[0]?.message?.content || data?.message?.content || data?.content || "";
                if (!content) {
                    throw new Error("Chat model returned an empty response.");
                }
                return content;
            } catch (error) {
                errors.push({ endpoint, error });
            } finally {
                clearTimeout(timeout);
            }
        }

        const detail = errors
            .map(({ endpoint, error }) => `${endpoint}: ${error?.message || String(error)}`)
            .join("; ");
        throw new Error(`Chat model request failed after ${errors.length} attempt(s): ${detail || "unknown error"}`);
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

function extractGearName(item) {
    if (!item || typeof item !== "object") return "";
    return safeString(item.name || item.label || item.title);
}

function summarizeEquipment(gear) {
    if (!gear || typeof gear !== "object") return "";

    const entries = collectEquippedGearEntries(gear);
    const summaryParts = [];
    const usedEntries = new Set();
    const usedNames = new Set();

    const noteEntry = (label, entry) => {
        if (!entry || usedEntries.has(entry)) return;
        const displayLabel = label || entry.label || "Gear";
        summaryParts.push(`${displayLabel}: ${entry.name}`);
        usedEntries.add(entry);
        usedNames.add(entry.name.toLowerCase());
    };

    const weaponEntry = findEntryBySlot(entries, ["weapon", "mainhand", "offhand"]);
    const accessoryEntry = findEntryBySlot(entries, ["accessory", "trinket", "neck"]);
    const armorEntry = findEntryBySlot(entries, ["armor", "body", "torso", "outfit", "clothing"]);

    noteEntry("Weapon", weaponEntry);
    noteEntry("Armor", armorEntry);
    noteEntry("Accessory", accessoryEntry);

    for (const entry of entries) {
        noteEntry(null, entry);
        if (summaryParts.length >= 6) break;
    }

    if (summaryParts.length < 6) {
        const bagArray = Array.isArray(gear.bag) ? gear.bag : [];
        const extras = [];
        for (const item of bagArray) {
            const name = extractGearName(item);
            if (!name) continue;
            const normalized = name.toLowerCase();
            if (usedNames.has(normalized)) continue;
            extras.push(name);
            usedNames.add(normalized);
            if (extras.length >= 3) break;
        }
        if (extras.length > 0) {
            summaryParts.push(`Pack items: ${extras.join(", ")}`);
        }
    }

    return summaryParts.slice(0, 6).join("; ");
}

function buildPortraitVariables(character, overrides = {}) {
    const profile = character?.profile && typeof character.profile === "object" ? character.profile : {};
    const gear = character?.gear && typeof character.gear === "object" ? character.gear : {};

    const race = safeString(profile.race) || "mysterious adventurer";
    const role = safeString(profile.class) || safeString(profile.concept) || "hero";
    const armor = overrides.armor || inferArmor(gear) || "signature battle attire";
    const nationality = safeString(profile.nationality);
    const locale = safeString(profile.backgroundLocale);
    const historySummary = summarizeHistoryForPrompt(profile.background);
    let setting = overrides.setting;
    if (!setting) {
        const base = locale || (nationality ? `${nationality} locale` : "dramatic fantasy scene");
        const influences = [];
        if (nationality) influences.push(`${nationality} heritage`);
        if (historySummary) influences.push(`their history: ${historySummary}`);
        if (influences.length > 0) {
            const influenceText =
                influences.length === 1
                    ? `inspired by ${influences[0]}`
                    : `inspired by ${influences.slice(0, -1).join(", ")} and ${influences[influences.length - 1]}`;
            setting = `${base} ${influenceText}`.trim();
        } else {
            setting = base;
        }
    }
    const expression = overrides.expression || safeString(profile.expression) || "determined";
    const style = overrides.style || safeString(profile.style);
    const details = safeString(overrides.details) || gatherPortraitDetails(character, profile, gear);

    return {
        race,
        role,
        armor,
        setting,
        expression,
        style,
        details,
    };
}

function gatherPortraitDetails(character, profile, gear) {
    const sentences = [];

    const name = safeString(character?.name);
    const gender = safeString(profile.gender || profile.pronouns || profile.sex);
    const age = safeString(profile.age);
    const identityBits = [
        name ? `named ${name}` : "",
        gender,
        age ? `${age} years old` : "",
    ]
        .map((entry) => safeString(entry))
        .filter(Boolean);
    if (identityBits.length > 0) {
        sentences.push(`Identity: ${identityBits.join(", ")}.`);
    }

    const origin = safeString(
        profile.nationality || profile.homeland || profile.origin || profile.backgroundLocale,
    );
    if (origin) {
        sentences.push(`Origin: ${origin}.`);
    }

    const appearanceTraits = [
        profile.eye,
        profile.hair,
        profile.skinTone,
        profile.height,
        profile.build,
        profile.appearance,
        profile.distinguishingMarks,
    ]
        .map((entry) => safeString(entry))
        .filter(Boolean)
        .slice(0, 6);
    if (appearanceTraits.length > 0) {
        sentences.push(`Appearance: ${appearanceTraits.join(", ")}.`);
    }

    const personalityTraits = [
        profile.personality,
        profile.mannerisms,
        profile.quirks,
        profile.ideal,
        profile.bond,
        profile.flaw,
        profile.notes,
    ]
        .map((entry) => safeString(entry))
        .filter(Boolean)
        .slice(0, 3);
    if (personalityTraits.length > 0) {
        sentences.push(`Personality: ${personalityTraits.join(" ")}.`);
    }

    const background = safeString(profile.background);
    if (background) {
        sentences.push(`Background: ${background}.`);
    }

    const equipment = summarizeEquipment(gear);
    if (equipment) {
        sentences.push(`Signature gear: ${equipment}.`);
    }

    return sentences.slice(0, 4).join(" ");
}

function summarizeHistoryForPrompt(value) {
    const text = safeString(value);
    if (!text) return "";
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    const sentenceMatch = normalized.match(/[^.!?]+[.!?]?/);
    const sentence = sentenceMatch ? sentenceMatch[0].trim() : normalized;
    const words = sentence.split(/\s+/);
    if (words.length > 24) {
        return `${words.slice(0, 24).join(" ")}…`;
    }
    return sentence;
}

const GEAR_SLOT_LABEL_OVERRIDES = { weapon: "Weapon", armor: "Armor", accessory: "Accessory" };

function formatGearSlotLabel(key) {
    if (!key) return "Gear";
    const normalizedKey = String(key).trim();
    const lower = normalizedKey.toLowerCase();
    if (GEAR_SLOT_LABEL_OVERRIDES[lower]) return GEAR_SLOT_LABEL_OVERRIDES[lower];
    const cleaned = normalizedKey.replace(/[-_]+/g, " ").trim();
    if (!cleaned) return "Gear";
    return cleaned
        .split(/\s+/)
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
        .join(" ");
}

function normalizeSlotKey(key) {
    if (!key) return "";
    return String(key)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function collectEquippedGearEntries(gear) {
    if (!gear || typeof gear !== "object") return [];

    const bagArray = Array.isArray(gear.bag) ? gear.bag : [];
    const bagMap = new Map();
    for (const entry of bagArray) {
        if (!entry || typeof entry !== "object") continue;
        const id = typeof entry.id === "string" ? entry.id : null;
        if (id && !bagMap.has(id)) {
            bagMap.set(id, entry);
        }
    }

    const entries = [];
    const seen = new Set();

    const pushEntry = (slotKey, source) => {
        const name = extractGearName(source);
        if (!name) return;
        const slot = normalizeSlotKey(slotKey);
        const label = slotKey ? formatGearSlotLabel(slotKey) : "Gear";
        const dedupeKey = `${slot}:${name.toLowerCase()}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        entries.push({ slot, label, name });
    };

    const slotEntries = gear.slots && typeof gear.slots === "object" ? gear.slots : null;
    if (slotEntries) {
        for (const [slotKey, value] of Object.entries(slotEntries)) {
            if (!value || typeof value !== "object") continue;
            let item = value;
            if (value.item && typeof value.item === "object") {
                item = value.item;
            } else if (value.itemId && bagMap.has(value.itemId)) {
                item = bagMap.get(value.itemId);
            }
            pushEntry(slotKey, item);
        }
    }

    const legacyEquipped = gear.equipped && typeof gear.equipped === "object" ? gear.equipped : null;
    if (legacyEquipped) {
        for (const [slotKey, value] of Object.entries(legacyEquipped)) {
            pushEntry(slotKey, value);
        }
    }

    if (!slotEntries && (!legacyEquipped || typeof legacyEquipped !== "object")) {
        for (const [slotKey, value] of Object.entries(gear)) {
            if (slotKey === "bag") continue;
            pushEntry(slotKey, value);
        }
    }

    return entries;
}

function findEntryBySlot(entries, slotKeys) {
    const targets = slotKeys.map((key) => normalizeSlotKey(key)).filter(Boolean);
    if (targets.length === 0) return null;
    for (const entry of entries) {
        if (!entry || !entry.slot) continue;
        if (targets.includes(entry.slot)) {
            return entry;
        }
    }
    return null;
}

function inferArmor(gear) {
    if (!gear || typeof gear !== "object") return "";
    const entries = collectEquippedGearEntries(gear);
    const armorEntry = findEntryBySlot(entries, ["armor", "body", "torso", "outfit", "clothing"]);
    if (armorEntry) {
        return armorEntry.name;
    }

    for (const entry of entries) {
        if (entry.label.toLowerCase().includes("armor")) {
            return entry.name;
        }
    }

    const bagArray = Array.isArray(gear.bag) ? gear.bag : [];
    for (const item of bagArray) {
        const name = extractGearName(item);
        if (name) return name;
    }

    return "";
}

const promptEnhancerPrompt = ChatPromptTemplate.fromMessages([
    [
        "system",
        "You are an expert prompt engineer for Stable Diffusion and similar image models. " +
            "Rewrite the provided base prompt using the supplied character context so it becomes a vivid, " +
            "cohesive prompt suited for high-quality fantasy portrait generation. Respond with a single refined " +
            "prompt sentence no longer than 120 words and do not include any additional commentary or JSON.",
    ],
    [
        "user",
        "Base prompt:\n{basePrompt}\n\nCharacter context:\n{context}\n\n" +
            "Incorporate the important gear, personality, and heritage cues. Keep the portrait framing implicit and do not mention camera settings unless they appear in the base prompt.",
    ],
]);

const imageChain = RunnableSequence.from([
    new RunnableLambda({
        func: async ({ character, overrides }) => ({
            variables: buildPortraitVariables(character, overrides),
            overrides,
        }),
    }),
    new RunnableLambda({
        func: async ({ variables, overrides }) => ({
            variables,
            overrides,
            basePrompt: await portraitTemplate.format(variables),
        }),
    }),
    new RunnableLambda({
        func: async ({ basePrompt, variables, overrides }) => ({
            variables,
            overrides,
            basePrompt,
            prompt: await enhanceStableDiffusionPrompt(basePrompt, variables),
        }),
    }),
    new RunnableLambda({
        func: async ({ prompt, variables, overrides }) => {
            const count = clampImageCount(overrides?.count);
            const referenceImages = normalizeReferenceImages(
                overrides?.referenceImages ?? overrides?.referenceImage ?? overrides?.reference,
            );
            const images = await callImageEndpoint(prompt, variables?.style, { count, referenceImages });
            return {
                prompt: safeString(prompt),
                images,
            };
        },
    }),
]);

async function callImageEndpoint(prompt, style, options = {}) {
    const finalPrompt = style ? `${prompt} Art style: ${style}.`.trim() : prompt;
    const negativePrompt = getNegativePrompt();
    const backend = getImageBackend();
    const configs = getImageEndpointConfigs();
    const imageCount = clampImageCount(options?.count);
    const referenceImages = normalizeReferenceImages(options?.referenceImages || options?.referenceImage);

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
            count: imageCount,
            referenceImages,
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

            const images = await extractImagesFromResponse(response);
            if (!Array.isArray(images) || images.length === 0) {
                throw new Error("Image response did not include image data.");
            }
            return images;
        } catch (error) {
            errors.push({ url: config.url, error });
        }
    }

    const detail = errors
        .map(({ url, error }) => `${url}: ${error?.message || String(error)}`)
        .join("; ");
    throw new Error(`Image generation failed after ${errors.length} attempt(s): ${detail || "unknown error"}`);
}

async function enhanceStableDiffusionPrompt(basePrompt, variables) {
    const context = formatPromptEnhancerContext(variables);
    const messages = await promptEnhancerPrompt.formatMessages({
        basePrompt,
        context,
    });
    const enhanced = await callChatEndpoint.invoke(messages);
    return cleanEnhancedPrompt(enhanced, basePrompt);
}

function formatPromptEnhancerContext(variables) {
    if (!variables || typeof variables !== "object") {
        return "";
    }
    const lines = [];
    for (const [key, value] of Object.entries(variables)) {
        const text = safeString(value);
        if (!text) continue;
        const label = key
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (char) => char.toUpperCase())
            .trim();
        lines.push(`${label}: ${text}`);
    }
    return lines.join("\n");
}

function cleanEnhancedPrompt(response, fallback) {
    const text = safeString(response);
    if (!text) return fallback;
    let normalized = text.replace(/^```(?:text)?/i, "").replace(/```$/i, "").trim();
    if (!normalized) return fallback;
    normalized = normalized
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ");
    normalized = normalized.replace(/^Improved prompt[:-]?\s*/i, "");
    normalized = normalized.replace(/^Final prompt[:-]?\s*/i, "");
    return normalized.trim() || fallback;
}

function clampImageCount(value, defaultValue = 1) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return defaultValue;
    return Math.min(MAX_IMAGE_COUNT, Math.max(1, Math.floor(raw)));
}

function normalizeReferenceImages(value) {
    if (!value) return [];
    const entries = Array.isArray(value) ? value : [value];
    const normalized = [];
    const seen = new Set();
    for (const entry of entries) {
        let source = "";
        if (typeof entry === "string") {
            source = entry.trim();
        } else if (entry && typeof entry === "object") {
            if (typeof entry.image === "string") {
                source = entry.image.trim();
            } else if (typeof entry.url === "string") {
                source = entry.url.trim();
            } else if (typeof entry.base64 === "string") {
                source = entry.base64.trim();
            }
        }
        if (!source || seen.has(source)) continue;
        normalized.push(source);
        seen.add(source);
        if (normalized.length >= MAX_IMAGE_COUNT) break;
    }
    return normalized;
}

function buildImagePayload({ apiStyle, prompt, negativePrompt, backend, count = 1, referenceImages = [] }) {
    const finalCount = clampImageCount(count);
    const refs = normalizeReferenceImages(referenceImages);
    if (apiStyle === "openai") {
        const payload = {
            model: getImageModel(),
            prompt,
            negative_prompt: negativePrompt,
            size: OPENAI_IMAGE_SIZE,
            response_format: "b64_json",
            n: finalCount,
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
    if (finalCount > 1) {
        payload.n = finalCount;
        payload.num_images = finalCount;
        payload.batch_size = Math.min(finalCount, MAX_IMAGE_COUNT);
        payload.samples = finalCount;
    }
    if (refs.length > 0) {
        payload.reference_images = refs;
        payload.init_images = refs;
        payload.image = refs[0];
    }
    return payload;
}

async function extractImagesFromResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        const data = await response.json();
        return extractImagesFromJson(data);
    }

    const buffer = await response.arrayBuffer();
    const mime = contentType || "image/png";
    const base64 = Buffer.from(buffer).toString("base64");
    return [`data:${mime};base64,${base64}`];
}

function extractImagesFromJson(data) {
    if (!data || typeof data !== "object") {
        return [];
    }

    const images = [];
    const pushImage = (raw, format) => {
        const normalized = normalizeImageData(raw, format);
        if (normalized) {
            images.push(normalized);
        }
    };

    if (typeof data.image === "string") {
        pushImage(data.image, data.format || data.mime_type || "");
    }

    if (Array.isArray(data.images)) {
        for (const item of data.images) {
            if (!item) continue;
            if (typeof item === "string") {
                pushImage(item, data.format || data.mime_type || "");
                continue;
            }
            if (typeof item !== "object") continue;
            const raw =
                typeof item.image === "string"
                    ? item.image
                    : typeof item.base64 === "string"
                    ? item.base64
                    : typeof item.b64_json === "string"
                    ? item.b64_json
                    : "";
            const format = item.format || item.mime_type || data.format || data.mime_type || "";
            if (raw) {
                pushImage(raw, format);
            }
            if (Array.isArray(item.data)) {
                for (const nested of item.data) {
                    if (!nested || typeof nested !== "object") continue;
                    const nestedRaw =
                        typeof nested.image === "string"
                            ? nested.image
                            : typeof nested.base64 === "string"
                            ? nested.base64
                            : typeof nested.b64_json === "string"
                            ? nested.b64_json
                            : "";
                    const nestedFormat = nested.mime_type || nested.format || format;
                    if (nestedRaw) {
                        pushImage(nestedRaw, nestedFormat);
                    }
                }
            }
        }
    }

    if (Array.isArray(data.data)) {
        for (const item of data.data) {
            if (!item || typeof item !== "object") continue;
            if (typeof item.b64_json === "string") {
                pushImage(item.b64_json, item.mime_type || item.format || data.mime_type || data.format || "image/png");
            } else if (typeof item.base64 === "string") {
                pushImage(item.base64, item.mime_type || item.format || data.mime_type || data.format || "image/png");
            } else if (typeof item.image === "string") {
                pushImage(item.image, item.mime_type || item.format || data.mime_type || data.format || "image/png");
            } else if (typeof item.url === "string") {
                pushImage(item.url, item.mime_type || item.format || data.mime_type || data.format || "");
            }
        }
    }

    if (Array.isArray(data.output)) {
        for (const entry of data.output) {
            if (!entry) continue;
            if (typeof entry === "string") {
                pushImage(entry, data.format || data.mime_type || "");
            } else if (typeof entry === "object") {
                const raw =
                    typeof entry.image === "string"
                        ? entry.image
                        : typeof entry.base64 === "string"
                        ? entry.base64
                        : typeof entry.b64_json === "string"
                        ? entry.b64_json
                        : "";
                const format = entry.mime_type || entry.format || data.mime_type || data.format || "";
                if (raw) {
                    pushImage(raw, format);
                }
            }
        }
    }

    if (typeof data.b64_json === "string") {
        pushImage(data.b64_json, data.mime_type || data.format || "image/png");
    }

    if (typeof data.url === "string") {
        pushImage(data.url, data.mime_type || data.format || "");
    }

    return images;
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
    const { prompt, images } = await imageChain.invoke({ character, overrides });
    const promptText = safeString(prompt);
    const normalizedImages = [];
    const seen = new Set();
    const addImage = (value) => {
        if (!value) return;
        const normalized = normalizeImageData(value);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        normalizedImages.push(normalized);
    };
    if (Array.isArray(images)) {
        for (const entry of images) {
            addImage(entry);
            if (normalizedImages.length >= MAX_IMAGE_COUNT) break;
        }
    } else {
        addImage(images);
    }
    const primaryImage = normalizedImages[0] || "";
    return { prompt: promptText, image: primaryImage, images: normalizedImages };
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

