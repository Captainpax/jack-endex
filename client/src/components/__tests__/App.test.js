import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';

import App from '../../App.vue';

const mockAuth = {
    me: vi.fn(),
    logout: vi.fn(),
};

const mockGames = {
    list: vi.fn(),
    get: vi.fn(),
};

vi.mock('../../api', () => ({
    Auth: mockAuth,
    Games: mockGames,
    Help: {
        docs: vi.fn().mockResolvedValue(null),
    },
    StoryLogs: {
        fetch: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../composables/useRealtimeConnection', () => {
    const musicState = { value: null };
    return {
        realtimeSymbol: Symbol('realtime'),
        useRealtimeConnection: () => ({
            state: {},
            socket: null,
            connect: vi.fn(),
            disconnect: vi.fn(),
            send: vi.fn(),
            sendAlert: vi.fn(),
            dismissAlert: vi.fn(),
            syncMusic: vi.fn(),
            musicState,
        }),
    };
});

vi.mock('../../composables/useBattleLogger', () => ({
    useBattleLogger: () => vi.fn(),
    default: () => vi.fn(),
}));

async function flushAll() {
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
    await nextTick();
}

describe('App', () => {
    beforeEach(() => {
        mockAuth.me.mockReset();
        mockAuth.logout.mockReset();
        mockGames.list.mockReset();
        mockGames.get.mockReset();
    });

    it('renders DM information when only dmId is present', async () => {
        const dmId = 'dm-001';
        const dmPlayer = { userId: dmId, username: 'Dungeon Master', role: 'dm' };
        const game = {
            id: 'game-1',
            name: 'Test Campaign',
            dmId,
            updatedAt: '2024-01-01T00:00:00.000Z',
            players: [dmPlayer],
        };

        mockAuth.me.mockResolvedValue({ id: 'user-123', username: 'Player One' });
        mockGames.list.mockResolvedValue([game]);
        mockGames.get.mockResolvedValue(game);

        const wrapper = shallowMount(App);

        await flushAll();

        const meta = wrapper.find('.game-list__meta');
        expect(meta.exists()).toBe(true);
        expect(meta.text()).toContain('Dungeon Master');

        const activeMeta = wrapper.find('.app-shell__content-meta');
        expect(activeMeta.exists()).toBe(true);
        expect(activeMeta.text()).toContain('Dungeon Master');
    });
});
