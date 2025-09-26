import session from 'express-session';
import { MongoClient } from 'mongodb';

function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? value : null;
    }
    const parsed = new Date(value);
    const time = parsed.getTime();
    return Number.isFinite(time) ? parsed : null;
}

function resolveMaxAge(session) {
    const cookie = session?.cookie;
    if (!cookie) return null;
    if (typeof cookie.maxAge === 'number' && Number.isFinite(cookie.maxAge) && cookie.maxAge > 0) {
        return cookie.maxAge;
    }
    if (typeof cookie.maxAge === 'string' && cookie.maxAge.trim()) {
        const parsed = Number(cookie.maxAge);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    if (typeof cookie.originalMaxAge === 'number' && Number.isFinite(cookie.originalMaxAge) && cookie.originalMaxAge > 0) {
        return cookie.originalMaxAge;
    }
    if (typeof cookie.originalMaxAge === 'string' && cookie.originalMaxAge.trim()) {
        const parsed = Number(cookie.originalMaxAge);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return null;
}

export default class MongoSessionStore extends session.Store {
    constructor(options = {}) {
        super();
        const {
            uri,
            client,
            clientPromise,
            dbName,
            collectionName = 'sessions',
            clientOptions = {},
            ttlSeconds = 60 * 60 * 24 * 7,
        } = options;

        if (!uri && !client && !clientPromise) {
            throw new Error('MongoSessionStore requires a MongoClient, clientPromise, or uri option');
        }

        this.collectionName = collectionName;
        this.dbName = dbName || undefined;
        this.ttlSeconds = Number.isFinite(ttlSeconds) && ttlSeconds > 0
            ? Math.floor(ttlSeconds)
            : 60 * 60 * 24 * 7;
        this.ttlMs = this.ttlSeconds * 1000;
        this._closed = false;

        if (client) {
            this.clientPromise = Promise.resolve(client);
        } else if (clientPromise) {
            this.clientPromise = clientPromise;
        } else {
            this.clientPromise = MongoClient.connect(uri, {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                ...clientOptions,
            });
        }

        this.collectionPromise = this.clientPromise
            .then(async (mongoClient) => {
                if (!mongoClient) {
                    throw new Error('MongoSessionStore could not acquire a MongoClient instance');
                }
                const db = this.dbName ? mongoClient.db(this.dbName) : mongoClient.db();
                const collection = db.collection(this.collectionName);
                await collection.createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
                this.collection = collection;
                return collection;
            })
            .catch((err) => {
                console.error('[session] Failed to initialize Mongo session store:', err);
                throw err;
            });
    }

    async close() {
        if (this._closed) return;
        this._closed = true;
        try {
            const client = await Promise.resolve(this.clientPromise).catch(() => null);
            if (client && typeof client.close === 'function') {
                await client.close();
            }
        } catch (err) {
            console.warn('[session] Failed to close Mongo session store client:', err);
        }
    }

    async _getCollection() {
        if (this.collection) return this.collection;
        return this.collectionPromise;
    }

    _computeExpiration(session) {
        const expires = toDate(session?.cookie?.expires);
        if (expires) return expires;

        const maxAge = resolveMaxAge(session);
        if (Number.isFinite(maxAge) && maxAge > 0) {
            return new Date(Date.now() + maxAge);
        }

        return new Date(Date.now() + this.ttlMs);
    }

    async get(sid, callback = () => {}) {
        try {
            const collection = await this._getCollection();
            const entry = await collection.findOne({ _id: sid });
            if (!entry) {
                callback(null, null);
                return;
            }
            if (entry.expires && entry.expires <= new Date()) {
                await collection.deleteOne({ _id: sid });
                callback(null, null);
                return;
            }
            callback(null, entry.session);
        } catch (err) {
            callback(err);
        }
    }

    async set(sid, sessionData, callback = () => {}) {
        try {
            const collection = await this._getCollection();
            const expires = this._computeExpiration(sessionData);
            await collection.updateOne(
                { _id: sid },
                { $set: { session: sessionData, expires } },
                { upsert: true },
            );
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    async destroy(sid, callback = () => {}) {
        try {
            const collection = await this._getCollection();
            await collection.deleteOne({ _id: sid });
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    async touch(sid, sessionData, callback = () => {}) {
        try {
            const collection = await this._getCollection();
            const expires = this._computeExpiration(sessionData);
            await collection.updateOne(
                { _id: sid },
                { $set: { expires, session: sessionData } },
                { upsert: true },
            );
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    async clear(callback = () => {}) {
        try {
            const collection = await this._getCollection();
            await collection.deleteMany({});
            callback(null);
        } catch (err) {
            callback(err);
        }
    }
}
