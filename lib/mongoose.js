let mongooseModule;
try {
    const imported = await import('mongoose');
    mongooseModule = imported.default ?? imported;
} catch (err) {
    if (process.env.MOCK_MONGOOSE === 'true') {
        const mock = await import('./mockMongoose.js');
        mongooseModule = mock.default ?? mock;
        console.warn('[mock] Using in-memory mongoose stub.');
    } else {
        throw err;
    }
}

export default mongooseModule;
