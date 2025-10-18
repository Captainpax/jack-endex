import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

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

        const wrapper = mount({
            components: { NavigationSidebar },
            data: () => ({
                items: navItems,
                activeKey: navItems[0]?.key ?? null,
            }),
            methods: {
                handleSelect(key) {
                    this.activeKey = key;
                },
            },
            template: `
                <NavigationSidebar
                    :items="items"
                    :active-key="activeKey"
                    @select="handleSelect"
                />
            `,
        });

        for (const item of navItems) {
            const button = wrapper
                .findAll('button')
                .find((candidate) => candidate.text().includes(item.label));

            expect(button).toBeTruthy();

            await button.trigger('click');
            await wrapper.vm.$nextTick();

            expect(button.attributes('aria-pressed')).toBe('true');
        }
    });
});
