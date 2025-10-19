import { describe, expect, it, vi } from 'vitest';
import { filterGamesForUser } from '../filterGamesForUser.js';

describe('filterGamesForUser', () => {
    it('includes games where the user is the DM even if not listed as a player', () => {
        const onlineLookup = vi.fn().mockReturnValue(false);
        const games = [
            {
                id: 'game-1',
                name: 'DM Only',
                dmId: 'user-a',
                players: [
                    { userId: 'user-b', role: 'player' },
                ],
            },
        ];

        const result = filterGamesForUser(games, 'user-a', onlineLookup);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: 'game-1',
            name: 'DM Only',
            dmId: 'user-a',
        });
    });

    it('includes games where the user is a player and marks online status', () => {
        const onlineLookup = vi.fn((gameId, userId) => gameId === 'game-2' && userId === 'user-c');
        const games = [
            {
                id: 'game-2',
                name: 'Player Game',
                dmId: 'user-x',
                players: [
                    { userId: 'user-c', role: 'player' },
                ],
            },
        ];

        const result = filterGamesForUser(games, 'user-c', onlineLookup);

        expect(result).toHaveLength(1);
        expect(result[0].players).toEqual([
            { userId: 'user-c', role: 'player', online: true },
        ]);
        expect(onlineLookup).toHaveBeenCalledWith('game-2', 'user-c');
    });
});
