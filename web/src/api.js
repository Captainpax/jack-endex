// --- FILE: web/src/api.ts ---
export async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!res.ok) {
        try {
            throw new Error((await res.json()).error || res.statusText);
        }
        catch {
            throw new Error(res.statusText);
        }
    }
    return res.json();
}
export const Auth = {
    me: () => api('/api/auth/me'),
    login: (username, password) => api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    register: (username, password) => api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
    logout: () => api('/api/auth/logout', { method: 'POST' })
};
export const Games = {
    list: () => api('/api/games'),
    create: (name) => api('/api/games', { method: 'POST', body: JSON.stringify({ name }) }),
    get: (id) => api(`/api/games/${id}`),
    invite: (id) => api(`/api/games/${id}/invites`, { method: 'POST' }),
    joinByCode: (code) => api(`/api/games/join/${code}`, { method: 'POST' }),
    setPerms: (id, perms) => api(`/api/games/${id}/permissions`, { method: 'PUT', body: JSON.stringify(perms) }),
    saveCharacter: (id, character) => api(`/api/games/${id}/character`, { method: 'PUT', body: JSON.stringify({ character }) }),
    addCustomItem: (id, item) => api(`/api/games/${id}/items/custom`, { method: 'POST', body: JSON.stringify({ item }) }),
    addDemon: (id, body) => api(`/api/games/${id}/demons`, { method: 'POST', body: JSON.stringify(body) }),
    delDemon: (id, demonId) => api(`/api/games/${id}/demons/${demonId}`, { method: 'DELETE' })
};
export const Items = { premade: () => api('/api/items/premade') };
export const Personas = {
    search: (q) => api(`/api/personas/search?q=${encodeURIComponent(q)}`),
    get: (slug) => api(`/api/personas/${slug}`)
};
