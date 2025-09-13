import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// --- FILE: web/src/App.tsx ---
import React, { useEffect, useState } from 'react';
import { Auth, Games, Items, Personas } from './api';
export default function App() {
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);
    const [games, setGames] = useState([]);
    const [active, setActive] = useState(null);
    const [tab, setTab] = useState('sheet');
    useEffect(() => {
        (async () => {
            const m = await Auth.me();
            setMe(m);
            setLoading(false);
            if (m) {
                setGames(await Games.list());
            }
        })();
    }, []);
    if (loading)
        return _jsx(Center, { children: "Loading\u2026" });
    if (!me)
        return _jsx(AuthView, { onAuthed: async () => { const m = await Auth.me(); setMe(m); setGames(await Games.list()); } });
    if (!active)
        return (_jsx(Home, { me: me, games: games, onOpen: async (g) => { const full = await Games.get(g.id); setActive(full); setTab('sheet'); }, onCreate: async (name) => { await Games.create(name); setGames(await Games.list()); } }));
    return (_jsxs("div", { style: { padding: 20, display: 'grid', gap: 16 }, children: [_jsxs("header", { className: "row", style: { alignItems: 'center', justifyContent: 'space-between' }, children: [_jsx("h2", { children: active.name }), _jsxs("div", { className: "row", children: [_jsx("button", { className: "btn", onClick: async () => { const code = await Games.invite(active.id); alert(`Invite code: ${code.code}\nURL: ${location.origin}${code.joinUrl}`); }, children: "Invite" }), _jsx("button", { className: "btn", onClick: () => { setActive(null); }, children: "Back" })] })] }), _jsx("div", { className: "tabs", children: ['sheet', 'party', 'items', 'demons', 'settings'].map(k => (_jsx("div", { className: 'tab' + (tab === k ? ' active' : ''), onClick: () => setTab(k), children: k.toUpperCase() }, k))) }), tab === 'sheet' && _jsx(Sheet, { me: me, game: active, onSave: async (ch) => { await Games.saveCharacter(active.id, ch); const full = await Games.get(active.id); setActive(full); } }), tab === 'party' && _jsx(Party, { game: active }), tab === 'items' && _jsx(ItemsTab, { game: active, onUpdate: async () => { const full = await Games.get(active.id); setActive(full); } }), tab === 'demons' && _jsx(DemonTab, { game: active, onUpdate: async () => { const full = await Games.get(active.id); setActive(full); } }), tab === 'settings' && _jsx(SettingsTab, { game: active, onUpdate: async (per) => { await Games.setPerms(active.id, per); const full = await Games.get(active.id); setActive(full); } })] }));
}
function Center({ children }) {
    return _jsx("div", { style: { display: 'grid', placeItems: 'center', height: '100vh' }, children: children });
}
function AuthView({ onAuthed }) {
    const [username, setUser] = useState('');
    const [password, setPass] = useState('');
    const [mode, setMode] = useState('login');
    const go = async () => {
        try {
            if (mode === 'login')
                await Auth.login(username, password);
            else
                await Auth.register(username, password);
            onAuthed();
        }
        catch (e) {
            alert(e.message);
        }
    };
    return (_jsx(Center, { children: _jsxs("div", { className: "card", style: { minWidth: 360 }, children: [_jsx("h2", { children: mode === 'login' ? 'Login' : 'Create Account' }), _jsxs("div", { className: "col", children: [_jsx("input", { placeholder: "Username", value: username, onChange: e => setUser(e.target.value) }), _jsx("input", { placeholder: "Password", type: "password", value: password, onChange: e => setPass(e.target.value) }), _jsx("button", { className: "btn", onClick: go, children: mode === 'login' ? 'Login' : 'Register' }), _jsx("button", { className: "btn", onClick: () => setMode(mode === 'login' ? 'register' : 'login'), children: mode === 'login' ? 'Need an account?' : 'Have an account?' })] })] }) }));
}
function Home({ me, games, onOpen, onCreate }) {
    const [name, setName] = useState('My Campaign');
    return (_jsxs("div", { style: { padding: 20, display: 'grid', gap: 16 }, children: [_jsxs("header", { className: "row", style: { alignItems: 'center', justifyContent: 'space-between' }, children: [_jsxs("h2", { children: ["Welcome, ", me.username] }), _jsx("button", { className: "btn", onClick: async () => { await Auth.logout(); location.reload(); }, children: "Logout" })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Your Games" }), _jsxs("div", { className: "list", children: [games.length === 0 && _jsx("div", { children: "No games yet." }), games.map(g => (_jsxs("div", { className: "row", style: { justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("div", { children: [_jsx("b", { children: g.name }), " ", _jsxs("span", { className: "pill", children: [g.players.length, " members"] })] }), _jsx("button", { className: "btn", onClick: () => onOpen(g), children: "Open" })] }, g.id)))] })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Start a New Game (DM)" }), _jsxs("div", { className: "row", children: [_jsx("input", { placeholder: "Campaign name", value: name, onChange: e => setName(e.target.value) }), _jsx("button", { className: "btn", onClick: async () => { try {
                                    await onCreate(name);
                                    alert('Game created');
                                }
                                catch (e) {
                                    alert(e.message);
                                } }, children: "Create" })] })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Join by Invite Code" }), _jsx(JoinByCode, { onJoined: () => location.reload() })] })] }));
}
function JoinByCode({ onJoined }) {
    const [code, setCode] = useState('');
    return (_jsxs("div", { className: "row", children: [_jsx("input", { placeholder: "CODE", value: code, onChange: e => setCode(e.target.value.toUpperCase()) }), _jsx("button", { className: "btn", onClick: async () => { try {
                    await Games.joinByCode(code);
                    onJoined();
                }
                catch (e) {
                    alert(e.message);
                } }, children: "Join" })] }));
}
function Sheet({ me, game, onSave }) {
    const slot = game.players.find((p) => p.userId === me.id) || {};
    const isDM = game.dmId === me.id;
    const [ch, setCh] = useState(slot.character || {});
    useEffect(() => { setCh(slot.character || {}); }, [game.id]);
    const set = (path, value) => {
        const seg = path.split('.');
        setCh((prev) => {
            var _a;
            var _b;
            const next = structuredClone(prev || {});
            let o = next;
            for (let i = 0; i < seg.length - 1; i++) {
                o = ((_a = o[_b = seg[i]]) !== null && _a !== void 0 ? _a : (o[_b] = {}));
            }
            o[seg.at(-1)] = value;
            return next;
        });
    };
    const field = (label, path, type = 'text') => {
        var _a;
        return (_jsxs("div", { className: "col", children: [_jsx("label", { children: label }), _jsx("input", { type: type, value: (_a = get(ch, path)) !== null && _a !== void 0 ? _a : '', onChange: e => set(path, type === 'number' ? Number(e.target.value || 0) : e.target.value) })] }));
    };
    return (_jsxs("div", { className: "card", children: [_jsx("h3", { children: "Character Sheet" }), _jsxs("div", { className: "row", children: [field('Name', 'name'), field('Class', 'profile.class'), field('Level', 'resources.level', 'number'), field('EXP', 'resources.exp', 'number')] }), _jsxs("div", { className: "row", children: [field('HP', 'resources.hp', 'number'), field('Max HP', 'resources.maxHP', 'number'), _jsxs("div", { className: "col", children: [_jsx("label", { children: "Resource" }), _jsxs("select", { value: get(ch, 'resources.useTP') ? 'TP' : 'MP', onChange: e => set('resources.useTP', e.target.value === 'TP'), children: [_jsx("option", { children: "MP" }), _jsx("option", { children: "TP" })] })] }), get(ch, 'resources.useTP') ? field('TP', 'resources.tp', 'number') : (_jsxs(_Fragment, { children: [field('MP', 'resources.mp', 'number'), field('Max MP', 'resources.maxMP', 'number')] }))] }), _jsx("div", { className: "row", children: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(s => (_jsxs("div", { className: "col", children: [_jsx("label", { children: s }), _jsx("input", { type: "number", value: get(ch, `stats.${s}`) || 0, onChange: e => set(`stats.${s}`, Number(e.target.value || 0)) })] }, s))) }), _jsx("div", { className: "row", style: { justifyContent: 'flex-end' }, children: _jsx("button", { className: "btn", onClick: () => onSave(ch), disabled: !isDM && !game.permissions.canEditStats, children: "Save" }) })] }));
}
function Party({ game }) {
    return (_jsxs("div", { className: "card", children: [_jsx("h3", { children: "Party" }), _jsx("div", { className: "list", children: game.players.map((p) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                    return (_jsxs("div", { className: "row", style: { justifyContent: 'space-between' }, children: [_jsxs("div", { children: [_jsx("b", { children: p.role.toUpperCase() }), " \u00B7 ", (_b = (_a = p.character) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '—'] }), _jsxs("div", { className: "row", children: [_jsxs("span", { className: "pill", children: ["LV ", (_e = (_d = (_c = p.character) === null || _c === void 0 ? void 0 : _c.resources) === null || _d === void 0 ? void 0 : _d.level) !== null && _e !== void 0 ? _e : 1] }), _jsxs("span", { className: "pill", children: ["HP ", (_h = (_g = (_f = p.character) === null || _f === void 0 ? void 0 : _f.resources) === null || _g === void 0 ? void 0 : _g.hp) !== null && _h !== void 0 ? _h : 0, "/", (_l = (_k = (_j = p.character) === null || _j === void 0 ? void 0 : _j.resources) === null || _k === void 0 ? void 0 : _k.maxHP) !== null && _l !== void 0 ? _l : 0] })] })] }, p.userId));
                }) })] }));
}
function ItemsTab({ game, onUpdate }) {
    const [premade, setPremade] = useState([]);
    const [form, setForm] = useState({ name: '', type: '', desc: '' });
    useEffect(() => { (async () => setPremade(await Items.premade()))(); }, []);
    const add = async (item) => { try {
        await Games.addCustomItem(game.id, item);
        await onUpdate();
    }
    catch (e) {
        alert(e.message);
    } };
    return (_jsxs("div", { className: "row", children: [_jsxs("div", { className: "card", style: { flex: 1 }, children: [_jsx("h3", { children: "Custom Item" }), _jsxs("div", { className: "row", children: [_jsx("input", { placeholder: "Name", value: form.name, onChange: e => setForm({ ...form, name: e.target.value }) }), _jsx("input", { placeholder: "Type", value: form.type, onChange: e => setForm({ ...form, type: e.target.value }) }), _jsx("input", { placeholder: "Description", value: form.desc, onChange: e => setForm({ ...form, desc: e.target.value }) }), _jsx("button", { className: "btn", onClick: () => add(form), children: "Add" })] }), _jsx("h4", { style: { marginTop: 16 }, children: "Game Custom Items" }), _jsx("div", { className: "list", children: game.items.custom.map((it) => _jsxs("div", { className: "row", style: { justifyContent: 'space-between' }, children: [_jsxs("div", { children: [_jsx("b", { children: it.name }), " \u2014 ", it.type] }), _jsx("div", { children: it.desc })] }, it.id)) })] }), _jsxs("div", { className: "card", style: { width: 380 }, children: [_jsx("h3", { children: "Premade Items" }), _jsx("div", { className: "list", style: { maxHeight: 420, overflow: 'auto' }, children: premade.map((it, idx) => (_jsxs("div", { className: "row", style: { justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("div", { children: [_jsx("b", { children: it.name }), " ", _jsx("span", { className: "pill", children: it.type || '—' }), _jsx("div", { style: { opacity: .8, fontSize: 12 }, children: it.desc })] }), _jsx("button", { className: "btn", onClick: () => add({ name: it.name, type: it.type, desc: it.desc }), children: "Add" })] }, idx))) })] })] }));
}
function DemonTab({ game, onUpdate }) {
    const [name, setName] = useState('');
    const [arcana, setArc] = useState('');
    const [align, setAlign] = useState('');
    const [q, setQ] = useState('');
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const add = async () => { try {
        await Games.addDemon(game.id, { name, arcana, alignment: align });
        await onUpdate();
    }
    catch (e) {
        alert(e.message);
    } };
    const runSearch = async () => {
        try {
            if (!q.trim())
                return setResults([]);
            const r = await Personas.search(q.trim());
            setResults(r);
        }
        catch (e) {
            alert(e.message);
        }
    };
    const pick = async (slug) => {
        try {
            const p = await Personas.get(slug);
            setSelected(p);
            setName(p.name);
            setArc(p.arcana);
        }
        catch (e) {
            alert(e.message);
        }
    };
    return (_jsxs("div", { className: "card", children: [_jsx("h3", { children: "Shared Demon Pool" }), _jsx("div", { className: "row", style: { marginBottom: 10 }, children: _jsxs("span", { className: "pill", children: [game.demonPool.used, "/", game.demonPool.max, " used"] }) }), _jsxs("div", { className: "row", children: [_jsx("input", { placeholder: "Name", value: name, onChange: e => setName(e.target.value) }), _jsx("input", { placeholder: "Arcana", value: arcana, onChange: e => setArc(e.target.value) }), _jsx("input", { placeholder: "Alignment", value: align, onChange: e => setAlign(e.target.value) }), _jsx("button", { className: "btn", onClick: add, children: "Add Demon" })] }), _jsxs("div", { className: "row", style: { marginTop: 16 }, children: [_jsxs("div", { className: "col", style: { flex: 1 }, children: [_jsx("h4", { children: "Lookup Persona (Persona Compendium)" }), _jsxs("div", { className: "row", children: [_jsx("input", { placeholder: "Search name, e.g., jack frost", value: q, onChange: e => setQ(e.target.value) }), _jsx("button", { className: "btn", onClick: runSearch, children: "Search" })] }), _jsxs("div", { className: "list", style: { maxHeight: 240, overflow: 'auto', marginTop: 8 }, children: [results.map((r) => (_jsxs("div", { className: "row", style: { justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("div", { children: r.name }), _jsx("button", { className: "btn", onClick: () => pick(r.slug), children: "Use" })] }, r.slug))), results.length === 0 && _jsx("div", { style: { opacity: .7 }, children: "No results yet." })] })] }), _jsxs("div", { className: "col", style: { width: 360 }, children: [_jsx("h4", { children: "Preview" }), selected ? (_jsxs("div", { children: [selected.image && _jsx("img", { src: selected.image, alt: selected.name, style: { maxWidth: '100%', background: '#0b0c10', borderRadius: 12, border: '1px solid #1f2937' } }), _jsxs("div", { style: { marginTop: 8 }, children: [_jsx("b", { children: selected.name }), " \u00B7 ", selected.arcana, " \u00B7 LV ", selected.level] }), _jsx("div", { style: { opacity: .85, fontSize: 13, marginTop: 6 }, children: selected.description }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginTop: 8 }, children: [_jsxs("span", { className: "pill", children: ["STR ", selected.strength] }), _jsxs("span", { className: "pill", children: ["MAG ", selected.magic] }), _jsxs("span", { className: "pill", children: ["END ", selected.endurance] }), _jsxs("span", { className: "pill", children: ["AGI ", selected.agility] }), _jsxs("span", { className: "pill", children: ["LUC ", selected.luck] })] })] })) : _jsx("div", { style: { opacity: .7 }, children: "Pick a persona to preview" })] })] }), _jsx("div", { className: "list", style: { marginTop: 12 }, children: game.demons.map((d) => {
                    var _a, _b;
                    return (_jsxs("div", { className: "row", style: { justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("div", { children: [_jsx("b", { children: d.name }), " \u00B7 ", (_a = d.arcana) !== null && _a !== void 0 ? _a : '—', " \u00B7 ", (_b = d.alignment) !== null && _b !== void 0 ? _b : '—'] }), _jsx("button", { className: "btn", onClick: async () => { try {
                                    await Games.delDemon(game.id, d.id);
                                    await onUpdate();
                                }
                                catch (e) {
                                    alert(e.message);
                                } }, children: "Remove" })] }, d.id));
                }) })] }));
}
function SettingsTab({ game, onUpdate }) {
    const [perms, setPerms] = useState(game.permissions);
    useEffect(() => setPerms(game.permissions), [game.id]);
    return (_jsxs("div", { className: "card", children: [_jsx("h3", { children: "Permissions" }), Object.entries(perms).map(([k, v]) => (_jsxs("label", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsx("input", { type: "checkbox", checked: !!v, onChange: e => setPerms((p) => ({ ...p, [k]: e.target.checked })) }), k] }, k))), _jsx("div", { className: "row", style: { justifyContent: 'flex-end' }, children: _jsx("button", { className: "btn", onClick: () => onUpdate(perms), children: "Save" }) })] }));
}
function get(obj, path) { return path.split('.').reduce((o, k) => (o === null || o === void 0 ? void 0 : o[k]), obj); }
