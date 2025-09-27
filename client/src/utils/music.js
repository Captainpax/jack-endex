import { MAIN_MENU_TRACK_ID, MUSIC_TRACKS } from "@shared/music/index.js";

/**
 * @typedef {{ id: string, title: string, info?: string, filename: string, loop?: boolean, default?: boolean }} MusicTrack
 */

/**
 * Pre-resolved list of music tracks bundled with absolute source URLs.
 * @type {Array<MusicTrack & { src: string }>}
 */
const TRACKS_WITH_SOURCES = MUSIC_TRACKS.map((track) => ({
    ...track,
    src: new URL(`../../../shared/music/${track.filename}`, import.meta.url).href,
}));

const TRACK_MAP = new Map(TRACKS_WITH_SOURCES.map((track) => [track.id, track]));

/**
 * Return the catalog of music tracks with resolved source URLs.
 * @returns {Array<MusicTrack & { src: string }>}
 */
export function getAvailableTracks() {
    return TRACKS_WITH_SOURCES;
}

/**
 * Lookup a track by id, returning `null` if not found.
 * @param {string} trackId
 * @returns {MusicTrack & { src: string } | null}
 */
export function getTrackById(trackId) {
    if (!trackId) return null;
    return TRACK_MAP.get(trackId) || null;
}

/**
 * Resolve the configured main menu track when available.
 * @returns {MusicTrack & { src: string } | null}
 */
export function getMainMenuTrack() {
    if (!MAIN_MENU_TRACK_ID) return null;
    return getTrackById(MAIN_MENU_TRACK_ID);
}
