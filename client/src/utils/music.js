import { MAIN_MENU_TRACK_ID, MUSIC_TRACKS } from "@shared/music/index.js";

const TRACKS_WITH_SOURCES = MUSIC_TRACKS.map((track) => ({
    ...track,
    src: new URL(`../../../shared/music/${track.filename}`, import.meta.url).href,
}));

const TRACK_MAP = new Map(TRACKS_WITH_SOURCES.map((track) => [track.id, track]));

export function getAvailableTracks() {
    return TRACKS_WITH_SOURCES;
}

export function getTrackById(trackId) {
    if (!trackId) return null;
    return TRACK_MAP.get(trackId) || null;
}

export function getMainMenuTrack() {
    if (!MAIN_MENU_TRACK_ID) return null;
    return getTrackById(MAIN_MENU_TRACK_ID);
}
