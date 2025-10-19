import { describe, expect, it } from 'vitest';
import { presentDungeonMaster } from '../presentDungeonMaster.js';

describe('presentDungeonMaster', () => {
    it('derives username and display name from the DM player entry', () => {
        const game = {
            id: 'game-1',
            dmId: 'user-123',
            players: [
                { userId: 'user-123', role: 'dm', username: 'DungeonMaster', displayName: 'DM Supreme', online: true },
            ],
        };

        const result = presentDungeonMaster(game);

        expect(result).toEqual({
            userId: 'user-123',
            username: 'DungeonMaster',
            displayName: 'DM Supreme',
            role: 'dm',
            online: true,
        });
    });

    it('falls back to dmId when no player data is available', () => {
        const game = {
            id: 'game-2',
            dmId: 'user-999',
            players: [],
            dm: 'Legacy DM',
        };

        const result = presentDungeonMaster(game);

        expect(result).toEqual({
            userId: 'user-999',
            username: 'Legacy DM',
            displayName: 'Legacy DM',
            role: 'dm',
        });
    });
});
