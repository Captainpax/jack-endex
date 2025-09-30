// --- FILE: client/src/App.jsx ---
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import { ApiError, Auth, Games, Help, StoryLogs, onApiActivity, LocalAI } from "./api";

import useRealtimeConnection from "./hooks/useRealtimeConnection";
import useBattleLogger from "./hooks/useBattleLogger";
import MathField from "./components/MathField";
import WorldSkillsTab from "./components/WorldSkillsTab";
import { GearTab, ItemsTab } from "./components/ItemsGearTabs";
import DemonTab from "./components/DemonTab";
import DemonImage from "./components/DemonImage";
import MapTab from "./components/battleMap/MapTab";
import NavigationSidebar from "./components/NavigationSidebar";
import { MAP_DEFAULT_SETTINGS, mapReadBoolean, describePlayerName } from "./components/battleMap/mapShared";
import { buildNavigation } from "./constants/navigation";
import { BATTLE_MATH_REFERENCE } from "./constants/referenceContent";
import ServerManagementTab from "./components/ServerManagementTab";
import {
    ABILITY_DEFS,
    ABILITY_KEY_SET,
    ARCANA_DATA,
    COMBAT_CATEGORY_LABELS,
    COMBAT_CATEGORY_OPTIONS,
    COMBAT_SKILL_SORT_OPTIONS,
    COMBAT_SKILL_SORTERS,
    COMBAT_TIER_ORDER,
    COMBAT_TIER_INFO,
    COMBAT_TIER_LABELS,
    CONCEPT_PROMPTS,
    DEFAULT_COMBAT_CATEGORY,
    DEFAULT_WORLD_SKILLS,
    DEMON_RESISTANCE_SORTS,
    WORLD_SKILL_SORT_OPTIONS,
    WORLD_SKILL_SORTERS,
    abilityModifier,
    clampNonNegative,
    computeCombatSkillDamage,
    formatModifier,
    getDemonSkillList,
    NEW_COMBAT_SKILL_ID,
    NEW_WORLD_SKILL_ID,
    normalizeCombatCategoryValue,
    normalizeCombatSkillDefs,
    normalizeCustomSkills,
    normalizeWorldSkillDefs,
    ROLE_ARCHETYPES,
    SAVE_DEFS,
} from "./constants/gameData";
import { EMPTY_ARRAY, EMPTY_OBJECT } from "./utils/constants";
import { createEmptySkillViewPrefs, sanitizeSkillViewPrefs } from "./utils/skillViewPrefs";
import { deepClone, normalizeCharacter, normalizeSkills } from "./utils/character";
import { get } from "./utils/object";
import { getMainMenuTrack } from "./utils/music";
import { idsMatch, normalizeId } from "./utils/ids";
import { COMBAT_SKILL_LIBRARY, findCombatSkillById, findCombatSkillByName } from "@shared/combatSkills.js";
import RealtimeContext from "./contexts/RealtimeContext";
import clientLogger from "./utils/clientLogger";

function normalizePrimaryBot(primaryBot) {
    if (!primaryBot || typeof primaryBot !== "object") {
        return {
            available: false,
            inviteUrl: "",
            applicationId: "",
            defaultGuildId: "",
            defaultChannelId: "",
        };
    }

    const inviteUrl = typeof primaryBot.inviteUrl === "string" ? primaryBot.inviteUrl : "";
    const applicationId = typeof primaryBot.applicationId === "string" ? primaryBot.applicationId : "";
    const defaultGuildId = typeof primaryBot.defaultGuildId === "string" ? primaryBot.defaultGuildId : "";
    const defaultChannelId = typeof primaryBot.defaultChannelId === "string"
        ? primaryBot.defaultChannelId
        : "";

    return {
        available: !!primaryBot.available,
        inviteUrl,
        applicationId,
        defaultGuildId,
        defaultChannelId,
    };
}



function normalizePlayerRecord(player) {
    if (!player || typeof player !== "object") return player;
    const normalizedId = normalizeId(player.userId);
    if (normalizedId === null || normalizedId === undefined) {
        if (player.userId === null || player.userId === undefined || player.userId === "") {
            return { ...player, userId: null };
        }
        return { ...player, userId: String(player.userId) };
    }
    if (normalizedId !== player.userId) {
        return { ...player, userId: normalizedId };
    }
    return player;
}

function normalizeGameRecord(game) {
    if (!game || typeof game !== "object") return game;
    const dmCandidate = normalizeId(game.dmId);
    const normalizedDmId =
        dmCandidate === null || dmCandidate === undefined
            ? game.dmId === null || game.dmId === undefined || game.dmId === ""
                ? null
                : String(game.dmId)
            : dmCandidate;

    let playersChanged = false;
    let normalizedPlayers = game.players;
    if (Array.isArray(game.players)) {
        const mapped = game.players.map((player) => {
            const normalized = normalizePlayerRecord(player);
            if (normalized !== player) {
                playersChanged = true;
            }
            return normalized;
        });
        if (playersChanged) {
            normalizedPlayers = mapped;
        }
    }

    const dmUnchanged = normalizedDmId === game.dmId;
    const playersUnchanged = normalizedPlayers === game.players;
    if (dmUnchanged && playersUnchanged) {
        return game;
    }

    const next = {
        ...game,
        dmId: normalizedDmId,
    };
    if (Array.isArray(normalizedPlayers)) {
        next.players = normalizedPlayers;
    }
    return next;
}

function normalizeGameList(list) {
    if (!Array.isArray(list)) return [];
    return list.map((game) => normalizeGameRecord(game));
}

function safeAiString(value) {
    if (typeof value === "string") return value.trim();
    if (value === undefined || value === null) return "";
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return "";
}

function normalizeAiGearItem(item) {
    if (!item || typeof item !== "object") return null;
    const name = safeAiString(item.name || item.label || item.title);
    const notes = safeAiString(item.notes || item.description || item.desc);
    const type = safeAiString(item.type || item.category);
    if (!name && !notes && !type) return null;
    return { name, notes, type };
}

function buildAiGearSummary(gear) {
    if (!gear || typeof gear !== "object") {
        return { equipped: {}, bag: [] };
    }

    const equipped = {};
    const bagItems = [];
    const bagMap = new Map();

    if (Array.isArray(gear.bag)) {
        for (const item of gear.bag) {
            if (!item || typeof item !== "object") continue;
            const normalized = normalizeAiGearItem(item);
            if (!normalized) continue;
            bagItems.push(normalized);
            const id = typeof item.id === "string" && item.id ? item.id : null;
            if (id && !bagMap.has(id)) {
                bagMap.set(id, normalized);
            }
        }
    }

    if (gear.equipped && typeof gear.equipped === "object") {
        for (const [slot, item] of Object.entries(gear.equipped)) {
            const normalized = normalizeAiGearItem(item);
            if (!normalized) continue;
            equipped[slot] = normalized;
        }
    }

    if (gear.slots && typeof gear.slots === "object") {
        for (const [slot, value] of Object.entries(gear.slots)) {
            if (!value || typeof value !== "object") continue;
            let source = null;
            if (value.item && typeof value.item === "object") {
                source = value.item;
            } else if (value.itemId && bagMap.has(value.itemId)) {
                source = bagMap.get(value.itemId);
            } else {
                source = value;
            }
            const normalized = normalizeAiGearItem(source);
            if (!normalized) continue;
            equipped[slot] = normalized;
        }
    } else if (!gear.equipped || typeof gear.equipped !== "object") {
        for (const [slot, item] of Object.entries(gear)) {
            const normalized = normalizeAiGearItem(item);
            if (!normalized) continue;
            equipped[slot] = normalized;
        }
    }

    const bag = bagItems.slice(0, 6);

    return { equipped, bag };
}

function buildCharacterAiPayload(character, playerGear) {
    if (!character || typeof character !== "object") {
        return {};
    }

    const profile = character.profile && typeof character.profile === "object" ? character.profile : {};
    const resources = character.resources && typeof character.resources === "object" ? character.resources : {};
    const gearSource =
        playerGear && typeof playerGear === "object"
            ? playerGear
            : character.gear && typeof character.gear === "object"
            ? character.gear
            : {};

    return {
        name: safeAiString(character.name),
        profile: {
            class: safeAiString(profile.class),
            concept: safeAiString(profile.concept),
            race: safeAiString(profile.race),
            alignment: safeAiString(profile.alignment),
            arcana: safeAiString(profile.arcana),
            nationality: safeAiString(profile.nationality),
            backgroundLocale: safeAiString(profile.backgroundLocale),
            homeland: safeAiString(profile.homeland),
            origin: safeAiString(profile.origin),
            age: safeAiString(profile.age),
            gender: safeAiString(profile.gender),
            height: safeAiString(profile.height),
            weight: safeAiString(profile.weight),
            eye: safeAiString(profile.eye),
            hair: safeAiString(profile.hair),
            skinTone: safeAiString(profile.skinTone),
            background: safeAiString(profile.background),
            notes: safeAiString(profile.notes),
            expression: safeAiString(profile.expression),
            style: safeAiString(profile.style),
        },
        resources: {
            level: resources.level ?? "",
            hp: resources.hp ?? "",
            mp: resources.mp ?? "",
            tp: resources.tp ?? "",
            sp: resources.sp ?? "",
        },
        gear: buildAiGearSummary(gearSource),
    };
}


const GEAR_SLOT_LABEL_OVERRIDES = {
    weapon: "Weapon",
    armor: "Armor",
    accessory: "Accessory",
};

function formatGearSlotLabel(key, index = 1) {
    if (!key) return `Gear Slot ${index}`;
    const normalizedKey = String(key).trim();
    const lower = normalizedKey.toLowerCase();
    if (GEAR_SLOT_LABEL_OVERRIDES[lower]) return GEAR_SLOT_LABEL_OVERRIDES[lower];
    const cleaned = normalizedKey.replace(/[-_]+/g, " ").trim();
    if (!cleaned) return `Gear Slot ${index}`;
    return cleaned
        .split(/\s+/)
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
        .join(" ");
}

function normalizeGearDisplayItem(item) {
    if (!item || typeof item !== "object") return null;
    const nameSource =
        typeof item.name === "string"
            ? item.name
            : typeof item.label === "string"
            ? item.label
            : typeof item.title === "string"
            ? item.title
            : "";
    const name = nameSource.trim();
    const detailSource = [
        item.desc,
        item.description,
        item.notes,
        item.effect,
        item.type,
        item.category,
    ];
    let detail = "";
    for (const candidate of detailSource) {
        if (typeof candidate === "string") {
            const trimmed = candidate.trim();
            if (trimmed) {
                detail = trimmed;
                break;
            }
        }
    }
    if (!name && !detail) return null;
    return {
        name: name || "Unnamed gear",
        detail,
    };
}

function resolveGearSlotItem(slotValue, bagMap) {
    if (!slotValue || typeof slotValue !== "object") return null;
    if (slotValue.item && typeof slotValue.item === "object") {
        return normalizeGearDisplayItem(slotValue.item);
    }
    if (slotValue.itemId && bagMap instanceof Map && bagMap.has(slotValue.itemId)) {
        return normalizeGearDisplayItem(bagMap.get(slotValue.itemId));
    }
    return normalizeGearDisplayItem(slotValue);
}

const MusicContext = createContext({
    currentTrack: null,
    playTrack: () => {},
    stopTrack: () => {},
    volume: 0.2,
    setVolume: () => {},
    muted: false,
    setMuted: () => {},
    toggleMute: () => {},
    playbackBlocked: false,
    resume: () => {},
    currentTime: 0,
    duration: 0,
    seek: () => {},
});

const MUSIC_VOLUME_KEY = "amz:musicVolume";
const MUSIC_MUTED_KEY = "amz:musicMuted";

const ALIGNMENT_OPTIONS = [
    { value: "Lawful Good", label: "Lawful Good" },
    { value: "Neutral Good", label: "Neutral Good" },
    { value: "Chaotic Good", label: "Chaotic Good" },
    { value: "Lawful Neutral", label: "Lawful Neutral" },
    { value: "True Neutral", label: "True Neutral" },
    { value: "Chaotic Neutral", label: "Chaotic Neutral" },
    { value: "Lawful Evil", label: "Lawful Evil" },
    { value: "Neutral Evil", label: "Neutral Evil" },
    { value: "Chaotic Evil", label: "Chaotic Evil" },
];

const SERVER_ADMIN_USERNAMES = new Set(["captainpax", "amzyoshio"]);

const AVAILABLE_TAB_KEYS = new Set([
    "overview",
    "sheet",
    "party",
    "map",
    "items",
    "gear",
    "combatSkills",
    "worldSkills",
    "demons",
    "storyLogs",
    "help",
    "settings",
    "serverManagement",
]);

function isServerAdminClient(user) {
    if (!user) return false;
    if (user.isAdmin) return true;
    const username = typeof user.username === "string" ? user.username.trim().toLowerCase() : "";
    if (!username) return false;
    return SERVER_ADMIN_USERNAMES.has(username);
}

function clampVolume(value, fallback = 0.2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    if (num <= 0) return 0;
    if (num >= 1) return 1;
    return num;
}

function MusicProvider({ children }) {
    const audioRef = useRef(null);
    const [currentTrack, setCurrentTrack] = useState(null);
    const [volume, setVolumeState] = useState(() => {
        if (typeof window === "undefined") return 0.2;
        const stored = window.localStorage.getItem(MUSIC_VOLUME_KEY);
        return clampVolume(stored, 0.2);
    });
    const [muted, setMutedState] = useState(() => {
        if (typeof window === "undefined") return false;
        return window.localStorage.getItem(MUSIC_MUTED_KEY) === "1";
    });
    const [playbackBlocked, setPlaybackBlocked] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.volume = clampVolume(volume, volume);
    }, [volume]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.muted = !!muted;
    }, [muted]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime || 0);
        };
        const handleDuration = () => {
            const raw = Number(audio.duration);
            if (Number.isFinite(raw) && raw >= 0) {
                setDuration(raw);
            }
        };
        const handleEnded = () => {
            setPlaybackBlocked(false);
        };
        audio.addEventListener("timeupdate", handleTimeUpdate);
        audio.addEventListener("loadedmetadata", handleDuration);
        audio.addEventListener("durationchange", handleDuration);
        audio.addEventListener("ended", handleEnded);
        return () => {
            audio.removeEventListener("timeupdate", handleTimeUpdate);
            audio.removeEventListener("loadedmetadata", handleDuration);
            audio.removeEventListener("durationchange", handleDuration);
            audio.removeEventListener("ended", handleEnded);
        };
    }, []);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        if (!currentTrack || !currentTrack.src) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            setPlaybackBlocked(false);
            setCurrentTime(0);
            setDuration(0);
            return;
        }

        if (audio.src !== currentTrack.src) {
            audio.src = currentTrack.src;
        }
        audio.loop = currentTrack.loop !== false;

        const desiredTime =
            typeof currentTrack.position === "number" && Number.isFinite(currentTrack.position) && currentTrack.position >= 0
                ? currentTrack.position
                : 0;

        const syncPosition = () => {
            try {
                if (Math.abs(audio.currentTime - desiredTime) > 0.25) {
                    audio.currentTime = desiredTime;
                }
                setCurrentTime(desiredTime);
            } catch (err) {
                console.warn("Failed to sync audio position", err);
            }
        };

        const updateDurationFromAudio = () => {
            const raw = Number(audio.duration);
            if (Number.isFinite(raw) && raw >= 0) {
                setDuration(raw);
            }
        };

        const attemptPlay = () => {
            try {
                const maybePromise = audio.play();
                if (maybePromise && typeof maybePromise.then === "function") {
                    maybePromise
                        .then(() => setPlaybackBlocked(false))
                        .catch((err) => {
                            console.warn("Music playback failed", err);
                            setPlaybackBlocked(true);
                        });
                } else {
                    setPlaybackBlocked(false);
                }
            } catch (err) {
                console.warn("Music playback failed", err);
                setPlaybackBlocked(true);
            }
        };

        if (currentTrack.duration != null && Number.isFinite(currentTrack.duration) && currentTrack.duration >= 0) {
            setDuration(currentTrack.duration);
        }

        if (audio.readyState >= 1) {
            syncPosition();
            if (currentTrack.playing) {
                attemptPlay();
            } else {
                audio.pause();
            }
            if (audio.readyState >= 2 && currentTrack.duration == null) {
                updateDurationFromAudio();
            }
            return;
        }

        const onLoaded = () => {
            audio.removeEventListener("loadedmetadata", onLoaded);
            syncPosition();
            updateDurationFromAudio();
            if (currentTrack.playing) {
                attemptPlay();
            } else {
                audio.pause();
            }
        };

        audio.addEventListener("loadedmetadata", onLoaded);
        return () => audio.removeEventListener("loadedmetadata", onLoaded);
    }, [currentTrack]);

    const playTrack = useCallback((track) => {
        if (!track || !track.src) {
            setCurrentTrack(null);
            setCurrentTime(0);
            setDuration(0);
            return;
        }
        const normalized = {
            id: track.trackId || track.id || "",
            title: track.title || "Unknown track",
            info: track.info || "",
            src: track.src,
            loop: track.loop !== false,
            updatedAt: typeof track.updatedAt === "string" ? track.updatedAt : new Date().toISOString(),
            playing: track.playing !== false,
            position:
                typeof track.position === "number" && Number.isFinite(track.position) && track.position >= 0
                    ? track.position
                    : 0,
            source: track.source || "",
            duration:
                typeof track.duration === "number" && Number.isFinite(track.duration) && track.duration >= 0
                    ? track.duration
                    : null,
        };
        setCurrentTime(normalized.position);
        if (normalized.duration != null) {
            setDuration(normalized.duration);
        }
        setCurrentTrack((prev) => {
            if (
                prev &&
                prev.id === normalized.id &&
                prev.src === normalized.src &&
                prev.updatedAt === normalized.updatedAt &&
                prev.playing === normalized.playing &&
                Math.abs((prev.position || 0) - normalized.position) < 0.01
            ) {
                return { ...prev, ...normalized };
            }
            return normalized;
        });
    }, []);

    const stopTrack = useCallback(() => {
        setCurrentTrack(null);
        setCurrentTime(0);
        setDuration(0);
    }, []);

    const seek = useCallback((time) => {
        const audio = audioRef.current;
        if (!audio) return;
        const safe = Number(time);
        const clamped = Number.isFinite(safe) && safe >= 0 ? safe : 0;
        try {
            audio.currentTime = clamped;
            setCurrentTime(clamped);
        } catch (err) {
            console.warn("Music seek failed", err);
        }
    }, []);

    const updateVolume = useCallback((value) => {
        setVolumeState((prev) => {
            const sanitized = clampVolume(value, prev);
            if (typeof window !== "undefined") {
                window.localStorage.setItem(MUSIC_VOLUME_KEY, String(sanitized));
            }
            return sanitized;
        });
    }, []);

    const updateMuted = useCallback((value) => {
        const next = !!value;
        setMutedState(next);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(MUSIC_MUTED_KEY, next ? "1" : "0");
        }
    }, []);

    const toggleMute = useCallback(() => {
        updateMuted(!muted);
    }, [muted, updateMuted]);

    const resumePlayback = useCallback(() => {
        const audio = audioRef.current;
        if (!audio || !currentTrack?.src) return;
        try {
            const maybePromise = audio.play();
            if (maybePromise && typeof maybePromise.then === "function") {
                maybePromise
                    .then(() => setPlaybackBlocked(false))
                    .catch((err) => {
                        console.warn("Music resume failed", err);
                        setPlaybackBlocked(true);
                    });
            } else {
                setPlaybackBlocked(false);
            }
        } catch (err) {
            console.warn("Music resume failed", err);
            setPlaybackBlocked(true);
        }
    }, [currentTrack]);

    const contextValue = useMemo(
        () => ({
            currentTrack,
            playTrack,
            stopTrack,
            volume,
            setVolume: updateVolume,
            muted,
            setMuted: updateMuted,
            toggleMute,
            playbackBlocked,
            resume: resumePlayback,
            currentTime,
            duration,
            seek,
        }),
        [
            currentTrack,
            playTrack,
            stopTrack,
            volume,
            updateVolume,
            muted,
            updateMuted,
            toggleMute,
            playbackBlocked,
            resumePlayback,
            currentTime,
            duration,
            seek,
        ],
    );

    return (
        <MusicContext.Provider value={contextValue}>
            {children}
            <audio ref={audioRef} preload="auto" style={{ display: "none" }} />
        </MusicContext.Provider>
    );
}

// formatting helpers moved to utils/items

function parseAppLocation(loc) {
    if (!loc) {
        return { joinCode: null, game: null };
    }
    const pathname = typeof loc.pathname === "string" ? loc.pathname : "";
    const search = typeof loc.search === "string" ? loc.search : "";
    const joinMatch = pathname.match(/^\/join\/([^/?#]+)/i);
    if (joinMatch) {
        let code = joinMatch[1];
        try {
            code = decodeURIComponent(code);
        } catch {
            // ignore malformed escape sequences
        }
        return { joinCode: code.toUpperCase(), game: null };
    }
    const gameMatch = pathname.match(/^\/game\/([^/?#]+)/i);
    if (gameMatch) {
        let id = gameMatch[1];
        try {
            id = decodeURIComponent(id);
        } catch {
            // ignore malformed escape sequences
        }
        const params = new URLSearchParams(search);
        const tabParam = params.get("tab");
        const playerParam = params.get("player");
        return {
            joinCode: null,
            game: {
                id,
                tab: tabParam || null,
                player: playerParam || null,
            },
        };
    }
    return { joinCode: null, game: null };
}


export default function App() {
    const initialRouteRef = useRef(
        typeof window !== "undefined" ? parseAppLocation(window.location) : { joinCode: null, game: null }
    );
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);
    const [games, setGames] = useState([]);
    const [active, setActive] = useState(null);
    const [tab, setTab] = useState("sheet");
    const [dmSheetPlayerId, setDmSheetPlayerId] = useState(null);
    const [pendingJoinCode, setPendingJoinCode] = useState(initialRouteRef.current.joinCode);
    const [pendingGameLink, setPendingGameLink] = useState(initialRouteRef.current.game);
    const joinInFlight = useRef(false);

    const meId = me?.id;

    useEffect(() => {
        if (!active || !idsMatch(active.dmId, meId)) {
            if (dmSheetPlayerId !== null) setDmSheetPlayerId(null);
            return;
        }

        const players = (active.players || []).filter(
            (p) => (p?.role || "").toLowerCase() !== "dm"
        );
        if (players.length === 0) {
            if (dmSheetPlayerId !== null) setDmSheetPlayerId(null);
            return;
        }

        if (dmSheetPlayerId && players.some((p) => idsMatch(p.userId, dmSheetPlayerId))) {
            return;
        }

        const firstPlayerId = normalizeId(players[0]?.userId) ?? players[0]?.userId ?? null;
        setDmSheetPlayerId(firstPlayerId);
    }, [active, dmSheetPlayerId, meId]);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const handlePopState = () => {
            const parsed = parseAppLocation(window.location);
            setPendingJoinCode(parsed.joinCode);
            setPendingGameLink(parsed.game);
            if (!parsed.game) {
                setActive(null);
                setDmSheetPlayerId(null);
            }
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [setActive, setDmSheetPlayerId, setPendingGameLink, setPendingJoinCode]);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const m = await Auth.me();
                if (!mounted) return;
                const normalizedMe = m
                    ? {
                          ...m,
                          id: normalizeId(m.id) ?? (m.id ?? null),
                      }
                    : null;
                setMe(normalizedMe);
                setLoading(false);
                if (m) setGames(normalizeGameList(await Games.list()));
            } catch (e) {
                console.error(e);
                if (mounted) setLoading(false);
                alert(e.message || "Failed to load session");
            }
        })();
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        const link = pendingGameLink;
        if (!link) return;
        if (!link.id) {
            setPendingGameLink(null);
            return;
        }
        if (!me) return;

        const applyStateForGame = (gameData) => {
            if (!gameData) return;
            const isDM = idsMatch(gameData.dmId, me.id);
            const nav = buildNavigation({
                role: isDM ? "dm" : "player",
                isServerAdmin: isServerAdminClient(me),
                availableKeys: AVAILABLE_TAB_KEYS,
            });
            const allowedTabs = new Set(nav.map((item) => item.key));
            const fallbackTab = isDM ? "overview" : "sheet";
            const desiredTab = link.tab && allowedTabs.has(link.tab) ? link.tab : fallbackTab;
            setTab((prev) => (prev === desiredTab ? prev : desiredTab));

            if (isDM) {
                let targetPlayerId = null;
                const linkPlayerId = normalizeId(link.player) ?? link.player ?? null;
                if (linkPlayerId && Array.isArray(gameData.players)) {
                    const match = gameData.players.find((p) => p && idsMatch(p.userId, linkPlayerId));
                    if (match && match.userId) {
                        targetPlayerId = normalizeId(match.userId) ?? match.userId;
                    }
                }
                if (!targetPlayerId && Array.isArray(gameData.players)) {
                    const first = gameData.players.find(
                        (p) => p && (p.role || "").toLowerCase() !== "dm" && p.userId
                    );
                    targetPlayerId = normalizeId(first?.userId) ?? first?.userId ?? null;
                }
                setDmSheetPlayerId((prev) =>
                    idsMatch(prev, targetPlayerId) ? prev : targetPlayerId ?? null
                );
            } else {
                setDmSheetPlayerId((prev) => (prev === null ? prev : null));
            }
        };

        if (active?.id === link.id) {
            applyStateForGame(active);
            setPendingGameLink(null);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const full = await Games.get(link.id);
                if (cancelled) return;
                const normalizedFull = normalizeGameRecord(full);
                setActive(normalizedFull);
                applyStateForGame(normalizedFull);
            } catch (err) {
                console.error(err);
                if (!cancelled) {
                    if (typeof window !== "undefined") {
                        window.history.replaceState({}, "", "/");
                    }
                    setActive(null);
                    setDmSheetPlayerId(null);
                    alert(err.message || "Failed to open game");
                }
            } finally {
                if (!cancelled) {
                    setPendingGameLink(null);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [active, me, pendingGameLink, setActive, setDmSheetPlayerId, setPendingGameLink, setTab]);

    useEffect(() => {
        if (!pendingJoinCode || !me || joinInFlight.current) return;
        joinInFlight.current = true;
        let joinSucceeded = false;
        (async () => {
            try {
                const result = await Games.joinByCode(pendingJoinCode);
                setGames(normalizeGameList(await Games.list()));
                if (result?.gameId) {
                    const full = await Games.get(result.gameId);
                    const normalizedFull = normalizeGameRecord(full);
                    setActive(normalizedFull);
                    if (idsMatch(normalizedFull.dmId, me.id)) {
                        const firstPlayer = (full.players || []).find(
                            (p) => (p?.role || "").toLowerCase() !== "dm"
                        );
                        const normalizedFirstId = normalizeId(firstPlayer?.userId);
                        setDmSheetPlayerId(normalizedFirstId ?? firstPlayer?.userId ?? null);
                        setTab("overview");
                    } else {
                        setDmSheetPlayerId(null);
                        setTab("sheet");
                    }
                    joinSucceeded = true;
                }
            } catch (e) {
                console.error(e);
                alert(e.message || "Failed to join game");
            } finally {
                setPendingJoinCode(null);
                joinInFlight.current = false;
                if (typeof window !== "undefined") {
                    if (!joinSucceeded) {
                        window.history.replaceState({}, "", "/");
                    }
                }
            }
        })();
    }, [pendingJoinCode, me]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (active && active.id) return;
        if (pendingGameLink) return;
        if (pendingJoinCode) return;
        const current = `${window.location.pathname}${window.location.search}`;
        if (current !== "/") {
            window.history.replaceState({}, "", "/");
        }
    }, [active, pendingGameLink, pendingJoinCode]);

    const authContent = (
        <AuthView
            onAuthed={async () => {
                try {
                    const m = await Auth.me();
                    const normalizedMe = m
                        ? {
                              ...m,
                              id: normalizeId(m.id) ?? (m.id ?? null),
                          }
                        : null;
                    setMe(normalizedMe);
                    setGames(normalizeGameList(await Games.list()));
                } catch (e) {
                    alert(e.message);
                }
            }}
        />
    );

    const appContent = (
        <AuthenticatedApp
            me={me}
            games={games}
            active={active}
            setActive={setActive}
            setGames={setGames}
            tab={tab}
            setTab={setTab}
            dmSheetPlayerId={dmSheetPlayerId}
            setDmSheetPlayerId={setDmSheetPlayerId}
        />
    );

    const body = loading ? <Center>Loading…</Center> : me ? appContent : authContent;

    return <MusicProvider>{body}</MusicProvider>;
}

// ---------- Small bits ----------
function Center({ children }) {
    return (
        <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
            {children}
        </div>
    );
}

function InviteButton({ gameId }) {
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);

    useEffect(() => {
        if (!feedback) return undefined;
        const timer = setTimeout(() => setFeedback(null), 8000);
        return () => clearTimeout(timer);
    }, [feedback]);

    const copyToClipboard = useCallback(async (text) => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (err) {
            console.warn("Clipboard API failed", err);
        }

        try {
            const area = document.createElement("textarea");
            area.value = text;
            area.setAttribute("readonly", "");
            area.style.position = "absolute";
            area.style.left = "-9999px";
            document.body.appendChild(area);
            area.select();
            document.execCommand("copy");
            document.body.removeChild(area);
            return true;
        } catch (err) {
            console.warn("Fallback clipboard copy failed", err);
            return false;
        }
    }, []);

    return (
        <div className="invite-button">
            <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                    try {
                        setBusy(true);
                        const code = await Games.invite(gameId);
                        const url = `${location.origin}${code.joinUrl}`;
                        const copied = await copyToClipboard(
                            `Join my campaign using invite code ${code.code}: ${url}`
                        );
                        setFeedback({
                            code: code.code,
                            url,
                            copied,
                        });
                    } catch (e) {
                        alert(e.message);
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                {busy ? "…" : "Invite"}
            </button>

            {feedback && (
                <div className="invite-feedback" role="status" aria-live="polite">
                    <strong>
                        {feedback.copied
                            ? "Invite link copied to your clipboard"
                            : "Invite ready to share"}
                    </strong>
                    <div className="invite-feedback__row">
                        <span>Code:</span>
                        <code>{feedback.code}</code>
                    </div>
                    <div className="invite-feedback__row">
                        <span>Link:</span>
                        <code>{feedback.url}</code>
                    </div>
                    {!feedback.copied && (
                        <span className="invite-feedback__note">
                            Copying may be blocked by your browser. You can manually copy the
                            details above.
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------- Auth ----------
function AuthView({ onAuthed }) {
    const [username, setUser] = useState("");
    const [password, setPass] = useState("");
    const [email, setEmail] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [mode, setMode] = useState("login");
    const [busy, setBusy] = useState(false);

    const go = async () => {
        if (!username || !password) return alert("Enter username & password");
        if (mode === "register") {
            if (!email) return alert("Enter email");
            if (!confirmPassword) return alert("Confirm your password");
            if (password !== confirmPassword) return alert("Passwords do not match");
        }
        try {
            setBusy(true);
            if (mode === "login") await Auth.login(username, password);
            else await Auth.register(username, password, email, confirmPassword);
            onAuthed();
        } catch (e) {
            alert(e.message);
        } finally {
            setBusy(false);
        }
    };

    const onKey = (e) => e.key === "Enter" && go();

    const toggleMode = () => {
        setMode((prev) => {
            const next = prev === "login" ? "register" : "login";
            if (next === "login") {
                setEmail("");
                setConfirmPassword("");
            }
            return next;
        });
    };

    return (
        <Center>
            <div className="card auth-card" style={{ minWidth: 360 }}>
                <HatLogo size={72} className="auth-card__logo" />
                <h2>{mode === "login" ? "Login" : "Create Account"}</h2>
                <div className="col">
                    <input
                        placeholder="Username"
                        value={username}
                        onChange={(e) => setUser(e.target.value)}
                        onKeyDown={onKey}
                    />
                    {mode === "register" && (
                        <input
                            placeholder="Email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={onKey}
                        />
                    )}
                    <input
                        placeholder="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPass(e.target.value)}
                        onKeyDown={onKey}
                    />
                    {mode === "register" && (
                        <input
                            placeholder="Confirm Password"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            onKeyDown={onKey}
                        />
                    )}
                    <button className="btn" onClick={go} disabled={busy}>
                        {busy ? "…" : mode === "login" ? "Login" : "Register"}
                    </button>
                    <button
                        className="btn"
                        onClick={toggleMode}
                        disabled={busy}
                    >
                        {mode === "login" ? "Need an account?" : "Have an account?"}
                    </button>
                </div>
            </div>
        </Center>
    );
}

function HatLogo({ size = 56, className = "" }) {
    const classes = ["hat-logo", className].filter(Boolean).join(" ");
    return (
        <img
            src="/personahaticon.gif"
            alt="Persona tabletop logo"
            width={size}
            height={size}
            className={classes}
            draggable="false"
        />
    );
}

// ---------- Home ----------
function Home({ me, games, onOpen, onCreate, onDelete }) {
    const [name, setName] = useState("My Campaign");
    const [busy, setBusy] = useState(false);
    const gameList = useMemo(() => {
        if (Array.isArray(games)) return games;
        if (games && Array.isArray(games.items)) return games.items;
        if (games && typeof games === "object") {
            console.warn("Unexpected games payload", games);
        }
        return [];
    }, [games]);
    const displayName = useMemo(() => {
        if (!me) return "Adventurer";
        const raw = typeof me.username === "string" ? me.username.trim() : "";
        return raw || "Adventurer";
    }, [me]);

    const musicControls = useContext(MusicContext);
    const playTrack = musicControls?.playTrack;
    const stopTrack = musicControls?.stopTrack;

    useEffect(() => {
        if (typeof playTrack !== "function") return undefined;
        const track = getMainMenuTrack();
        if (track) {
            playTrack({
                trackId: track.id,
                id: track.id,
                title: track.title,
                info: track.info || "",
                src: track.src,
                loop: track.loop !== false,
                playing: true,
                position: 0,
                updatedAt: new Date().toISOString(),
                source: "builtin",
                duration:
                    typeof track.duration === "number" && Number.isFinite(track.duration) && track.duration >= 0
                        ? track.duration
                        : null,
            });
        } else if (typeof stopTrack === "function") {
            stopTrack();
        }
        return () => {
            if (typeof stopTrack === "function") {
                stopTrack();
            }
        };
    }, [playTrack, stopTrack]);

    return (
        <div className="home-layout">
            <header className="home-header">
                <div className="home-header__brand">
                    <HatLogo size={64} />
                    <div className="home-header__brand-text">
                        <span className="eyebrow">Campaign hub</span>
                        <h2>Welcome, {displayName}</h2>
                    </div>
                </div>
                <button
                    className="btn"
                    onClick={async () => {
                        try {
                            await Auth.logout();
                            location.reload();
                        } catch (e) {
                            alert(e.message);
                        }
                    }}
                >
                    Logout
                </button>
            </header>

            <div className="card">
                <h3>Your Games</h3>
                <div className="list">
                    {gameList.length === 0 && <div>No games yet.</div>}
                    {gameList.map((g) => {
                        const isOwner = idsMatch(g.dmId, me.id);
                        return (
                            <div
                                key={g.id}
                                className="row"
                                style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}
                            >
                                <div>
                                    <b>{g.name}</b>{" "}
                                    <span className="pill">{(g.players?.length ?? 0)} members</span>
                                </div>
                                <div className="row" style={{ gap: 8 }}>
                                    <button className="btn" onClick={() => onOpen(g)}>Open</button>
                                    {isOwner && (
                                        <button
                                            className="btn danger"
                                            onClick={() => onDelete?.(g)}
                                        >
                                            Delete
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="card">
                <h3>Start a New Game (DM)</h3>
                <div className="row">
                    <input
                        placeholder="Campaign name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <button
                        className="btn"
                        disabled={!name.trim() || busy}
                        onClick={async () => {
                            try {
                                setBusy(true);
                                await onCreate(name.trim());
                                alert("Game created");
                            } catch (e) {
                                alert(e.message);
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        {busy ? "…" : "Create"}
                    </button>
                </div>
            </div>

            <div className="card">
                <h3>Join by Invite Code</h3>
                <JoinByCode onJoined={() => location.reload()} />
            </div>
        </div>
    );
}

function AuthenticatedApp({
    me,
    games,
    active,
    setActive,
    setGames,
    tab,
    setTab,
    dmSheetPlayerId,
    setDmSheetPlayerId,
}) {
    if (!active) {
        return (
            <Home
                me={me}
                games={games}
                onOpen={async (g) => {
                    const full = await Games.get(g.id);
                    const normalizedFull = normalizeGameRecord(full);
                    setActive(normalizedFull);
                    if (idsMatch(normalizedFull.dmId, me.id)) {
                        const firstPlayer = (normalizedFull.players || []).find(
                            (p) => (p?.role || "").toLowerCase() !== "dm"
                        );
                        const normalizedFirstId = normalizeId(firstPlayer?.userId);
                        setDmSheetPlayerId(normalizedFirstId ?? firstPlayer?.userId ?? null);
                    } else {
                        setDmSheetPlayerId(null);
                    }
                    setTab(idsMatch(normalizedFull.dmId, me.id) ? "overview" : "sheet");
                }}
                onCreate={async (name) => {
                    await Games.create(name);
                    setGames(normalizeGameList(await Games.list()));
                }}
                onDelete={async (game) => {
                    if (!confirm(`Delete the game "${game.name}"? This cannot be undone.`)) return;
                    try {
                        await Games.delete(game.id);
                        setGames(normalizeGameList(await Games.list()));
                        alert("Game deleted");
                    } catch (e) {
                        alert(e.message);
                    }
                }}
            />
        );
    }

    return (
        <GameView
            me={me}
            game={active}
            setActive={setActive}
            setGames={setGames}
            tab={tab}
            setTab={setTab}
            dmSheetPlayerId={dmSheetPlayerId}
            setDmSheetPlayerId={setDmSheetPlayerId}
        />
    );
}

function GameView({
    me,
    game,
    setActive,
    setGames,
    tab,
    setTab,
    dmSheetPlayerId,
    setDmSheetPlayerId,
}) {
    const isDM = idsMatch(game.dmId, me.id);
    const [apiBusy, setApiBusy] = useState(false);
    const [refreshBusy, setRefreshBusy] = useState(false);
    const initialDesktop = typeof window === "undefined" ? true : window.innerWidth >= 960;
    const [isDesktop, setIsDesktop] = useState(initialDesktop);
    const [sidebarOpen, setSidebarOpen] = useState(initialDesktop);
    const [logoutBusy, setLogoutBusy] = useState(false);
    const loadedTabRef = useRef(false);
    const loadedSheetRef = useRef(false);
    const previousIsDesktopRef = useRef(initialDesktop);
    const showServerManagement = isServerAdminClient(me);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const handleResize = () => {
            setIsDesktop(window.innerWidth >= 960);
        };
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => onApiActivity(setApiBusy), []);

    const tabPrefKey = game?.id ? `amz:lastTab:${game.id}` : null;
    const sheetPrefKey = game?.id ? `amz:lastSheet:${game.id}` : null;

    useEffect(() => {
        loadedTabRef.current = false;
    }, [tabPrefKey]);

    useEffect(() => {
        loadedSheetRef.current = false;
    }, [sheetPrefKey]);

    const navItems = useMemo(
        () =>
            buildNavigation({
                role: isDM ? "dm" : "player",
                isServerAdmin: showServerManagement,
                availableKeys: AVAILABLE_TAB_KEYS,
            }),
        [isDM, showServerManagement]
    );

    const refreshCampaignList = useCallback(async () => {
        try {
            setGames(normalizeGameList(await Games.list()));
        } catch (err) {
            console.warn("Failed to refresh games", err);
        }
    }, [setGames]);

    const updateSidebarOpen = useCallback((nextValue, reason) => {
        setSidebarOpen((prev) => {
            const resolved =
                typeof nextValue === "function" ? nextValue(prev) : Boolean(nextValue);
            if (resolved !== prev) {
                clientLogger.info(
                    resolved ? "Navigation drawer opened" : "Navigation drawer closed",
                    reason ? { reason } : undefined,
                );
            }
            return resolved;
        });
    }, []);

    const hideSidebar = useCallback(
        (reason) => {
            updateSidebarOpen(false, reason);
        },
        [updateSidebarOpen]
    );

    const handleSelectNav = useCallback(
        (key) => {
            setTab(key);
            clientLogger.debug("Navigated to tab", { tab: key });
            if (!isDesktop) {
                hideSidebar("tab-select");
            }
        },
        [hideSidebar, isDesktop, setTab]
    );

    const toggleSidebar = useCallback(() => {
        updateSidebarOpen((prev) => !prev, "toggle-button");
    }, [updateSidebarOpen]);

    const closeSidebar = useCallback(() => {
        hideSidebar("close-button");
    }, [hideSidebar]);

    useEffect(() => {
        const previous = previousIsDesktopRef.current;
        if (isDesktop && !previous) {
            updateSidebarOpen(true, "layout-breakpoint");
        } else if (!isDesktop && previous) {
            updateSidebarOpen(false, "layout-breakpoint");
        }
        previousIsDesktopRef.current = isDesktop;
    }, [isDesktop, updateSidebarOpen]);

    useEffect(() => {
        if (navItems.length === 0) return;
        if (!navItems.some((item) => item.key === tab)) {
            setTab(navItems[0].key);
        }
    }, [navItems, tab, setTab]);

    useEffect(() => {
        if (!tabPrefKey || loadedTabRef.current) return;
        const stored = typeof window !== "undefined" ? localStorage.getItem(tabPrefKey) : null;
        if (stored && navItems.some((item) => item.key === stored)) {
            setTab(stored);
        }
        loadedTabRef.current = true;
    }, [navItems, setTab, tabPrefKey]);

    useEffect(() => {
        if (!tabPrefKey) return;
        if (typeof window !== "undefined") {
            localStorage.setItem(tabPrefKey, tab);
        }
    }, [tab, tabPrefKey]);

    const activeNav = navItems.find((item) => item.key === tab) || navItems[0] || null;

    const campaignPlayers = useMemo(
        () =>
            (game.players || []).filter(
                (p) => (p?.role || "").toLowerCase() !== "dm"
            ),
        [game.players]
    );

    useEffect(() => {
        if (!sheetPrefKey || !isDM || loadedSheetRef.current) return;
        const stored = typeof window !== "undefined" ? localStorage.getItem(sheetPrefKey) : null;
        if (stored && campaignPlayers.some((p) => idsMatch(p.userId, stored))) {
            setDmSheetPlayerId(stored);
        }
        loadedSheetRef.current = true;
    }, [campaignPlayers, isDM, setDmSheetPlayerId, sheetPrefKey]);

    useEffect(() => {
        if (!sheetPrefKey || !isDM) return;
        if (typeof window !== "undefined") {
            localStorage.setItem(sheetPrefKey, dmSheetPlayerId || "");
        }
    }, [dmSheetPlayerId, isDM, sheetPrefKey]);

    const myEntry = useMemo(
        () => campaignPlayers.find((p) => idsMatch(p.userId, me.id)) || null,
        [campaignPlayers, me.id]
    );

    const playerMaccaInfo = useMemo(() => {
        if (!myEntry) {
            return { value: 0, label: "0" };
        }
        const raw = Number(myEntry.character?.resources?.macca);
        const value = Number.isFinite(raw) ? raw : 0;
        return {
            value,
            label: Number.isFinite(raw) ? value.toLocaleString() : "0",
        };
    }, [myEntry]);

    const demonCount = Array.isArray(game.demons) ? game.demons.length : 0;

    const headerPills = useMemo(() => {
        if (isDM) {
            return [
                { label: `Players ${campaignPlayers.length}` },
                { label: `Demons ${demonCount}` },
            ];
        }
        if (!myEntry) return [];
        const hpRaw = Number(myEntry.character?.resources?.hp ?? 0);
        const maxRaw = Number(myEntry.character?.resources?.maxHP ?? 0);
        const hp = Number.isFinite(hpRaw) ? hpRaw : 0;
        const maxHP = Number.isFinite(maxRaw) ? maxRaw : 0;
        const lvlRaw = Number(myEntry.character?.resources?.level);
        const level = Number.isFinite(lvlRaw) ? lvlRaw : null;
        const tone =
            maxHP > 0
                ? hp <= 0
                    ? "danger"
                    : hp / maxHP < 0.35
                    ? "warn"
                    : "success"
                : hp <= 0
                ? "danger"
                : undefined;
        const hpLabel = maxHP > 0 ? `${hp}/${maxHP}` : String(hp);
        const pills = [];
        if (level !== null) pills.push({ label: `Level ${level}` });
        pills.push({
            label: `HP ${hpLabel}`,
            tone,
        });
        return pills;
    }, [campaignPlayers.length, demonCount, isDM, myEntry]);

    const handleLogout = useCallback(async () => {
        try {
            setLogoutBusy(true);
            await Auth.logout();
            if (typeof window !== "undefined") {
                window.location.href = "/";
            }
        } catch (err) {
            alert(err?.message || "Failed to log out");
        } finally {
            setLogoutBusy(false);
        }
    }, []);

    const refreshGameData = useCallback(async () => {
        if (!game?.id) return null;
        const full = await Games.get(game.id);
        const normalizedFull = normalizeGameRecord(full);
        setActive(normalizedFull);
        return normalizedFull;
    }, [game?.id, setActive]);

    const handleRefresh = useCallback(async () => {
        if (!game?.id) return;
        try {
            setRefreshBusy(true);
            await refreshGameData();
        } catch (e) {
            alert(e.message);
        } finally {
            setRefreshBusy(false);
        }
    }, [game?.id, refreshGameData]);

    const handleGameDeleted = useCallback(async () => {
        if (typeof window !== "undefined" && !isDM) {
            alert("This game has been deleted. Returning to your campaigns.");
        }
        setActive(null);
        setDmSheetPlayerId(null);
        await refreshCampaignList();
    }, [isDM, refreshCampaignList, setActive, setDmSheetPlayerId]);

    useEffect(() => {
        if (typeof window === "undefined" || !game?.id) return;
        const params = new URLSearchParams();
        if (tab) params.set("tab", tab);
        if (isDM && dmSheetPlayerId) params.set("player", dmSheetPlayerId);
        const search = params.toString();
        const next = `/game/${encodeURIComponent(game.id)}${search ? `?${search}` : ""}`;
        const current = `${window.location.pathname}${window.location.search}`;
        if (current !== next) {
            window.history.replaceState({}, "", next);
        }
    }, [game?.id, tab, isDM, dmSheetPlayerId]);

    useEffect(() => {
        const handler = (evt) => {
            if (!(evt.ctrlKey && evt.altKey)) return;
            const target = evt.target;
            if (target && target instanceof HTMLElement) {
                const tag = target.tagName.toLowerCase();
                if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
            }
            if (evt.key === "r" || evt.key === "R") {
                evt.preventDefault();
                handleRefresh();
                return;
            }
            const numeric = Number(evt.key);
            if (Number.isInteger(numeric) && numeric > 0 && numeric <= navItems.length) {
                evt.preventDefault();
                setTab(navItems[numeric - 1].key);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [handleRefresh, navItems, setTab]);

    const realtime = useRealtimeConnection({
        gameId: game.id,
        refreshGame: refreshGameData,
        onGameDeleted: handleGameDeleted,
    });

    const syncMusic = realtime.syncMusic;
    const musicControls = useContext(MusicContext);
    const playTrack = musicControls?.playTrack;
    const stopTrack = musicControls?.stopTrack;
    const realtimeMusicState = realtime.musicState || null;
    const volumeValue = typeof musicControls?.volume === "number" ? musicControls.volume : 0.2;
    const muted = !!musicControls?.muted;
    const setVolume = musicControls?.setVolume;
    const toggleMuteControl = musicControls?.toggleMute;
    const resumePlayback = musicControls?.resume;
    const playbackBlocked = !!musicControls?.playbackBlocked;
    const currentMusicTrack = musicControls?.currentTrack || null;
    const canSetVolume = typeof setVolume === "function";
    const canToggleMute = typeof toggleMuteControl === "function";
    const canResumePlayback = typeof resumePlayback === "function";

    useEffect(() => {
        if (typeof syncMusic === "function") {
            syncMusic(game.music);
        }
    }, [game.music, syncMusic]);

    useEffect(() => {
        if (realtimeMusicState) {
            if (typeof playTrack === "function") {
                playTrack(realtimeMusicState);
            }
        } else if (typeof stopTrack === "function") {
            stopTrack();
        }
    }, [playTrack, stopTrack, realtimeMusicState]);

    useEffect(
        () => () => {
            if (typeof stopTrack === "function") {
                stopTrack();
            }
        },
        [stopTrack]
    );

    const sidebarVisible = sidebarOpen;
    const shellClassName = `app-shell ${sidebarVisible ? "is-sidebar-open" : "is-sidebar-collapsed"}`;
    const showSidebarScrim = sidebarVisible && !isDesktop;

    useEffect(() => {
        if (navItems.length === 0) return;
        clientLogger.info("Navigation tabs ready", {
            tabs: navItems.map((item) => ({ key: item.key, label: item.label })),
        });
    }, [navItems]);

    useEffect(() => {
        if (!tab) return;
        clientLogger.debug("Active tab changed", { tab });
    }, [tab]);

    return (
        <RealtimeContext.Provider value={realtime}>
            <div className="app-root">
                <div className={`app-activity${apiBusy ? " is-active" : ""}`}>
                    <div className="app-activity__bar" />
                </div>
                <SharedMediaDisplay isDM={isDM} />
                <AlertOverlay />
                <div className={shellClassName}>
                    <button
                        type="button"
                        className={`app-sidebar__scrim${showSidebarScrim ? " is-visible" : ""}`}
                        onClick={() => hideSidebar("scrim")}
                        aria-hidden={!showSidebarScrim}
                        aria-label="Close navigation"
                        hidden={!showSidebarScrim}
                        tabIndex={showSidebarScrim ? 0 : -1}
                    >
                        <span className="sr-only">Close navigation</span>
                    </button>
                    <aside
                        id="game-sidebar"
                        className={`app-sidebar${sidebarVisible ? " is-open" : ""}`}
                        aria-hidden={!sidebarVisible}
                    >
                        <div className="sidebar__header">
                            <div className="sidebar__header-main">
                                <span className="sidebar__mode">
                                    {isDM ? "Dungeon Master Mode" : "Player Mode"}
                                </span>
                                <h2 className="sidebar__title">{game.name}</h2>
                                <p className="sidebar__summary">
                                    {isDM
                                        ? "Share quick links, manage characters, and keep your table organized."
                                        : "Track your hero, review the party, and stay aligned with your DM."}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="sidebar__close"
                                onClick={closeSidebar}
                                aria-label="Close menu"
                                title="Close menu"
                            >
                                <span aria-hidden>×</span>
                            </button>
                        </div>
                        <NavigationSidebar
                            items={navItems}
                            activeKey={tab}
                            onSelect={handleSelectNav}
                        />
                        <div className="sidebar__audio-panel">
                            <div className="sidebar__audio-header">
                                <span className="sidebar__audio-title">Session music</span>
                                {playbackBlocked && (
                                    <button
                                        type="button"
                                        className="btn ghost btn-small"
                                        onClick={() => {
                                            if (canResumePlayback) {
                                                resumePlayback();
                                            }
                                        }}
                                        disabled={!canResumePlayback}
                                    >
                                        Resume
                                    </button>
                                )}
                            </div>
                            <div className="sidebar__audio-controls">
                                <button
                                    type="button"
                                    className="btn ghost btn-small"
                                    onClick={() => {
                                        if (canToggleMute) {
                                            toggleMuteControl();
                                        }
                                    }}
                                    disabled={!canToggleMute}
                                >
                                    {muted ? "Unmute" : "Mute"}
                                </button>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={Math.round(volumeValue * 100)}
                                    onChange={(event) => {
                                        if (canSetVolume) {
                                            const next = Number(event.target.value) / 100;
                                            setVolume(next);
                                        }
                                    }}
                                    disabled={!canSetVolume}
                                    aria-label="Music volume"
                                />
                                <span className="sidebar__audio-volume">{Math.round(volumeValue * 100)}%</span>
                            </div>
                            <div className="sidebar__audio-track">
                                {currentMusicTrack ? (
                                    <>
                                        <strong>{currentMusicTrack.title}</strong>
                                        {currentMusicTrack.info && (
                                            <span className="text-muted"> · {currentMusicTrack.info}</span>
                                        )}
                                    </>
                                ) : (
                                    <span className="text-muted">No track selected</span>
                                )}
                            </div>
                        </div>
                        <div className="sidebar__footer">
                            {isDM && <InviteButton gameId={game.id} />}
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => {
                                    setActive(null);
                                    setDmSheetPlayerId(null);
                                }}
                            >
                                Back to games
                            </button>
                            <button
                                type="button"
                                className="btn danger"
                                onClick={handleLogout}
                                disabled={logoutBusy}
                            >
                                {logoutBusy ? "Logging out…" : "Log out"}
                            </button>
                        </div>
                    </aside>
                    <main className="app-main">
                        <header className="app-main__header">
                            <div className="header-leading">
                                <button
                                    type="button"
                                    className={`nav-trigger${sidebarVisible ? " is-active" : ""}`}
                                    onClick={toggleSidebar}
                                    aria-expanded={sidebarVisible}
                                    aria-controls="game-sidebar"
                                    title={sidebarVisible ? "Hide navigation" : "Show navigation"}
                                >
                                    <span className="nav-trigger__icon" aria-hidden>
                                        <span />
                                        <span />
                                        <span />
                                    </span>
                                    <span className="nav-trigger__label">
                                        {sidebarVisible ? "Hide menu" : "Show menu"}
                                    </span>
                                </button>
                                <div className="header-leading__body">
                                    <div className="header-leading__title-row">
                                        <HatLogo size={56} className="header-leading__logo" />
                                        <div className="header-leading__text">
                                            <span className="eyebrow">
                                                {isDM ? "Dungeon Master" : "Player"} View
                                            </span>
                                            <h1>{activeNav?.label || ""}</h1>
                                            {activeNav?.description && (
                                                <p className="text-muted">{activeNav.description}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="app-main__header-meta">
                                <div className="header-actions">
                                    <button
                                        type="button"
                                        className="btn ghost btn-small"
                                        onClick={handleRefresh}
                                        disabled={refreshBusy}
                                        title="Ctrl+Alt+R"
                                    >
                                        {refreshBusy ? "Refreshing…" : "Refresh data"}
                                    </button>
                                    <span className="text-muted text-small hotkey-hint">
                                        Ctrl+Alt+1–{navItems.length} to switch · Ctrl+Alt+R refresh
                                    </span>
                                </div>
                                <div className="header-pills">
                                    {headerPills.map((pill, idx) => (
                                        <span
                                            key={idx}
                                            className={`pill${pill.tone ? ` ${pill.tone}` : ""}`}
                                        >
                                            {pill.label}
                                        </span>
                                    ))}
                                </div>
                                {!isDM && (
                                    <div className="header-metrics">
                                        <div className="header-metric">
                                            <span className="text-muted text-small">Account</span>
                                            <strong>{me?.username?.trim() || "Player"}</strong>
                                        </div>
                                        <div className="header-metric">
                                            <span className="text-muted text-small">Macca</span>
                                            <strong>{playerMaccaInfo.label}</strong>
                                        </div>
                                        {myEntry && (
                                            <div className="header-metric">
                                                <span className="text-muted text-small">Character</span>
                                                <strong>
                                                    {myEntry.character?.name?.trim() ||
                                                        me?.username?.trim() ||
                                                        "Character"}
                                                </strong>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                </header>

                <div className="app-content">
                    {tab === "overview" && isDM && (
                        <DMOverview
                            game={game}
                            onInspectPlayer={(player) => {
                                if (!player?.userId) return;
                                const nextId = normalizeId(player.userId) ?? player.userId;
                                setDmSheetPlayerId(nextId ?? null);
                                setTab("sheet");
                            }}
                        />
                    )}

                    {tab === "sheet" && (
                        <Sheet
                            me={me}
                            game={game}
                            targetUserId={isDM ? dmSheetPlayerId : undefined}
                            onChangePlayer={
                                isDM
                                    ? (nextId) =>
                                          setDmSheetPlayerId(
                                              normalizeId(nextId) ?? nextId ?? null,
                                          )
                                    : undefined
                            }
                            onSave={async (ch) => {
                                await Games.saveCharacter(game.id, ch);
                                const full = await Games.get(game.id);
                                setActive(normalizeGameRecord(full));
                            }}
                        />
                    )}

                    {tab === "party" && (
                        <Party
                            mode={isDM ? "dm" : "player"}
                            game={game}
                            selectedPlayerId={isDM ? dmSheetPlayerId : null}
                            currentUserId={me.id}
                            onSelectPlayer={
                                isDM
                                    ? (player) => {
                                          if (!player?.userId) return;
                                          const nextId = normalizeId(player.userId) ?? player.userId;
                                          setDmSheetPlayerId(nextId ?? null);
                                          setTab("sheet");
                                      }
                                    : undefined
                            }
                        />
                    )}

                    {tab === "map" && <MapTab game={game} me={me} />}

                    {tab === "items" && (
                        <ItemsTab
                            game={game}
                            me={me}
                            onUpdate={async () => {
                                const full = await Games.get(game.id);
                                setActive(normalizeGameRecord(full));
                            }}
                            realtime={realtime}
                        />
                    )}

                    {tab === "gear" && (
                        <GearTab
                            game={game}
                            me={me}
                            onUpdate={async () => {
                                const full = await Games.get(game.id);
                                setActive(normalizeGameRecord(full));
                            }}
                        />
                    )}

                    {tab === "combatSkills" && (
                        <CombatSkillsTab
                            game={game}
                            me={me}
                            onUpdate={async () => {
                                const full = await Games.get(game.id);
                                setActive(normalizeGameRecord(full));
                            }}
                        />
                    )}

                    {tab === "worldSkills" && (
                        <WorldSkillsTab
                            game={game}
                            me={me}
                            onUpdate={async () => {
                                const full = await Games.get(game.id);
                                setActive(normalizeGameRecord(full));
                            }}
                        />
                    )}

                    {tab === "demons" && (
                        <DemonTab
                            game={game}
                            me={me}
                            onUpdate={async () => {
                                const full = await Games.get(game.id);
                                setActive(normalizeGameRecord(full));
                            }}
                        />
                    )}

                    {tab === "storyLogs" && <StoryLogsTab game={game} me={me} />}

                    {tab === "help" && <HelpTab />}

                    {tab === "serverManagement" && showServerManagement && (
                        <ServerManagementTab
                            activeGameId={game.id}
                            onGameDeleted={handleGameDeleted}
                            onRefreshGames={refreshCampaignList}
                            onRefreshActiveGame={refreshGameData}
                        />
                    )}

                    {tab === "settings" && isDM && (
                        <SettingsTab
                            game={game}
                            me={me}
                            onUpdate={async (per) => {
                                await Games.setPerms(game.id, per);
                                const full = await Games.get(game.id);
                                setActive(normalizeGameRecord(full));
                            }}
                            onGameRefresh={handleRefresh}
                            onKickPlayer={
                                isDM
                                    ? async (playerId) => {
                                          if (!playerId) return;
                                          try {
                                              if (idsMatch(dmSheetPlayerId, playerId)) {
                                                  setDmSheetPlayerId(null);
                                              }
                                              await Games.removePlayer(game.id, playerId);
                                              const full = await Games.get(game.id);
                                              setActive(normalizeGameRecord(full));
                                              setGames(normalizeGameList(await Games.list()));
                                          } catch (e) {
                                              alert(e.message);
                                          }
                                      }
                                    : undefined
                            }
                            onDelete={
                                isDM
                                    ? async () => {
                                          if (
                                              !confirm(
                                                  `Delete the game "${game.name}"? This cannot be undone.`
                                              )
                                          ) {
                                              return;
                                          }
                                          try {
                                              await Games.delete(game.id);
                                              setActive(null);
                                              setDmSheetPlayerId(null);
                                              setGames(normalizeGameList(await Games.list()));
                                              alert("Game deleted");
                                          } catch (e) {
                                              alert(e.message);
                                          }
                                      }
                                    : undefined
                            }
                        />
                    )}
                </div>
            </main>
                </div>
                <PersonaPromptCenter realtime={realtime} />
                <TradeOverlay game={game} me={me} realtime={realtime} />
            </div>
        </RealtimeContext.Provider>
    );
}

// ---------- DM Overview ----------
function DMOverview({ game, onInspectPlayer }) {
    const realtime = useContext(RealtimeContext);
    const musicControls = useContext(MusicContext);
    const [library, setLibrary] = useState({ builtin: [], uploads: [] });
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [selectedTrackId, setSelectedTrackId] = useState(() => realtime?.musicState?.trackId || "");
    const [pendingSeek, setPendingSeek] = useState(null);
    const [alertDraft, setAlertDraft] = useState("");
    const [musicFormError, setMusicFormError] = useState(null);
    const [alertFormError, setAlertFormError] = useState(null);
    const isRealtimeConnected = !!realtime?.connected;
    const currentTrackId = realtime?.musicState?.trackId || "";
    const currentMusic = realtime?.musicState || null;

    const loadLibrary = useCallback(async () => {
        setLibraryLoading(true);
        try {
            const response = await Games.music.library(game.id);
            if (response?.library) {
                setLibrary(response.library);
            } else {
                setLibrary({ builtin: [], uploads: [] });
            }
        } catch (err) {
            setMusicFormError((prev) => prev || err.message);
        } finally {
            setLibraryLoading(false);
        }
    }, [game.id]);

    useEffect(() => {
        loadLibrary();
    }, [loadLibrary]);

    useEffect(() => {
        if (!selectedTrackId) {
            const firstUpload = library.uploads?.[0];
            const firstBuiltin = library.builtin?.[0];
            const next = firstUpload?.id || firstBuiltin?.id || "";
            if (next) {
                setSelectedTrackId(next);
            }
        }
    }, [library, selectedTrackId]);
    const serverMusicError = realtime?.musicError || null;
    const friendlyMusicError = useMemo(() => {
        if (!serverMusicError) return null;
        switch (serverMusicError) {
            case "invalid_track":
                return "That track isn’t available.";
            case "invalid_request":
                return "Select a track before pressing play.";
            case "forbidden":
                return "Only the DM can control playback.";
            case "not_found":
                return "Campaign not found. Refresh and try again.";
            default:
                return serverMusicError;
        }
    }, [serverMusicError]);
    const displayMusicError = musicFormError || friendlyMusicError;
    const playRealtime = realtime?.playMusic;
    const pauseRealtime = realtime?.pauseMusic;
    const seekRealtime = realtime?.seekMusic;
    const stopRealtime = realtime?.stopMusic;
    const audioTime = typeof musicControls?.currentTime === "number" ? musicControls.currentTime : 0;
    const audioDuration = typeof musicControls?.duration === "number" ? musicControls.duration : 0;
    const seekControl = typeof musicControls?.seek === "function" ? musicControls.seek : null;
    const formatTime = (seconds) => {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    };
    const formatSize = (bytes) => {
        const value = Number(bytes);
        if (!Number.isFinite(value) || value <= 0) return null;
        if (value >= 1024 * 1024) {
            return `${(value / (1024 * 1024)).toFixed(1)} MB`;
        }
        return `${Math.max(1, Math.round(value / 1024))} KB`;
    };
    const sliderValue = pendingSeek != null ? pendingSeek : audioTime;
    const sliderMax = Math.max(
        audioDuration > 0 ? audioDuration : 0,
        currentMusic?.duration && currentMusic.duration > 0 ? currentMusic.duration : 0,
        pendingSeek != null ? pendingSeek : 0,
        sliderValue,
    );
    const musicStatus = currentMusic ? (currentMusic.playing ? "Playing" : "Paused") : "Stopped";
    useEffect(() => {
        if (currentTrackId) {
            setSelectedTrackId(currentTrackId);
        }
        setPendingSeek(null);
    }, [currentTrackId]);
    useEffect(() => {
        if (musicFormError) {
            setMusicFormError(null);
        }
    }, [selectedTrackId, musicFormError]);
    const serverAlertError = realtime?.alertError || null;
    const friendlyAlertError = useMemo(() => {
        if (!serverAlertError) return null;
        switch (serverAlertError) {
            case "invalid_message":
                return "Enter a message before sending.";
            case "forbidden":
                return "Only the DM can send alerts.";
            case "not_found":
                return "Campaign not found. Refresh and try again.";
            default:
                return serverAlertError;
        }
    }, [serverAlertError]);
    const displayAlertError = alertFormError || friendlyAlertError;
    const presenceMap = realtime?.onlineUsers || EMPTY_OBJECT;

    const players = useMemo(
        () =>
            (game.players || []).filter(
                (p) => (p?.role || "").toLowerCase() !== "dm"
            ),
        [game.players]
    );

    const averageLevel = useMemo(() => {
        if (players.length === 0) return null;
        const total = players.reduce((sum, player) => {
            const lvlRaw = Number(player.character?.resources?.level);
            const lvl = Number.isFinite(lvlRaw) ? lvlRaw : 0;
            return sum + lvl;
        }, 0);
        const avg = total / players.length;
        return Number.isFinite(avg) ? avg : null;
    }, [players]);

    const stabilizedCount = useMemo(
        () =>
            players.filter((player) => {
                const hpRaw = Number(player.character?.resources?.hp ?? 0);
                const hp = Number.isFinite(hpRaw) ? hpRaw : 0;
                return hp > 0;
            }).length,
        [players]
    );

    const demonCount = Array.isArray(game.demons) ? game.demons.length : 0;
    const sharedItemCount = Array.isArray(game.items?.shared)
        ? game.items.shared.length
        : 0;
    const customItemCount = Array.isArray(game.items?.custom)
        ? game.items.custom.length
        : 0;
    const customGearCount = Array.isArray(game.gear?.custom)
        ? game.gear.custom.length
        : 0;

    const metrics = [
        {
            label: "Adventurers",
            value: String(players.length),
            description: "Players currently in your campaign",
        },
        {
            label: "Average level",
            value:
                players.length > 0 && averageLevel !== null
                    ? averageLevel.toFixed(1)
                    : "—",
            description:
                players.length > 0
                    ? "Across all active character sheets"
                    : "Awaiting character data",
        },
        {
            label: "Ready for battle",
            value: `${stabilizedCount}/${players.length || 0}`,
            description: "Members above zero hit points",
        },
        {
            label: "Codex entries",
            value: String(demonCount),
            description: "Demons listed across all player inventories",
        },
        {
            label: "Shared loot",
            value: String(sharedItemCount),
            description: "Entries in the shared party inventory",
        },
        {
            label: "Custom items",
            value: String(customItemCount),
            description: "Homebrew loot available to the party",
        },
        {
            label: "Custom gear",
            value: String(customGearCount),
            description: "Homebrew equipment loadouts",
        },
    ];

    const resourceRows = [
        {
            label: "Map status",
            value: game.map?.paused ? "Paused" : "Live",
            hint: game.map?.paused ? "Players cannot see updates" : "Realtime updates enabled",
        },
        {
            label: "Drawing",
            value: game.map?.settings?.allowPlayerDrawing ? "Enabled" : "DM only",
            hint: "Players can draw on the battle map",
        },
        {
            label: "Token moves",
            value: game.map?.settings?.allowPlayerTokenMoves ? "Enabled" : "DM only",
            hint: "Players can move their own tokens",
        },
        {
            label: "Story log",
            value: game.story?.automation?.enabled ? "Active" : "Manual",
            hint: game.story?.automation?.enabled
                ? "Events automatically posted to Discord"
                : "Only manual log entries",
        },
        {
            label: "Alerts",
            value: realtime?.activeAlert ? "Active" : "Idle",
            hint: realtime?.activeAlert ? "Players see the alert banner" : "No active alerts",
        },
        {
            label: "Music",
            value: currentMusic ? currentMusic.title : "Stopped",
            hint: currentMusic
                ? currentMusic.playing
                    ? "Playing via DM companion"
                    : "Paused on DM companion"
                : "No track playing",
        },
    ];

    const canInspect = typeof onInspectPlayer === "function";

    const handlePlayTrack = useCallback(
        (event) => {
            event.preventDefault();
            setMusicFormError(null);
            if (!selectedTrackId) {
                setMusicFormError("Select a track before starting playback.");
                return;
            }
            try {
                if (typeof playRealtime === "function") {
                    const sameTrack = realtime?.musicState?.trackId === selectedTrackId;
                    const resumePosition = sameTrack ? audioTime : 0;
                    playRealtime(selectedTrackId, { position: resumePosition });
                }
            } catch (err) {
                setMusicFormError(err.message);
            }
        },
        [selectedTrackId, playRealtime, realtime?.musicState?.trackId, audioTime]
    );

    const handlePauseTrack = useCallback(
        (event) => {
            event.preventDefault();
            setMusicFormError(null);
            try {
                if (typeof pauseRealtime === "function") {
                    pauseRealtime(audioTime);
                }
            } catch (err) {
                setMusicFormError(err.message);
            }
        },
        [pauseRealtime, audioTime]
    );

    const handleStopTrack = useCallback(
        (event) => {
            event.preventDefault();
            setMusicFormError(null);
            try {
                if (typeof stopRealtime === "function") {
                    stopRealtime();
                }
            } catch (err) {
                setMusicFormError(err.message);
            }
        },
        [stopRealtime]
    );

    const handleSeekChange = useCallback(
        (event) => {
            const value = Number(event.target.value);
            if (!Number.isFinite(value) || value < 0) return;
            setPendingSeek(value);
            if (seekControl) {
                seekControl(value);
            }
        },
        [seekControl]
    );

    const handleSeekCommit = useCallback(() => {
        if (pendingSeek == null) return;
        try {
            setMusicFormError(null);
            if (typeof seekRealtime === "function") {
                seekRealtime(pendingSeek, { playing: !!realtime?.musicState?.playing });
            }
        } catch (err) {
            setMusicFormError(err.message);
        } finally {
            setPendingSeek(null);
        }
    }, [pendingSeek, seekRealtime, realtime?.musicState?.playing]);

    const handleSeekKeyUp = useCallback(
        (event) => {
            if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                handleSeekCommit();
            }
        },
        [handleSeekCommit]
    );

    const handleUploadTrack = useCallback(
        async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            try {
                setMusicFormError(null);
                const response = await Games.music.upload(game.id, file);
                if (response?.library) {
                    setLibrary(response.library);
                } else {
                    await loadLibrary();
                }
            } catch (err) {
                const message = err?.message;
                switch (message) {
                    case "upload_limit":
                        setMusicFormError("Campaign storage is full. Remove a track before uploading another.");
                        break;
                    case "unsupported_type":
                        setMusicFormError("Only MP3 uploads are supported.");
                        break;
                    case "file_too_large":
                        setMusicFormError("That file is too large to upload.");
                        break;
                    default:
                        setMusicFormError(message);
                }
            } finally {
                event.target.value = "";
            }
        },
        [game.id, loadLibrary]
    );

    const handleDeleteUpload = useCallback(
        async (trackId) => {
            if (!trackId) return;
            try {
                const response = await Games.music.deleteUpload(game.id, trackId);
                if (response?.library) {
                    setLibrary(response.library);
                } else {
                    await loadLibrary();
                }
            } catch (err) {
                setMusicFormError(err.message);
            }
        },
        [game.id, loadLibrary]
    );

    const handleSendAlert = useCallback(
        async (event) => {
            event.preventDefault();
            const message = alertDraft.trim();
            if (!message) {
                setAlertFormError("Enter a message before sending.");
                return;
            }
            try {
                await Games.sendAlert(game.id, message);
                setAlertDraft("");
            } catch (err) {
                setAlertFormError(err.message);
            }
        },
        [alertDraft, game.id]
    );

    const handleClearAlert = useCallback(
        async (event) => {
            event.preventDefault();
            try {
                await Games.clearAlert(game.id);
                setAlertDraft("");
            } catch (err) {
                setAlertFormError(err.message);
            }
        },
        [game.id]
    );

    return (
        <div className="overview-grid">
            <section className="card">
                <div className="header">
                    <div>
                        <h3>Music &amp; alerts</h3>
                        <p className="text-muted text-small">
                            Control background ambience for the virtual table.
                        </p>
                    </div>
                    {isRealtimeConnected ? (
                        <span className="pill success">Connected</span>
                    ) : (
                        <span className="pill warn">Companion offline</span>
                    )}
                </div>
                <form className="stack" onSubmit={handlePlayTrack}>
                    <label className="field">
                        <span className="field__label">Background music</span>
                        <select
                            value={selectedTrackId}
                            onChange={(event) => setSelectedTrackId(event.target.value)}
                            disabled={libraryLoading && library.uploads.length === 0 && library.builtin.length === 0}
                        >
                            <option value="">Select a track</option>
                            {library.uploads.length > 0 && (
                                <optgroup label="Campaign uploads">
                                    {library.uploads.map((track) => (
                                        <option key={track.id} value={track.id}>
                                            {track.title}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                            {library.builtin.length > 0 && (
                                <optgroup label="Built-in tracks">
                                    {library.builtin.map((track) => (
                                        <option key={track.id} value={track.id}>
                                            {track.title}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    </label>
                    {displayMusicError && <div className="text-error text-small">{displayMusicError}</div>}
                    <div className="music-controls-row">
                        <button type="submit" className="btn btn-small" disabled={!selectedTrackId || libraryLoading}>
                            {currentMusic?.playing ? "Restart" : "Play"}
                        </button>
                        <button
                            type="button"
                            className="btn ghost btn-small"
                            onClick={handlePauseTrack}
                            disabled={!currentMusic?.trackId || !currentMusic?.playing}
                        >
                            Pause
                        </button>
                        <button
                            type="button"
                            className="btn ghost btn-small"
                            onClick={handleStopTrack}
                            disabled={!currentMusic?.trackId}
                        >
                            Stop
                        </button>
                    </div>
                    {currentMusic ? (
                        <div className="music-status-panel">
                            <div className="music-status-heading">
                                <strong>{currentMusic.title}</strong>
                                {currentMusic.info && <span className="text-muted"> · {currentMusic.info}</span>}
                            </div>
                            <div className="music-status text-muted text-small">Status: {musicStatus}</div>
                            <div className="music-seek">
                                <input
                                    type="range"
                                    min="0"
                                    max={sliderMax > 0 ? sliderMax : sliderValue > 0 ? sliderValue : 1}
                                    step="0.1"
                                    value={sliderValue}
                                    onChange={handleSeekChange}
                                    onMouseUp={handleSeekCommit}
                                    onTouchEnd={handleSeekCommit}
                                    onBlur={handleSeekCommit}
                                    onKeyUp={handleSeekKeyUp}
                                />
                                <div className="music-seek__labels">
                                    <span>{formatTime(sliderValue)}</span>
                                    <span>{formatTime(sliderMax)}</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p className="text-muted text-small">No track selected.</p>
                    )}
                </form>
                <div className="music-upload-section">
                    <label className="field field--file">
                        <span className="field__label">Upload MP3</span>
                        <input type="file" accept="audio/mpeg" onChange={handleUploadTrack} disabled={libraryLoading} />
                    </label>
                    {library.uploads.length === 0 ? (
                        <p className="text-muted text-small">Add custom ambience for this campaign.</p>
                    ) : (
                        <ul className="music-upload-list">
                            {library.uploads.map((track) => {
                                const sizeLabel = formatSize(track.size);
                                const uploadedOn = track.createdAt ? new Date(track.createdAt).toLocaleDateString() : null;
                                const metaParts = [];
                                if (uploadedOn) metaParts.push(`Uploaded ${uploadedOn}`);
                                if (sizeLabel) metaParts.push(sizeLabel);
                                return (
                                    <li key={track.id} className="music-upload-list__item">
                                        <div className="music-upload-list__meta">
                                            <strong>{track.title}</strong>
                                            {metaParts.length > 0 && (
                                                <span className="text-muted text-small"> · {metaParts.join(" · ")}</span>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            className="btn ghost btn-small"
                                            onClick={() => handleDeleteUpload(track.id)}
                                            disabled={libraryLoading}
                                        >
                                            Remove
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
                <form className="stack" onSubmit={handleSendAlert}>
                    <label className="field">
                        <span className="field__label">Send alert</span>
                        <textarea
                            rows={2}
                            value={alertDraft}
                            onChange={(event) => setAlertDraft(event.target.value)}
                            placeholder="Announce initiative or call for a break"
                        />
                    </label>
                    {displayAlertError && <div className="text-error text-small">{displayAlertError}</div>}
                    <div className="overview-actions">
                        <button type="submit" className="btn btn-small">
                            Send alert
                        </button>
                        <button type="button" className="btn ghost btn-small" onClick={handleClearAlert}>
                            Clear
                        </button>
                    </div>
                </form>
            </section>

            <section className="card">
                <div className="header">
                    <div>
                        <h3>Campaign stats</h3>
                        <p className="text-muted text-small">
                            Snapshot of your world at a glance.
                        </p>
                    </div>
                </div>
                <div className="metric-grid">
                    {metrics.map((metric) => (
                        <div key={metric.label} className="metric">
                            <span className="metric__label">{metric.label}</span>
                            <strong className="metric__value">{metric.value}</strong>
                            <span className="metric__description text-small text-muted">
                                {metric.description}
                            </span>
                        </div>
                    ))}
                </div>
            </section>

            <section className="card">
                <div className="header">
                    <div>
                        <h3>Party status</h3>
                        <p className="text-muted text-small">
                            {canInspect
                                ? "Select a player to jump directly to their sheet."
                                : "Player information at a glance."}
                        </p>
                    </div>
                </div>
                <div className="list overview-roster">
                    {players.length === 0 ? (
                        <div className="text-muted">No players have joined yet.</div>
                    ) : (
                        players.map((player, index) => {
                            const key = player.userId || `player-${index}`;
                            const name =
                                player.character?.name?.trim() ||
                                player.username ||
                                `Player ${index + 1}`;
                            const subtitleParts = [];
                            if (player.character?.profile?.class) {
                                subtitleParts.push(player.character.profile.class);
                            }
                            const lvlRaw = Number(player.character?.resources?.level);
                            const level = Number.isFinite(lvlRaw) ? lvlRaw : null;
                            if (level !== null) subtitleParts.push(`LV ${level}`);
                            const subtitle = subtitleParts.join(" · ");

                            const hpRaw = Number(player.character?.resources?.hp ?? 0);
                            const hp = Number.isFinite(hpRaw) ? hpRaw : 0;
                            const maxRaw = Number(player.character?.resources?.maxHP ?? 0);
                            const maxHP = Number.isFinite(maxRaw) ? maxRaw : 0;
                            const hpLabel = maxHP > 0 ? `${hp}/${maxHP}` : String(hp);
                            const ratio = maxHP > 0 ? hp / maxHP : hp > 0 ? 1 : 0;
                            let tone = "success";
                            if (hp <= 0) tone = "danger";
                            else if (ratio < 0.35) tone = "warn";

                            const inventoryCount = Array.isArray(player.inventory)
                                ? player.inventory.length
                                : 0;
                            const isOnline = !!(
                                (player.userId && presenceMap[player.userId]) ?? player.online
                            );

                            return (
                                <div
                                    key={key}
                                    className={`overview-player${canInspect ? " is-clickable" : ""}`}
                                    role={canInspect ? "button" : undefined}
                                    tabIndex={canInspect ? 0 : undefined}
                                    onClick={() => {
                                        if (!canInspect) return;
                                        onInspectPlayer(player);
                                    }}
                                    onKeyDown={(evt) => {
                                        if (!canInspect) return;
                                        if (evt.key === "Enter" || evt.key === " ") {
                                            evt.preventDefault();
                                            onInspectPlayer(player);
                                        }
                                    }}
                                >
                                    <div className="overview-player__info">
                                        <span className="overview-player__name">{name}</span>
                                        {subtitle && (
                                            <span className="text-muted text-small">
                                                {subtitle}
                                            </span>
                                        )}
                                    </div>
                                    <div className="overview-player__meta">
                                        <span
                                            className={`presence-indicator ${
                                                isOnline ? "is-online" : "is-offline"
                                            }`}
                                        >
                                            {isOnline ? "Online" : "Offline"}
                                        </span>
                                        <span className={`pill ${tone}`}>HP {hpLabel}</span>
                                        <span className="pill">Items {inventoryCount}</span>
                                        {canInspect && (
                                            <button
                                                type="button"
                                                className="btn ghost btn-small"
                                                onClick={(evt) => {
                                                    evt.stopPropagation();
                                                    onInspectPlayer(player);
                                                }}
                                            >
                                                Open sheet
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </section>

            <section className="card overview-resources">
                <div className="header">
                    <div>
                        <h3>Campaign resources</h3>
                        <p className="text-muted text-small">
                            A quick look at shared pools across the table.
                        </p>
                    </div>
                </div>
                <div className="resource-grid">
                    {resourceRows.map((row) => (
                        <div key={row.label} className="resource-chip">
                            <span className="text-muted text-small">{row.label}</span>
                            <strong>{row.value}</strong>
                            <span className="text-muted text-small">{row.hint}</span>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

function JoinByCode({ onJoined }) {
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    return (
        <div className="row">
            <input
                placeholder="CODE"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
                className="btn"
                disabled={!code.trim() || busy}
                onClick={async () => {
                    try {
                        setBusy(true);
                        await Games.joinByCode(code.trim());
                        onJoined();
                    } catch (e) {
                        alert(e.message);
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                {busy ? "…" : "Join"}
            </button>
        </div>
    );
}


function SharedMediaDisplay({ isDM }) {
    const realtime = useContext(RealtimeContext);
    const musicControls = useContext(MusicContext);
    const trackId = realtime?.musicState?.trackId || null;
    const track = trackId ? getTrackById(trackId) : null;
    const playbackBlocked = !!musicControls?.playbackBlocked;
    const resume = musicControls?.resume;
    const canResume = typeof resume === "function";
    const muted = !!musicControls?.muted;

    if (!track && !playbackBlocked) return null;

    const description = isDM ? "Shared with the party" : "Broadcast from your DM";

    return (
        <div className="shared-media">
            <div className="shared-media__header">
                <strong>Session music</strong>
                {playbackBlocked && (
                    <button
                        type="button"
                        className="btn ghost btn-small"
                        onClick={() => {
                            if (canResume) {
                                resume();
                            }
                        }}
                        disabled={!canResume}
                    >
                        Resume audio
                    </button>
                )}
            </div>
            <div className="shared-media__body shared-media__body--compact">
                {track ? (
                    <p className="shared-media__track">
                        Now playing: <strong>{track.title}</strong>
                        {track.info && <span className="text-muted"> · {track.info}</span>}
                    </p>
                ) : (
                    <p>No track is currently selected.</p>
                )}
                <p className="text-muted text-small">
                    Use the sidebar controls to adjust volume{muted ? " (muted)" : ""}.
                </p>
                <span className="text-muted text-small">{description}</span>
            </div>
        </div>
    );
}

function AlertOverlay() {
    const realtime = useContext(RealtimeContext);
    const alerts = realtime?.alerts || EMPTY_ARRAY;
    const dismiss = realtime?.dismissAlert;

    const timeFormatter = useMemo(
        () => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }),
        []
    );

    if (!alerts || alerts.length === 0) return null;

    return (
        <div className="alert-overlay">
            {alerts.map((alert) => {
                let timeLabel = '';
                if (alert?.issuedAt) {
                    const date = new Date(alert.issuedAt);
                    if (!Number.isNaN(date.getTime())) {
                        timeLabel = timeFormatter.format(date);
                    }
                }
                return (
                    <div key={alert.id} className="alert-toast">
                        <div className="alert-toast__header">
                            <strong>DM Alert</strong>
                            <button
                                type="button"
                                className="btn ghost btn-small"
                                onClick={() => dismiss?.(alert.id)}
                            >
                                Dismiss
                            </button>
                        </div>
                        <p>{alert.message}</p>
                        <span className="text-muted text-small">
                            {alert.senderName}
                            {timeLabel ? ` · ${timeLabel}` : ''}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

const MAX_PORTRAIT_BYTES = 2 * 1024 * 1024;

// ---------- Sheet ----------
function Sheet({ me, game, onSave, targetUserId, onChangePlayer }) {
    const isDM = idsMatch(game.dmId, me.id);
    const worldSkills = useMemo(() => normalizeWorldSkillDefs(game.worldSkills), [game.worldSkills]);
    const selectablePlayers = useMemo(
        () => (game.players || []).filter((p) => (p?.role || "").toLowerCase() !== "dm"),
        [game.players]
    );
    const selectedPlayerId = isDM
        ? normalizeId(targetUserId) ?? targetUserId ?? null
        : normalizeId(me.id) ?? me.id ?? null;
    const slot = useMemo(
        () =>
            (
                selectedPlayerId
                    ? (game.players || []).find((p) => idsMatch(p.userId, selectedPlayerId))
                    : null
            ) || {},
        [game.players, selectedPlayerId]
    );
    const slotCharacter = slot?.character;
    const [ch, setCh] = useState(() => normalizeCharacter(slotCharacter, worldSkills));
    const portraitInputRef = useRef(null);
    const [portraitError, setPortraitError] = useState("");
    const [imageGenerating, setImageGenerating] = useState(false);
    const [imageError, setImageError] = useState("");
    const [imagePromptPreview, setImagePromptPreview] = useState("");
    const [imageOptions, setImageOptions] = useState(EMPTY_ARRAY);
    const [backgroundUpdating, setBackgroundUpdating] = useState(false);
    const [backgroundError, setBackgroundError] = useState("");
    const [backgroundSuggestion, setBackgroundSuggestion] = useState(null);
    const [saving, setSaving] = useState(false);
    const [showWizard, setShowWizard] = useState(false);
    const [playerSortMode, setPlayerSortMode] = useState("name");
    const playerCollator = useMemo(
        () => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }),
        [],
    );
    const gearCollator = useMemo(
        () => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }),
        [],
    );

    useEffect(() => {
        setCh(normalizeCharacter(slotCharacter, worldSkills));
    }, [game.id, selectedPlayerId, slotCharacter, worldSkills]);

    useEffect(() => {
        setPortraitError("");
        if (portraitInputRef.current) {
            portraitInputRef.current.value = "";
        }
    }, [slotCharacter, setPortraitError]);

    useEffect(() => {
        setImageError("");
        setImagePromptPreview("");
        setImageOptions(EMPTY_ARRAY);
        setBackgroundError("");
        setBackgroundSuggestion(null);
    }, [slotCharacter]);

    const set = useCallback((path, value) => {
        setCh((prev) => {
            const next = deepClone(prev || {});
            let ref = next;
            const seg = path.split(".");
            for (let i = 0; i < seg.length - 1; i++) {
                const key = seg[i];
                if (ref[key] == null || typeof ref[key] !== "object") {
                    ref[key] = {};
                }
                ref = ref[key];
            }
            ref[seg.at(-1)] = value;
            return normalizeCharacter(next, worldSkills);
        });
    }, [worldSkills]);

    const getPlayerLabel = useCallback((player) => {
        if (!player) return "Unnamed player";
        const charName = typeof player.character?.name === "string" ? player.character.name.trim() : "";
        if (charName) return charName;
        const username = typeof player.username === "string" ? player.username.trim() : "";
        if (username) return username;
        return "Unnamed player";
    }, []);

    const getPlayerLevel = useCallback((player) => {
        const raw = player?.character?.resources?.level;
        const num = Number(raw);
        return Number.isFinite(num) ? num : 0;
    }, []);

    const sortedPlayers = useMemo(() => {
        if (!Array.isArray(selectablePlayers) || selectablePlayers.length === 0) {
            return selectablePlayers;
        }
        const arr = [...selectablePlayers];
        arr.sort((a, b) => {
            if (playerSortMode === "player") {
                const aName = typeof a?.username === "string" ? a.username.trim() : "";
                const bName = typeof b?.username === "string" ? b.username.trim() : "";
                const cmp = playerCollator.compare(aName, bName);
                if (cmp !== 0) return cmp;
            } else if (playerSortMode === "levelHigh" || playerSortMode === "levelLow") {
                const aLevel = getPlayerLevel(a);
                const bLevel = getPlayerLevel(b);
                if (aLevel !== bLevel) {
                    return playerSortMode === "levelHigh" ? bLevel - aLevel : aLevel - bLevel;
                }
            }
            const cmpLabel = playerCollator.compare(getPlayerLabel(a), getPlayerLabel(b));
            if (cmpLabel !== 0) return cmpLabel;
            const aName = typeof a?.username === "string" ? a.username.trim() : "";
            const bName = typeof b?.username === "string" ? b.username.trim() : "";
            const cmpUser = playerCollator.compare(aName, bName);
            if (cmpUser !== 0) return cmpUser;
            return playerCollator.compare(String(a?.userId ?? ""), String(b?.userId ?? ""));
        });
        return arr;
    }, [getPlayerLabel, getPlayerLevel, playerCollator, playerSortMode, selectablePlayers]);

    const hasSelection = !isDM || (!!selectedPlayerId && slot && slot.userId);
    const noPlayers = isDM && selectablePlayers.length === 0;
    const canEditSheet = (isDM && hasSelection) || (!isDM && !!game.permissions?.canEditStats);
    const disableInputs = !canEditSheet;
    const aiCharacterPayload = useMemo(() => buildCharacterAiPayload(ch, slot?.gear), [ch, slot?.gear]);
    const backgroundText = get(ch, "profile.background") ?? "";
    const notesText = get(ch, "profile.notes") ?? "";
    const disableSave = saving || !canEditSheet;

    const equippedGearList = useMemo(() => {
        const entries = [];
        const gear = slot?.gear && typeof slot.gear === "object" ? slot.gear : null;
        if (gear) {
            const bagArray = Array.isArray(gear.bag) ? gear.bag : [];
            const bagMap = new Map();
            for (const item of bagArray) {
                if (!item || typeof item !== "object") continue;
                const id = typeof item.id === "string" ? item.id : null;
                if (id && !bagMap.has(id)) {
                    bagMap.set(id, item);
                }
            }
            const slots = gear.slots && typeof gear.slots === "object" ? gear.slots : {};
            let index = 0;
            for (const [slotKey, slotValue] of Object.entries(slots)) {
                index += 1;
                const normalized = resolveGearSlotItem(slotValue, bagMap);
                if (!normalized) continue;
                entries.push({
                    key: `slot:${slotKey}`,
                    label: formatGearSlotLabel(slotKey, index),
                    name: normalized.name,
                    detail: normalized.detail,
                });
            }
        }

        if (entries.length === 0) {
            const legacy = ch?.gear && typeof ch.gear === "object" ? ch.gear : null;
            if (legacy && legacy.equipped && typeof legacy.equipped === "object") {
                let index = 0;
                for (const [slotKey, item] of Object.entries(legacy.equipped)) {
                    index += 1;
                    const normalized = normalizeGearDisplayItem(item);
                    if (!normalized) continue;
                    entries.push({
                        key: `legacy:${slotKey}`,
                        label: formatGearSlotLabel(slotKey, index),
                        name: normalized.name,
                        detail: normalized.detail,
                    });
                }
            }
        }

        entries.sort((a, b) => gearCollator.compare(a.label, b.label));
        return entries;
    }, [ch?.gear, gearCollator, slot?.gear]);

    const [collapsedSections, setCollapsedSections] = useState(() => ({
        profile: false,
        resources: false,
        abilities: false,
    }));
    const toggleSection = useCallback((key) => {
        setCollapsedSections((prev) => ({
            ...prev,
            [key]: !prev?.[key],
        }));
    }, []);
    const profileSectionId = useId();
    const resourcesSectionId = useId();
    const abilitySectionId = useId();

    const abilityInfo = useMemo(() => {
        const stats = ch?.stats || {};
        return ABILITY_DEFS.map((entry) => {
            const raw = stats?.[entry.key];
            const modifier = abilityModifier(raw);
            const num = Number(raw);
            const score = raw === undefined || raw === null || raw === ""
                ? ""
                : Number.isFinite(num)
                ? num
                : raw;
            return {
                ...entry,
                score,
                modifier,
            };
        });
    }, [ch?.stats]);

    const abilityMap = useMemo(() => {
        const map = {};
        for (const ability of abilityInfo) map[ability.key] = ability;
        return map;
    }, [abilityInfo]);

    const getMod = useCallback(
        (abilityKey) => abilityMap[abilityKey]?.modifier ?? 0,
        [abilityMap]
    );

    const level = clampNonNegative(get(ch, "resources.level")) || 1;
    const hp = clampNonNegative(get(ch, "resources.hp"));
    const maxHP = clampNonNegative(get(ch, "resources.maxHP"));
    const mp = clampNonNegative(get(ch, "resources.mp"));
    const maxMP = clampNonNegative(get(ch, "resources.maxMP"));
    const tp = clampNonNegative(get(ch, "resources.tp"));
    const maxTP = clampNonNegative(get(ch, "resources.maxTP"));
    const spRaw = get(ch, "resources.sp");
    const spValue = clampNonNegative(spRaw);
    const resourceMode = get(ch, "resources.useTP") ? "TP" : "MP";

    const suggestedHP = Math.max(1, Math.ceil(17 + getMod("CON") + getMod("STR") / 2));
    const suggestedMP = Math.max(0, Math.ceil(17 + getMod("INT") + getMod("WIS") / 2));
    const suggestedTP = Math.max(0, Math.ceil(7 + getMod("DEX") + getMod("CON") / 2));
    const suggestedSP = Math.max(0, Math.ceil((5 + getMod("INT")) * 2 + getMod("CHA")));

    const maxSkillRank = Math.max(4, level * 2 + 2);

    const resourceSuggestions = useMemo(() => {
        const rows = [
            {
                key: "hp",
                label: "Suggested HP",
                value: suggestedHP,
                detail: "17 + CON + (STR ÷ 2)",
                actual: hp,
            },
            {
                key: resourceMode === "TP" ? "tp" : "mp",
                label: resourceMode === "TP" ? "Suggested TP" : "Suggested MP",
                value: resourceMode === "TP" ? suggestedTP : suggestedMP,
                detail: resourceMode === "TP" ? "7 + DEX + (CON ÷ 2)" : "17 + INT + (WIS ÷ 2)",
                actual: resourceMode === "TP" ? tp : mp,
            },
            {
                key: "sp",
                label: "Suggested SP",
                value: suggestedSP,
                detail: "((5 + INT) × 2) + CHA",
                actual: spValue,
            },
            {
                key: "rank",
                label: "Max skill rank",
                value: maxSkillRank,
                detail: "(Level × 2) + 2",
            },
        ];
        return rows;
    }, [
        hp,
        maxSkillRank,
        mp,
        resourceMode,
        spValue,
        suggestedHP,
        suggestedMP,
        suggestedSP,
        suggestedTP,
        tp,
    ]);

    const spentSP = useMemo(() => {
        const skills = ch?.skills || {};
        const base = worldSkills.reduce((sum, skill) => {
            const ranks = clampNonNegative(get(skills, `${skill.key}.ranks`));
            return sum + ranks;
        }, 0);
        const extras = Array.isArray(ch?.customSkills)
            ? ch.customSkills.reduce((sum, entry) => sum + clampNonNegative(entry?.ranks), 0)
            : 0;
        return base + extras;
    }, [ch?.customSkills, ch?.skills, worldSkills]);
    const availableSP =
        spRaw === undefined || spRaw === null || spRaw === ""
            ? suggestedSP
            : spValue;
    const saveRows = useMemo(() => {
        const saves = ch?.resources?.saves || {};
        return SAVE_DEFS.map((save) => {
            const total = clampNonNegative(get(saves, `${save.key}.total`));
            const abilityMod = getMod(save.ability);
            const fallback = abilityMod;
            return {
                ...save,
                abilityMod,
                total: total || total === 0 ? total : fallback,
            };
        });
    }, [ch?.resources?.saves, getMod]);

    const characterName = ch?.name?.trim() || "Unnamed Adventurer";
    const classLabel = ch?.profile?.class?.trim() || "";
    const arcanaLabel = ch?.profile?.arcana?.trim() || "";
    const alignmentLabel = ch?.profile?.alignment?.trim() || "";
    const handlerName = ch?.profile?.player?.trim() || slot?.username || me.username;
    const portraitSrc = typeof ch?.profile?.portrait === "string" ? ch.profile.portrait : "";
    const hasPortrait = portraitSrc.trim() !== "";
    const portraitAlt = characterName ? `${characterName} portrait` : "Character portrait";

    const initiativeValueRaw = get(ch, "resources.initiative");
    const initiativeValue = Number.isFinite(Number(initiativeValueRaw))
        ? Number(initiativeValueRaw)
        : 0;
    const resourceLabel = resourceMode === "TP" ? "TP" : "MP";
    const resourceCurrent = resourceMode === "TP" ? tp : mp;
    const resourceMax = resourceMode === "TP" ? null : maxMP;
    const nextLevelExp = Math.max(1, Number(level) || 1) * 1000;

    const displayValue = (value) => {
        if (value === undefined || value === null || value === "") return "—";
        if (typeof value === "number") {
            return Number.isFinite(value) ? value : "—";
        }
        const num = Number(value);
        return Number.isFinite(num) ? num : value;
    };

    const headlineParts = [classLabel, arcanaLabel, alignmentLabel].filter(Boolean);
    const portraitButtonLabel = hasPortrait ? "Replace portrait" : "Upload portrait";

    const handleGeneratePortrait = useCallback(async () => {
        if (disableInputs) return;
        setImageError("");
        setImageGenerating(true);
        setImageOptions(EMPTY_ARRAY);
        try {
            const normalizedPortrait = typeof portraitSrc === "string" ? portraitSrc.trim() : "";
            const overrides = {};
            if (normalizedPortrait) {
                overrides.referenceImage = normalizedPortrait;
            } else {
                overrides.count = 4;
            }
            const result = await LocalAI.generatePortrait({ character: aiCharacterPayload, overrides });

            const promptText = typeof result?.prompt === "string" ? result.prompt.trim() : "";
            setImagePromptPreview(promptText);

            const extractImage = (entry) => {
                if (!entry) return "";
                if (typeof entry === "string") {
                    return entry.trim();
                }
                if (typeof entry === "object") {
                    if (typeof entry.image === "string") return entry.image.trim();
                    if (typeof entry.url === "string") return entry.url.trim();
                    if (typeof entry.base64 === "string") return entry.base64.trim();
                }
                return "";
            };

            const rawImages = [];
            if (Array.isArray(result?.images)) {
                rawImages.push(...result.images);
            }
            if (result?.image) {
                rawImages.unshift(result.image);
            }

            const seenImages = new Set();
            const options = [];
            for (const entry of rawImages) {
                const value = extractImage(entry);
                if (!value || seenImages.has(value)) continue;
                options.push(value);
                seenImages.add(value);
                if (options.length >= 4) break;
            }

            if (!normalizedPortrait && options.length > 1) {
                setImageOptions(options);
                setPortraitError("");
            } else {
                const nextImage = options[0];
                if (nextImage) {
                    set("profile.portrait", nextImage);
                    setPortraitError("");
                    setImageOptions(EMPTY_ARRAY);
                } else {
                    throw new Error("Image generation did not return any portraits.");
                }
            }
        } catch (err) {
            console.error("Failed to generate portrait", err);
            const message = err instanceof ApiError ? err.message : err?.message || "Failed to generate portrait.";
            setImageError(message);
        } finally {
            setImageGenerating(false);
        }
    }, [aiCharacterPayload, disableInputs, portraitSrc, set, setPortraitError]);

    const handlePortraitUploadClick = useCallback(() => {
        if (disableInputs) return;
        portraitInputRef.current?.click();
    }, [disableInputs]);

    const handlePortraitRemove = useCallback(() => {
        if (disableInputs) return;
        set("profile.portrait", "");
        setPortraitError("");
        setImageOptions(EMPTY_ARRAY);
        if (portraitInputRef.current) {
            portraitInputRef.current.value = "";
        }
    }, [disableInputs, set, setPortraitError]);

    const handleApplyGeneratedPortrait = useCallback(
        (image) => {
            if (disableInputs) return;
            const value = typeof image === "string" ? image.trim() : "";
            if (!value) return;
            set("profile.portrait", value);
            setPortraitError("");
            setImageError("");
            setImageOptions(EMPTY_ARRAY);
        },
        [disableInputs, set, setPortraitError],
    );

    const handleDismissGeneratedOptions = useCallback(() => {
        setImageOptions(EMPTY_ARRAY);
    }, []);

    const handlePortraitUpload = useCallback(
        (event) => {
            if (disableInputs) return;
            const input = event.target;
            const file = input?.files?.[0];

            const resetInput = () => {
                if (input) input.value = "";
            };

            if (!file) {
                resetInput();
                return;
            }

            const type = typeof file.type === "string" ? file.type : "";
            if (type && !type.startsWith("image/")) {
                setPortraitError("Please choose an image file.");
                resetInput();
                return;
            }

            if (file.size > MAX_PORTRAIT_BYTES) {
                setPortraitError("Portrait images must be 2 MB or smaller.");
                resetInput();
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                const result = typeof reader.result === "string" ? reader.result : "";
                set("profile.portrait", result);
                setPortraitError("");
                resetInput();
            };
            reader.onerror = () => {
                setPortraitError("Failed to load image. Try a different file.");
                resetInput();
            };
            reader.readAsDataURL(file);
        },
        [disableInputs, set, setPortraitError]
    );

    const handleUpdateBackground = useCallback(async () => {
        if (disableInputs) return;
        setBackgroundError("");
        setBackgroundUpdating(true);
        try {
            const result = await LocalAI.enhanceBackground({
                character: aiCharacterPayload,
                background: backgroundText,
                notes: notesText,
            });
            const nextBackground =
                typeof result?.background === "string" && result.background.trim()
                    ? result.background.trim()
                    : backgroundText;
            const nextNotes =
                typeof result?.notes === "string" && result.notes.trim() ? result.notes.trim() : notesText;
            setBackgroundSuggestion({
                background: nextBackground,
                notes: nextNotes,
                draftBackground: nextBackground,
                draftNotes: nextNotes,
                summary: typeof result?.summary === "string" ? result.summary : "",
            });
        } catch (err) {
            console.error("Failed to enhance background", err);
            const message =
                err instanceof ApiError ? err.message : err?.message || "Failed to enhance background.";
            setBackgroundError(message);
        } finally {
            setBackgroundUpdating(false);
        }
    }, [aiCharacterPayload, backgroundText, disableInputs, notesText]);

    const handleSuggestionDraftChange = useCallback(
        (field) => (event) => {
            const value = event?.target?.value ?? "";
            setBackgroundSuggestion((prev) => {
                if (!prev) return prev;
                return { ...prev, [field]: value };
            });
        },
        [],
    );

    const handleApplySuggestion = useCallback(() => {
        if (!backgroundSuggestion) return;
        set("profile.background", backgroundSuggestion.draftBackground);
        set("profile.notes", backgroundSuggestion.draftNotes);
        setBackgroundSuggestion(null);
        setBackgroundError("");
    }, [backgroundSuggestion, set]);

    const handleDismissSuggestion = useCallback(() => {
        setBackgroundSuggestion(null);
    }, []);

    const handleWizardApply = useCallback(
        async (payload) => {
            const next = normalizeCharacter(payload || {}, worldSkills);
            setCh(next);
            setShowWizard(false);
            if (!onSave || !canEditSheet || !hasSelection) return;
            try {
                setSaving(true);
                const request =
                    isDM && selectedPlayerId && selectedPlayerId !== me.id
                        ? { userId: selectedPlayerId, character: next }
                        : next;
                await onSave(request);
            } catch (error) {
                console.error(error);
                alert(error?.message || "Failed to save character");
            } finally {
                setSaving(false);
            }
        },
        [canEditSheet, hasSelection, isDM, me.id, onSave, selectedPlayerId, setCh, setShowWizard, setSaving, worldSkills]
    );

    const textField = (label, path, props = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <input
                type={props.type || "text"}
                placeholder={props.placeholder || ""}
                value={get(ch, path) ?? ""}
                onChange={(e) => set(path, e.target.value)}
                disabled={disableInputs || props.disabled}
                autoComplete="off"
            />
        </label>
    );

    const selectField = (label, path, options, props = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <select
                value={get(ch, path) ?? ""}
                onChange={(e) => set(path, e.target.value)}
                disabled={disableInputs || props.disabled}
            >
                <option value="">—</option>
                {options.map((opt) => (
                    <option key={opt.key || opt.value || opt.label} value={opt.value ?? opt.key}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </label>
    );

    return (
        <div className="card sheet-card">
            <div className="sheet-header">
                <div>
                    <h3>Character sheet</h3>
                    <p className="text-muted text-small">
                        Keep your AntiMatter Zone adventurer organised with modern tools inspired by the old spreadsheets.
                    </p>
                </div>
                <div className="sheet-header__actions">
                    <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setShowWizard(true)}
                        disabled={!hasSelection || disableInputs}
                    >
                        Launch setup wizard
                    </button>
                </div>
            </div>

            {isDM && (
                <div className="sheet-toolbar">
                    <label className="field">
                        <span className="field__label">Player</span>
                        <select
                            value={selectedPlayerId ?? ""}
                            onChange={(e) => onChangePlayer?.(e.target.value || null)}
                            disabled={sortedPlayers.length === 0}
                        >
                            <option value="">Select a player…</option>
                            {sortedPlayers.map((p) => (
                                <option key={p.userId} value={p.userId}>
                                    {getPlayerLabel(p)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span className="field__label">Sort players by</span>
                        <select
                            value={playerSortMode}
                            onChange={(e) => setPlayerSortMode(e.target.value)}
                            disabled={sortedPlayers.length === 0}
                        >
                            <option value="name">Character name (A → Z)</option>
                            <option value="player">Player name (A → Z)</option>
                            <option value="levelHigh">Level (high → low)</option>
                            <option value="levelLow">Level (low → high)</option>
                        </select>
                    </label>
                </div>
            )}

            {noPlayers && (
                <p className="text-muted" style={{ marginTop: 0 }}>
                    Invite players to your campaign to view their character sheets.
                </p>
            )}

            {!hasSelection ? (
                !noPlayers && (
                    <p className="text-muted" style={{ marginTop: 0 }}>
                        Select a player to review and edit their sheet.
                    </p>
                )
            ) : (
                <>
                    <div className="sheet-spotlight">
                        <div className="sheet-spotlight__top">
                            <div className="sheet-spotlight__identity">
                                <h2>{characterName}</h2>
                                {headlineParts.length > 0 && (
                                    <p className="sheet-spotlight__meta">{headlineParts.join(" · ")}</p>
                                )}
                                <p className="text-muted text-small">Handler: {handlerName}</p>
                            </div>
                            <div className="sheet-portrait">
                                <div className="sheet-portrait__frame">
                                    {hasPortrait ? (
                                        <img src={portraitSrc} alt={portraitAlt} className="sheet-portrait__image" />
                                    ) : (
                                        <span className="sheet-portrait__placeholder">No portrait uploaded</span>
                                    )}
                                </div>
                                {canEditSheet && (
                                    <>
                                        <input
                                            ref={portraitInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={handlePortraitUpload}
                                            style={{ display: "none" }}
                                            disabled={disableInputs}
                                        />
                                        <div className="sheet-portrait__actions">
                                            <button
                                                type="button"
                                                className="btn btn-small"
                                                onClick={handleGeneratePortrait}
                                                disabled={disableInputs || imageGenerating}
                                            >
                                                {imageGenerating ? "Generating..." : "Generate image"}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn secondary btn-small"
                                                onClick={handlePortraitUploadClick}
                                                disabled={disableInputs}
                                            >
                                                {portraitButtonLabel}
                                            </button>
                                            {hasPortrait && (
                                                <button
                                                    type="button"
                                                    className="btn ghost btn-small"
                                                    onClick={handlePortraitRemove}
                                                    disabled={disableInputs}
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                        {(portraitError || imageError) && (
                                            <div className="sheet-portrait__messages">
                                                {portraitError && (
                                                    <p className="text-error sheet-portrait__error">{portraitError}</p>
                                                )}
                                                {imageError && (
                                                    <p className="text-error sheet-portrait__error">{imageError}</p>
                                                )}
                                            </div>
                                        )}
                                        {imageOptions.length > 0 && (
                                            <div className="sheet-portrait__options">
                                                <p className="sheet-portrait__options-text">
                                                    Choose a portrait to apply to this character.
                                                </p>
                                                <div className="sheet-portrait__options-grid">
                                                    {imageOptions.map((option, index) => (
                                                        <button
                                                            key={`${index}-${option.slice(0, 32)}`}
                                                            type="button"
                                                            className="sheet-portrait__option"
                                                            onClick={() => handleApplyGeneratedPortrait(option)}
                                                            disabled={disableInputs || imageGenerating}
                                                        >
                                                            <img
                                                                src={option}
                                                                alt={`Generated portrait option ${index + 1}`}
                                                            />
                                                            <span className="sheet-portrait__option-label">
                                                                Select option {index + 1}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className="sheet-portrait__options-actions">
                                                    <button
                                                        type="button"
                                                        className="btn ghost btn-small"
                                                        onClick={handleDismissGeneratedOptions}
                                                        disabled={disableInputs || imageGenerating}
                                                    >
                                                        Dismiss options
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        {imagePromptPreview && (
                                            <details className="sheet-portrait__prompt">
                                                <summary>Prompt used</summary>
                                                <p>{imagePromptPreview}</p>
                                            </details>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="sheet-spotlight__stats">
                            <div className="sheet-spotlight__stat">
                                <span className="sheet-spotlight__stat-label">Level</span>
                                <span className="sheet-spotlight__stat-value">{displayValue(level)}</span>
                                <span className="sheet-spotlight__stat-detail">
                                    Next at {nextLevelExp.toLocaleString()} EXP
                                </span>
                            </div>
                            <div className="sheet-spotlight__stat">
                                <span className="sheet-spotlight__stat-label">HP</span>
                                <span className="sheet-spotlight__stat-value">
                                    {displayValue(hp)}
                                    <span className="sheet-spotlight__stat-extra">/ {displayValue(maxHP)}</span>
                                </span>
                                <span className="sheet-spotlight__stat-detail">Update in combat breaks</span>
                            </div>
                            <div className="sheet-spotlight__stat">
                                <span className="sheet-spotlight__stat-label">{resourceLabel}</span>
                                <span className="sheet-spotlight__stat-value">
                                    {displayValue(resourceCurrent)}
                                    {resourceMax !== null && (
                                        <span className="sheet-spotlight__stat-extra">/ {displayValue(resourceMax)}</span>
                                    )}
                                </span>
                                <span className="sheet-spotlight__stat-detail">
                                    {resourceLabel === "TP"
                                        ? "Regains through actions"
                                        : "Spend on spells & skills"}
                                </span>
                            </div>
                            <div className="sheet-spotlight__stat">
                                <span className="sheet-spotlight__stat-label">SP spent</span>
                                <span className="sheet-spotlight__stat-value">{displayValue(spentSP)}</span>
                                <span className="sheet-spotlight__stat-detail">Pool {displayValue(availableSP)}</span>
                            </div>
                            <div className="sheet-spotlight__stat">
                                <span className="sheet-spotlight__stat-label">Initiative</span>
                                <span className="sheet-spotlight__stat-value">{formatModifier(initiativeValue)}</span>
                                <span className="sheet-spotlight__stat-detail">
                                    Base bonus before gear or situational tweaks
                                </span>
                            </div>
                        </div>
                        <div className="sheet-spotlight__gear">
                            <div className="sheet-spotlight__gear-header">
                                <h4>Equipped gear</h4>
                            </div>
                            {equippedGearList.length > 0 ? (
                                <ul className="sheet-spotlight__gear-list">
                                    {equippedGearList.map((entry) => (
                                        <li key={entry.key} className="sheet-spotlight__gear-item">
                                            <span className="sheet-spotlight__gear-slot">{entry.label}:</span>
                                            <span className="sheet-spotlight__gear-name">{entry.name}</span>
                                            {entry.detail && (
                                                <span className="sheet-spotlight__gear-detail"> — {entry.detail}</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-muted text-small sheet-spotlight__gear-empty">
                                    No gear equipped.
                                </p>
                            )}
                        </div>
                        <div className="sheet-spotlight__notes text-muted text-small">
                            Use the panels below to record everything else—gear, saves, and background notes. Suggested
                            totals stay pinned on the right for quick reference.
                        </div>
                    </div>

                    <section
                        className={`sheet-section${collapsedSections.profile ? " is-collapsed" : ""}`}
                    >
                        <button
                            type="button"
                            className="section-header"
                            onClick={() => toggleSection("profile")}
                            aria-expanded={!collapsedSections.profile}
                            aria-controls={profileSectionId}
                        >
                            <div className="section-header__text">
                                <h4>Adventurer profile</h4>
                                <p className="text-muted text-small" style={{ margin: 0 }}>
                                    Capture the essentials, from alignment and arcana to class.
                                </p>
                            </div>
                            <span className="section-header__icon" aria-hidden="true">
                                {collapsedSections.profile ? "▸" : "▾"}
                            </span>
                        </button>
                        {!collapsedSections.profile && (
                            <div className="section-body" id={profileSectionId}>
                                <div className="sheet-grid">
                                    {textField("Character name", "name")}
                                    {textField("Player / handler", "profile.player", {
                                        placeholder: slot?.username || me.username,
                                    })}
                                    {textField("Concept / class", "profile.class")}
                                    {selectField(
                                        "Arcana",
                                        "profile.arcana",
                                        ARCANA_DATA.map((opt) => ({ ...opt, value: opt.label }))
                                    )}
                                    {selectField("Alignment", "profile.alignment", ALIGNMENT_OPTIONS)}
                                    {textField("Race / origin", "profile.race")}
                                    {textField("Nationality", "profile.nationality")}
                                    {textField("Age", "profile.age")}
                                    {textField("Gender", "profile.gender")}
                                    {textField("Height", "profile.height")}
                                    {textField("Weight", "profile.weight")}
                                    {textField("Eye colour", "profile.eye")}
                                    {textField("Hair", "profile.hair")}
                                    {textField("Skin tone", "profile.skinTone")}
                                </div>
                                <div className="sheet-grid sheet-grid--stretch">
                                    <div className="field field--with-action">
                                        <div className="field__header">
                                            <span className="field__label">Background & hooks</span>
                                            {canEditSheet && (
                                                <button
                                                    type="button"
                                                    className="btn secondary btn-small"
                                                    onClick={handleUpdateBackground}
                                                    disabled={disableInputs || backgroundUpdating}
                                                >
                                                    {backgroundUpdating
                                                        ? "Updating..."
                                                        : "Update background & notes"}
                                                </button>
                                            )}
                                        </div>
                                        <textarea
                                            rows={3}
                                            value={backgroundText}
                                            onChange={(e) => set("profile.background", e.target.value)}
                                            disabled={disableInputs}
                                        />
                                        {backgroundError && (
                                            <p className="text-error field__error">{backgroundError}</p>
                                        )}
                                    </div>
                                    <label className="field">
                                        <span className="field__label">Notes</span>
                                        <textarea
                                            rows={3}
                                            value={notesText}
                                            onChange={(e) => set("profile.notes", e.target.value)}
                                            disabled={disableInputs}
                                        />
                                    </label>
                                </div>
                                {backgroundSuggestion && (
                                    <div className="ai-suggestion" role="region" aria-live="polite">
                                        <div className="ai-suggestion__header">
                                            <h5>Suggested update</h5>
                                            <p className="text-muted text-small">
                                                Review the generated text, tweak anything you'd like, then apply it to your
                                                sheet.
                                            </p>
                                        </div>
                                        <label className="field">
                                            <span className="field__label">Suggested background</span>
                                            <textarea
                                                rows={4}
                                                value={backgroundSuggestion.draftBackground}
                                                onChange={handleSuggestionDraftChange("draftBackground")}
                                                disabled={backgroundUpdating}
                                            />
                                        </label>
                                        <label className="field">
                                            <span className="field__label">Suggested notes</span>
                                            <textarea
                                                rows={4}
                                                value={backgroundSuggestion.draftNotes}
                                                onChange={handleSuggestionDraftChange("draftNotes")}
                                                disabled={backgroundUpdating}
                                            />
                                        </label>
                                        <div className="ai-suggestion__actions">
                                            <button
                                                type="button"
                                                className="btn btn-small"
                                                onClick={handleApplySuggestion}
                                                disabled={backgroundUpdating}
                                            >
                                                Apply to sheet
                                            </button>
                                            <button
                                                type="button"
                                                className="btn ghost btn-small"
                                                onClick={handleDismissSuggestion}
                                                disabled={backgroundUpdating}
                                            >
                                                Dismiss
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>

                    <section
                        className={`sheet-section${collapsedSections.resources ? " is-collapsed" : ""}`}
                    >
                        <button
                            type="button"
                            className="section-header"
                            onClick={() => toggleSection("resources")}
                            aria-expanded={!collapsedSections.resources}
                            aria-controls={resourcesSectionId}
                        >
                            <div className="section-header__text">
                                <h4>Progress & resources</h4>
                                <p className="text-muted text-small" style={{ margin: 0 }}>
                                    Base formulas assume modifiers: adjust manually if your table uses variants.
                                </p>
                            </div>
                            <span className="section-header__icon" aria-hidden="true">
                                {collapsedSections.resources ? "▸" : "▾"}
                            </span>
                        </button>
                        {!collapsedSections.resources && (
                            <div className="section-body" id={resourcesSectionId}>
                                <div className="sheet-grid sheet-grid--resources">
                                    <MathField
                                        label="Level"
                                        value={get(ch, "resources.level")}
                                        onCommit={(val) => set("resources.level", clampNonNegative(val))}
                                        className="math-inline"
                                        disabled={disableInputs}
                                    />
                                    <MathField
                                        label="EXP"
                                        value={get(ch, "resources.exp")}
                                        onCommit={(val) => set("resources.exp", clampNonNegative(val))}
                                        className="math-inline"
                                        disabled={disableInputs}
                                    />
                                    <MathField
                                        label="HP"
                                        value={hp}
                                        onCommit={(val) => set("resources.hp", clampNonNegative(val))}
                                        className="math-inline"
                                        disabled={disableInputs}
                                    />
                                    <MathField
                                        label="Max HP"
                                        value={maxHP}
                                        onCommit={(val) => set("resources.maxHP", clampNonNegative(val))}
                                        className="math-inline"
                                        disabled={disableInputs}
                                    />
                                    <label className="field">
                                        <span className="field__label">Resource type</span>
                                        <select
                                            value={resourceMode}
                                            onChange={(e) => set("resources.useTP", e.target.value === "TP")}
                                            disabled={disableInputs}
                                        >
                                            <option value="MP">MP</option>
                                            <option value="TP">TP</option>
                                        </select>
                                    </label>
                                    {resourceMode === "TP" ? (
                                        <>
                                            <MathField
                                                label="TP"
                                                value={tp}
                                                onCommit={(val) => set("resources.tp", clampNonNegative(val))}
                                                className="math-inline"
                                                disabled={disableInputs}
                                            />
                                            <MathField
                                                label="Max TP"
                                                value={maxTP}
                                                onCommit={(val) => set("resources.maxTP", clampNonNegative(val))}
                                                className="math-inline"
                                                disabled={disableInputs}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <MathField
                                                label="MP"
                                                value={mp}
                                                onCommit={(val) => set("resources.mp", clampNonNegative(val))}
                                                className="math-inline"
                                                disabled={disableInputs}
                                            />
                                            <MathField
                                                label="Max MP"
                                                value={maxMP}
                                                onCommit={(val) => set("resources.maxMP", clampNonNegative(val))}
                                                className="math-inline"
                                                disabled={disableInputs}
                                            />
                                        </>
                                    )}
                                    <MathField
                                        label="SP (earned)"
                                        value={get(ch, "resources.sp")}
                                        onCommit={(val) => set("resources.sp", clampNonNegative(val))}
                                        className="math-inline"
                                        disabled={disableInputs}
                                    />
                                    <MathField
                                        label="Macca"
                                        value={get(ch, "resources.macca")}
                                        onCommit={(val) => set("resources.macca", clampNonNegative(val))}
                                        className="math-inline"
                                        disabled={disableInputs}
                                    />
                                    <MathField
                                        label="Initiative bonus"
                                        value={get(ch, "resources.initiative")}
                                        onCommit={(val) => set("resources.initiative", Number(val))}
                                        className="math-inline"
                                        disabled={disableInputs}
                                    />
                                </div>
                                <div className="sheet-hints">
                                    {resourceSuggestions.map((row) => {
                                        const mismatched =
                                            row.actual !== undefined && Number(row.actual) !== row.value;
                                        return (
                                            <div
                                                key={row.key}
                                                className={`sheet-hint${mismatched ? " warn" : ""}`}
                                            >
                                                <span className="sheet-hint__label">{row.label}</span>
                                                <span className="sheet-hint__value">{row.value}</span>
                                                <span className="sheet-hint__meta">{row.detail}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="save-grid">
                                    {saveRows.map((save) => (
                                        <div key={save.key} className="save-card">
                                            <div className="save-card__header">
                                                <span>{save.label}</span>
                                                <span className="pill light">
                                                    {save.ability} mod {formatModifier(save.abilityMod)}
                                                </span>
                                            </div>
                                            <MathField
                                                label="Total save"
                                                value={save.total}
                                                onCommit={(val) =>
                                                    set(`resources.saves.${save.key}.total`, Number(val))
                                                }
                                                className="math-inline"
                                                disabled={disableInputs}
                                            />
                                            <p className="text-muted text-small">
                                                Add class, gear, and situational bonuses here.
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>

                    <section
                        className={`sheet-section${collapsedSections.abilities ? " is-collapsed" : ""}`}
                    >
                        <button
                            type="button"
                            className="section-header"
                            onClick={() => toggleSection("abilities")}
                            aria-expanded={!collapsedSections.abilities}
                            aria-controls={abilitySectionId}
                        >
                            <div className="section-header__text">
                                <h4>Ability scores</h4>
                                <p className="text-muted text-small" style={{ margin: 0 }}>
                                    Every formula references these modifiers. Even numbers step the modifier.
                                </p>
                            </div>
                            <span className="section-header__icon" aria-hidden="true">
                                {collapsedSections.abilities ? "▸" : "▾"}
                            </span>
                        </button>
                        {!collapsedSections.abilities && (
                            <div className="section-body" id={abilitySectionId}>
                                <div className="ability-grid">
                                    {abilityInfo.map((ability) => (
                                        <div key={ability.key} className="ability-card">
                                            <div className="ability-card__heading">
                                                <span className="ability-card__abbr">{ability.key}</span>
                                                <span className="ability-card__title">{ability.label}</span>
                                            </div>
                                            <MathField
                                                label="Score"
                                                value={ability.score}
                                                onCommit={(val) => set(`stats.${ability.key}`, Number(val))}
                                                disabled={disableInputs}
                                            />
                                            <div className="ability-card__mod">
                                                <span>Modifier</span>
                                                <span className="ability-card__mod-value">
                                                    {formatModifier(ability.modifier)}
                                                </span>
                                            </div>
                                            <p className="ability-card__summary">{ability.summary}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>

                    <div className="sheet-footer">
                        {!canEditSheet && (
                            <span className="text-muted text-small">
                                You have read-only access. Ask your DM for edit permissions.
                            </span>
                        )}
                        <button
                            className="btn"
                            disabled={disableSave}
                            onClick={async () => {
                                if (!hasSelection) return;
                                try {
                                    setSaving(true);
                                    const payload =
                                        isDM && selectedPlayerId !== me.id
                                            ? { userId: selectedPlayerId, character: ch }
                                            : ch;
                                    await onSave(payload);
                                } catch (e) {
                                    alert(e.message);
                                } finally {
                                    setSaving(false);
                                }
                            }}
                        >
                            {saving ? "Saving…" : "Save changes"}
                        </button>
                    </div>
                </>
            )}

            {showWizard && (
                <PlayerSetupWizard
                    open={showWizard}
                    onClose={() => setShowWizard(false)}
                    onApply={handleWizardApply}
                    baseCharacter={ch}
                    playerName={slot?.username || me.username}
                    worldSkills={worldSkills}
                />
            )}
        </div>
    );
}

function PlayerSetupWizard({ open, onClose, onApply, baseCharacter, playerName, worldSkills }) {
    const steps = useMemo(
        () => [
            {
                key: "concept",
                title: "Concept & role",
                blurb: "Align on the basics before you roll any dice.",
            },
            {
                key: "abilities",
                title: "Roll ability points",
                blurb: "Generate six scores (6d20 by default) and place them where you like.",
            },
            {
                key: "arcana",
                title: "Choose an Arcana",
                blurb: "Arcana grant permanent bonuses and penalties on creation.",
            },
            {
                key: "resources",
                title: "Resources & world skills",
                blurb: "Calculate HP/MP/TP/SP and spend skill ranks immediately.",
            },
            {
                key: "review",
                title: "Review & apply",
                blurb: "Double-check your hero, then send everything to the sheet.",
            },
        ],
        []
    );

    const normalizedWorldSkills = useMemo(
        () => normalizeWorldSkillDefs(worldSkills),
        [worldSkills]
    );

    const initial = useMemo(
        () => buildInitialWizardState(baseCharacter, playerName, normalizedWorldSkills),
        [baseCharacter, normalizedWorldSkills, playerName]
    );

    const promptCount = CONCEPT_PROMPTS.length;
    const displayName = playerName?.trim() ? playerName.trim() : "adventurer";

    const [step, setStep] = useState(0);
    const [concept, setConcept] = useState(initial.concept);
    const [abilities, setAbilities] = useState(initial.abilities);
    const [resources, setResources] = useState(initial.resources);
    const [skills, setSkills] = useState(initial.skills);
    const [rolled, setRolled] = useState([]);
    const [applying, setApplying] = useState(false);
    const [conceptPromptIndex, setConceptPromptIndex] = useState(() =>
        promptCount ? Math.floor(Math.random() * promptCount) : 0
    );
    const [promptApplied, setPromptApplied] = useState(false);

    const conceptPrompt = CONCEPT_PROMPTS[conceptPromptIndex] || null;
    const conceptPromptSnippet = conceptPrompt
        ? [conceptPrompt.hook, conceptPrompt.question].filter(Boolean).join("\n")
        : "";
    const progress = Math.round(((step + 1) / steps.length) * 100);

    useEffect(() => {
        if (!open) return;
        setStep(0);
        setConcept(initial.concept);
        setAbilities(initial.abilities);
        setResources(initial.resources);
        setSkills(initial.skills);
        setRolled([]);
        setApplying(false);
        setPromptApplied(false);
        if (promptCount) {
            setConceptPromptIndex(Math.floor(Math.random() * promptCount));
        }
    }, [initial, open, promptCount]);

    useEffect(() => {
        if (!promptApplied) return undefined;
        const timer = setTimeout(() => setPromptApplied(false), 2400);
        return () => clearTimeout(timer);
    }, [promptApplied]);

    const abilityRows = useMemo(
        () =>
            ABILITY_DEFS.map((entry) => {
                const score = clampNonNegative(abilities?.[entry.key]);
                const modifier = abilityModifier(score);
                return {
                    ...entry,
                    score,
                    modifier,
                };
            }),
        [abilities]
    );

    const abilityMods = useMemo(() => {
        const map = {};
        for (const row of abilityRows) map[row.key] = row.modifier;
        return map;
    }, [abilityRows]);

    const level = clampNonNegative(resources.level) || 1;
    const suggestedHP = Math.max(1, Math.ceil(17 + (abilityMods.CON ?? 0) + (abilityMods.STR ?? 0) / 2));
    const suggestedMP = Math.max(0, Math.ceil(17 + (abilityMods.INT ?? 0) + (abilityMods.WIS ?? 0) / 2));
    const suggestedTP = Math.max(0, Math.ceil(7 + (abilityMods.DEX ?? 0) + (abilityMods.CON ?? 0) / 2));
    const suggestedSP = Math.max(
        0,
        Math.ceil((5 + (abilityMods.INT ?? 0)) * 2 + (abilityMods.CHA ?? 0))
    );
    const maxSkillRank = Math.max(4, level * 2 + 2);

    const wizardSkillRows = useMemo(() => {
        return normalizedWorldSkills.map((skill) => {
            const entry = skills?.[skill.key] || { ranks: 0, misc: 0 };
            const ranks = clampNonNegative(entry.ranks);
            const miscRaw = Number(entry.misc);
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            const abilityMod = abilityMods[skill.ability] ?? 0;
            const total = abilityMod + ranks + misc;
            return { ...skill, ranks, misc, abilityMod, total };
        });
    }, [abilityMods, normalizedWorldSkills, skills]);

    const spentSP = wizardSkillRows.reduce((sum, row) => sum + row.ranks, 0);
    const availableSP =
        resources.sp === undefined || resources.sp === null
            ? suggestedSP
            : clampNonNegative(resources.sp);
    const overSpent = spentSP > availableSP;
    const rankIssues = wizardSkillRows.filter((row) => row.ranks > maxSkillRank).map((row) => row.label);

    const setConceptField = useCallback((field, value) => {
        setConcept((prev) => ({ ...prev, [field]: value }));
    }, []);

    const setAbilityField = useCallback((key, value) => {
        setAbilities((prev) => ({
            ...prev,
            [key]: clampNonNegative(value),
        }));
    }, []);

    const setResourceField = useCallback((field, value) => {
        setResources((prev) => {
            if (field === "mode") {
                return { ...prev, mode: value === "TP" ? "TP" : "MP" };
            }
            if (field === "notes") {
                return { ...prev, notes: value };
            }
            const num = Number(value);
            if (field === "initiative") {
                return { ...prev, initiative: Number.isFinite(num) ? num : 0 };
            }
            return { ...prev, [field]: clampNonNegative(num) };
        });
    }, []);

    const updateSkillField = useCallback(
        (key, field, value) => {
            setSkills((prev) => {
                const next = { ...prev };
                const current = next[key] || { ranks: 0, misc: 0 };
                const num = Number(value);
                const sanitized =
                    field === "misc"
                        ? Number.isFinite(num)
                            ? num
                            : 0
                        : Math.min(Math.max(0, Number.isFinite(num) ? num : 0), maxSkillRank);
                next[key] = { ...current, [field]: sanitized };
                return next;
            });
        },
        [maxSkillRank]
    );

    const assignValuesToAbilities = useCallback((values) => {
        setAbilities((prev) => {
            const next = { ...prev };
            ABILITY_DEFS.forEach((ability, index) => {
                if (values[index] !== undefined) {
                    next[ability.key] = clampNonNegative(values[index]);
                }
            });
            return next;
        });
    }, []);

    const rollStats = useCallback(
        (mode) => {
            const values = [];
            for (let i = 0; i < 6; i++) {
                if (mode === "alt") {
                    values.push(Math.floor(Math.random() * 12) + 1 + 4);
                } else {
                    values.push(Math.floor(Math.random() * 20) + 1);
                }
            }
            setRolled(values);
            assignValuesToAbilities(values);
        },
        [assignValuesToAbilities]
    );

    const autoFillResources = useCallback(() => {
        setResources((prev) => {
            const useTP = prev.mode === "TP";
            return {
                ...prev,
                hp: suggestedHP,
                maxHP: suggestedHP,
                mp: useTP ? prev.mp : suggestedMP,
                maxMP: useTP ? prev.maxMP : suggestedMP,
                tp: useTP ? suggestedTP : prev.tp,
                maxTP: useTP ? suggestedTP : prev.maxTP,
                sp: suggestedSP,
            };
        });
    }, [suggestedHP, suggestedMP, suggestedSP, suggestedTP]);

    const cyclePrompt = useCallback(() => {
        if (!promptCount) return;
        setConceptPromptIndex((prev) => {
            if (promptCount <= 1) return prev;
            let next = prev;
            while (next === prev) {
                next = Math.floor(Math.random() * promptCount);
            }
            return next;
        });
        setPromptApplied(false);
    }, [promptCount, setConceptPromptIndex, setPromptApplied]);

    const applyPromptToBackground = useCallback(() => {
        if (!conceptPromptSnippet) return;
        setConcept((prev) => {
            const existing = typeof prev.background === "string" ? prev.background : "";
            if (existing.includes(conceptPromptSnippet)) {
                return prev;
            }
            const trimmed = existing.trim();
            const nextBackground = trimmed
                ? `${trimmed}\n\n${conceptPromptSnippet}`
                : conceptPromptSnippet;
            return { ...prev, background: nextBackground };
        });
        setPromptApplied(true);
    }, [conceptPromptSnippet, setConcept, setPromptApplied]);

    const goNext = useCallback(() => {
        setStep((prev) => Math.min(prev + 1, steps.length - 1));
    }, [steps.length]);
    const goBack = useCallback(() => {
        setStep((prev) => Math.max(prev - 1, 0));
    }, []);

    const canAdvance = useMemo(() => {
        const current = steps[step]?.key;
        if (current === "concept") {
            return !!concept.name.trim();
        }
        if (current === "resources") {
            return !overSpent && rankIssues.length === 0;
        }
        return true;
    }, [concept.name, overSpent, rankIssues.length, step, steps]);

    const canApply = !overSpent && rankIssues.length === 0;

    const handleApply = useCallback(async () => {
        if (!canApply || applying) return;
        const payload = buildCharacterFromWizard(
            { concept, abilities, resources, skills },
            baseCharacter,
            normalizedWorldSkills
        );
        try {
            setApplying(true);
            await onApply?.(payload);
        } catch (error) {
            console.error(error);
            alert(error?.message || "Failed to apply setup");
        } finally {
            setApplying(false);
        }
    }, [abilities, applying, baseCharacter, canApply, concept, normalizedWorldSkills, onApply, resources, skills]);

    const conceptField = (label, field, opts = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <input
                type="text"
                value={concept[field] ?? ""}
                onChange={(e) => setConceptField(field, e.target.value)}
                placeholder={opts.placeholder || ""}
                autoComplete="off"
            />
        </label>
    );

    const conceptArea = (label, field, opts = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <textarea
                rows={opts.rows || 3}
                value={concept[field] ?? ""}
                onChange={(e) => setConceptField(field, e.target.value)}
                placeholder={opts.placeholder || ""}
            />
        </label>
    );

    const resourceField = (label, field, opts = {}) => (
        <label className="field">
            <span className="field__label">{label}</span>
            <input
                type="number"
                value={resources[field] ?? 0}
                onChange={(e) => setResourceField(field, e.target.value)}
                min={opts.allowNegative ? undefined : 0}
                step={opts.step || 1}
            />
        </label>
    );

    const renderConcept = () => (
        <div className="wizard-stack">
            <p>
                Welcome, {displayName}! Collaborate with your table on tone and party balance. Mix and
                match archetypes, and remember that demon allies can round out any gaps. If inspiration
                runs dry, try the prompt generator below.
            </p>
            {conceptPrompt && (
                <div className="wizard-prompt" role="status" aria-live="polite">
                    <div className="wizard-prompt__body">
                        <span className="wizard-prompt__title">{conceptPrompt.title}</span>
                        <p className="wizard-prompt__hook">{conceptPrompt.hook}</p>
                        <p className="wizard-prompt__question">{conceptPrompt.question}</p>
                    </div>
                    <div className="wizard-prompt__actions">
                        <button type="button" className="btn ghost" onClick={cyclePrompt}>
                            New idea
                        </button>
                        <button
                            type="button"
                            className="btn secondary"
                            onClick={applyPromptToBackground}
                        >
                            Add to background
                        </button>
                    </div>
                    {promptApplied && (
                        <span className="wizard-prompt__hint">Prompt added to background</span>
                    )}
                </div>
            )}
            <div className="wizard-grid">
                {conceptField("Character name", "name")}
                {conceptField("Player / handler", "player", { placeholder: playerName || "" })}
                {conceptField("Concept / class", "class", {
                    placeholder: "Click a role card below to autofill",
                })}
                {conceptField("Alignment", "alignment")}
                {conceptField("Race / origin", "race")}
                {conceptField("Nationality", "nationality")}
                {conceptField("Age", "age")}
                {conceptField("Gender", "gender")}
                {conceptField("Height", "height")}
                {conceptField("Weight", "weight")}
                {conceptField("Eye colour", "eye")}
                {conceptField("Hair", "hair")}
                {conceptField("Skin tone", "skinTone")}
            </div>
            <div className="wizard-archetypes">
                {ROLE_ARCHETYPES.map((role) => {
                    const selectedTitle = concept.class?.trim().toLowerCase();
                    const normalizedTitle = role.title?.trim().toLowerCase();
                    const isSelected = !!selectedTitle && selectedTitle === normalizedTitle;
                    return (
                        <button
                            key={role.key}
                            type="button"
                            className={`wizard-role-card${isSelected ? " is-selected" : ""}`}
                            onClick={() => setConceptField("class", role.title)}
                            aria-pressed={isSelected}
                        >
                            <h5>{role.title}</h5>
                            <div className="wizard-role-meta">{role.stats}</div>
                            <div className="wizard-role-row">
                                <span className="pill success">Pros</span>
                                <span>{role.pros}</span>
                            </div>
                            <div className="wizard-role-row">
                                <span className="pill warn">Cons</span>
                                <span>{role.cons}</span>
                            </div>
                            <div className="wizard-role-card__cta" aria-hidden="true">
                                {isSelected ? "Selected" : "Use this class"}
                            </div>
                        </button>
                    );
                })}
            </div>
            <div className="wizard-grid wizard-grid--stretch">
                {conceptArea("Background & hooks", "background", { rows: 3 })}
                {conceptArea("Notes", "notes", { rows: 3 })}
            </div>
        </div>
    );

    const renderAbilities = () => (
        <div className="wizard-stack">
            <p>
                Roll six ability points using 6d20. The brave can try multiple sets and pick their
                favourite, or use the alternate 6d12+4 method for a flatter 5–16 spread. Even numbers
                bump your modifier; odds are for gear prerequisites.
            </p>
            <div className="wizard-roller">
                <button type="button" className="btn" onClick={() => rollStats("d20")}>Roll 6d20</button>
                <button type="button" className="btn" onClick={() => rollStats("alt")}>Roll 6d12 + 4</button>
                {rolled.length > 0 && (
                    <div className="wizard-rolled" role="status">
                        <span>Latest roll: {rolled.join(", ")}</span>
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={() => assignValuesToAbilities(rolled)}
                        >
                            Reapply to abilities
                        </button>
                    </div>
                )}
            </div>
            <div className="ability-grid ability-grid--wizard">
                {abilityRows.map((ability) => (
                    <div key={ability.key} className="ability-card ability-card--wizard">
                        <div className="ability-card__heading">
                            <span className="ability-card__abbr">{ability.key}</span>
                            <span className="ability-card__title">{ability.label}</span>
                        </div>
                        <label className="field">
                            <span className="field__label">Score</span>
                            <input
                                type="number"
                                value={ability.score}
                                min={0}
                                onChange={(e) => setAbilityField(ability.key, e.target.value)}
                            />
                        </label>
                        <div className="ability-card__mod">
                            <span>Modifier</span>
                            <span className="ability-card__mod-value">{formatModifier(ability.modifier)}</span>
                        </div>
                        <p className="ability-card__summary">{ability.summary}</p>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderArcana = () => (
        <div className="wizard-stack">
            <p>
                Arcana act like races—permanent stat tweaks applied once during creation. Keep the total
                adjustment within four points and remember to update your ability scores if your table
                applies them immediately.
            </p>
            <div className="wizard-arcana-grid">
                {ARCANA_DATA.map((arcana) => {
                    const selected = concept.arcana === arcana.label;
                    return (
                        <label
                            key={arcana.key}
                            className={`wizard-arcana-card${selected ? " is-selected" : ""}`}
                        >
                            <input
                                type="radio"
                                name="wizard-arcana"
                                value={arcana.label}
                                checked={selected}
                                onChange={() => setConceptField("arcana", arcana.label)}
                            />
                            <div className="wizard-arcana-card__body">
                                <span className="wizard-arcana-card__title">{arcana.label}</span>
                                <div className="wizard-arcana-card__row">
                                    <span className="pill success">Bonus</span>
                                    <span>{arcana.bonus}</span>
                                </div>
                                <div className="wizard-arcana-card__row">
                                    <span className="pill warn">Penalty</span>
                                    <span>{arcana.penalty}</span>
                                </div>
                            </div>
                        </label>
                    );
                })}
            </div>
            <p className="text-muted text-small">
                Need a custom Arcana? Keep the math fair—no more than ±4 total across all stats.
            </p>
        </div>
    );

    const renderResources = () => (
        <div className="wizard-stack">
            <p>
                HP uses <b>17 + CON + (STR ÷ 2)</b>. MP uses <b>17 + INT + (WIS ÷ 2)</b>. TP uses
                <b>7 + DEX + (CON ÷ 2)</b> and regens one per round. SP uses <b>((5 + INT) × 2) + CHA</b>
                and must be spent immediately on world skills. Round up and never let gains drop below 1.
            </p>
            <div className="wizard-grid wizard-grid--resources">
                {resourceField("Level", "level")}
                {resourceField("EXP", "exp")}
                <label className="field">
                    <span className="field__label">Resource type</span>
                    <select
                        value={resources.mode}
                        onChange={(e) => setResourceField("mode", e.target.value)}
                    >
                        <option value="MP">MP</option>
                        <option value="TP">TP</option>
                    </select>
                </label>
                {resourceField("HP", "hp")}
                {resourceField("Max HP", "maxHP")}
                {resources.mode === "TP" ? (
                    <>
                        {resourceField("TP", "tp")}
                        {resourceField("Max TP", "maxTP")}
                    </>
                ) : (
                    <>
                        {resourceField("MP", "mp")}
                        {resourceField("Max MP", "maxMP")}
                    </>
                )}
                {resourceField("SP (earned)", "sp")}
                {resourceField("Macca", "macca")}
                {resourceField("Initiative bonus", "initiative", { allowNegative: true })}
            </div>
            <div className="wizard-hints">
                <div className="sheet-hint">
                    <span className="sheet-hint__label">Suggested HP</span>
                    <span className="sheet-hint__value">{suggestedHP}</span>
                    <span className="sheet-hint__meta">17 + CON + (STR ÷ 2)</span>
                </div>
                <div className="sheet-hint">
                    <span className="sheet-hint__label">
                        {resources.mode === "TP" ? "Suggested TP" : "Suggested MP"}
                    </span>
                    <span className="sheet-hint__value">
                        {resources.mode === "TP" ? suggestedTP : suggestedMP}
                    </span>
                    <span className="sheet-hint__meta">
                        {resources.mode === "TP"
                            ? "7 + DEX + (CON ÷ 2)"
                            : "17 + INT + (WIS ÷ 2)"}
                    </span>
                </div>
                <div className="sheet-hint">
                    <span className="sheet-hint__label">Suggested SP</span>
                    <span className="sheet-hint__value">{suggestedSP}</span>
                    <span className="sheet-hint__meta">((5 + INT) × 2) + CHA</span>
                </div>
                <div className="sheet-hint">
                    <span className="sheet-hint__label">Max skill rank</span>
                    <span className="sheet-hint__value">{maxSkillRank}</span>
                    <span className="sheet-hint__meta">(Level × 2) + 2</span>
                </div>
            </div>
            <div className="wizard-actions">
                <button type="button" className="btn ghost" onClick={autoFillResources}>
                    Use suggested totals
                </button>
            </div>
            <p className="text-muted text-small">
                Optional variants: Cats halve HP (9 + CON + (STR ÷ 2)). Psychic babies double MP (33 + INT + (WIS ÷ 2)).
            </p>
            <h4>World skills</h4>
            <p>
                Spend SP now—unused points vanish. TP regens on its own, MP usually requires rest or items.
            </p>
            <div className={`wizard-sp-summary${overSpent ? " warn" : ""}`}>
                <span>SP spent: {spentSP}</span>
                <span>Available: {availableSP}</span>
                <span>Max rank: {maxSkillRank}</span>
            </div>
            {overSpent && (
                <div className="wizard-warning">You have spent more SP than available.</div>
            )}
            {rankIssues.length > 0 && (
                <div className="wizard-warning">
                    Over the rank cap: {rankIssues.join(", ")}
                </div>
            )}
            <div className="sheet-table-wrapper">
                <table className="sheet-table skill-table">
                    <thead>
                        <tr>
                            <th>Skill</th>
                            <th>Ability</th>
                            <th>Ability mod</th>
                            <th>Ranks</th>
                            <th>Misc</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {wizardSkillRows.map((row) => (
                            <tr key={row.key}>
                                <th scope="row">{row.label}</th>
                                <td>{row.ability}</td>
                                <td>
                                    <span className="pill light">{formatModifier(row.abilityMod)}</span>
                                </td>
                                <td>
                                    <input
                                        type="number"
                                        min={0}
                                        max={maxSkillRank}
                                        value={row.ranks}
                                        onChange={(e) => updateSkillField(row.key, "ranks", e.target.value)}
                                    />
                                </td>
                                <td>
                                    <input
                                        type="number"
                                        value={row.misc}
                                        onChange={(e) => updateSkillField(row.key, "misc", e.target.value)}
                                    />
                                </td>
                                <td>
                                    <span className="skill-total">{formatModifier(row.total)}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderReview = () => {
        const summarySkills = wizardSkillRows.filter((row) => row.ranks || row.misc);
        return (
            <div className="wizard-stack">
                <p>
                    One last look before committing. Level-ups require <b>Level × 1,000 EXP</b>. On a level
                    gain: +1 AP, HP +1d4+CON+(STR ÷ 2), MP +1d4+INT+(WIS ÷ 2) or TP +1d4+((DEX+CON) ÷ 2),
                    and SP equal to (INT + CHA) ÷ 2—spend it immediately.
                </p>
                <div className="wizard-summary">
                    <div className="wizard-summary__section">
                        <h4>Profile</h4>
                        <dl>
                            <div>
                                <dt>Name</dt>
                                <dd>{concept.name || "—"}</dd>
                            </div>
                            <div>
                                <dt>Arcana</dt>
                                <dd>{concept.arcana || "—"}</dd>
                            </div>
                            <div>
                                <dt>Alignment</dt>
                                <dd>{concept.alignment || "Neutral"}</dd>
                            </div>
                            <div>
                                <dt>Origin</dt>
                                <dd>{concept.race || "—"}</dd>
                            </div>
                        </dl>
                    </div>
                    <div className="wizard-summary__section">
                        <h4>Ability scores</h4>
                        <ul>
                            {abilityRows.map((row) => (
                                <li key={row.key}>
                                    {row.key}: {row.score} ({formatModifier(row.modifier)})
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="wizard-summary__section">
                        <h4>Resources</h4>
                        <ul>
                            <li>Level {level} · EXP {resources.exp}</li>
                            <li>HP {resources.hp}/{resources.maxHP}</li>
                            {resources.mode === "TP" ? (
                                <li>TP {resources.tp}/{resources.maxTP || resources.tp}</li>
                            ) : (
                                <li>MP {resources.mp}/{resources.maxMP}</li>
                            )}
                        <li>SP {resources.sp}</li>
                        <li>Macca {resources.macca}</li>
                    </ul>
                </div>
                    <div className="wizard-summary__section">
                        <h4>World skills</h4>
                        {summarySkills.length === 0 ? (
                            <p className="text-muted text-small">No ranks allocated yet.</p>
                        ) : (
                            <ul>
                                {summarySkills.map((row) => (
                                    <li key={row.key}>
                                        {row.label}: {row.ranks} ranks ({formatModifier(row.total)})
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
                <div className="wizard-info">
                    <h4>Scaling new high-level characters or demons</h4>
                    <ol>
                        <li>Roll 6 ability scores and apply Arcana adjustments.</li>
                        <li>Set base HP/MP/TP/SP using the level 1 formulas above.</li>
                        <li>Add X AP into stats (3–5 recommended) for each batch of levels.</li>
                        <li>For each batch, add level-up gains: HP (1d4+CON+(STR ÷ 2)) × X, MP (1d4+INT+(WIS ÷ 2)) × X, TP (1d4+((DEX+CON) ÷ 2)) × X, SP ((INT+CHA) ÷ 2) × X.</li>
                        <li>Repeat until you cover every level beyond 1; use smaller X for precise RNG.</li>
                    </ol>
                </div>
            </div>
        );
    };

    if (!open) return null;

    const activeKey = steps[step]?.key;
    let content = null;
    if (activeKey === "concept") content = renderConcept();
    else if (activeKey === "abilities") content = renderAbilities();
    else if (activeKey === "arcana") content = renderArcana();
    else if (activeKey === "resources") content = renderResources();
    else content = renderReview();

    return (
        <div className="wizard-backdrop" role="dialog" aria-modal="true">
            <div className="wizard-panel">
                <header className="wizard-header">
                    <div className="wizard-header__text">
                        <h3>New player setup</h3>
                        <p className="text-muted text-small">{steps[step]?.blurb || ""}</p>
                        <div className="wizard-progress__meta">Step {step + 1} of {steps.length}</div>
                        <div
                            className="wizard-progress"
                            role="progressbar"
                            aria-valuenow={progress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label="Setup progress"
                        >
                            <span className="wizard-progress__bar" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                    <div className="wizard-header__actions">
                        <button type="button" className="btn ghost" onClick={onClose}>
                            Close
                        </button>
                    </div>
                </header>
                <div className="wizard-stepper">
                    {steps.map((item, index) => (
                        <button
                            key={item.key}
                            type="button"
                            className={`wizard-step${
                                index === step
                                    ? " is-active"
                                    : index < step
                                    ? " is-complete"
                                    : ""
                            }`}
                            onClick={() => setStep(index)}
                            disabled={index > step}
                        >
                            <span className="wizard-step__label">{item.title}</span>
                        </button>
                    ))}
                </div>
                <div className="wizard-content">{content}</div>
                <footer className="wizard-footer">
                    <button type="button" className="btn ghost" onClick={onClose}>
                        Cancel
                    </button>
                    <div className="wizard-footer__actions">
                        <button type="button" className="btn secondary" onClick={goBack} disabled={step === 0}>
                            Back
                        </button>
                        {step < steps.length - 1 ? (
                            <button type="button" className="btn" onClick={goNext} disabled={!canAdvance}>
                                Next
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="btn"
                                onClick={handleApply}
                                disabled={!canApply || applying}
                            >
                                {applying ? "Applying…" : "Apply to sheet"}
                            </button>
                        )}
                    </div>
                </footer>
            </div>
        </div>
    );
}

function buildInitialWizardState(character, playerName, worldSkills = DEFAULT_WORLD_SKILLS) {
    const normalized = normalizeCharacter(character, worldSkills);
    const abilityDefaults = ABILITY_DEFS.reduce((acc, ability) => {
        const value = clampNonNegative(normalized.stats?.[ability.key]);
        acc[ability.key] = value || 0;
        return acc;
    }, {});
    const resources = {
        level: clampNonNegative(normalized.resources?.level) || 1,
        exp: clampNonNegative(normalized.resources?.exp),
        hp: clampNonNegative(normalized.resources?.hp),
        maxHP: clampNonNegative(normalized.resources?.maxHP),
        mp: clampNonNegative(normalized.resources?.mp),
        maxMP: clampNonNegative(normalized.resources?.maxMP),
        tp: clampNonNegative(normalized.resources?.tp),
        maxTP: clampNonNegative(normalized.resources?.maxTP),
        sp: clampNonNegative(normalized.resources?.sp),
        macca: clampNonNegative(normalized.resources?.macca),
        initiative: Number(normalized.resources?.initiative) || 0,
        mode: normalized.resources?.useTP ? "TP" : "MP",
        notes: normalized.resources?.notes || "",
    };
    const concept = {
        name: normalized.name || "",
        player: normalized.profile?.player || playerName || "",
        class: normalized.profile?.class || "",
        arcana: normalized.profile?.arcana || "",
        alignment: normalized.profile?.alignment || "",
        race: normalized.profile?.race || "",
        nationality: normalized.profile?.nationality || "",
        age: normalized.profile?.age || "",
        gender: normalized.profile?.gender || "",
        height: normalized.profile?.height || "",
        weight: normalized.profile?.weight || "",
        eye: normalized.profile?.eye || "",
        hair: normalized.profile?.hair || "",
        skinTone: normalized.profile?.skinTone || "",
        background: normalized.profile?.background || "",
        notes: normalized.profile?.notes || "",
    };
    return {
        concept,
        abilities: abilityDefaults,
        resources,
        skills: normalizeSkills(normalized.skills, worldSkills),
        customSkills: normalizeCustomSkills(normalized.customSkills),
    };
}

function buildCharacterFromWizard(state, base, worldSkills = DEFAULT_WORLD_SKILLS) {
    const normalized = normalizeCharacter(base, worldSkills);
    const merged = deepClone(normalized);
    merged.name = state.concept.name?.trim() || "";
    merged.profile = {
        ...normalized.profile,
        player: state.concept.player || normalized.profile?.player || "",
        class: state.concept.class || "",
        arcana: state.concept.arcana || "",
        alignment: state.concept.alignment || "",
        race: state.concept.race || "",
        nationality: state.concept.nationality || "",
        age: state.concept.age || "",
        gender: state.concept.gender || "",
        height: state.concept.height || "",
        weight: state.concept.weight || "",
        eye: state.concept.eye || "",
        hair: state.concept.hair || "",
        skinTone: state.concept.skinTone || "",
        background: state.concept.background || "",
        notes: state.concept.notes || "",
    };
    merged.stats = ABILITY_DEFS.reduce((acc, ability) => {
        acc[ability.key] = clampNonNegative(state.abilities?.[ability.key]);
        return acc;
    }, {});
    const useTP = state.resources.mode === "TP";
    merged.resources = {
        ...normalized.resources,
        level: clampNonNegative(state.resources.level) || 1,
        exp: clampNonNegative(state.resources.exp),
        hp: clampNonNegative(state.resources.hp),
        maxHP: clampNonNegative(state.resources.maxHP),
        mp: useTP ? 0 : clampNonNegative(state.resources.mp),
        maxMP: useTP ? 0 : clampNonNegative(state.resources.maxMP),
        tp: useTP ? clampNonNegative(state.resources.tp) : clampNonNegative(normalized.resources?.tp),
        maxTP: useTP
            ? clampNonNegative(state.resources.maxTP)
            : clampNonNegative(normalized.resources?.maxTP),
        sp: clampNonNegative(state.resources.sp),
        macca: clampNonNegative(state.resources.macca),
        initiative: Number(state.resources.initiative) || 0,
        notes: state.resources.notes || normalized.resources?.notes || "",
        useTP,
    };
    merged.skills = normalizeSkills(state.skills, worldSkills);
    merged.customSkills = normalizeCustomSkills(state.customSkills ?? normalized.customSkills);
    return merged;
}

// ---------- Party ----------
function Party({ game, selectedPlayerId, onSelectPlayer, mode = "player", currentUserId }) {
    const realtime = useContext(RealtimeContext);
    const players = useMemo(
        () =>
            (game.players || []).filter(
                (entry) => (entry?.role || "").toLowerCase() !== "dm"
            ),
        [game.players]
    );
    const presenceMap = realtime?.onlineUsers || EMPTY_OBJECT;

    const allowInspect = mode !== "dm";
    const [inspectedPlayerId, setInspectedPlayerId] = useState(null);
    const inspectedPlayer = useMemo(() => {
        if (!inspectedPlayerId) return null;
        return (
            players.find((entry) => entry?.userId === inspectedPlayerId) || null
        );
    }, [players, inspectedPlayerId]);

    useEffect(() => {
        if (!allowInspect && inspectedPlayerId) {
            setInspectedPlayerId(null);
        }
    }, [allowInspect, inspectedPlayerId]);

    useEffect(() => {
        if (!allowInspect || !inspectedPlayerId) return;
        const exists = players.some((p) => p?.userId === inspectedPlayerId);
        if (!exists) {
            setInspectedPlayerId(null);
        }
    }, [allowInspect, inspectedPlayerId, players]);

    const canSelect = typeof onSelectPlayer === "function";
    const isInteractive = canSelect || allowInspect;
    const title = mode === "dm" ? "Party roster" : "Party lineup";
    const subtitle =
        mode === "dm"
            ? "Tap a player to open their character sheet."
            : "Tap a party member to review their sheet, inventory, and gear.";

    return (
        <div className="card">
            <div className="header">
                <div>
                    <h3>{title}</h3>
                    <p className="text-muted text-small">{subtitle}</p>
                </div>
            </div>
            <div className="list party-roster">
                {players.length === 0 ? (
                    <div className="text-muted">No players have joined yet.</div>
                ) : (
                    players.map((p, index) => {
                        const key = p.userId || `player-${index}`;
                        const name =
                            p.character?.name?.trim() ||
                            p.username ||
                            `Player ${index + 1}`;
                        const lvlRaw = Number(p.character?.resources?.level);
                        const level = Number.isFinite(lvlRaw) ? lvlRaw : null;
                        const hpRaw = Number(p.character?.resources?.hp ?? 0);
                        const hp = Number.isFinite(hpRaw) ? hpRaw : 0;
                        const maxRaw = Number(p.character?.resources?.maxHP ?? 0);
                        const maxHP = Number.isFinite(maxRaw) ? maxRaw : 0;
                        const hpLabel = maxHP > 0 ? `${hp}/${maxHP}` : String(hp);
                        const ratio = maxHP > 0 ? hp / maxHP : hp > 0 ? 1 : 0;
                        let tone = "success";
                        if (hp <= 0) tone = "danger";
                        else if (ratio < 0.35) tone = "warn";
                        const isSelected = !!selectedPlayerId && p.userId === selectedPlayerId;
                        const isSelf = currentUserId && p.userId === currentUserId;
                        const roleLabel = (p.role || "").trim();
                        const showRole = roleLabel && roleLabel.toLowerCase() !== "player";
                        const isOnline = !!(
                            (p.userId && presenceMap[p.userId]) ?? p.online
                        );

                        const subtitleParts = [];
                        if (p.character?.profile?.class) {
                            subtitleParts.push(p.character.profile.class);
                        }
                        if (level !== null) subtitleParts.push(`LV ${level}`);
                        const subtitleText = subtitleParts.join(" · ");

                        return (
                            <div
                                key={key}
                                className={`party-row${isSelected ? " is-active" : ""}${
                                    isInteractive ? " is-clickable" : ""
                                }`}
                                role={isInteractive ? "button" : undefined}
                                tabIndex={isInteractive ? 0 : undefined}
                                onClick={() => {
                                    if (canSelect && p.userId) {
                                        onSelectPlayer(p);
                                        return;
                                    }
                                    if (allowInspect && p.userId) {
                                        setInspectedPlayerId(p.userId);
                                    }
                                }}
                                onKeyDown={(evt) => {
                                    if (!isInteractive) return;
                                    if (evt.key === "Enter" || evt.key === " ") {
                                        evt.preventDefault();
                                        if (canSelect && p.userId) {
                                            onSelectPlayer(p);
                                        } else if (allowInspect && p.userId) {
                                            setInspectedPlayerId(p.userId);
                                        }
                                    }
                                }}
                            >
                                <div className="party-row__info">
                                    <span className="party-row__name">{name}</span>
                                    {subtitleText && (
                                        <span className="text-muted text-small">
                                            {subtitleText}
                                        </span>
                                    )}
                                </div>
                                <div className="party-row__metrics">
                                    <span
                                        className={`presence-indicator ${
                                            isOnline ? "is-online" : "is-offline"
                                        }`}
                                    >
                                        {isOnline ? "Online" : "Offline"}
                                    </span>
                                    <span className={`pill ${tone}`}>HP {hpLabel}</span>
                                    {mode !== "dm" && level !== null && (
                                        <span className="pill">LV {level}</span>
                                    )}
                                    {mode === "dm" && showRole && (
                                        <span className="pill">{roleLabel.toUpperCase()}</span>
                                    )}
                                    {isSelf && <span className="pill success">You</span>}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
            {allowInspect && inspectedPlayer && (
                <PartyInspectModal
                    player={inspectedPlayer}
                    onClose={() => setInspectedPlayerId(null)}
                    viewerId={currentUserId}
                />
            )}
        </div>
    );
}

const PARTY_GEAR_SLOT_ORDER = ["weapon", "armor", "accessory"];

function PartyInspectModal({ player, onClose, viewerId }) {
    const labelId = useId();
    const descriptionId = useId();

    useEffect(() => {
        const handleKey = (evt) => {
            if (evt.key === "Escape") {
                evt.preventDefault();
                onClose?.();
            }
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [onClose]);

    const character = useMemo(() => {
        if (!player?.character) return null;
        return normalizeCharacter(player.character);
    }, [player?.character]);

    const displayName =
        (character?.name || "").trim() ||
        (player?.character?.name || "").trim() ||
        player?.username ||
        "Player";

    const profile = character?.profile || EMPTY_OBJECT;
    const levelRaw = character?.resources?.level;
    const level = Number(levelRaw);
    const levelLabel = Number.isFinite(level) && level > 0 ? `Level ${level}` : "";
    const classLabel = typeof profile.class === "string" ? profile.class.trim() : "";
    const raceLabel = typeof profile.race === "string" ? profile.race.trim() : "";
    const alignment =
        typeof profile.alignment === "string" ? profile.alignment.trim() : "";
    const isSelf = viewerId && player?.userId === viewerId;
    const roleLabel =
        typeof player?.role === "string" && player.role.trim().toLowerCase() !== "player"
            ? player.role.trim()
            : "";

    const headerChips = [
        classLabel,
        levelLabel,
        raceLabel,
        alignment,
        roleLabel,
        isSelf ? "You" : "",
    ].filter((value) => typeof value === "string" && value);

    const abilitySummaries = useMemo(() => {
        if (!character) return [];
        return ABILITY_DEFS.map((ability) => {
            const raw = character.stats?.[ability.key];
            const parsed = Number(raw);
            const score =
                raw === undefined || raw === null || raw === ""
                    ? null
                    : Number.isFinite(parsed)
                    ? parsed
                    : null;
            const modifier = score === null ? null : abilityModifier(score);
            return {
                key: ability.key,
                label: ability.label,
                score,
                modifier,
            };
        });
    }, [character]);

    const resources = character?.resources || EMPTY_OBJECT;
    const parseResource = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    };
    const hp = parseResource(resources.hp);
    const maxHP = parseResource(resources.maxHP);
    const mp = parseResource(resources.mp);
    const maxMP = parseResource(resources.maxMP);
    const tp = parseResource(resources.tp);
    const maxTP = parseResource(resources.maxTP);
    const sp = parseResource(resources.sp);
    const macca = parseResource(resources.macca);
    const initiative = parseResource(resources.initiative);

    const resourceChips = [];
    if (hp !== null || maxHP !== null) {
        const valueLabel =
            maxHP !== null && maxHP > 0
                ? `${hp !== null ? Math.max(0, hp) : 0}/${Math.max(0, maxHP)}`
                : hp !== null
                ? String(Math.max(0, hp))
                : "—";
        resourceChips.push({ label: "HP", value: valueLabel });
    }
    if (mp !== null || maxMP !== null) {
        const valueLabel =
            maxMP !== null && maxMP > 0
                ? `${mp !== null ? Math.max(0, mp) : 0}/${Math.max(0, maxMP)}`
                : mp !== null
                ? String(Math.max(0, mp))
                : "—";
        resourceChips.push({ label: "MP", value: valueLabel });
    }
    if (tp !== null || maxTP !== null) {
        const valueLabel =
            maxTP !== null && maxTP > 0
                ? `${tp !== null ? Math.max(0, tp) : 0}/${Math.max(0, maxTP)}`
                : tp !== null
                ? String(Math.max(0, tp))
                : "—";
        resourceChips.push({ label: "TP", value: valueLabel });
    }
    if (sp !== null) {
        resourceChips.push({ label: "SP", value: String(Math.max(0, sp)) });
    }
    if (macca !== null) {
        resourceChips.push({ label: "Macca", value: String(Math.max(0, macca)) });
    }
    if (initiative !== null) {
        resourceChips.push({ label: "Initiative", value: formatModifier(initiative) });
    }

    const profileDetails = [
        { label: "Background", value: profile.background },
        { label: "Origin", value: profile.nationality || profile.homeland },
        { label: "Pronouns", value: profile.pronouns || profile.gender },
        { label: "Age", value: profile.age },
    ].filter((entry) => typeof entry.value === "string" && entry.value.trim());

    const profileNotes =
        typeof profile.notes === "string" && profile.notes.trim()
            ? profile.notes.trim()
            : "";

    const inventory = Array.isArray(player?.inventory) ? player.inventory : EMPTY_ARRAY;
    const gearBag = Array.isArray(player?.gear?.bag) ? player.gear.bag : EMPTY_ARRAY;
    const gearSlots =
        player?.gear?.slots && typeof player.gear.slots === "object"
            ? player.gear.slots
            : EMPTY_OBJECT;

    const bagMap = useMemo(() => {
        const map = new Map();
        for (const item of gearBag) {
            if (!item || typeof item !== "object") continue;
            const id = typeof item.id === "string" ? item.id : null;
            if (!id) continue;
            map.set(id, item);
        }
        return map;
    }, [gearBag]);

    const slotKeys = useMemo(() => {
        const keys = [];
        const seen = new Set();
        for (const key of PARTY_GEAR_SLOT_ORDER) {
            if (Object.prototype.hasOwnProperty.call(gearSlots, key)) {
                keys.push(key);
                seen.add(key);
            }
        }
        for (const key of Object.keys(gearSlots)) {
            if (!seen.has(key)) keys.push(key);
        }
        return keys;
    }, [gearSlots]);

    const formatSlotLabel = (key) => {
        if (!key) return "Slot";
        switch (key) {
            case "weapon":
                return "Weapon";
            case "armor":
                return "Armor";
            case "accessory":
                return "Accessory";
            default:
                return key
                    .replace(/[-_]+/g, " ")
                    .replace(/\b\w/g, (char) => char.toUpperCase());
        }
    };

    const resolveSlotItem = (key) => {
        const slotEntry = gearSlots?.[key];
        if (!slotEntry) return null;
        if (slotEntry.itemId && bagMap.has(slotEntry.itemId)) {
            return bagMap.get(slotEntry.itemId);
        }
        if (slotEntry.item && typeof slotEntry.item === "object") {
            return slotEntry.item;
        }
        const legacy = player?.gear?.[key];
        if (legacy && typeof legacy === "object") return legacy;
        return null;
    };

    const handleBackdropClick = (evt) => {
        evt.stopPropagation();
        onClose?.();
    };

    const stopPropagation = (evt) => {
        evt.stopPropagation();
    };

    const descriptionText =
        headerChips.length > 0
            ? `${displayName} · ${headerChips.join(" · ")}`
            : `${displayName}'s character overview`;

    return (
        <div className="party-inspect-backdrop" role="presentation" onClick={handleBackdropClick}>
            <div
                className="party-inspect-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                onClick={stopPropagation}
            >
                <header className="party-inspect-modal__header">
                    <div>
                        <h3 id={labelId}>{displayName}</h3>
                        <p id={descriptionId} className="text-muted text-small">
                            {descriptionText}
                        </p>
                        {headerChips.length > 0 && (
                            <div className="party-inspect-chip-row">
                                {headerChips.map((chip) => (
                                    <span key={chip} className="pill">
                                        {chip}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    <button type="button" className="btn ghost" onClick={onClose}>
                        Close
                    </button>
                </header>
                <div className="party-inspect-modal__body">
                    {character ? (
                        <section className="party-inspect-section">
                            <h4>Character sheet</h4>
                            {abilitySummaries.length > 0 && (
                                <div className="party-inspect-stats">
                                    {abilitySummaries.map((entry) => (
                                        <div key={entry.key} className="party-inspect-stat">
                                            <span className="text-muted text-small">{entry.label}</span>
                                            <strong className="party-inspect-stat__value">
                                                {entry.score ?? "—"}
                                            </strong>
                                            {entry.modifier !== null && (
                                                <span className="text-muted text-small">
                                                    Mod {formatModifier(entry.modifier)}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {resourceChips.length > 0 && (
                                <div className="party-inspect-resource-grid">
                                    {resourceChips.map((row) => (
                                        <div key={row.label} className="party-inspect-resource">
                                            <span className="text-muted text-small">{row.label}</span>
                                            <strong>{row.value}</strong>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {profileDetails.length > 0 && (
                                <div className="party-inspect-profile">
                                    {profileDetails.map((detail) => (
                                        <div key={detail.label} className="party-inspect-profile__row">
                                            <span className="text-muted text-small">{detail.label}</span>
                                            <span>{detail.value}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {profileNotes && (
                                <div className="party-inspect-notes">
                                    <span className="text-muted text-small">Notes</span>
                                    <p>{profileNotes}</p>
                                </div>
                            )}
                        </section>
                    ) : (
                        <section className="party-inspect-section">
                            <h4>Character sheet</h4>
                            <p className="text-muted text-small">
                                This adventurer hasn&apos;t shared a character sheet yet.
                            </p>
                        </section>
                    )}

                    <section className="party-inspect-section">
                        <h4>Inventory</h4>
                        {inventory.length === 0 ? (
                            <p className="text-muted text-small">No items in their pack.</p>
                        ) : (
                            <div className="party-inspect-item-list">
                                {inventory.map((item) => {
                                    if (!item || typeof item !== "object") return null;
                                    const key = item.id || `${item.name || "item"}-${item.type || ""}`;
                                    const quantity = Number(item.amount);
                                    const amountLabel = Number.isFinite(quantity) && quantity > 0 ? `×${quantity}` : "";
                                    const metaParts = [
                                        typeof item.type === "string" ? item.type.trim() : "",
                                        amountLabel,
                                    ].filter(Boolean);
                                    const tags = Array.isArray(item.tags) ? item.tags : EMPTY_ARRAY;
                                    return (
                                        <div key={key} className="party-inspect-item">
                                            <div className="party-inspect-item__header">
                                                <strong>{item.name || "Unnamed item"}</strong>
                                                {metaParts.length > 0 && (
                                                    <span className="text-muted text-small">
                                                        {metaParts.join(" · ")}
                                                    </span>
                                                )}
                                            </div>
                                            {item.desc && <p>{item.desc}</p>}
                                            {tags.length > 0 && (
                                                <div className="party-inspect-tags">
                                                    {tags.map((tag) => (
                                                        <span key={tag} className="pill light">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <section className="party-inspect-section">
                        <h4>Gear</h4>
                        <div className="party-inspect-gear">
                            <div>
                                <h5>Equipped</h5>
                                {slotKeys.length === 0 ? (
                                    <p className="text-muted text-small">No gear slots shared.</p>
                                ) : (
                                    <div className="party-inspect-slot-list">
                                        {slotKeys.map((slotKey) => {
                                            const resolved = resolveSlotItem(slotKey);
                                            const label = formatSlotLabel(slotKey);
                                            const description = resolved?.type
                                                ? resolved.type
                                                : resolved?.desc || "";
                                            return (
                                                <div key={slotKey} className="party-inspect-slot">
                                                    <div>
                                                        <span className="text-muted text-small">{label}</span>
                                                        <strong>{resolved?.name || "Empty"}</strong>
                                                    </div>
                                                    {description && (
                                                        <span className="text-muted text-small">
                                                            {description}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <div>
                                <h5>Bag</h5>
                                {gearBag.length === 0 ? (
                                    <p className="text-muted text-small">No spare gear listed.</p>
                                ) : (
                                    <div className="party-inspect-item-list">
                                        {gearBag.map((item) => {
                                            if (!item || typeof item !== "object") return null;
                                            const key = item.id || `${item.name || "gear"}-${item.type || ""}`;
                                            const meta = [
                                                typeof item.type === "string" ? item.type.trim() : "",
                                            ].filter(Boolean);
                                            return (
                                                <div key={key} className="party-inspect-item">
                                                    <div className="party-inspect-item__header">
                                                        <strong>{item.name || "Unnamed gear"}</strong>
                                                        {meta.length > 0 && (
                                                            <span className="text-muted text-small">
                                                                {meta.join(" · ")}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {item.desc && <p>{item.desc}</p>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

const DEFAULT_STORY_POLL_MS = 15_000;
const IMAGE_FILE_REGEX = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/**
 * Normalize the story log payload returned by the server into a predictable shape.
 *
 * @param {unknown} source
 * @returns {{
 *   channelId: string,
 *   guildId: string,
 *   allowPlayerPosts: boolean,
 *   scribeIds: string[],
 *   webhookConfigured: boolean,
 *   botTokenConfigured: boolean,
 *   pollIntervalMs: number
 * }}
 */
function normalizeStoryLogConfig(source) {
    if (!source || typeof source !== "object") {
        return {
            channelId: "",
            guildId: "",
            allowPlayerPosts: false,
            scribeIds: [],
            webhookConfigured: false,
            botTokenConfigured: false,
            pollIntervalMs: DEFAULT_STORY_POLL_MS,
        };
    }
    const ids = Array.isArray(source.scribeIds)
        ? source.scribeIds.filter((id) => typeof id === "string")
        : [];
    return {
        channelId: source.channelId || "",
        guildId: source.guildId || "",
        allowPlayerPosts: !!source.allowPlayerPosts,
        scribeIds: ids,
        webhookConfigured: !!(source.webhookConfigured || source.webhookUrl),
        botTokenConfigured: !!source.botTokenConfigured,
        pollIntervalMs: Number(source.pollIntervalMs) || DEFAULT_STORY_POLL_MS,
    };
}

/**
 * Normalize campaign story configuration for the DM-facing settings form.
 *
 * @param {unknown} story
 * @returns {{
 *   channelId: string,
 *   guildId: string,
 *   webhookUrl: string,
 *   botToken: string,
 *   allowPlayerPosts: boolean,
 *   scribeIds: string[]
 * }}
 */
function normalizeStorySettings(story) {
    if (!story || typeof story !== "object") {
        return {
            channelId: "",
            guildId: "",
            webhookUrl: "",
            botToken: "",
            allowPlayerPosts: false,
            scribeIds: [],
            webhookConfigured: false,
            botTokenConfigured: false,
            primaryBot: normalizePrimaryBot(null),
        };
    }
    const ids = Array.isArray(story.scribeIds)
        ? story.scribeIds.filter((id) => typeof id === "string").sort()
        : [];
    const webhookConfigured = !!(story.webhookConfigured || story.webhookUrl);
    const botTokenConfigured = !!(story.botTokenConfigured || story.botToken);
    return {
        channelId: story.channelId || "",
        guildId: story.guildId || "",
        webhookUrl: story.webhookUrl || "",
        botToken: typeof story.botToken === "string" ? story.botToken : "",
        allowPlayerPosts: !!story.allowPlayerPosts,
        scribeIds: ids,
        webhookConfigured,
        botTokenConfigured,
        primaryBot: normalizePrimaryBot(story.primaryBot),
    };
}

// ---------- Story Logs ----------
function StoryLogsTab({ game, me }) {
    const gameId = game?.id || null;
    const isDM = idsMatch(game.dmId, me.id);
    const realtime = useContext(RealtimeContext);
    const storyConfigFromGame = useMemo(
        () => normalizeStoryLogConfig(game?.story),
        [game?.story]
    );
    const [data, setData] = useState(() => ({
        enabled: false,
        status: null,
        channel: null,
        messages: [],
        pollIntervalMs: null,
        fetchedAt: null,
        config: storyConfigFromGame,
    }));
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [sending, setSending] = useState(false);
    const [message, setMessage] = useState('');
    const [selectedPersona, setSelectedPersona] = useState('');
    const [deletingId, setDeletingId] = useState(null);
    const fetchRef = useRef(false);
    const firstLoadRef = useRef(true);
    const pollMsRef = useRef(DEFAULT_STORY_POLL_MS);
    const previousGameIdRef = useRef(gameId);
    const messagesRef = useRef(null);

    useEffect(() => {
        setData((prev) => ({
            ...prev,
            config: storyConfigFromGame,
        }));
    }, [storyConfigFromGame]);

    useEffect(() => {
        if (previousGameIdRef.current === gameId) {
            return;
        }
        previousGameIdRef.current = gameId;
        firstLoadRef.current = true;
        pollMsRef.current = DEFAULT_STORY_POLL_MS;
        setData({
            enabled: false,
            status: null,
            channel: null,
            messages: [],
            pollIntervalMs: null,
            fetchedAt: null,
            config: storyConfigFromGame,
        });
        setLoading(true);
        setRefreshing(false);
        setError(null);
        setMessage('');
        setSelectedPersona('');
    }, [gameId, storyConfigFromGame]);

    useEffect(() => {
        if (!realtime) return undefined;
        const unsubscribe = realtime.subscribeStory((snapshot) => {
            if (!snapshot) return;
            pollMsRef.current = snapshot.config?.pollIntervalMs || pollMsRef.current;
            setData({
                enabled: !!(snapshot?.enabled ?? snapshot?.status?.enabled),
                status: snapshot?.status ?? null,
                channel: snapshot?.channel ?? snapshot?.status?.channel ?? null,
                messages: Array.isArray(snapshot?.messages) ? snapshot.messages : [],
                pollIntervalMs: Number(snapshot?.pollIntervalMs ?? snapshot?.status?.pollIntervalMs) || null,
                fetchedAt: snapshot?.fetchedAt || new Date().toISOString(),
                config: normalizeStoryLogConfig(snapshot?.config ?? storyConfigFromGame),
            });
            const statusError = snapshot?.status?.error;
            setError(statusError || null);
            setLoading(false);
            setRefreshing(false);
            firstLoadRef.current = false;
        });
        return unsubscribe;
    }, [realtime, storyConfigFromGame]);

    const dateFormatter = useMemo(
        () => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        []
    );
    const relativeFormatter = useMemo(
        () => new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }),
        []
    );

    const formatTimestamp = useCallback(
        (iso) => {
            if (!iso) return '';
            const dt = new Date(iso);
            if (Number.isNaN(dt.getTime())) return '';
            return dateFormatter.format(dt);
        },
        [dateFormatter]
    );

    const formatRelative = useCallback(
        (iso) => {
            if (!iso) return '';
            const value = Date.parse(iso);
            if (!Number.isFinite(value)) return '';
            const diff = value - Date.now();
            const abs = Math.abs(diff);
            const units = [
                ['day', 86_400_000],
                ['hour', 3_600_000],
                ['minute', 60_000],
                ['second', 1000],
            ];
            for (const [unit, ms] of units) {
                if (abs >= ms || unit === 'second') {
                    const amount = Math.round(diff / ms);
                    return relativeFormatter.format(amount, unit);
                }
            }
            return '';
        },
        [relativeFormatter]
    );

    const mergeData = useCallback((result) => {
        const config = normalizeStoryLogConfig(result?.config);
        pollMsRef.current = config.pollIntervalMs || pollMsRef.current;
        setData({
            enabled: !!(result?.enabled ?? result?.status?.enabled),
            status: result?.status ?? null,
            channel: result?.channel ?? result?.status?.channel ?? null,
            messages: Array.isArray(result?.messages) ? result.messages : [],
            pollIntervalMs: Number(result?.pollIntervalMs ?? result?.status?.pollIntervalMs) || null,
            fetchedAt: result?.fetchedAt || new Date().toISOString(),
            config,
        });
    }, []);

    const fetchLogs = useCallback(async () => {
        if (!gameId) {
            setLoading(false);
            setRefreshing(false);
            return;
        }
        if (fetchRef.current) return;
        fetchRef.current = true;
        const isInitial = firstLoadRef.current;
        if (isInitial) {
            setLoading(true);
        } else {
            setRefreshing(true);
        }
        try {
            const result = await StoryLogs.fetch(gameId);
            mergeData(result);
            const statusError = result?.status?.error;
            setError(statusError || null);
        } catch (err) {
            setError(err?.message || 'Failed to load story logs.');
        } finally {
            if (isInitial) {
                firstLoadRef.current = false;
                setLoading(false);
            }
            setRefreshing(false);
            fetchRef.current = false;
        }
    }, [gameId, mergeData]);

    useEffect(() => {
        if (!gameId) {
            setLoading(false);
            return undefined;
        }
        let cancelled = false;
        let timer = null;

        const tick = async () => {
            if (cancelled) return;
            await fetchLogs();
            if (cancelled) return;
            if (realtime?.connected) {
                return;
            }
            const delay = Math.max(5_000, pollMsRef.current || DEFAULT_STORY_POLL_MS);
            timer = setTimeout(tick, delay);
        };

        tick();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [fetchLogs, gameId, realtime?.connected]);

    const handleRefresh = useCallback(() => {
        fetchLogs();
    }, [fetchLogs]);

    useEffect(() => {
        if (!messagesRef.current) return;
        messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }, [data.messages]);

    const config = data.config;
    const players = useMemo(
        () => (Array.isArray(game.players) ? game.players.filter((p) => p && p.userId) : []),
        [game.players]
    );
    const playerLabels = useMemo(
        () =>
            players.map((player, index) => {
                const charName = player?.character?.name;
                if (typeof charName === 'string' && charName.trim()) {
                    return { player, label: charName.trim() };
                }
                if (player?.username) {
                    return { player, label: player.username };
                }
                if (player?.userId) {
                    return { player, label: `Player ${player.userId.slice(0, 6)}` };
                }
                return { player, label: `Player ${index + 1}` };
            }),
        [players]
    );
    const labelMap = useMemo(() => {
        const map = new Map();
        for (const entry of playerLabels) {
            if (entry.player?.userId) {
                map.set(entry.player.userId, entry.label);
            }
        }
        return map;
    }, [playerLabels]);
    const selfLabel = useMemo(() => {
        if (labelMap.has(me.id)) return labelMap.get(me.id);
        return me.username;
    }, [labelMap, me.id, me.username]);

    const scribeIds = config.scribeIds || [];
    const isScribe = scribeIds.includes(me.id);
    const personaStatusList = useMemo(() => {
        if (!realtime?.personaStatuses) return [];
        const entries = Object.values(realtime.personaStatuses).filter((entry) => entry?.gameId === gameId);
        entries.sort((a, b) => {
            const aTime = Date.parse(a?.createdAt || a?.fetchedAt || '');
            const bTime = Date.parse(b?.createdAt || b?.fetchedAt || '');
            return aTime - bTime;
        });
        return entries;
    }, [realtime?.personaStatuses, gameId]);
    const describePersonaStatus = useCallback((status) => {
        const target = status?.targetName || 'the player';
        switch (status?.status) {
            case 'pending':
                return `Awaiting approval from ${target}.`;
            case 'approved':
                return `Approved by ${target}.`;
            case 'denied':
                return `Denied by ${target}.`;
            case 'expired':
                return 'Request expired without a response.';
            default:
                return status?.reason || status?.status || '';
        }
    }, []);

    const personaOptions = useMemo(() => {
        if (isDM) {
            const base = [
                { value: 'bot', label: 'BOT', payload: { persona: 'bot' } },
                { value: 'dm', label: 'Dungeon Master', payload: { persona: 'dm' } },
                { value: 'scribe', label: 'Scribe', payload: { persona: 'scribe' } },
                { value: 'player', label: 'Player', payload: { persona: 'player' } },
            ];
            const impersonation = playerLabels
                .filter(
                    ({ player }) =>
                        player?.userId && (player.role || '').toLowerCase() !== 'dm'
                )
                .map(({ player, label }) => ({
                    value: `player:${player.userId}`,
                    label,
                    payload: { persona: 'player', targetUserId: player.userId },
                }));
            return [...base, ...impersonation];
        }
        const opts = [];
        if (selfLabel) {
            opts.push({ value: 'self', label: selfLabel, payload: { persona: 'self' } });
        }
        if (isScribe) {
            opts.push({ value: 'scribe', label: 'Scribe', payload: { persona: 'scribe' } });
        }
        return opts;
    }, [isDM, isScribe, playerLabels, selfLabel]);

    useEffect(() => {
        if (personaOptions.length === 0) {
            setSelectedPersona('');
            return;
        }
        setSelectedPersona((prev) => {
            if (prev && personaOptions.some((opt) => opt.value === prev)) {
                return prev;
            }
            return personaOptions[0]?.value || '';
        });
    }, [personaOptions]);

    const trimmedMessage = message.trim();
    const canPost = isDM || (!!config.allowPlayerPosts && personaOptions.length > 0);
    const composerHint = useMemo(() => {
        if (!config.webhookConfigured) {
            return 'Connect a Discord webhook in Campaign Settings to enable posting.';
        }
        if (!selectedPersona) {
            return 'Choose who you want to speak as.';
        }
        if (!trimmedMessage) {
            return 'Type your story update above.';
        }
        return 'Messages are delivered straight to the linked Discord channel.';
    }, [config.webhookConfigured, selectedPersona, trimmedMessage]);
    const readyToSend = Boolean(config.webhookConfigured && selectedPersona && trimmedMessage);
    const composerDisabled = sending || !readyToSend;

    const handleSend = useCallback(
        async (evt) => {
            evt.preventDefault();
            if (!gameId) return;
            const trimmed = message.trim();
            if (!trimmed) return;
            const option = personaOptions.find((opt) => opt.value === selectedPersona);
            if (!option) return;
            try {
                setSending(true);
                if (
                    !isDM &&
                    option.payload?.persona === 'player' &&
                    option.payload?.targetUserId &&
                    option.payload.targetUserId !== me.id
                ) {
                    if (!realtime) {
                        throw new Error('Real-time connection unavailable.');
                    }
                    await realtime.requestPersona(option.payload.targetUserId, trimmed);
                    setMessage('');
                    setError(null);
                    return;
                }
                await StoryLogs.post(gameId, { ...option.payload, content: trimmed });
                setMessage('');
                setError(null);
                await fetchLogs();
            } catch (err) {
                setError(err?.message || 'Failed to post to Discord.');
            } finally {
                setSending(false);
            }
        },
        [fetchLogs, gameId, isDM, me.id, message, personaOptions, realtime, selectedPersona]
    );

    const handleDeleteMessage = useCallback(
        async (messageId) => {
            if (!isDM || !gameId || !messageId) return;
            if (typeof window !== 'undefined') {
                const confirmed = window.confirm('Delete this Discord message? This cannot be undone.');
                if (!confirmed) return;
            }
            try {
                setDeletingId(messageId);
                await StoryLogs.delete(gameId, messageId);
                setData((prev) => ({
                    ...prev,
                    messages: prev.messages.filter((entry) => entry.id !== messageId),
                }));
                setError(null);
                if (!realtime?.connected) {
                    await fetchLogs();
                }
            } catch (err) {
                const message = err?.message || 'Failed to delete message.';
                setError(message);
                if (typeof window !== 'undefined') {
                    alert(message);
                }
            } finally {
                setDeletingId(null);
            }
        },
        [fetchLogs, gameId, isDM, realtime?.connected]
    );

    const isImageAttachment = useCallback((att) => {
        if (!att) return false;
        if (typeof att.contentType === 'string' && att.contentType.startsWith('image/')) {
            return true;
        }
        if (typeof att.name === 'string' && IMAGE_FILE_REGEX.test(att.name)) {
            return true;
        }
        if (typeof att.url === 'string') {
            try {
                const url = new URL(att.url);
                return IMAGE_FILE_REGEX.test(url.pathname);
            } catch {
                return IMAGE_FILE_REGEX.test(att.url);
            }
        }
        return false;
    }, []);

    const status = data.status || {};
    const phase = status.phase || (data.enabled ? 'idle' : 'disabled');
    const phaseLabelMap = {
        disabled: 'Disabled',
        idle: 'Idle',
        connecting: 'Connecting',
        ready: 'Connected',
        error: 'Error',
        missing_token: 'Server setup required',
        unconfigured: 'Not linked',
        configuring: 'Connecting',
    };
    const phaseToneMap = {
        disabled: 'warn',
        idle: 'light',
        connecting: 'warn',
        ready: 'success',
        error: 'danger',
        missing_token: 'danger',
        unconfigured: 'warn',
        configuring: 'warn',
    };
    const phaseLabel = phaseLabelMap[phase] || 'Unknown';
    const phaseTone = phaseToneMap[phase] || 'light';
    const channelName = data.channel?.name ? `#${data.channel.name}` : null;
    const channelUrl = data.channel?.url || null;
    const channelTopic = data.channel?.topic || '';
    const lastSynced = status.lastSyncAt || data.fetchedAt;
    const lastSyncedRelative = formatRelative(lastSynced);
    const lastSyncedAbsolute = formatTimestamp(lastSynced);
    const showErrorBanner = Boolean(
        error && (phase === 'error' || phase === 'missing_token')
    );
    const hasMessages = data.messages.length > 0;
    const composerVisible = canPost && personaOptions.length > 0;
    const playerPostingDisabled = !isDM && !config.allowPlayerPosts;
    const webhookMissing = isDM && !config.webhookConfigured;

    return (
        <section className="card story-logs-card">
            <div className="header">
                <div>
                    <h3>Story logs</h3>
                    <p className="text-muted text-small">
                        Keep up with the Discord story log channel without leaving the command center.
                    </p>
                </div>
                <div className="story-logs__actions">
                    <button
                        className="btn ghost btn-small"
                        type="button"
                        onClick={handleRefresh}
                        disabled={loading || refreshing || !gameId}
                    >
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                    </button>
                    {channelUrl && (
                        <a
                            className="btn ghost btn-small"
                            href={channelUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            Open in Discord
                        </a>
                    )}
                </div>
            </div>
            <div className="story-logs__status">
                <span className={`pill ${phaseTone}`}>{phaseLabel}</span>
                {channelName && <span className="story-logs__status-name">{channelName}</span>}
                {lastSyncedAbsolute && (
                    <span className="text-muted text-small">
                        Last synced {lastSyncedRelative ? `${lastSyncedRelative} (${lastSyncedAbsolute})` : lastSyncedAbsolute}
                    </span>
                )}
            </div>
            {showErrorBanner && (
                <div className="story-logs__alert">
                    <p>{error}</p>
                </div>
            )}
            {loading ? (
                <div className="story-logs__empty">
                    <p className="text-muted">Loading story logs…</p>
                </div>
            ) : (
                <>
                    {playerPostingDisabled && (
                        <p className="text-muted text-small" style={{ marginTop: -4 }}>
                            The DM has disabled player posting for this campaign.
                        </p>
                    )}
                    {webhookMissing && (
                        <p className="text-muted text-small" style={{ marginTop: -4 }}>
                            Add a Discord webhook URL in Campaign Settings to enable posting as the bot, DM, or scribe.
                        </p>
                    )}
                    {composerVisible && (
                        <form className="story-logs__composer" onSubmit={handleSend}>
                            <div className="story-logs__composer-row">
                                <label className="text-small" style={{ display: 'grid', gap: 4 }}>
                                    Post as
                                    <select
                                        value={selectedPersona}
                                        onChange={(e) => setSelectedPersona(e.target.value)}
                                        disabled={sending}
                                    >
                                        {personaOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder={
                                    isDM
                                        ? 'Narrate the next beat or speak for an adventurer…'
                                        : 'Share your part of the story…'
                                }
                                disabled={sending}
                            />
                            <div className="story-logs__composer-footer">
                                <span className="text-muted text-small">{composerHint}</span>
                                <button type="submit" className="btn btn-small" disabled={composerDisabled}>
                                    {sending ? 'Sending…' : 'Send to Discord'}
                                </button>
                            </div>
                        </form>
                    )}
                    {isScribe && personaStatusList.length > 0 && (
                        <div className="story-logs__persona-statuses">
                            {personaStatusList.map((status) => (
                                <div
                                    key={status.requestId}
                                    className={`story-logs__persona-status story-logs__persona-status--${status.status}`}
                                >
                                    <span className="story-logs__persona-status-text">
                                        {describePersonaStatus(status)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    {!data.enabled ? (
                        <div className="story-logs__empty">
                            {phase === 'missing_token' ? (
                                <p className="text-muted">
                                    The server administrator must supply a Discord bot token before story syncing can run.
                                </p>
                            ) : phase === 'unconfigured' ? (
                                <p className="text-muted">
                                    Link this campaign to a Discord channel from Campaign Settings to start syncing the story log.
                                </p>
                            ) : (
                                <p className="text-muted">{error || 'Discord sync is inactive for this campaign.'}</p>
                            )}
                        </div>
                    ) : hasMessages ? (
                        <div className="story-logs__body">
                            {channelTopic && <p className="text-muted story-logs__topic">{channelTopic}</p>}
                            <div className="story-logs__messages" ref={messagesRef}>
                                {data.messages.map((msg) => {
                                    const msgRelative = formatRelative(msg.createdAt);
                                    const msgAbsolute = formatTimestamp(msg.createdAt);
                                    return (
                                        <article key={msg.id} className="story-logs__message">
                                            <div className="story-logs__avatar">
                                                {msg.author?.avatarUrl ? (
                                                    <img
                                                        src={msg.author.avatarUrl}
                                                        alt={msg.author?.displayName || 'Avatar'}
                                                    />
                                                ) : (
                                                    <span>{(msg.author?.displayName || '?').slice(0, 1)}</span>
                                                )}
                                            </div>
                                            <div className="story-logs__message-body">
                                                <header className="story-logs__message-header">
                                                    <div className="story-logs__message-meta">
                                                        <span className="story-logs__author">{msg.author?.displayName || 'Unknown'}</span>
                                                        {msg.author?.bot && <span className="pill warn">BOT</span>}
                                                        {msgAbsolute && (
                                                            <time
                                                                className="story-logs__timestamp"
                                                                dateTime={msg.createdAt || undefined}
                                                                title={msgAbsolute}
                                                            >
                                                                {msgRelative || msgAbsolute}
                                                            </time>
                                                        )}
                                                    </div>
                                                    {isDM && msg.id && (
                                                        <button
                                                            type="button"
                                                            className="story-logs__delete"
                                                            onClick={() => handleDeleteMessage(msg.id)}
                                                            disabled={deletingId === msg.id}
                                                        >
                                                            {deletingId === msg.id ? 'Deleting…' : 'Delete'}
                                                        </button>
                                                    )}
                                                </header>
                                                {msg.content && <MessageMarkdown content={msg.content} />}
                                                {msg.attachments?.length > 0 && (
                                                    <ul className="story-logs__attachments">
                                                        {msg.attachments.map((att) => (
                                                            <li key={att.id}>
                                                                {isImageAttachment(att) ? (
                                                                    <a
                                                                        className="story-logs__image-link"
                                                                        href={att.url}
                                                                        target="_blank"
                                                                        rel="noreferrer noopener"
                                                                    >
                                                                        <img
                                                                            className="story-logs__image"
                                                                            src={att.proxyUrl || att.url}
                                                                            alt={att.name || 'Attachment'}
                                                                        />
                                                                    </a>
                                                                ) : (
                                                                    <a href={att.url} target="_blank" rel="noreferrer noopener">
                                                                        {att.name || 'Attachment'}
                                                                    </a>
                                                                )}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                                {msg.jumpLink && (
                                                    <div className="story-logs__message-footer">
                                                        <a href={msg.jumpLink} target="_blank" rel="noreferrer noopener">
                                                            View in Discord
                                                        </a>
                                                    </div>
                                                )}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="story-logs__empty">
                            <p className="text-muted">
                                No messages synced yet. When players post in the configured Discord channel they will appear here.
                            </p>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

const INLINE_PATTERN =
    /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\*(?!\s)([^*]+?)\*(?!\s)|_(?!\s)([^_]+?)_(?!\s))/g;

function sanitizeLinkHref(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^mailto:/i.test(trimmed)) return trimmed;
    if (/^discord:/i.test(trimmed)) return trimmed;
    return null;
}

function renderInlineSegments(text, keyPrefix) {
    if (!text) return [];
    const nodes = [];
    let remaining = text;
    let index = 0;

    while (remaining.length > 0) {
        INLINE_PATTERN.lastIndex = 0;
        const match = INLINE_PATTERN.exec(remaining);
        if (!match || match.index === undefined) {
            if (remaining) nodes.push(remaining);
            break;
        }
        if (match.index > 0) {
            nodes.push(remaining.slice(0, match.index));
        }
        const full = match[0];
        if (match[2] !== undefined) {
            const href = sanitizeLinkHref(match[3]);
            if (href) {
                nodes.push(
                    <a
                        key={`${keyPrefix}-link-${index}`}
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        {renderInlineSegments(match[2], `${keyPrefix}-link-${index}`)}
                    </a>
                );
            } else {
                nodes.push(match[2]);
            }
        } else if (match[4] !== undefined) {
            nodes.push(
                <strong key={`${keyPrefix}-strong-${index}`}>
                    {renderInlineSegments(match[4], `${keyPrefix}-strong-${index}`)}
                </strong>
            );
        } else if (match[5] !== undefined) {
            nodes.push(
                <strong key={`${keyPrefix}-strongu-${index}`}>
                    {renderInlineSegments(match[5], `${keyPrefix}-strongu-${index}`)}
                </strong>
            );
        } else if (match[6] !== undefined) {
            nodes.push(
                <del key={`${keyPrefix}-del-${index}`}>
                    {renderInlineSegments(match[6], `${keyPrefix}-del-${index}`)}
                </del>
            );
        } else if (match[7] !== undefined) {
            nodes.push(
                <code key={`${keyPrefix}-code-${index}`}>{match[7]}</code>
            );
        } else if (match[8] !== undefined) {
            nodes.push(
                <em key={`${keyPrefix}-em-${index}`}>
                    {renderInlineSegments(match[8], `${keyPrefix}-em-${index}`)}
                </em>
            );
        } else if (match[9] !== undefined) {
            nodes.push(
                <em key={`${keyPrefix}-emu-${index}`}>
                    {renderInlineSegments(match[9], `${keyPrefix}-emu-${index}`)}
                </em>
            );
        } else {
            nodes.push(full);
        }
        remaining = remaining.slice(match.index + full.length);
        index += 1;
    }

    return nodes;
}

function renderInlineWithBreaks(text, keyPrefix) {
    const lines = text.split('\n');
    return lines.flatMap((line, idx) => {
        const parts = renderInlineSegments(line, `${keyPrefix}-${idx}`);
        if (idx === lines.length - 1) {
            return parts;
        }
        return [
            <React.Fragment key={`${keyPrefix}-frag-${idx}`}>{parts}</React.Fragment>,
            <br key={`${keyPrefix}-br-${idx}`} />,
        ];
    });
}

function parseMarkdownBlocks(raw) {
    if (!raw) return [];
    const source = String(raw).replace(/\r\n?/g, '\n');
    const lines = source.split('\n');
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        if (line.startsWith('```')) {
            const language = line.slice(3).trim();
            index += 1;
            const codeLines = [];
            while (index < lines.length && !lines[index].startsWith('```')) {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length && lines[index].startsWith('```')) {
                index += 1;
            }
            blocks.push({ type: 'code', language, content: codeLines.join('\n') });
            continue;
        }

        const chunkLines = [];
        while (index < lines.length && !lines[index].startsWith('```')) {
            chunkLines.push(lines[index]);
            index += 1;
        }
        const chunk = chunkLines.join('\n');
        const segments = chunk.split(/\n{2,}/);
        for (const segment of segments) {
            const trimmed = segment.trim();
            if (!trimmed) continue;
            const segLines = trimmed.split('\n');
            const allTrimmed = segLines.map((ln) => ln.trim());
            const isQuote = allTrimmed.every((ln) => ln === '' || ln.startsWith('>'));
            if (isQuote) {
                const cleaned = segLines
                    .map((ln) => ln.replace(/^>\s?/, '').trim())
                    .join('\n')
                    .split(/\n{2,}/)
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                if (cleaned.length > 0) {
                    blocks.push({ type: 'quote', lines: cleaned });
                }
                continue;
            }
            const isBullet = allTrimmed.every((ln) => ln === '' || /^[-*]\s+/.test(ln));
            if (isBullet) {
                const items = segLines
                    .map((ln) => ln.replace(/^[-*]\s+/, '').trim())
                    .filter(Boolean);
                if (items.length > 0) {
                    blocks.push({ type: 'list', ordered: false, items });
                }
                continue;
            }
            const isOrdered = allTrimmed.every((ln) => ln === '' || /^\d+\.\s+/.test(ln));
            if (isOrdered) {
                const items = segLines
                    .map((ln) => ln.replace(/^\d+\.\s+/, '').trim())
                    .filter(Boolean);
                if (items.length > 0) {
                    blocks.push({ type: 'list', ordered: true, items });
                }
                continue;
            }
            blocks.push({ type: 'paragraph', content: trimmed });
        }
    }

    return blocks;
}

function MessageMarkdown({ content }) {
    const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
    if (blocks.length === 0) return null;

    return (
        <div className="story-logs__markdown">
            {blocks.map((block, index) => {
                const key = `md-block-${index}`;
                if (block.type === 'code') {
                    return (
                        <pre key={key} data-language={block.language || undefined}>
                            <code>{block.content}</code>
                        </pre>
                    );
                }
                if (block.type === 'quote') {
                    return (
                        <blockquote key={key}>
                            {block.lines.map((line, idx) => (
                                <p key={`${key}-line-${idx}`}>{renderInlineWithBreaks(line, `${key}-line-${idx}`)}</p>
                            ))}
                        </blockquote>
                    );
                }
                if (block.type === 'list') {
                    const Tag = block.ordered ? 'ol' : 'ul';
                    return (
                        <Tag key={key}>
                            {block.items.map((item, itemIndex) => (
                                <li key={`${key}-item-${itemIndex}`}>
                                    {renderInlineWithBreaks(item, `${key}-item-${itemIndex}`)}
                                </li>
                            ))}
                        </Tag>
                    );
                }
                return (
                    <p key={key}>{renderInlineWithBreaks(block.content, `${key}-paragraph`)}</p>
                );
            })}
        </div>
    );
}

function PersonaPromptCenter({ realtime }) {
    const prompts = Array.isArray(realtime?.personaPrompts)
        ? realtime.personaPrompts
        : EMPTY_ARRAY;
    const respondPersona = realtime?.respondPersona;
    const sorted = useMemo(() => {
        const list = prompts.slice();
        list.sort((a, b) => {
            const aTime = Date.parse(a?.request?.createdAt || '');
            const bTime = Date.parse(b?.request?.createdAt || '');
            return aTime - bTime;
        });
        return list;
    }, [prompts]);
    const active = sorted[0]?.request || null;
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    const [busy, setBusy] = useState(null);
    useEffect(() => {
        setBusy(null);
    }, [active?.id]);

    if (!active) return null;

    const expiresAt = active.expiresAt ? Date.parse(active.expiresAt) : null;
    const remaining = expiresAt ? expiresAt - now : null;
    const remainingLabel = remaining !== null ? formatDuration(remaining) : null;
    const actionDisabled = !respondPersona || busy !== null;

    const handleRespond = (approve) => {
        if (!respondPersona || !active.id) return;
        setBusy(approve ? 'approve' : 'deny');
        try {
            respondPersona(active.id, approve);
        } catch (err) {
            console.error('Failed to respond to persona prompt', err);
            setBusy(null);
        }
    };

    return (
        <div className="persona-overlay" role="presentation">
            <div className="persona-modal" role="dialog" aria-modal="true" aria-labelledby="persona-modal-title">
                <header className="persona-modal__header">
                    <div>
                        <h3 id="persona-modal-title">
                            {active.scribeName || 'A scribe'} wants to speak as you
                        </h3>
                        {active.gameName && (
                            <p className="text-muted text-small">Campaign: {active.gameName}</p>
                        )}
                    </div>
                    {remainingLabel && (
                        <span className="persona-modal__timer">Time left: {remainingLabel}</span>
                    )}
                </header>
                <div className="persona-modal__body">
                    <p className="text-small">
                        Approve to let {active.scribeName || 'the scribe'} send this update as {active.targetName || 'you'}.
                    </p>
                    <MessageMarkdown content={active.content || ''} />
                </div>
                <div className="persona-modal__actions">
                    <button
                        type="button"
                        className="btn ghost"
                        onClick={() => handleRespond(false)}
                        disabled={actionDisabled}
                    >
                        Deny
                    </button>
                    <button
                        type="button"
                        className="btn"
                        onClick={() => handleRespond(true)}
                        disabled={actionDisabled}
                    >
                        Approve
                    </button>
                </div>
            </div>
        </div>
    );
}

const TRADE_REASON_LABELS = {
    timeout: 'Trade timed out.',
    declined: 'The trade was declined.',
    cancelled: 'The trade was cancelled.',
    game_missing: 'Trade cancelled because the campaign data was unavailable.',
    player_missing: 'Trade cancelled because a participant could not be found.',
};

const MAX_TRADE_ITEMS = 20;

function TradeOverlay({ game, me, realtime }) {
    const trades = Array.isArray(realtime?.tradeSessions)
        ? realtime.tradeSessions
        : EMPTY_ARRAY;
    const actions = realtime?.tradeActions || {};
    const relevant = useMemo(() => {
        const list = trades.filter((trade) => trade?.participants?.[me.id]);
        list.sort((a, b) => {
            const aTime = Date.parse(a?.createdAt || '');
            const bTime = Date.parse(b?.createdAt || '');
            return aTime - bTime;
        });
        return list;
    }, [me.id, trades]);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    if (relevant.length === 0) return null;

    return (
        <div className="trade-overlay" role="presentation">
            {relevant.map((trade) => (
                <TradeWindow key={trade.id} trade={trade} me={me} game={game} actions={actions} now={now} />
            ))}
        </div>
    );
}

function TradeWindow({ trade, me, game, actions, now }) {
    const myId = me.id;
    const partnerId = trade.initiatorId === myId ? trade.partnerId : trade.initiatorId;
    const partnerParticipant = trade.participants?.[partnerId];
    const partnerName = partnerParticipant?.name || 'Partner';
    const status = trade.status || 'active';
    const myOffer = useMemo(
        () => (Array.isArray(trade.offers?.[myId]) ? trade.offers[myId] : []),
        [myId, trade.offers]
    );
    const partnerOffer = useMemo(
        () => (Array.isArray(trade.offers?.[partnerId]) ? trade.offers[partnerId] : []),
        [partnerId, trade.offers]
    );
    const myOfferMap = useMemo(() => {
        const map = new Map();
        for (const entry of myOffer) {
            if (entry?.itemId) map.set(entry.itemId, entry);
        }
        return map;
    }, [myOffer]);

    const myPlayer = useMemo(
        () => (Array.isArray(game.players) ? game.players.find((p) => p?.userId === myId) || null : null),
        [game.players, myId]
    );
    const myInventory = useMemo(
        () => (Array.isArray(myPlayer?.inventory) ? myPlayer.inventory : []),
        [myPlayer?.inventory]
    );
    const inventoryMap = useMemo(() => {
        const map = new Map();
        for (const item of myInventory) {
            if (item?.id) map.set(item.id, item);
        }
        return map;
    }, [myInventory]);

    const [draft, setDraft] = useState(() =>
        myOffer.map((entry) => ({
            itemId: entry.itemId,
            quantity: clampQuantity(entry.quantity),
        }))
    );
    const [dirty, setDirty] = useState(false);
    const [picker, setPicker] = useState('');

    useEffect(() => {
        setDraft(
            myOffer.map((entry) => ({
                itemId: entry.itemId,
                quantity: clampQuantity(entry.quantity),
            }))
        );
        setDirty(false);
        setPicker('');
    }, [trade.id, myOffer]);

    useEffect(() => {
        if (dirty) return;
        const remote = myOffer.map((entry) => ({
            itemId: entry.itemId,
            quantity: clampQuantity(entry.quantity),
        }));
        setDraft((prev) => (offersEqual(prev, remote) ? prev : remote));
    }, [dirty, myOffer]);

    useEffect(() => {
        if (!dirty) return;
        const remote = myOffer.map((entry) => ({
            itemId: entry.itemId,
            quantity: clampQuantity(entry.quantity),
        }));
        if (offersEqual(draft, remote)) {
            setDirty(false);
        }
    }, [dirty, draft, myOffer]);

    const expiresAt = trade.expiresAt ? Date.parse(trade.expiresAt) : null;
    const timeLeft = expiresAt ? formatDuration(expiresAt - now) : null;
    const myConfirmed = !!trade.confirmations?.[myId];
    const partnerConfirmed = !!trade.confirmations?.[partnerId];
    const tradeNote = typeof trade.note === 'string' ? trade.note.trim() : '';

    const availableOptions = useMemo(() => {
        return myInventory.filter((item) => {
            if (!item?.id) return false;
            const max = getItemMaxQuantity(inventoryMap, item.id);
            if (max <= 0) return false;
            const offered = draft.find((entry) => entry.itemId === item.id)?.quantity || 0;
            return offered < max;
        });
    }, [draft, inventoryMap, myInventory]);

    const handleAddItem = useCallback(
        (itemId) => {
            if (!itemId) return;
            setDraft((prev) => {
                if (prev.length >= MAX_TRADE_ITEMS) return prev;
                const max = getItemMaxQuantity(inventoryMap, itemId);
                if (max <= 0) return prev;
                const index = prev.findIndex((entry) => entry.itemId === itemId);
                if (index >= 0) {
                    const existing = prev[index];
                    const nextQty = Math.min(max, clampQuantity((existing.quantity || 0) + 1, max));
                    if (nextQty === existing.quantity) return prev;
                    const copy = [...prev];
                    copy[index] = { ...existing, quantity: nextQty };
                    return copy;
                }
                return [...prev, { itemId, quantity: 1 }];
            });
            setDirty(true);
        },
        [inventoryMap]
    );

    const handleQuantityChange = useCallback(
        (itemId, value) => {
            setDraft((prev) => {
                const index = prev.findIndex((entry) => entry.itemId === itemId);
                if (index < 0) return prev;
                const max = getItemMaxQuantity(inventoryMap, itemId) || 9999;
                const nextQty = clampQuantity(value, max || 9999);
                if (nextQty === prev[index].quantity) return prev;
                const copy = [...prev];
                copy[index] = { ...prev[index], quantity: nextQty };
                return copy;
            });
            setDirty(true);
        },
        [inventoryMap]
    );

    const handleRemove = useCallback((itemId) => {
        setDraft((prev) => prev.filter((entry) => entry.itemId !== itemId));
        setDirty(true);
    }, []);

    const handleApply = useCallback(() => {
        if (!actions.updateOffer) return;
        const payload = draft
            .map((entry) => {
                const max = getItemMaxQuantity(inventoryMap, entry.itemId) || entry.quantity;
                return {
                    itemId: entry.itemId,
                    quantity: clampQuantity(entry.quantity, max || 9999),
                };
            })
            .filter((entry) => entry.itemId);
        actions.updateOffer(trade.id, payload);
        setDirty(false);
    }, [actions, draft, inventoryMap, trade.id]);

    const handleConfirm = useCallback(() => {
        actions.confirm?.(trade.id);
    }, [actions, trade.id]);

    const handleUnconfirm = useCallback(() => {
        actions.unconfirm?.(trade.id);
    }, [actions, trade.id]);

    const handleCancel = useCallback(() => {
        actions.cancel?.(trade.id);
    }, [actions, trade.id]);

    const handleAccept = useCallback(() => {
        actions.respond?.(trade.id, true);
    }, [actions, trade.id]);

    const handleDecline = useCallback(() => {
        actions.respond?.(trade.id, false);
    }, [actions, trade.id]);

    const handleDismiss = useCallback(() => {
        actions.dismiss?.(trade.id);
    }, [actions, trade.id]);

    const disableConfirm = dirty || !actions.confirm;

    if (status === 'awaiting-partner') {
        const awaitingPartner = trade.partnerId === myId;
        return (
            <div className="trade-window" role="dialog" aria-modal="true">
                <header className="trade-window__header">
                    <h3>Trade request from {trade.participants?.[trade.initiatorId]?.name || 'Player'}</h3>
                    {timeLeft && <span className="trade-window__timer">Respond within {timeLeft}</span>}
                </header>
                <div className="trade-window__body">
                    {tradeNote && <p className="trade-window__note">“{tradeNote}”</p>}
                    {awaitingPartner ? (
                        <p>{trade.participants?.[trade.initiatorId]?.name || 'A player'} wants to trade items with you.</p>
                    ) : (
                        <p>Waiting for {partnerName} to accept the trade request…</p>
                    )}
                </div>
                <div className="trade-window__actions trade-window__actions--invite">
                    {awaitingPartner ? (
                        <>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={handleDecline}
                                disabled={!actions.respond}
                            >
                                Decline
                            </button>
                            <button
                                type="button"
                                className="btn"
                                onClick={handleAccept}
                                disabled={!actions.respond}
                            >
                                Accept trade
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={handleCancel}
                            disabled={!actions.cancel}
                        >
                            Cancel request
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (status !== 'active') {
        const completed = status === 'completed';
        const reasonText = trade.reason ? TRADE_REASON_LABELS[trade.reason] || trade.reason : null;
        return (
            <div className="trade-window" role="dialog" aria-modal="true">
                <header className="trade-window__header">
                    <h3>{completed ? 'Trade complete' : 'Trade closed'}</h3>
                </header>
                <div className="trade-window__body">
                    <p className="trade-window__message">
                        {completed ? `Your trade with ${partnerName} finished successfully.` : reasonText || 'The trade ended.'}
                    </p>
                </div>
                <div className="trade-window__actions">
                    <button type="button" className="btn" onClick={handleDismiss} disabled={!actions.dismiss}>
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="trade-window" role="dialog" aria-modal="true">
            <header className="trade-window__header">
                <div>
                    <h3>Trading with {partnerName}</h3>
                    {tradeNote && <p className="trade-window__note">“{tradeNote}”</p>}
                </div>
                {timeLeft && <span className="trade-window__timer">Expires in {timeLeft}</span>}
            </header>
            <div className="trade-window__columns">
                <div className="trade-window__column">
                    <h4>Your offer</h4>
                    {dirty && (
                        <p className="trade-window__warning text-small">Apply your changes before confirming.</p>
                    )}
                    <div className="trade-offer">
                        {draft.length > 0 ? (
                            draft.map((entry) => {
                                const item = inventoryMap.get(entry.itemId) || myOfferMap.get(entry.itemId) || {};
                                const label = item.name || 'Item';
                                const type = item.type || '';
                                const desc = item.desc || '';
                                const max = getItemMaxQuantity(inventoryMap, entry.itemId) || undefined;
                                return (
                                    <div key={entry.itemId} className="trade-offer__row">
                                        <div className="trade-offer__info">
                                            <div className="trade-offer__name">{label}</div>
                                            <div className="trade-offer__meta">
                                                {type && <span className="pill">{type}</span>}
                                                {typeof max === 'number' && Number.isFinite(max) && (
                                                    <span className="text-muted text-tiny">Inventory: {max}</span>
                                                )}
                                            </div>
                                            {desc && <p className="trade-offer__desc text-small">{desc}</p>}
                                        </div>
                                        <div className="trade-offer__controls">
                                            <label className="text-tiny" htmlFor={`trade-${trade.id}-${entry.itemId}`}>
                                                Qty
                                            </label>
                                            <input
                                                id={`trade-${trade.id}-${entry.itemId}`}
                                                type="number"
                                                min={1}
                                                max={max || undefined}
                                                value={entry.quantity}
                                                onChange={(e) => handleQuantityChange(entry.itemId, e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                className="btn ghost btn-small"
                                                onClick={() => handleRemove(entry.itemId)}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <p className="trade-offer__empty text-muted">No items offered yet.</p>
                        )}
                    </div>
                    <div className="trade-offer__picker">
                        <label htmlFor={`trade-picker-${trade.id}`} className="text-small">
                            Add from inventory
                        </label>
                        <select
                            id={`trade-picker-${trade.id}`}
                            value={picker}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (value) {
                                    handleAddItem(value);
                                    setPicker('');
                                } else {
                                    setPicker('');
                                }
                            }}
                        >
                            <option value="">Select an item…</option>
                            {availableOptions.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name || 'Item'}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="trade-offer__footer">
                        <button
                            type="button"
                            className="btn secondary"
                            onClick={handleApply}
                            disabled={!actions.updateOffer || !dirty}
                        >
                            Save offer
                        </button>
                    </div>
                </div>
                <div className="trade-window__column trade-window__column--partner">
                    <h4>{partnerName}'s offer</h4>
                    <div className="trade-offer">
                        {partnerOffer.length > 0 ? (
                            partnerOffer.map((entry) => (
                                <div key={entry.itemId} className="trade-offer__row">
                                    <div className="trade-offer__info">
                                        <div className="trade-offer__name">{entry.name || 'Item'}</div>
                                        <div className="trade-offer__meta">
                                            {entry.type && <span className="pill">{entry.type}</span>}
                                            <span className="pill">x{entry.quantity || 1}</span>
                                        </div>
                                        {entry.desc && <p className="trade-offer__desc text-small">{entry.desc}</p>}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="trade-offer__empty text-muted">No items offered yet.</p>
                        )}
                    </div>
                </div>
            </div>
            <footer className="trade-window__footer">
                <div className="trade-window__status">
                    <span className={`pill ${myConfirmed ? 'success' : ''}`}>
                        {myConfirmed ? 'You confirmed' : 'Awaiting your confirmation'}
                    </span>
                    <span className={`pill ${partnerConfirmed ? 'success' : ''}`}>
                        {partnerConfirmed ? `${partnerName} confirmed` : `${partnerName} reviewing`}
                    </span>
                </div>
                <div className="trade-window__actions">
                    <button
                        type="button"
                        className="btn ghost"
                        onClick={handleCancel}
                        disabled={!actions.cancel}
                    >
                        Cancel trade
                    </button>
                    {myConfirmed ? (
                        <button
                            type="button"
                            className="btn secondary"
                            onClick={handleUnconfirm}
                            disabled={!actions.unconfirm}
                        >
                            Unconfirm
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="btn"
                            onClick={handleConfirm}
                            disabled={disableConfirm}
                        >
                            Confirm trade
                        </button>
                    )}
                </div>
            </footer>
        </div>
    );
}

function offersEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i].itemId !== b[i].itemId) return false;
        if (clampQuantity(a[i].quantity) !== clampQuantity(b[i].quantity)) return false;
    }
    return true;
}

function clampQuantity(value, max = 9999) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 1;
    const rounded = Math.round(num);
    return Math.max(1, Math.min(max, rounded));
}

function getItemMaxQuantity(inventoryMap, itemId) {
    const item = inventoryMap.get(itemId);
    if (!item) return 0;
    const amount = Number(item.amount);
    if (!Number.isFinite(amount)) return 0;
    return Math.max(0, Math.round(amount));
}

function formatDuration(ms) {
    if (!Number.isFinite(ms)) return '';
    const clamped = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    if (minutes > 0) {
        return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
    }
    return `${seconds}s`;
}

function readCombatSkillBucket(collection, ownerId, dmId) {
    if (!collection) return [];
    if (Array.isArray(collection)) {
        if (ownerId && dmId && ownerId === dmId) {
            return collection;
        }
        return [];
    }
    if (!ownerId) {
        const dmBucket = dmId && collection && typeof collection === 'object' ? collection[dmId] : null;
        return Array.isArray(dmBucket) ? dmBucket : [];
    }
    if (collection && typeof collection === 'object') {
        const bucket = collection[ownerId];
        if (Array.isArray(bucket)) return bucket;
    }
    return [];
}

// ---------- Items ----------

function CombatSkillsTab({ game, me, onUpdate }) {
    const isDM = idsMatch(game.dmId, me.id);
    const abilityDefault = ABILITY_DEFS[0]?.key || "INT";
    const ownerOptions = useMemo(() => {
        const options = [];
        const seen = new Set();
        const addOption = (value, label) => {
            if (!value || seen.has(value)) return;
            seen.add(value);
            options.push({ value, label });
        };
        const players = Array.isArray(game.players) ? game.players.filter(Boolean) : [];
        if (isDM && typeof game.dmId === "string" && game.dmId) {
            const dmLabel = idsMatch(game.dmId, me.id)
                ? `You (${me.username || "Dungeon Master"})`
                : "Dungeon Master";
            addOption(game.dmId, dmLabel);
        }
        for (const player of players) {
            if (!player?.userId) continue;
            if (!isDM && player.userId !== me.id) continue;
            const baseLabel = describePlayerName(player);
            const label = player.userId === me.id ? `You (${baseLabel})` : baseLabel;
            addOption(player.userId, label);
        }
        if (!isDM && me?.id && !seen.has(me.id)) {
            const fallbackLabel = me.username ? `You (${me.username})` : "You";
            addOption(me.id, fallbackLabel);
        }
        return options;
    }, [game.dmId, game.players, isDM, me?.id, me?.username]);
    const defaultOwnerId = useMemo(() => {
        if (ownerOptions.length > 0) return ownerOptions[0].value;
        if (isDM && typeof game.dmId === "string" && game.dmId) return game.dmId;
        if (me?.id) return me.id;
        return "";
    }, [game.dmId, isDM, me?.id, ownerOptions]);
    const [activeOwnerId, setActiveOwnerId] = useState(defaultOwnerId);
    useEffect(() => {
        if (ownerOptions.length === 0) {
            setActiveOwnerId("");
            return;
        }
        setActiveOwnerId((prev) => {
            if (prev && ownerOptions.some((option) => option.value === prev)) {
                return prev;
            }
            return defaultOwnerId;
        });
    }, [defaultOwnerId, ownerOptions]);
    const activeOwnerValue = activeOwnerId || defaultOwnerId;
    const rawCombatSkills = useMemo(
        () => readCombatSkillBucket(game.combatSkills, activeOwnerValue, game.dmId),
        [game.combatSkills, activeOwnerValue, game.dmId],
    );
    const combatSkills = useMemo(() => normalizeCombatSkillDefs(rawCombatSkills), [rawCombatSkills]);
    const worldSkills = useMemo(() => normalizeWorldSkillDefs(game.worldSkills), [game.worldSkills]);
    const demons = useMemo(
        () => (Array.isArray(game.demons) ? game.demons.filter(Boolean) : EMPTY_ARRAY),
        [game.demons]
    );
    const [skillQuery, setSkillQuery] = useState("");
    const [skillSort, setSkillSort] = useState("default");
    const [editingSkillId, setEditingSkillId] = useState(null);
    const [form, setForm] = useState({
        label: "",
        ability: abilityDefault,
        tier: COMBAT_TIER_ORDER[0],
        category: DEFAULT_COMBAT_CATEGORY,
        cost: "",
        notes: "",
        glossaryId: "",
    });
    const [activePane, setActivePane] = useState("library");
    const [busy, setBusy] = useState(false);
    const [rowBusy, setRowBusy] = useState(null);
    const [importBusyId, setImportBusyId] = useState(null);
    const skillLibraryDatalistId = "combat-skill-library-options";
    const viewPrefKey = useMemo(() => {
        const ownerKey = activeOwnerValue || me.id || game.dmId || "owner";
        return `combat-skill-view:${game.id || "game"}:${ownerKey}`;
    }, [activeOwnerValue, game.dmId, game.id, me.id]);
    const [viewPrefs, setViewPrefs] = useState(() => createEmptySkillViewPrefs());
    const [showHiddenSkills, setShowHiddenSkills] = useState(false);
    const canManage = isDM || !!game.permissions?.canEditCombatSkills;

    useEffect(() => {
        setSkillQuery("");
        setSkillSort("default");
        setEditingSkillId(null);
        setForm({
            label: "",
            ability: abilityDefault,
            tier: COMBAT_TIER_ORDER[0],
            category: DEFAULT_COMBAT_CATEGORY,
            cost: "",
            notes: "",
            glossaryId: "",
        });
        setActivePane("library");
        setShowHiddenSkills(false);
    }, [abilityDefault, activeOwnerValue, game.id]);

    const editingSkill = useMemo(() => {
        if (!editingSkillId || editingSkillId === NEW_COMBAT_SKILL_ID) return null;
        return combatSkills.find((skill) => skill.id === editingSkillId) || null;
    }, [editingSkillId, combatSkills]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const stored = window.localStorage.getItem(viewPrefKey);
            if (!stored) {
                setViewPrefs(createEmptySkillViewPrefs());
                return;
            }
            const parsed = JSON.parse(stored);
            setViewPrefs(sanitizeSkillViewPrefs(parsed));
        } catch (err) {
            console.warn("Failed to load combat skill view preferences", err);
            setViewPrefs(createEmptySkillViewPrefs());
        }
    }, [viewPrefKey]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem(viewPrefKey, JSON.stringify(viewPrefs));
        } catch (err) {
            console.warn("Failed to save combat skill view preferences", err);
        }
    }, [viewPrefKey, viewPrefs]);

    useEffect(() => {
        if (activePane !== "library" && editingSkillId) {
            setEditingSkillId(null);
        }
    }, [activePane, editingSkillId]);

    useEffect(() => {
        if (!canManage && editingSkillId) {
            setEditingSkillId(null);
        }
    }, [canManage, editingSkillId]);

    useEffect(() => {
        setViewPrefs((prev) => {
            if (!prev) return createEmptySkillViewPrefs();
            const validIds = new Set(combatSkills.map((skill) => skill.id));
            const favorites = prev.favorites.filter((id) => validIds.has(id));
            const hidden = prev.hidden.filter((id) => validIds.has(id));
            if (favorites.length === prev.favorites.length && hidden.length === prev.hidden.length) {
                return prev;
            }
            return { favorites, hidden };
        });
    }, [combatSkills]);

    useEffect(() => {
        if (editingSkill) {
            setForm({
                label: editingSkill.label || "",
                ability: ABILITY_KEY_SET.has(editingSkill.ability) ? editingSkill.ability : abilityDefault,
                tier: COMBAT_TIER_ORDER.includes(editingSkill.tier) ? editingSkill.tier : COMBAT_TIER_ORDER[0],
                category: normalizeCombatCategoryValue(editingSkill.category),
                cost: editingSkill.cost || "",
                notes: editingSkill.notes || "",
                glossaryId:
                    typeof editingSkill.glossaryId === "string" && editingSkill.glossaryId.trim()
                        ? editingSkill.glossaryId.trim()
                        : "",
            });
        } else {
            setForm((prev) =>
                prev.label === "" &&
                prev.ability === abilityDefault &&
                prev.tier === COMBAT_TIER_ORDER[0] &&
                prev.category === DEFAULT_COMBAT_CATEGORY &&
                prev.cost === "" &&
                prev.notes === "" &&
                prev.glossaryId === ""
                    ? prev
                    : {
                          label: "",
                          ability: abilityDefault,
                          tier: COMBAT_TIER_ORDER[0],
                          category: DEFAULT_COMBAT_CATEGORY,
                          cost: "",
                          notes: "",
                          glossaryId: "",
                      }
            );
        }
    }, [editingSkill, abilityDefault]);

    const favoriteSkillIds = useMemo(() => new Set(viewPrefs.favorites), [viewPrefs.favorites]);
    const hiddenSkillIds = useMemo(() => new Set(viewPrefs.hidden), [viewPrefs.hidden]);
    const selectedGlossary = useMemo(() => {
        if (typeof form.glossaryId !== "string" || !form.glossaryId.trim()) return null;
        return findCombatSkillById(form.glossaryId.trim()) || null;
    }, [form.glossaryId]);

    const filteredSkills = useMemo(() => {
        const q = skillQuery.trim().toLowerCase();
        let list = combatSkills.slice();
        if (q) {
            list = list.filter((skill) => {
                const label = skill.label.toLowerCase();
                const ability = skill.ability.toLowerCase();
                const tierLabel = COMBAT_TIER_LABELS[skill.tier]?.toLowerCase() || "";
                const categoryLabel = COMBAT_CATEGORY_LABELS[skill.category]?.toLowerCase() || "";
                const notes = (skill.notes || "").toLowerCase();
                const cost = (skill.cost || "").toLowerCase();
                return (
                    label.includes(q) ||
                    ability.includes(q) ||
                    tierLabel.includes(q) ||
                    categoryLabel.includes(q) ||
                    notes.includes(q) ||
                    cost.includes(q)
                );
            });
        }
        const comparator = COMBAT_SKILL_SORTERS[skillSort] || null;
        if (comparator) list.sort(comparator);
        return list;
    }, [combatSkills, skillQuery, skillSort]);

    const visibleSkills = useMemo(() => {
        const list = filteredSkills.filter((skill) => !hiddenSkillIds.has(skill.id));
        if (favoriteSkillIds.size === 0) return list;
        const favorites = [];
        const rest = [];
        list.forEach((skill) => {
            if (favoriteSkillIds.has(skill.id)) {
                favorites.push(skill);
            } else {
                rest.push(skill);
            }
        });
        return favorites.concat(rest);
    }, [favoriteSkillIds, filteredSkills, hiddenSkillIds]);

    const displaySkills = useMemo(() => {
        if (!editingSkill) return visibleSkills;
        if (visibleSkills.some((skill) => skill.id === editingSkill.id)) return visibleSkills;
        return [editingSkill, ...visibleSkills];
    }, [editingSkill, visibleSkills]);

    const hiddenSkills = useMemo(
        () => combatSkills.filter((skill) => hiddenSkillIds.has(skill.id)),
        [combatSkills, hiddenSkillIds]
    );

    useEffect(() => {
        if (hiddenSkills.length === 0) {
            setShowHiddenSkills(false);
        }
    }, [hiddenSkills.length]);

    const hasFilters = skillQuery.trim().length > 0 || skillSort !== "default";

    const toggleFavoriteSkill = useCallback((skillId) => {
        if (!skillId) return;
        setViewPrefs((prev) => {
            const favorites = new Set(prev.favorites);
            if (favorites.has(skillId)) {
                favorites.delete(skillId);
            } else {
                favorites.add(skillId);
            }
            const nextFavorites = Array.from(favorites);
            if (
                nextFavorites.length === prev.favorites.length &&
                nextFavorites.every((id, index) => id === prev.favorites[index])
            ) {
                return prev;
            }
            return { favorites: nextFavorites, hidden: prev.hidden };
        });
    }, []);

    const hideSkillFromView = useCallback((skillId) => {
        if (!skillId) return;
        setViewPrefs((prev) => {
            if (prev.hidden.includes(skillId)) return prev;
            return {
                favorites: prev.favorites,
                hidden: [...prev.hidden, skillId],
            };
        });
    }, []);

    const restoreHiddenSkill = useCallback((skillId) => {
        if (!skillId) return;
        setViewPrefs((prev) => {
            if (!prev.hidden.includes(skillId)) return prev;
            const hidden = prev.hidden.filter((id) => id !== skillId);
            return { favorites: prev.favorites, hidden };
        });
    }, []);

    const restoreAllHiddenSkills = useCallback(() => {
        setViewPrefs((prev) => {
            if (prev.hidden.length === 0) return prev;
            return { favorites: prev.favorites, hidden: [] };
        });
    }, []);

    const playerOptions = useMemo(() => {
        const players = (game.players || []).filter((p) => (p?.role || "").toLowerCase() !== "dm");
        return players
            .filter((p) => isDM || p.userId === me.id)
            .map((p) => {
                const character = normalizeCharacter(p.character, worldSkills);
                const label = character?.name?.trim() || p.username || "Unnamed Adventurer";
                const mods = ABILITY_DEFS.reduce((acc, ability) => {
                    acc[ability.key] = abilityModifier(character?.stats?.[ability.key]);
                    return acc;
                }, {});
                return { value: p.userId || `slot-${label}`, label, mods };
            });
    }, [game.players, isDM, me.id, worldSkills]);

    const startCreate = useCallback(() => {
        if (!canManage) return;
        setActivePane("library");
        setEditingSkillId(NEW_COMBAT_SKILL_ID);
        setForm({
            label: "",
            ability: abilityDefault,
            tier: COMBAT_TIER_ORDER[0],
            category: DEFAULT_COMBAT_CATEGORY,
            cost: "",
            notes: "",
            glossaryId: "",
        });
    }, [abilityDefault, canManage]);

    const startEdit = useCallback(
        (skill) => {
            if (!canManage) return;
            if (!skill) {
                setEditingSkillId(null);
                return;
            }
            setActivePane("library");
            setEditingSkillId(skill.id);
        },
        [canManage]
    );

    const cancelEdit = useCallback(() => {
        setEditingSkillId(null);
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!canManage) return;
        const label = form.label.trim();
        if (!label) {
            alert("Skill needs a name");
            return;
        }
        const ownerIdForRequest = activeOwnerValue || defaultOwnerId || (isDM ? game.dmId : me.id) || null;
        const payload = {
            label,
            ability: ABILITY_KEY_SET.has(form.ability) ? form.ability : abilityDefault,
            tier: COMBAT_TIER_ORDER.includes(form.tier) ? form.tier : COMBAT_TIER_ORDER[0],
            category: normalizeCombatCategoryValue(form.category),
            cost: form.cost.trim(),
            notes: form.notes.trim(),
        };
        if (typeof form.glossaryId === "string" && form.glossaryId.trim()) {
            payload.glossaryId = form.glossaryId.trim();
        }
        try {
            if (editingSkillId === NEW_COMBAT_SKILL_ID) {
                setBusy(true);
                await Games.addCombatSkill(
                    game.id,
                    payload,
                    ownerIdForRequest ? { userId: ownerIdForRequest } : undefined,
                );
            } else if (editingSkill) {
                setRowBusy(editingSkill.id);
                await Games.updateCombatSkill(
                    game.id,
                    editingSkill.id,
                    payload,
                    ownerIdForRequest ? { userId: ownerIdForRequest } : undefined,
                );
            }
            setEditingSkillId(null);
            await onUpdate?.();
        } catch (err) {
            alert(err?.message || "Failed to save combat skill");
        } finally {
            setBusy(false);
            setRowBusy(null);
        }
    }, [
        abilityDefault,
        activeOwnerValue,
        canManage,
        defaultOwnerId,
        editingSkill,
        editingSkillId,
        form,
        game.dmId,
        game.id,
        isDM,
        me.id,
        onUpdate,
    ]);

    const handleDelete = useCallback(
        async (skill) => {
            if (!canManage || !skill) return;
            const confirmed = confirm(`Delete ${skill.label}? This cannot be undone.`);
            if (!confirmed) return;
            const ownerIdForRequest = activeOwnerValue || defaultOwnerId || (isDM ? game.dmId : me.id) || null;
            try {
                setRowBusy(skill.id);
                await Games.deleteCombatSkill(
                    game.id,
                    skill.id,
                    ownerIdForRequest ? { userId: ownerIdForRequest } : undefined,
                );
                await onUpdate?.();
            } catch (err) {
                alert(err?.message || "Failed to delete combat skill");
            } finally {
                setRowBusy(null);
            }
        },
        [activeOwnerValue, canManage, defaultOwnerId, game.dmId, game.id, isDM, me.id, onUpdate]
    );

    const importGlossarySkill = useCallback(
        async (entry) => {
            if (!canManage || !entry || typeof entry.label !== "string") return;
            const ownerIdForRequest = activeOwnerValue || defaultOwnerId || (isDM ? game.dmId : me.id) || null;
            const payload = {
                label: entry.label,
                ability: ABILITY_KEY_SET.has(entry.ability) ? entry.ability : abilityDefault,
                tier: COMBAT_TIER_ORDER.includes(entry.tier) ? entry.tier : COMBAT_TIER_ORDER[0],
                category: normalizeCombatCategoryValue(entry.category),
                cost: typeof entry.cost === "string" ? entry.cost : "",
                notes: typeof entry.notes === "string" ? entry.notes : "",
                glossaryId: entry.id,
            };
            try {
                setImportBusyId(entry.id);
                await Games.addCombatSkill(
                    game.id,
                    payload,
                    ownerIdForRequest ? { userId: ownerIdForRequest } : undefined,
                );
                await onUpdate?.();
            } catch (err) {
                alert(err?.message || "Failed to import skill");
            } finally {
                setImportBusyId(null);
            }
        },
        [
            abilityDefault,
            activeOwnerValue,
            canManage,
            defaultOwnerId,
            game.dmId,
            game.id,
            isDM,
            me.id,
            onUpdate,
        ]
    );

    const renderSkillEditor = (mode) => {
        const disableSubmit = busy || !canManage || (mode === "edit" && rowBusy === editingSkill?.id);
        const submitLabel = mode === "create" ? "Add skill" : "Save changes";
        const datalistId = `${skillLibraryDatalistId}-${mode}`;
        return (
            <form
                className="combat-skill-editor"
                onSubmit={(evt) => {
                    evt.preventDefault();
                    handleSubmit();
                }}
            >
                <label className="text-small" htmlFor={`${mode}-combat-name`}>
                    Name
                    <input
                        id={`${mode}-combat-name`}
                        type="text"
                        value={form.label}
                        list={datalistId}
                        onChange={(e) => {
                            const nextLabel = e.target.value;
                            setForm((prev) => {
                                const trimmed = nextLabel.trim();
                                const glossary = findCombatSkillByName(trimmed);
                                if (glossary) {
                                    return {
                                        label: glossary.label,
                                        ability: ABILITY_KEY_SET.has(glossary.ability)
                                            ? glossary.ability
                                            : abilityDefault,
                                        tier: COMBAT_TIER_ORDER.includes(glossary.tier)
                                            ? glossary.tier
                                            : COMBAT_TIER_ORDER[0],
                                        category: normalizeCombatCategoryValue(glossary.category),
                                        cost: glossary.cost || "",
                                        notes: glossary.notes || "",
                                        glossaryId: glossary.id,
                                    };
                                }
                                let glossaryId = prev.glossaryId;
                                if (glossaryId) {
                                    const current = findCombatSkillById(glossaryId);
                                    if (!current || current.label.toLowerCase() !== trimmed.toLowerCase()) {
                                        glossaryId = "";
                                    }
                                }
                                return { ...prev, label: nextLabel, glossaryId };
                            });
                        }}
                        disabled={disableSubmit}
                    />
                    <datalist id={datalistId}>
                        {COMBAT_SKILL_LIBRARY.map((entry) => {
                            const optionLabel = `${entry.ability} · ${
                                COMBAT_TIER_LABELS[entry.tier] || entry.tier
                            } · ${COMBAT_CATEGORY_LABELS[entry.category] || entry.category}`;
                            return <option key={entry.id} value={entry.label} label={optionLabel} />;
                        })}
                    </datalist>
                    {selectedGlossary && form.glossaryId === selectedGlossary.id && (
                        <p className="text-small text-muted" style={{ marginTop: 4 }}>
                            Loaded from glossary: {selectedGlossary.label} ({selectedGlossary.ability} ·{' '}
                            {COMBAT_TIER_LABELS[selectedGlossary.tier] || selectedGlossary.tier})
                        </p>
                    )}
                </label>
                <div className="row wrap" style={{ gap: 12 }}>
                    <label className="col text-small">
                        Ability
                        <select
                            value={form.ability}
                            onChange={(e) => setForm((prev) => ({ ...prev, ability: e.target.value }))}
                            disabled={disableSubmit}
                        >
                            {ABILITY_DEFS.map((ability) => (
                                <option key={ability.key} value={ability.key}>
                                    {ability.key} · {ability.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="col text-small">
                        Tier
                        <select
                            value={form.tier}
                            onChange={(e) => setForm((prev) => ({ ...prev, tier: e.target.value }))}
                            disabled={disableSubmit}
                        >
                            {COMBAT_TIER_ORDER.map((tier) => (
                                <option key={tier} value={tier}>
                                    {COMBAT_TIER_LABELS[tier]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="col text-small">
                        Category
                        <select
                            value={form.category}
                            onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                            disabled={disableSubmit}
                        >
                            {COMBAT_CATEGORY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <label className="text-small" htmlFor={`${mode}-combat-cost`}>
                    Cost / resources
                    <input
                        id={`${mode}-combat-cost`}
                        type="text"
                        value={form.cost}
                        onChange={(e) => setForm((prev) => ({ ...prev, cost: e.target.value }))}
                        disabled={disableSubmit}
                    />
                </label>
                <label className="text-small" htmlFor={`${mode}-combat-notes`}>
                    Notes
                    <textarea
                        id={`${mode}-combat-notes`}
                        value={form.notes}
                        rows={3}
                        onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                        disabled={disableSubmit}
                    />
                </label>
                <div className="combat-skill-editor__actions">
                    <button type="submit" className="btn" disabled={disableSubmit}>
                        {disableSubmit ? "…" : submitLabel}
                    </button>
                    <button type="button" className="btn ghost" onClick={cancelEdit} disabled={disableSubmit}>
                        Cancel
                    </button>
                </div>
            </form>
        );
    };

    return (
        <div className="stack-lg combat-skill-tab">
            <div className="card">
                <div className="combat-skill-manager__header">
                    <div>
                        <h3>Combat Skills</h3>
                        <p className="text-muted text-small">
                            Share combat techniques and guide players through the Battle Math quick reference.
                        </p>
                    </div>
                </div>
                <div className="combat-skill-manager__nav" role="tablist" aria-label="Combat skill views">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activePane === "library"}
                        className={`combat-skill-manager__tab${
                            activePane === "library" ? " is-active" : ""
                        }`}
                        onClick={() => setActivePane("library")}
                    >
                        Skill library
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activePane === "codex"}
                        className={`combat-skill-manager__tab${
                            activePane === "codex" ? " is-active" : ""
                        }`}
                        onClick={() => setActivePane("codex")}
                    >
                        Demon codex
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activePane === "reference"}
                        className={`combat-skill-manager__tab${
                            activePane === "reference" ? " is-active" : ""
                        }`}
                        onClick={() => setActivePane("reference")}
                    >
                        Battle Math
                    </button>
                </div>
                {activePane === "library" ? (
                    <>
                        <div className="combat-skill-manager__filters row wrap">
                            {isDM && ownerOptions.length > 0 && (
                                <label className="text-small" style={{ minWidth: 200 }}>
                                    Managing skills for
                                    <select
                                        value={activeOwnerValue}
                                        onChange={(e) => setActiveOwnerId(e.target.value)}
                                    >
                                        {ownerOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            <label className="text-small" style={{ flexGrow: 1 }}>
                                Search
                                <input
                                    type="search"
                                    value={skillQuery}
                                    onChange={(e) => setSkillQuery(e.target.value)}
                                    placeholder="Filter by name, tier, or notes"
                                />
                            </label>
                            <label className="text-small">
                                Sort by
                                <select value={skillSort} onChange={(e) => setSkillSort(e.target.value)}>
                                    {COMBAT_SKILL_SORT_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <button
                                type="button"
                                className="btn ghost btn-small"
                                onClick={() => setShowHiddenSkills((prev) => !prev)}
                                disabled={hiddenSkills.length === 0}
                            >
                                {hiddenSkills.length === 0
                                    ? "No hidden skills"
                                    : showHiddenSkills
                                    ? "Hide hidden list"
                                    : `Show hidden (${hiddenSkills.length})`}
                            </button>
                            {hasFilters && (
                                <button
                                    type="button"
                                    className="btn ghost btn-small"
                                    onClick={() => {
                                        setSkillQuery("");
                                        setSkillSort("default");
                                    }}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div className="combat-skill-grid">
                            {displaySkills.map((skill) => {
                                const isEditing = editingSkill && editingSkill.id === skill.id;
                                const isFavorite = favoriteSkillIds.has(skill.id);
                                return (
                                    <div
                                        key={skill.id}
                                        className={`combat-skill-card${isEditing ? " is-editing" : ""}${
                                            isFavorite ? " is-favorite" : ""
                                        }`}
                                    >
                                        {isEditing ? (
                                            renderSkillEditor("edit")
                                        ) : (
                                            <>
                                                <div className="combat-skill-card__header">
                                                    <div className="combat-skill-card__heading">
                                                        <h4>{skill.label}</h4>
                                                        <div className="combat-skill-card__badges">
                                                            <span className="pill">
                                                                {COMBAT_TIER_LABELS[skill.tier] || "Tier"}
                                                            </span>
                                                            <span className="pill light">{skill.ability} mod</span>
                                                            <span className="pill light">
                                                                {COMBAT_CATEGORY_LABELS[skill.category] || "Other"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="skill-card__toolbar">
                                                        <button
                                                            type="button"
                                                            className={`skill-card__icon-btn skill-card__icon-btn--star${
                                                                isFavorite ? " is-active" : ""
                                                            }`}
                                                            onClick={() => toggleFavoriteSkill(skill.id)}
                                                            aria-pressed={isFavorite}
                                                            aria-label={
                                                                isFavorite
                                                                    ? `Unstar ${skill.label}`
                                                                    : `Star ${skill.label}`
                                                            }
                                                            title={
                                                                isFavorite
                                                                    ? "Unstar to remove from the pinned list"
                                                                    : "Star to pin this skill to the top"
                                                            }
                                                        >
                                                            {isFavorite ? "★" : "☆"}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="skill-card__icon-btn"
                                                            onClick={() => {
                                                                hideSkillFromView(skill.id);
                                                                setShowHiddenSkills(true);
                                                            }}
                                                            disabled={busy || rowBusy === skill.id || isEditing}
                                                            aria-label={`Hide ${skill.label}`}
                                                            title="Hide this skill from the grid"
                                                        >
                                                            Hide
                                                        </button>
                                                    </div>
                                                </div>
                                                {skill.cost && (
                                                    <div className="combat-skill-card__meta text-small">Cost: {skill.cost}</div>
                                                )}
                                                {skill.notes && (
                                                    <p className="combat-skill-card__notes text-small">{skill.notes}</p>
                                                )}
                                                <CombatSkillCalculator skill={skill} playerOptions={playerOptions} />
                                                {canManage && (
                                                    <div className="combat-skill-card__actions">
                                                        <button
                                                            type="button"
                                                            className="btn ghost btn-small"
                                                            onClick={() => startEdit(skill)}
                                                            disabled={busy || rowBusy === skill.id}
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn ghost btn-small"
                                                            onClick={() => handleDelete(skill)}
                                                            disabled={busy || rowBusy === skill.id}
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                            {canManage && (
                                <div
                                    className={`combat-skill-card combat-skill-card--add${
                                        editingSkillId === NEW_COMBAT_SKILL_ID ? " is-editing" : ""
                                    }`}
                                >
                                    {editingSkillId === NEW_COMBAT_SKILL_ID ? (
                                        renderSkillEditor("create")
                                    ) : (
                                        <button
                                            type="button"
                                            className="combat-skill-card__add-btn"
                                            onClick={startCreate}
                                            disabled={busy || !canManage}
                                        >
                                            <span className="combat-skill-card__plus" aria-hidden="true">
                                                +
                                            </span>
                                            <span>New combat skill</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                        {hiddenSkills.length > 0 && (
                            <div className="skill-hidden">
                                <div className="skill-hidden__summary">
                                    <strong>Hidden skills ({hiddenSkills.length})</strong>
                                    <div className="skill-hidden__summary-actions">
                                        <button
                                            type="button"
                                            className="btn ghost btn-small"
                                            onClick={restoreAllHiddenSkills}
                                        >
                                            Restore all
                                        </button>
                                        {showHiddenSkills && (
                                            <button
                                                type="button"
                                                className="btn ghost btn-small"
                                                onClick={() => setShowHiddenSkills(false)}
                                            >
                                                Collapse
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {showHiddenSkills ? (
                                    <ul className="skill-hidden__list">
                                        {hiddenSkills.map((skill) => {
                                            const isFavorite = favoriteSkillIds.has(skill.id);
                                            return (
                                                <li key={skill.id} className="skill-hidden__item">
                                                    <div className="skill-hidden__info">
                                                        <strong>{skill.label}</strong>
                                                        <span className="text-muted text-small">
                                                            {`${COMBAT_TIER_LABELS[skill.tier] || "Tier"} · ${skill.ability} mod`}
                                                        </span>
                                                    </div>
                                                    <div className="skill-hidden__item-actions">
                                                        <button
                                                            type="button"
                                                            className={`skill-card__icon-btn skill-card__icon-btn--star${
                                                                isFavorite ? " is-active" : ""
                                                            }`}
                                                            onClick={() => toggleFavoriteSkill(skill.id)}
                                                            aria-pressed={isFavorite}
                                                            aria-label={
                                                                isFavorite
                                                                    ? `Unstar ${skill.label}`
                                                                    : `Star ${skill.label}`
                                                            }
                                                            title={
                                                                isFavorite
                                                                    ? "Unstar to remove from the pinned list"
                                                                    : "Star to pin this skill to the top"
                                                            }
                                                        >
                                                            {isFavorite ? "★" : "☆"}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn ghost btn-small"
                                                            onClick={() => restoreHiddenSkill(skill.id)}
                                                        >
                                                            Restore
                                                        </button>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                ) : (
                                    <p className="text-muted text-small">
                                        Hidden combat skills stay tucked away until you restore them.
                                    </p>
                                )}
                            </div>
                        )}
                        {displaySkills.length === 0 && hiddenSkills.length > 0 && (
                            <p className="text-muted text-small" style={{ marginTop: 12 }}>
                                Everything is hidden. Use “Show hidden” to bring skills back.
                            </p>
                        )}
                        {displaySkills.length === 0 && hiddenSkills.length === 0 && !canManage && (
                            <p className="text-muted text-small" style={{ marginTop: 12 }}>
                                No combat skills are available yet.
                            </p>
                        )}
                    </>
                ) : activePane === "codex" ? (
                    <CombatSkillCodexPanel
                        demons={demons}
                        skills={combatSkills}
                        onImportSkill={importGlossarySkill}
                        importBusyId={importBusyId}
                        canManage={canManage}
                    />
                ) : (
                    <CombatSkillReferencePanel reference={BATTLE_MATH_REFERENCE} />
                )}
            </div>
        </div>
    );
}

function CombatSkillReferencePanel({ reference = BATTLE_MATH_REFERENCE }) {
    const steps = [
        `Roll accuracy (${reference.accuracy.formula}).`,
        `Resolve damage (${reference.damage.formula}).`,
        "Apply weapon bonuses, weaknesses, resistances, buffs, debuffs, and critical modifiers.",
    ];

    return (
        <div className="combat-reference stack-lg">
            <section className="combat-reference__section">
                <h4>Battle flow</h4>
                <p className="text-small">{reference.overview}</p>
                <ol className="combat-reference__list combat-reference__list--numbered">
                    {steps.map((step, index) => (
                        <li key={index}>{step}</li>
                    ))}
                </ol>
            </section>

            <section className="combat-reference__section">
                <h4>{reference.accuracy.title}</h4>
                <p className="combat-reference__formula">
                    <code>{reference.accuracy.formula}</code>
                </p>
                <ul className="combat-reference__list">
                    {reference.accuracy.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                    ))}
                </ul>
            </section>

            <section className="combat-reference__section">
                <h4>{reference.damage.title}</h4>
                <p className="combat-reference__formula">
                    <code>{reference.damage.formula}</code>
                </p>
                <ul className="combat-reference__list">
                    {reference.damage.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                    ))}
                </ul>
            </section>

            <section className="combat-reference__section">
                <h4>Standard tiers</h4>
                <div className="combat-reference__table-wrapper">
                    <table className="combat-reference__table">
                        <thead>
                            <tr>
                                <th>Tier</th>
                                <th>Example</th>
                                <th>Dice</th>
                                <th>Ability modifier</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reference.tiers.map((tier) => (
                                <tr key={tier.tier}>
                                    <th scope="row">{tier.tier}</th>
                                    <td>{tier.example}</td>
                                    <td>{tier.dice}</td>
                                    <td>{tier.modifier}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="combat-reference__section">
                <h4>Table rulings</h4>
                <ul className="combat-reference__list">
                    {reference.skillNotes.map((note, index) => (
                        <li key={index}>{note}</li>
                    ))}
                </ul>
            </section>
        </div>
    );
}

function CombatSkillCalculator({ skill, playerOptions }) {
    const tierInfo = COMBAT_TIER_INFO[skill.tier] || COMBAT_TIER_INFO.WEAK;
    const options = useMemo(
        () => [{ value: "", label: "Manual entry", mods: {} }, ...playerOptions],
        [playerOptions]
    );
    const [playerId, setPlayerId] = useState(options[0]?.value || "");
    const [modInput, setModInput] = useState("");
    const [modIsManual, setModIsManual] = useState(false);
    const [rollInput, setRollInput] = useState("");
    const [bonusInput, setBonusInput] = useState("");
    const [buffInput, setBuffInput] = useState("1");
    const [critical, setCritical] = useState(false);

    useEffect(() => {
        if (!options.some((option) => option.value === playerId)) {
            setPlayerId(options[0]?.value || "");
        }
    }, [options, playerId]);

    const selected = options.find((option) => option.value === playerId) || options[0];
    const autoMod = selected && selected.value ? selected.mods?.[skill.ability] ?? 0 : 0;

    useEffect(() => {
        if (!selected?.value) return;
        if (modIsManual) return;
        const nextValue = String(autoMod ?? 0);
        if (modInput !== nextValue) {
            setModInput(nextValue);
        }
    }, [selected?.value, autoMod, modIsManual, modInput]);

    const manualModRaw = modInput.trim();
    const manualModValue = Number(modInput);
    const manualModValid = manualModRaw === "" || Number.isFinite(manualModValue);
    const abilityMod = manualModRaw === "" ? autoMod : manualModValue;

    const rollRaw = rollInput.trim();
    const bonusRaw = bonusInput.trim();
    const buffRaw = buffInput.trim();
    const rollValue = rollRaw === "" ? null : Number(rollInput);
    const bonusValue = bonusRaw === "" ? 0 : Number(bonusInput);
    const buffValue = buffRaw === "" ? 1 : Number(buffInput);
    const rollValid = rollRaw === "" || Number.isFinite(rollValue);
    const bonusValid = bonusRaw === "" || Number.isFinite(bonusValue);
    const buffValid = buffRaw === "" || Number.isFinite(buffValue);

    let damage = null;
    if (manualModValid && rollValid && bonusValid && buffValid && rollValue !== null) {
        damage = computeCombatSkillDamage({
            tier: skill.tier,
            abilityMod,
            roll: rollValue,
            bonus: bonusValue,
            buff: buffValue,
            critical,
        });
    }

    const resultTotal = damage ? damage.total : "—";
    const modDisplay = manualModRaw === "" ? autoMod : abilityMod;

    const handleReset = () => {
        setModInput("");
        setModIsManual(false);
        setRollInput("");
        setBonusInput("");
        setBuffInput("1");
        setCritical(false);
    };

    return (
        <div className="combat-calculator">
            {playerOptions.length > 0 && (
                <label className="text-small">
                    Acting player
                    <select
                        value={playerId}
                        onChange={(e) => {
                            const nextId = e.target.value;
                            setPlayerId(nextId);
                            setModIsManual(nextId === "" ? modInput.trim() !== "" : false);
                        }}
                    >
                        {options.map((option) => (
                            <option key={option.value || "__manual"} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            <div className="row wrap" style={{ gap: 12 }}>
                <label className="col text-small">
                    Ability modifier ({skill.ability})
                    <input
                        type="number"
                        value={modInput}
                        placeholder={String(autoMod)}
                        onChange={(e) => {
                            const value = e.target.value;
                            setModInput(value);
                            setModIsManual(value.trim() !== "");
                        }}
                        className={manualModValid ? undefined : "input-error"}
                    />
                </label>
                <label className="col text-small">
                    Roll total ({tierInfo.dice})
                    <input
                        type="number"
                        value={rollInput}
                        placeholder={`Roll ${tierInfo.dice}`}
                        onChange={(e) => setRollInput(e.target.value)}
                        className={rollValid ? undefined : "input-error"}
                    />
                </label>
            </div>
            <div className="row wrap" style={{ gap: 12 }}>
                <label className="col text-small">
                    Bonus damage
                    <input
                        type="number"
                        value={bonusInput}
                        placeholder="0"
                        onChange={(e) => setBonusInput(e.target.value)}
                        className={bonusValid ? undefined : "input-error"}
                    />
                </label>
                <label className="col text-small">
                    Buff multiplier
                    <input
                        type="number"
                        step="0.01"
                        value={buffInput}
                        placeholder="1"
                        onChange={(e) => setBuffInput(e.target.value)}
                        className={buffValid ? undefined : "input-error"}
                    />
                </label>
            </div>
            <label className="checkbox">
                <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
                Critical hit (+75% damage)
            </label>
            <div className="combat-calculator__result">
                <div className="combat-calculator__total">{resultTotal}</div>
                <div className="text-small text-muted">
                    Ask the acting player to roll {tierInfo.dice}. Enter the total above, then round up the result.
                </div>
                {damage && (
                    <div className="text-small text-muted">
                        Roll {damage.baseRoll} + ability ({skill.ability} × {tierInfo.modMultiplier} = {formatModifier(damage.abilityContribution)})
                        {damage.bonus ? ` + bonus ${formatModifier(damage.bonus)}` : ""}
                        {critical ? " → crit ×1.75" : ""}
                        {damage.buffMultiplier !== 1 ? ` → buffs ×${damage.buffMultiplier}` : ""}
                        → round up = {damage.total}
                    </div>
                )}
            </div>
            <div className="combat-calculator__footer">
                <span className="text-small text-muted">Using modifier {formatModifier(modDisplay)}.</span>
                <button type="button" className="btn ghost btn-small" onClick={handleReset}>
                    Clear inputs
                </button>
            </div>
        </div>
    );
}

function CombatSkillCodexPanel({ demons, skills, onImportSkill, importBusyId, canManage }) {
    const demonOptions = useMemo(() => {
        if (!Array.isArray(demons) || demons.length === 0) return EMPTY_ARRAY;
        return demons.map((demon, index) => {
            const value = demon?.id || `demon-${index}`;
            const name = typeof demon?.name === "string" && demon.name.trim() ? demon.name.trim() : `Demon ${index + 1}`;
            const arcana = typeof demon?.arcana === "string" && demon.arcana.trim() ? demon.arcana.trim() : "";
            const alignment = typeof demon?.alignment === "string" && demon.alignment.trim() ? demon.alignment.trim() : "";
            const levelRaw = Number(demon?.level);
            const level = Number.isFinite(levelRaw) ? levelRaw : null;
            const label = arcana ? `${name} · ${arcana}` : name;
            return { value, demon, label, name, arcana, alignment, level };
        });
    }, [demons]);

    const [selectedId, setSelectedId] = useState(() => demonOptions[0]?.value || "");

    useEffect(() => {
        if (demonOptions.length === 0) {
            setSelectedId("");
            return;
        }
        if (!demonOptions.some((option) => option.value === selectedId)) {
            setSelectedId(demonOptions[0].value);
        }
    }, [demonOptions, selectedId]);

    const activeMeta = useMemo(
        () => demonOptions.find((option) => option.value === selectedId) || null,
        [demonOptions, selectedId]
    );
    const activeDemon = activeMeta?.demon || null;

    const [query, setQuery] = useState("");

    useEffect(() => {
        setQuery("");
    }, [selectedId]);

    const demonSkillList = useMemo(() => getDemonSkillList(activeDemon), [activeDemon]);
    const librarySkillMap = useMemo(() => {
        if (!Array.isArray(skills) || skills.length === 0) return new Map();
        const map = new Map();
        for (const skill of skills) {
            if (!skill || typeof skill.label !== "string") continue;
            map.set(skill.label.toLowerCase(), skill);
        }
        return map;
    }, [skills]);
    const glossaryMatches = useMemo(() => {
        if (demonSkillList.length === 0) return EMPTY_ARRAY;
        const seen = new Set();
        const matches = [];
        for (const label of demonSkillList) {
            if (typeof label !== "string" || !label.trim()) continue;
            const lower = label.toLowerCase();
            if (seen.has(lower)) continue;
            seen.add(lower);
            const librarySkill = librarySkillMap.get(lower) || null;
            const glossary = findCombatSkillByName(label);
            matches.push({ label, lower, librarySkill, glossary });
        }
        return matches;
    }, [demonSkillList, librarySkillMap]);
    const matchedSkills = useMemo(() => {
        if (glossaryMatches.length === 0) return EMPTY_ARRAY;
        return glossaryMatches
            .map((entry) => entry.librarySkill)
            .filter((skill) => skill && typeof skill === "object");
    }, [glossaryMatches]);
    const glossarySuggestions = useMemo(() => {
        if (glossaryMatches.length === 0) return EMPTY_ARRAY;
        return glossaryMatches.filter((entry) => entry.glossary && !entry.librarySkill);
    }, [glossaryMatches]);
    const unmatchedSkills = useMemo(() => {
        if (glossaryMatches.length === 0) return EMPTY_ARRAY;
        return glossaryMatches
            .filter((entry) => !entry.librarySkill && !entry.glossary)
            .map((entry) => entry.label);
    }, [glossaryMatches]);
    const filteredSkills = useMemo(() => {
        if (matchedSkills.length === 0) return matchedSkills;
        const term = query.trim().toLowerCase();
        if (!term) return matchedSkills;
        return matchedSkills.filter((skill) => {
            const tierLabel = (COMBAT_TIER_LABELS[skill.tier] || "").toLowerCase();
            const categoryLabel = (COMBAT_CATEGORY_LABELS[skill.category] || "").toLowerCase();
            const notes = (skill.notes || "").toLowerCase();
            const cost = (skill.cost || "").toLowerCase();
            return (
                skill.label.toLowerCase().includes(term) ||
                skill.ability.toLowerCase().includes(term) ||
                tierLabel.includes(term) ||
                categoryLabel.includes(term) ||
                notes.includes(term) ||
                cost.includes(term)
            );
        });
    }, [matchedSkills, query]);
    const filteredSuggestions = useMemo(() => {
        if (glossarySuggestions.length === 0) return EMPTY_ARRAY;
        const term = query.trim().toLowerCase();
        if (!term) return glossarySuggestions;
        return glossarySuggestions.filter((entry) => {
            const { label, glossary } = entry;
            if (!glossary) return label.toLowerCase().includes(term);
            const tierLabel = (COMBAT_TIER_LABELS[glossary.tier] || "").toLowerCase();
            const categoryLabel = (COMBAT_CATEGORY_LABELS[glossary.category] || "").toLowerCase();
            const notes = (glossary.notes || "").toLowerCase();
            const cost = (glossary.cost || "").toLowerCase();
            return (
                label.toLowerCase().includes(term) ||
                glossary.ability.toLowerCase().includes(term) ||
                tierLabel.includes(term) ||
                categoryLabel.includes(term) ||
                notes.includes(term) ||
                cost.includes(term)
            );
        });
    }, [glossarySuggestions, query]);

    if (demonOptions.length === 0) {
        return (
            <div className="combat-codex__empty text-muted text-small">
                Add demons to your roster to explore their combat skills.
            </div>
        );
    }

    const displayName = activeMeta?.name || activeMeta?.label || "Selected demon";
    const levelLabel = typeof activeMeta?.level === "number" ? `Lv ${activeMeta.level}` : null;

    return (
        <div className="combat-codex">
            <div className="combat-codex__controls">
                <label className="text-small combat-codex__control">
                    Demon
                    <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                        {demonOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                {(matchedSkills.length > 0 || glossarySuggestions.length > 0) && (
                    <label className="text-small combat-codex__control">
                        Filter skills
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search by name, ability, or notes"
                        />
                    </label>
                )}
            </div>
            {activeDemon ? (
                <div className="combat-codex__content">
                    <div className="combat-codex__summary">
                        <h4>{displayName}</h4>
                        <div className="combat-codex__meta">
                            {levelLabel && <span className="pill">{levelLabel}</span>}
                            {activeMeta?.arcana && <span className="pill light">{activeMeta.arcana}</span>}
                            {activeMeta?.alignment && <span className="pill light">{activeMeta.alignment}</span>}
                        </div>
                        {demonSkillList.length === 0 ? (
                            <p className="text-small text-muted">This demon does not list any combat skills yet.</p>
                        ) : (
                            <>
                                {matchedSkills.length > 0 ? (
                                    <p className="text-small text-muted">
                                        Showing {filteredSkills.length} of {matchedSkills.length} linked skills from the shared
                                        library.
                                    </p>
                                ) : (
                                    <p className="text-small text-muted">
                                        No shared combat skills match these names yet.
                                    </p>
                                )}
                                {glossarySuggestions.length > 0 && (
                                    <p className="text-small text-muted">
                                        {glossarySuggestions.length} glossary match
                                        {glossarySuggestions.length === 1 ? " is" : "es are"} available to import.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                    {matchedSkills.length > 0 ? (
                        <div className="combat-codex__skills">
                            {filteredSkills.length > 0 ? (
                                filteredSkills.map((skill) => (
                                    <article key={skill.id} className="demon-skill-modal__item">
                                        <div className="demon-skill-modal__item-header">
                                            <h4>{skill.label}</h4>
                                            <div className="demon-skill-modal__badges">
                                                <span className="pill">{COMBAT_TIER_LABELS[skill.tier] || "Tier"}</span>
                                                <span className="pill light">{skill.ability} mod</span>
                                                <span className="pill light">{COMBAT_CATEGORY_LABELS[skill.category] || "Other"}</span>
                                            </div>
                                        </div>
                                        {skill.cost && <div className="text-small">Cost: {skill.cost}</div>}
                                        {skill.notes && <p className="text-small">{skill.notes}</p>}
                                    </article>
                                ))
                            ) : (
                                <div className="combat-codex__empty text-small text-muted">
                                    No combat skills match that filter.
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="combat-codex__empty text-small text-muted">
                            {demonSkillList.length === 0
                                ? "This demon does not list any combat skills yet."
                                : "No combat skills in the codex match these names."}
                        </div>
                    )}
                    {glossarySuggestions.length > 0 && (
                        <div className="combat-codex__skills combat-codex__skills--suggestions">
                            <h5 className="text-small" style={{ margin: "12px 0 8px" }}>
                                Glossary suggestions
                            </h5>
                            {filteredSuggestions.length > 0 ? (
                                filteredSuggestions.map((entry) => {
                                    const { glossary, label } = entry;
                                    if (!glossary) return null;
                                    const importDisabled =
                                        !canManage || typeof onImportSkill !== "function" || importBusyId === glossary.id;
                                    return (
                                        <article key={glossary.id} className="demon-skill-modal__item">
                                            <div className="demon-skill-modal__item-header">
                                                <h4>{glossary.label}</h4>
                                                <div className="demon-skill-modal__badges">
                                                    <span className="pill">
                                                        {COMBAT_TIER_LABELS[glossary.tier] || "Tier"}
                                                    </span>
                                                    <span className="pill light">{glossary.ability} mod</span>
                                                    <span className="pill light">
                                                        {COMBAT_CATEGORY_LABELS[glossary.category] || "Other"}
                                                    </span>
                                                </div>
                                            </div>
                                            {glossary.cost && <div className="text-small">Cost: {glossary.cost}</div>}
                                            {glossary.notes && <p className="text-small">{glossary.notes}</p>}
                                            <div className="demon-skill-modal__actions">
                                                {canManage ? (
                                                    <button
                                                        type="button"
                                                        className="btn ghost btn-small"
                                                        onClick={() => onImportSkill?.(glossary)}
                                                        disabled={importDisabled}
                                                    >
                                                        {importBusyId === glossary.id ? "Importing…" : "Import skill"}
                                                    </button>
                                                ) : (
                                                    <span className="text-small text-muted">
                                                        Ask the DM to import this skill.
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-small text-muted" style={{ marginTop: 4 }}>
                                                Listed as {label} in the demon entry.
                                            </div>
                                        </article>
                                    );
                                })
                            ) : (
                                <div className="combat-codex__empty text-small text-muted">
                                    No glossary suggestions match that filter.
                                </div>
                            )}
                        </div>
                    )}
                    {unmatchedSkills.length > 0 && (
                        <div className="combat-codex__unmatched text-small">
                            <strong>Unrecognized skills:</strong> {unmatchedSkills.join(", ")}
                        </div>
                    )}
                </div>
            ) : (
                <div className="combat-codex__empty text-muted text-small">
                    Select a demon to view codex matches.
                </div>
            )}
        </div>
    );
}




function HelpTab() {
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [activeDoc, setActiveDoc] = useState(null);
    const [docContent, setDocContent] = useState("");
    const [docLoading, setDocLoading] = useState(false);
    const [docError, setDocError] = useState("");

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        setError("");
        (async () => {
            try {
                const data = await Help.docs();
                if (!mounted) return;
                const list = Array.isArray(data) ? data : [];
                setDocs(list);
                if (list.length > 0) {
                    setActiveDoc((prev) => {
                        if (prev && list.some((doc) => doc.filename === prev.filename)) {
                            return prev;
                        }
                        return list[0];
                    });
                } else {
                    setActiveDoc(null);
                }
            } catch (e) {
                if (!mounted) return;
                setError(e?.message || "Unable to load help documents.");
                setDocs([]);
                setActiveDoc(null);
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (!activeDoc?.filename) {
            setDocContent("");
            return;
        }
        let cancelled = false;
        setDocLoading(true);
        setDocError("");
        (async () => {
            try {
                const content = await Help.getDoc(activeDoc.filename);
                if (cancelled) return;
                setDocContent(typeof content === "string" ? content : String(content ?? ""));
            } catch (e) {
                if (cancelled) return;
                setDocError(e?.message || "Unable to load this document.");
                setDocContent("");
            } finally {
                if (!cancelled) setDocLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [activeDoc]);

    const friendlyName = (doc) => {
        if (!doc?.name) return "Untitled";
        return doc.name.replace(/\.txt$/i, "");
    };

    return (
        <div className="help-layout">
            <aside className="help-sidebar">
                <h3>Help library</h3>
                <p className="text-muted text-small">
                    These reference files live in <code>txtdocs</code>. Pick a topic to open the matching .txt so
                    everyone sees the same table rulings.
                </p>
                {loading ? (
                    <div className="text-muted">Loading documents…</div>
                ) : error ? (
                    <div className="help-error">{error}</div>
                ) : docs.length === 0 ? (
                    <div className="text-muted">No reference docs were found in the <code>txtdocs</code> folder.</div>
                ) : (
                    <ul className="help-list">
                        {docs.map((doc) => {
                            const isActive = activeDoc?.filename === doc.filename;
                            return (
                                <li key={doc.filename}>
                                    <button
                                        type="button"
                                        className={`help-link${isActive ? " active" : ""}`}
                                        onClick={() => setActiveDoc(doc)}
                                    >
                                        {friendlyName(doc)}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </aside>
            <section className="help-content">
                {activeDoc ? (
                    <div className="help-doc">
                        <div className="help-doc__header">
                            <h3>{friendlyName(activeDoc)}</h3>
                            <span className="text-muted text-small">Source: {activeDoc.name}</span>
                        </div>
                        {docLoading ? (
                            <div className="text-muted">Opening document…</div>
                        ) : docError ? (
                            <div className="help-error">{docError}</div>
                        ) : (
                            <pre className="help-doc__body">{docContent || "This file is empty."}</pre>
                        )}
                    </div>
                ) : (
                    <div className="help-empty">
                        Select a document from the left to read it here. Need more? Drop .txt files into <code>txtdocs</code> and refresh.
                    </div>
                )}
            </section>
        </div>
    );
}
// ---------- Settings ----------
const PERMISSION_OPTIONS = [
    {
        key: "canEditStats",
        label: "Character sheets",
        description: "Allow players to edit their own stats, HP/MP, and background details.",
    },
    {
        key: "canEditItems",
        label: "Party inventory",
        description: "Let players add, update, or delete items from the shared inventory.",
    },
    {
        key: "canEditGear",
        label: "Equipment loadouts",
        description: "Let players swap or edit their own weapons, armor, and gear slots.",
    },
    {
        key: "canEditCombatSkills",
        label: "Combat skills",
        description: "Allow players to add, edit, or delete shared combat techniques.",
    },
    {
        key: "canEditDemons",
        label: "Demon roster",
        description: "Allow players to manage demons they control, including stats and notes.",
    },
];

const PERMISSION_DEFAULTS = PERMISSION_OPTIONS.reduce((acc, option) => {
    acc[option.key] = false;
    return acc;
}, {});

function SettingsTab({ game, onUpdate, me, onDelete, onKickPlayer, onGameRefresh }) {
    const [perms, setPerms] = useState(() => ({
        ...PERMISSION_DEFAULTS,
        ...(game.permissions || {}),
    }));
    const [saving, setSaving] = useState(false);
    const [removingId, setRemovingId] = useState(null);
    const storyDefaults = useMemo(() => normalizeStorySettings(game.story), [game.story]);
    const [storyForm, setStoryForm] = useState(storyDefaults);
    const [storySaving, setStorySaving] = useState(false);
    const [mapSettings, setMapSettings] = useState(() => ({
        allowPlayerDrawing: mapReadBoolean(
            game.map?.settings?.allowPlayerDrawing,
            MAP_DEFAULT_SETTINGS.allowPlayerDrawing,
        ),
        allowPlayerTokenMoves: mapReadBoolean(
            game.map?.settings?.allowPlayerTokenMoves,
            MAP_DEFAULT_SETTINGS.allowPlayerTokenMoves,
        ),
        paused: mapReadBoolean(game.map?.paused),
    }));
    const [mapSaving, setMapSaving] = useState(false);
    const [clearingDrawings, setClearingDrawings] = useState(false);
    const logBattle = useBattleLogger(game.id);

    useEffect(() => {
        setPerms({
            ...PERMISSION_DEFAULTS,
            ...(game.permissions || {}),
        });
        setRemovingId(null);
    }, [game.id, game.permissions]);

    useEffect(() => {
        setStoryForm(storyDefaults);
    }, [storyDefaults]);

    useEffect(() => {
        setMapSettings({
            allowPlayerDrawing: mapReadBoolean(
                game.map?.settings?.allowPlayerDrawing,
                MAP_DEFAULT_SETTINGS.allowPlayerDrawing,
            ),
            allowPlayerTokenMoves: mapReadBoolean(
                game.map?.settings?.allowPlayerTokenMoves,
                MAP_DEFAULT_SETTINGS.allowPlayerTokenMoves,
            ),
            paused: mapReadBoolean(game.map?.paused),
        });
    }, [
        game.id,
        game.map?.paused,
        game.map?.settings?.allowPlayerDrawing,
        game.map?.settings?.allowPlayerTokenMoves,
    ]);

    const removablePlayers = useMemo(
        () =>
            (game.players || []).filter(
                (p) => (p?.role || "").toLowerCase() !== "dm"
            ),
        [game.players]
    );

    const isDM = idsMatch(game.dmId, me?.id);
    const canKick = isDM && typeof onKickPlayer === "function";
    const canDelete = isDM && typeof onDelete === "function";

    const hasChanges = PERMISSION_OPTIONS.some(
        ({ key }) => !!(game.permissions?.[key]) !== !!perms[key]
    );
    const storyDirty = useMemo(
        () => JSON.stringify(storyForm) !== JSON.stringify(storyDefaults),
        [storyDefaults, storyForm]
    );

    const mapStrokeCount = Array.isArray(game.map?.strokes) ? game.map.strokes.length : 0;
    const storyBotTokenValue = typeof storyForm.botToken === "string" ? storyForm.botToken : "";
    const hasCustomBotToken = storyBotTokenValue.trim().length > 0;
    const storyPrimaryBot = storyForm.primaryBot || normalizePrimaryBot(null);
    const sharedBotAvailable = !!storyPrimaryBot.available;
    const usingSharedBot = sharedBotAvailable && !hasCustomBotToken;

    const applyMapSettings = useCallback(
        async (changes) => {
            if (!isDM) return;
            const previous = { ...mapSettings };
            setMapSettings((current) => ({ ...current, ...changes }));
            setMapSaving(true);
            try {
                const updated = await Games.updateMapSettings(game.id, changes);
                const resolvedSettings = {
                    allowPlayerDrawing: mapReadBoolean(
                        updated.settings?.allowPlayerDrawing,
                        MAP_DEFAULT_SETTINGS.allowPlayerDrawing,
                    ),
                    allowPlayerTokenMoves: mapReadBoolean(
                        updated.settings?.allowPlayerTokenMoves,
                        MAP_DEFAULT_SETTINGS.allowPlayerTokenMoves,
                    ),
                    paused: mapReadBoolean(updated.paused),
                };
                setMapSettings(resolvedSettings);
                const summary = [];
                const changeDetails = {};
                if (Object.prototype.hasOwnProperty.call(changes, "allowPlayerDrawing")) {
                    const enabled = !!changes.allowPlayerDrawing;
                    summary.push(`${enabled ? "Enabled" : "Disabled"} player drawing`);
                    changeDetails.allowPlayerDrawing = enabled;
                }
                if (Object.prototype.hasOwnProperty.call(changes, "allowPlayerTokenMoves")) {
                    const enabled = !!changes.allowPlayerTokenMoves;
                    summary.push(`${enabled ? "Enabled" : "Disabled"} player token moves`);
                    changeDetails.allowPlayerTokenMoves = enabled;
                }
                if (Object.prototype.hasOwnProperty.call(changes, "paused")) {
                    const paused = !!changes.paused;
                    summary.push(paused ? "Paused the battle map" : "Resumed the battle map");
                    changeDetails.paused = paused;
                }
                if (summary.length > 0) {
                    logBattle("map:settings:update", `Updated map settings: ${summary.join(", ")}.`, {
                        changes: changeDetails,
                        settings: resolvedSettings,
                    });
                }
                if (typeof onGameRefresh === "function") {
                    await onGameRefresh();
                }
            } catch (err) {
                alert(err.message);
                setMapSettings(previous);
            } finally {
                setMapSaving(false);
            }
        },
        [game.id, isDM, logBattle, mapSettings, onGameRefresh]
    );

    const handleClearDrawings = useCallback(async () => {
        if (!isDM) return;
        if (!confirm("Clear all drawings from the battle map?")) return;
        try {
            setClearingDrawings(true);
            await Games.clearMapStrokes(game.id);
            logBattle("map:stroke:clear", "Cleared all map drawings from the settings panel.");
            if (typeof onGameRefresh === "function") {
                await onGameRefresh();
            }
        } catch (err) {
            alert(err.message);
        } finally {
            setClearingDrawings(false);
        }
    }, [game.id, isDM, logBattle, onGameRefresh]);

    const navSections = useMemo(() => {
        const sections = [
            { key: "permissions", label: "Permissions" },
            { key: "battleMap", label: "Battle Map" },
            { key: "story", label: "Story Tools" },
        ];
        if (canKick) sections.push({ key: "members", label: "Members" });
        if (canDelete) sections.push({ key: "danger", label: "Danger Zone" });
        return sections;
    }, [canKick, canDelete]);

    const [activeSection, setActiveSection] = useState(() => navSections[0]?.key || "permissions");

    useEffect(() => {
        if (!navSections.some((section) => section.key === activeSection)) {
            setActiveSection(navSections[0]?.key || "permissions");
        }
    }, [activeSection, navSections]);

    let sectionContent = null;

    if (activeSection === "permissions") {
        sectionContent = (
            <>
                <h3>Permissions</h3>
                <p className="text-muted text-small" style={{ marginTop: -4 }}>
                    Decide which parts of the campaign your players can maintain themselves.
                </p>

                <div className="stack" style={{ marginTop: 12 }}>
                    {PERMISSION_OPTIONS.map((option) => (
                        <label
                            key={option.key}
                            className={`perm-toggle${!isDM ? " is-readonly" : ""}`}
                        >
                            <input
                                type="checkbox"
                                checked={!!perms[option.key]}
                                disabled={!isDM || saving}
                                onChange={(e) =>
                                    setPerms((prev) => ({
                                        ...prev,
                                        [option.key]: e.target.checked,
                                    }))
                                }
                            />
                            <div className="perm-toggle__text">
                                <span className="perm-toggle__label">{option.label}</span>
                                <span className="text-muted text-small">{option.description}</span>
                            </div>
                        </label>
                    ))}
                </div>

                <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
                    <button
                        className="btn"
                        disabled={saving || !hasChanges}
                        onClick={async () => {
                            try {
                                setSaving(true);
                                const payload = PERMISSION_OPTIONS.reduce((acc, option) => {
                                    acc[option.key] = !!perms[option.key];
                                    return acc;
                                }, {});
                                await onUpdate(payload);
                                setPerms(payload);
                            } catch (e) {
                                alert(e.message);
                            } finally {
                                setSaving(false);
                            }
                        }}
                    >
                        {saving ? "Saving…" : hasChanges ? "Save changes" : "Saved"}
                    </button>
                </div>
            </>
        );
    } else if (activeSection === "battleMap") {
        sectionContent = (
            <>
                <h3>Battle Map controls</h3>
                <p className="text-muted text-small" style={{ marginTop: -4 }}>
                    Control how players collaborate on the live battle map.
                </p>
                <div className="stack">
                    <label className={`perm-toggle${!isDM ? " is-readonly" : ""}`}>
                        <input
                            type="checkbox"
                            checked={mapSettings.allowPlayerDrawing}
                            disabled={!isDM || mapSaving}
                            onChange={(event) =>
                                applyMapSettings({ allowPlayerDrawing: event.target.checked })
                            }
                        />
                        <div className="perm-toggle__text">
                            <span className="perm-toggle__label">Allow players to draw</span>
                            <span className="text-muted text-small">
                                When enabled, party members can sketch routes, traps, and plans directly on the board.
                            </span>
                        </div>
                    </label>
                    <label className={`perm-toggle${!isDM ? " is-readonly" : ""}`}>
                        <input
                            type="checkbox"
                            checked={mapSettings.allowPlayerTokenMoves}
                            disabled={!isDM || mapSaving}
                            onChange={(event) =>
                                applyMapSettings({ allowPlayerTokenMoves: event.target.checked })
                            }
                        />
                        <div className="perm-toggle__text">
                            <span className="perm-toggle__label">Allow players to move their tokens</span>
                            <span className="text-muted text-small">
                                Grant owners the ability to drag their own token markers during encounters.
                            </span>
                        </div>
                    </label>
                    <label className={`perm-toggle${!isDM ? " is-readonly" : ""}`}>
                        <input
                            type="checkbox"
                            checked={mapSettings.paused}
                            disabled={!isDM || mapSaving}
                            onChange={(event) => applyMapSettings({ paused: event.target.checked })}
                        />
                        <div className="perm-toggle__text">
                            <span className="perm-toggle__label">Pause live updates</span>
                            <span className="text-muted text-small">
                                Pause the board while you prep the battlefield. Players keep their view until you resume.
                            </span>
                        </div>
                    </label>
                </div>
                <div className="row" style={{ justifyContent: "space-between", marginTop: 12, gap: 12 }}>
                    <span className="text-muted text-small">
                        {mapStrokeCount === 0
                            ? "No freehand drawings saved yet."
                            : `${mapStrokeCount} drawing${mapStrokeCount === 1 ? "" : "s"} on the board.`}
                    </span>
                    <button
                        type="button"
                        className="btn ghost btn-small"
                        disabled={!isDM || clearingDrawings || mapStrokeCount === 0}
                        onClick={handleClearDrawings}
                    >
                        {clearingDrawings ? "Clearing…" : "Clear drawings"}
                    </button>
                </div>
            </>
        );
    } else if (activeSection === "story") {
        const sharedStatusClass = `pill ${sharedBotAvailable ? "success" : "warn"}`;
        const sharedStatusText = sharedBotAvailable ? "Shared bot ready" : "Shared bot unavailable";
        const botModeDescription = hasCustomBotToken
            ? "This campaign will authenticate with its own Discord bot token."
            : usingSharedBot
                ? "This campaign will use the shared Jack Endex bot configured on the server."
                : "Add a bot token or rely on the shared bot to enable Discord syncing.";
        const showPrimaryDefaults = !!(
            storyPrimaryBot.defaultGuildId || storyPrimaryBot.defaultChannelId
        );
        sectionContent = (
            <>
                <h3>Discord story integration</h3>
                <p className="text-muted text-small" style={{ marginTop: -4 }}>
                    Link your campaign to a Discord channel and webhook so the story tab can both read and post updates.
                </p>
                <div className="story-callout">
                    <div
                        className="row"
                        style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}
                    >
                        <div className="col" style={{ gap: 4 }}>
                            <strong>Shared bot status</strong>
                            <span className="text-muted text-small">{botModeDescription}</span>
                        </div>
                        <span className={sharedStatusClass}>{sharedStatusText}</span>
                    </div>
                    {sharedBotAvailable ? (
                        <>
                            <p className="text-muted text-small" style={{ marginTop: 8 }}>
                                Leave the token field blank to fall back to the shared bot.
                                {storyPrimaryBot.inviteUrl
                                    ? " Invite it to your server if it isn't already present."
                                    : ""}
                            </p>
                            {storyPrimaryBot.inviteUrl && (
                                <div className="row" style={{ marginTop: 4, justifyContent: "flex-start" }}>
                                    <a
                                        className="btn ghost btn-small"
                                        href={storyPrimaryBot.inviteUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Invite the shared bot
                                    </a>
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="text-muted text-small" style={{ marginTop: 8 }}>
                            No shared bot token is configured on the server. Provide a bot token below to enable syncing.
                        </p>
                    )}
                    {showPrimaryDefaults && (
                        <div className="story-callout__grid">
                            {storyPrimaryBot.defaultGuildId && (
                                <div>
                                    <span className="story-callout__label">Default guild</span>
                                    <code>{storyPrimaryBot.defaultGuildId}</code>
                                </div>
                            )}
                            {storyPrimaryBot.defaultChannelId && (
                                <div>
                                    <span className="story-callout__label">Default channel</span>
                                    <code>{storyPrimaryBot.defaultChannelId}</code>
                                </div>
                            )}
                        </div>
                    )}
                    {storyPrimaryBot.applicationId && (
                        <span className="text-muted text-small">
                            Application ID for slash commands: <code>{storyPrimaryBot.applicationId}</code>
                        </span>
                    )}
                </div>
                <label className="field" style={{ display: "grid", gap: 4 }}>
                    <span className="text-small">Bot token</span>
                    <input
                        type="password"
                        value={storyBotTokenValue}
                        onChange={(e) =>
                            setStoryForm((prev) => ({ ...prev, botToken: e.target.value }))
                        }
                        placeholder="Paste the Discord bot token for this campaign"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={storySaving}
                    />
                    {!hasCustomBotToken && sharedBotAvailable && (
                        <span className="text-muted text-small">
                            Leave blank to use the shared token configured on the server.
                        </span>
                    )}
                </label>
                <label className="field" style={{ display: "grid", gap: 4 }}>
                    <span className="text-small">Channel ID</span>
                    <input
                        type="text"
                        value={storyForm.channelId}
                        onChange={(e) =>
                            setStoryForm((prev) => ({ ...prev, channelId: e.target.value }))
                        }
                        placeholder="e.g. 123456789012345678"
                        disabled={storySaving}
                    />
                </label>
                <label className="field" style={{ display: "grid", gap: 4 }}>
                    <span className="text-small">Guild ID (optional)</span>
                    <input
                        type="text"
                        value={storyForm.guildId}
                        onChange={(e) =>
                            setStoryForm((prev) => ({ ...prev, guildId: e.target.value }))
                        }
                        placeholder="Needed for jump links if the webhook lives in another server"
                        disabled={storySaving}
                    />
                </label>
                <label className="field" style={{ display: "grid", gap: 4 }}>
                    <span className="text-small">Webhook URL</span>
                    <input
                        type="url"
                        value={storyForm.webhookUrl}
                        onChange={(e) =>
                            setStoryForm((prev) => ({ ...prev, webhookUrl: e.target.value }))
                        }
                        placeholder="https://discord.com/api/webhooks/…"
                        disabled={storySaving}
                    />
                </label>
                <label className={`perm-toggle${storySaving ? " is-readonly" : ""}`}>
                    <input
                        type="checkbox"
                        checked={storyForm.allowPlayerPosts}
                        disabled={storySaving}
                        onChange={(e) =>
                            setStoryForm((prev) => ({ ...prev, allowPlayerPosts: e.target.checked }))
                        }
                    />
                    <div className="perm-toggle__text">
                        <span className="perm-toggle__label">Allow players to post from the dashboard</span>
                        <span className="text-muted text-small">
                            When enabled, players get a composer in the Story tab. They can only speak as themselves unless
                            marked as Scribes.
                        </span>
                    </div>
                </label>
                <div className="col" style={{ gap: 8 }}>
                    <strong>Scribe access</strong>
                    <p className="text-muted text-small" style={{ marginTop: 0 }}>
                        Scribes can narrate as the outside storyteller instead of their character.
                    </p>
                    {removablePlayers.length === 0 ? (
                        <span className="text-muted text-small">No players have joined yet.</span>
                    ) : (
                        removablePlayers.map((player, index) => {
                            if (!player?.userId) return null;
                            const label =
                                player.character?.name?.trim() ||
                                player.username ||
                                `Player ${index + 1}`;
                            const checked = storyForm.scribeIds.includes(player.userId);
                            return (
                                <label key={player.userId} className="perm-toggle">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={storySaving}
                                        onChange={(e) => {
                                            setStoryForm((prev) => {
                                                const next = new Set(prev.scribeIds);
                                                if (e.target.checked) {
                                                    next.add(player.userId);
                                                } else {
                                                    next.delete(player.userId);
                                                }
                                                return {
                                                    ...prev,
                                                    scribeIds: Array.from(next).sort(),
                                                };
                                            });
                                        }}
                                    />
                                    <div className="perm-toggle__text">
                                        <span className="perm-toggle__label">{label}</span>
                                        {player.username && (
                                            <span className="text-muted text-small">@{player.username}</span>
                                        )}
                                    </div>
                                </label>
                            );
                        })
                    )}
                </div>
                <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                    <button
                        className="btn"
                        disabled={storySaving || !storyDirty}
                        onClick={async () => {
                            try {
                                setStorySaving(true);
                                const payload = {
                                    botToken: storyBotTokenValue.trim(),
                                    channelId: storyForm.channelId.trim(),
                                    guildId: storyForm.guildId.trim(),
                                    webhookUrl: storyForm.webhookUrl.trim(),
                                    allowPlayerPosts: !!storyForm.allowPlayerPosts,
                                    scribeIds: storyForm.scribeIds,
                                };
                                const result = await StoryLogs.configure(game.id, payload);
                                if (typeof onGameRefresh === "function") {
                                    await onGameRefresh();
                                }
                                const nextStory =
                                    result?.story && typeof result.story === "object"
                                        ? normalizeStorySettings(result.story)
                                        : normalizeStorySettings({
                                              ...storyForm,
                                              ...payload,
                                          });
                                setStoryForm(nextStory);
                            } catch (e) {
                                alert(e.message);
                            } finally {
                                setStorySaving(false);
                            }
                        }}
                    >
                        {storySaving ? "Saving…" : storyDirty ? "Save story settings" : "Saved"}
                    </button>
                </div>
            </>
        );
    } else if (activeSection === "members" && canKick) {
        sectionContent = (
            <>
                <h3>Campaign members</h3>
                <p style={{ color: "var(--muted)", marginTop: -4 }}>
                    Remove players from the campaign if they should no longer have access.
                </p>
                <div className="list">
                    {removablePlayers.length === 0 ? (
                        <span className="text-muted text-small">No players have joined yet.</span>
                    ) : (
                        removablePlayers.map((player, index) => {
                            const name =
                                player.character?.name?.trim() ||
                                player.username ||
                                `Player ${index + 1}`;
                            const subtitleParts = [];
                            if (player.username) {
                                subtitleParts.push(`@${player.username}`);
                            }
                            const charClass = player.character?.profile?.class;
                            if (charClass) subtitleParts.push(charClass);
                            const subtitle = subtitleParts.join(" · ");
                            const isBusy = removingId === player.userId;

                            return (
                                <div
                                    key={player.userId || `player-${index}`}
                                    className="row"
                                    style={{
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        gap: 12,
                                    }}
                                >
                                    <div className="col" style={{ gap: 2 }}>
                                        <strong>{name}</strong>
                                        {subtitle && (
                                            <span className="text-muted text-small">{subtitle}</span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        className="btn danger btn-small"
                                        disabled={removingId !== null}
                                        onClick={async () => {
                                            if (!canKick || typeof onKickPlayer !== "function") {
                                                return;
                                            }
                                            if (!player?.userId) return;
                                            const confirmName =
                                                player.character?.name?.trim() ||
                                                player.username ||
                                                "this player";
                                            if (
                                                !confirm(
                                                    `Remove ${confirmName} from the campaign? They will lose access to this game.`
                                                )
                                            ) {
                                                return;
                                            }
                                            try {
                                                setRemovingId(player.userId);
                                                await onKickPlayer(player.userId);
                                            } catch (e) {
                                                alert(e.message);
                                            } finally {
                                                setRemovingId(null);
                                            }
                                        }}
                                    >
                                        {isBusy ? "Removing…" : "Remove"}
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>
            </>
        );
    } else if (activeSection === "danger" && canDelete) {
        sectionContent = (
            <>
                <h3>Danger Zone</h3>
                <p style={{ color: "var(--muted)", marginTop: -4 }}>
                    Deleting this game will remove all characters, inventory, and invites for every player.
                </p>
                <button className="btn danger" onClick={onDelete}>
                    Delete Game
                </button>
            </>
        );
    }

    return (
        <div className="card settings-card">
            <div className="settings-tabs">
                {navSections.map((section) => (
                    <button
                        key={section.key}
                        type="button"
                        className={`settings-tab${activeSection === section.key ? " is-active" : ""}`}
                        onClick={() => setActiveSection(section.key)}
                    >
                        {section.label}
                    </button>
                ))}
            </div>
            <div className="settings-content">{sectionContent}</div>
        </div>
    );
}
// ---------- Utils ----------

