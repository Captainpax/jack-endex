import { describe, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';

import NavigationSidebar from '../NavigationSidebar.vue';
import { buildNavigation } from '../../constants/navigation.js';

const AVAILABLE_KEYS = new Set([
    'overview',
    'sheet',
    'party',
    'map',
    'items',
    'gear',
    'combatSkills',
    'worldSkills',
    'demons',
    'storyLogs',
    'help',
    'settings',
    'serverManagement',
]);

describe('NavigationSidebar', () => {
    it('sets aria-pressed on the selected navigation entry', async () => {
        const navItems = buildNavigation({
            role: 'dm',
            isServerAdmin: true,
            availableKeys: AVAILABLE_KEYS,
        });

        const container = document.createElement('div');
        document.body.appendChild(container);

        const Harness = {
            components: { NavigationSidebar },
            data: () => ({
                items: navItems,
                activeKey: navItems[0]?.key ?? null,
            }),
            methods: {
                select(key) {
                    this.activeKey = key;
                },
            },
            template: `
                <NavigationSidebar
                    :items="items"
                    :active-key="activeKey"
                    @select="select"
                />
            `,
        };

        const app = createApp(Harness);
        app.mount(container);
        await nextTick();

        for (const item of navItems) {
            const button = [...container.querySelectorAll('button')].find((el) =>
                el.textContent.includes(item.label)
            );
            expect(button).toBeTruthy();
            button.click();
            await nextTick();
            expect(button.getAttribute('aria-pressed')).toBe('true');
        }

        app.unmount();
        container.remove();
    });
});
