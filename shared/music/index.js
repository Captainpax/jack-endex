export const MUSIC_TRACKS = [
    {
        id: "recovery-spring",
        title: "Recovery Spring",
        subtitle: "Shin Megami Tensei III: Nocturne",
        filename: "Recovery Spring - SMT III_ Nocturne.mp3",
        loop: true,
        default: true,
    },
];

export const MUSIC_TRACK_MAP = new Map(MUSIC_TRACKS.map((track) => [track.id, track]));

export function getMusicTrack(trackId) {
    if (!trackId) return null;
    return MUSIC_TRACK_MAP.get(trackId) || null;
}

export function getDefaultMusicTrack() {
    const firstDefault = MUSIC_TRACKS.find((track) => track.default);
    return firstDefault || MUSIC_TRACKS[0] || null;
}

export const MAIN_MENU_TRACK_ID = getDefaultMusicTrack()?.id || null;
