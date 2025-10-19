import { computed, isRef, isReadonly, ref, unref, watch, watchEffect } from 'vue';

import { idsMatch, normalizeId } from '../utils/ids';

export function useSheetPlayerContext({ game, me, slug } = {}) {
    const gameRef = computed(() => unref(game));
    const meRef = computed(() => unref(me));

    const slugIsRef = isRef(slug);
    const slugRef = slugIsRef ? slug : ref(typeof slug === 'string' ? slug : '');
    const canMutateSlug = !slugIsRef || !isReadonly(slug);

    const normalizedSlug = computed(() => normalizeSheetSlug(unref(slugRef)));

    const isDM = computed(() => idsMatch(normalizeId(gameRef.value?.dmId), normalizeId(meRef.value?.id)));

    const players = computed(() => {
        const list = gameRef.value?.players;
        if (!Array.isArray(list)) return [];
        return list.filter((player) => player && typeof player === 'object');
    });

    const selectablePlayers = computed(() => {
        const filtered = players.value.filter((player) => {
            const role = typeof player?.role === 'string' ? player.role.trim().toLowerCase() : '';
            return role !== 'dm';
        });
        return filtered.length ? filtered : players.value;
    });

    const playerOptions = computed(() =>
        selectablePlayers.value.map((player, index) => {
            const slug = extractPlayerSlug(player);
            return {
                key: slug || resolvePlayerKey(player, index),
                label: describePlayerName(player),
                slug,
                player,
            };
        })
    );

    const selectedPlayerKey = ref('');

    watchEffect(() => {
        if (!isDM.value) {
            selectedPlayerKey.value = '';
            return;
        }

        const options = playerOptions.value;
        if (!options.length) {
            selectedPlayerKey.value = '';
            if (canMutateSlug && slugRef.value) {
                slugRef.value = '';
            }
            return;
        }

        const slug = normalizedSlug.value;
        if (slug) {
            const match = options.find((option) => option.slug === slug);
            if (match) {
                if (selectedPlayerKey.value !== match.key) {
                    selectedPlayerKey.value = match.key;
                }
                return;
            }
        }

        const existing = options.find((option) => option.key === selectedPlayerKey.value);
        if (existing) {
            if (canMutateSlug && existing.slug && existing.slug !== normalizedSlug.value) {
                slugRef.value = existing.slug;
            }
            return;
        }

        const fallback = options[0];
        selectedPlayerKey.value = fallback.key;
        if (canMutateSlug && fallback.slug && fallback.slug !== normalizedSlug.value) {
            slugRef.value = fallback.slug;
        }
    });

    watch(
        selectedPlayerKey,
        (key) => {
            if (!isDM.value || !canMutateSlug) return;
            const option = playerOptions.value.find((entry) => entry.key === key);
            const normalized = normalizeSheetSlug(option?.slug);
            if (normalized !== normalizedSlug.value) {
                slugRef.value = normalized;
            }
        },
        { flush: 'post' }
    );

    const activePlayer = computed(() => {
        const playerList = players.value;
        if (!playerList.length) return null;

        const slug = normalizedSlug.value;
        if (slug) {
            const match = playerList.find((player) => normalizeSheetSlug(player?.sheetSlug) === slug);
            if (match) return match;
        }

        if (isDM.value) {
            const options = playerOptions.value;
            if (!options.length) return null;
            const match = options.find((option) => option.key === selectedPlayerKey.value);
            return (match || options[0]).player;
        }

        const currentUser = meRef.value;
        if (currentUser) {
            const found = playerList.find((player) => playerMatchesUser(player, currentUser));
            if (found) return found;
        }

        return selectablePlayers.value[0] || null;
    });

    watch(
        () => normalizeSheetSlug(activePlayer.value?.sheetSlug),
        (slug) => {
            if (isDM.value || !canMutateSlug) return;
            const normalized = slug || '';
            if (normalized !== normalizedSlug.value) {
                slugRef.value = normalized;
            }
        },
        { immediate: true }
    );

    function setActiveSlug(value) {
        if (!canMutateSlug) return;
        slugRef.value = normalizeSheetSlug(value);
    }

    return {
        isDM,
        players,
        selectablePlayers,
        playerOptions,
        selectedPlayerKey,
        activePlayer,
        activeSlug: normalizedSlug,
        setActiveSlug,
    };
}

export function playerMatchesUser(player, user) {
    if (!player || !user) return false;
    const playerIds = collectPlayerIdentifiers(player);
    const userIds = [normalizeId(user.id), normalizeId(user.userId), normalizeId(user.user?.id)].filter(Boolean);
    for (const playerId of playerIds) {
        if (userIds.some((id) => id && idsMatch(id, playerId))) {
            return true;
        }
    }
    return false;
}

export function collectPlayerIdentifiers(player) {
    if (!player || typeof player !== 'object') return [];
    const ids = [player.userId, player.id, player.user?.id]
        .map((value) => normalizeId(value))
        .filter((value, index, array) => value && array.indexOf(value) === index);
    return ids;
}

export function describePlayerName(player) {
    if (!player || typeof player !== 'object') return 'Unknown player';
    const charName = typeof player.character?.name === 'string' ? player.character.name.trim() : '';
    if (charName) return charName;
    const displayName = typeof player.displayName === 'string' ? player.displayName.trim() : '';
    if (displayName) return displayName;
    const username = typeof player.username === 'string' ? player.username.trim() : '';
    if (username) return username;
    const userId = typeof player.userId === 'string' ? player.userId.trim() : '';
    if (userId) return userId;
    return 'Unknown player';
}

function resolvePlayerKey(player, index = 0) {
    const identifiers = collectPlayerIdentifiers(player);
    if (identifiers.length) return identifiers[0];
    return `player:${index + 1}`;
}

function normalizeSheetSlug(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function extractPlayerSlug(player) {
    if (!player || typeof player !== 'object') return '';
    return normalizeSheetSlug(player.sheetSlug);
}
