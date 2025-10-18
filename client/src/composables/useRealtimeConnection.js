import { onBeforeUnmount, onMounted, reactive, ref, toRefs, unref, watch } from 'vue';
import { resolveRealtimeUrl } from '../api';

export const realtimeSymbol = Symbol('realtime-connection');

export function useRealtimeConnection({ gameId = null, autoConnect = true } = {}) {
    const socketRef = ref(null);
    const state = reactive({
        status: 'idle',
        connected: false,
        alerts: [],
        alertError: null,
        onlineUsers: {},
        musicState: null,
    });

    const resolvedGameId = () => unref(gameId);

    function attachSocket(ws) {
        ws.addEventListener('open', () => {
            state.status = 'connected';
            state.connected = true;
        });
        ws.addEventListener('close', () => {
            state.status = 'disconnected';
            state.connected = false;
            socketRef.value = null;
        });
        ws.addEventListener('error', () => {
            state.status = 'error';
        });
        ws.addEventListener('message', (event) => {
            try {
                const payload = JSON.parse(event.data);
                handleMessage(payload);
            } catch (err) {
                if (import.meta.env.DEV) {
                    console.warn('realtime message parse failed', err);
                }
            }
        });
    }

    function handleMessage(payload) {
        if (!payload || typeof payload !== 'object') return;
        switch (payload.type) {
            case 'alert': {
                const alert = normalizeAlert(payload.alert);
                if (alert) state.alerts = [...state.alerts, alert];
                break;
            }
            case 'online': {
                if (payload.users && typeof payload.users === 'object') {
                    state.onlineUsers = { ...payload.users };
                }
                break;
            }
            case 'music': {
                state.musicState = payload.snapshot || null;
                break;
            }
            default:
                break;
        }
    }

    function generateId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return `rt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    }

    function normalizeAlert(alert) {
        if (!alert || typeof alert !== 'object') return null;
        const id = typeof alert.id === 'string' ? alert.id : generateId();
        const message = typeof alert.message === 'string' ? alert.message : '';
        if (!message) return null;
        return {
            id,
            message,
            senderName: alert.senderName || 'System',
            issuedAt: alert.issuedAt || new Date().toISOString(),
            senderId: alert.senderId || null,
        };
    }

    function connect() {
        if (socketRef.value || typeof window === 'undefined' || typeof WebSocket === 'undefined') {
            return;
        }
        const id = resolvedGameId();
        if (!id) return;
        try {
            const url = resolveRealtimeUrl(`/ws/games/${encodeURIComponent(id)}`);
            const socket = new WebSocket(url);
            state.status = 'connecting';
            socketRef.value = socket;
            attachSocket(socket);
        } catch (err) {
            state.status = 'error';
            if (import.meta.env.DEV) {
                console.warn('Failed to open realtime socket', err);
            }
        }
    }

    function disconnect() {
        const socket = socketRef.value;
        if (!socket) return;
        socketRef.value = null;
        try {
            socket.close();
        } catch (err) {
            if (import.meta.env.DEV) {
                console.warn('Failed to close realtime socket', err);
            }
        }
    }

    function send(payload) {
        const socket = socketRef.value;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new Error('not_connected');
        }
        socket.send(JSON.stringify(payload));
    }

    function sendAlert(message) {
        if (!message) return;
        try {
            send({ type: 'alert', message });
        } catch (err) {
            const alert = {
                id: generateId(),
                message,
                senderName: 'You',
                issuedAt: new Date().toISOString(),
                senderId: null,
            };
            state.alerts = [...state.alerts, alert];
            state.alertError = err.message || 'Failed to send alert';
        }
    }

    function dismissAlert(alertId) {
        state.alerts = state.alerts.filter((alert) => alert.id !== alertId);
    }

    function syncMusic(snapshot) {
        state.musicState = snapshot || null;
    }

    watch(
        () => resolvedGameId(),
        (nextId, prevId) => {
            if (prevId && prevId !== nextId) {
                disconnect();
            }
            if (autoConnect && nextId) {
                connect();
            }
        },
        { immediate: autoConnect }
    );

    onMounted(() => {
        if (autoConnect && resolvedGameId()) {
            connect();
        }
    });

    onBeforeUnmount(() => {
        disconnect();
    });

    return {
        state,
        socket: socketRef,
        connect,
        disconnect,
        send,
        sendAlert,
        dismissAlert,
        syncMusic,
        ...toRefs(state),
    };
}

export default useRealtimeConnection;
