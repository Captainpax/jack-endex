import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';

import App from '../../App.vue';
import { createAppRouter } from '../../router';

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

async function mountApp() {
    const router = createAppRouter();
    await router.push('/');
    await router.isReady();
    const wrapper = shallowMount(App, {
        global: {
            plugins: [router],
        },
    });
    return { wrapper, router };
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

        const { wrapper } = await mountApp();

        await flushAll();

        const meta = wrapper.find('.game-list__meta');
        expect(meta.exists()).toBe(true);
        expect(meta.text()).toContain('Dungeon Master');

        const selectButton = wrapper.find('.game-list__button');
        expect(selectButton.exists()).toBe(true);
        await selectButton.trigger('click');
        await flushAll();

        const activeMeta = wrapper.find('.app-shell__content-meta');
        expect(activeMeta.exists()).toBe(true);
        expect(activeMeta.text()).toContain('Dungeon Master');
    });

    it('renders DM information from the dm summary payload', async () => {
        const dmId = 'dm-777';
        const game = {
            id: 'game-2',
            name: 'Summary Campaign',
            dmId,
            dm: { userId: dmId, username: 'SummaryDM', displayName: 'Summary DM' },
            updatedAt: '2024-02-01T00:00:00.000Z',
            players: [
                { userId: 'player-1', role: 'player', username: 'Player One' },
            ],
        };

        mockAuth.me.mockResolvedValue({ id: 'player-1', username: 'Player One' });
        mockGames.list.mockResolvedValue([game]);
        mockGames.get.mockResolvedValue(game);

        const { wrapper } = await mountApp();

        await flushAll();

        const meta = wrapper.find('.game-list__meta');
        expect(meta.exists()).toBe(true);
        expect(meta.text()).toContain('Summary DM');

        const selectButton = wrapper.find('.game-list__button');
        expect(selectButton.exists()).toBe(true);
        await selectButton.trigger('click');
        await flushAll();

        const activeMeta = wrapper.find('.app-shell__content-meta');
        expect(activeMeta.exists()).toBe(true);
        expect(activeMeta.text()).toContain('Summary DM');
    });
});
