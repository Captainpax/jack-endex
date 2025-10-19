import { presentDungeonMaster } from './presentDungeonMaster.js';

export function filterGamesForUser(games, userId, isUserOnlineInGame = () => false) {
    if (!Array.isArray(games) || !userId) return [];

    return games
        .filter((game) => {
            if (!game || typeof game !== 'object') return false;
            const isPlayer = Array.isArray(game.players)
                && game.players.some((player) => player?.userId === userId);
            const isDm = game.dmId === userId;
            return isPlayer || isDm;
        })
        .map((game) => {
            const players = Array.isArray(game.players)
                ? game.players.map((player) => {
                    if (!player || typeof player !== 'object') {
                        return player;
                    }

                    const online = isUserOnlineInGame(game.id, player.userId);
                    return { ...player, online };
                })
                : [];

            const dm = presentDungeonMaster({ ...game, players });

            return {
                id: game.id,
                name: game.name,
                dmId: game.dmId,
                dm,
                players,
            };
        });
}
