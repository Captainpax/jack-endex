import { importDemons } from './import-demons.js';

(async () => {
    try {
        const result = await importDemons({ dryRun: true });
        console.log(`Verified demon import mapping for ${result.count} entries.`);
    } catch (err) {
        console.error('Import verification failed:', err);
        process.exit(1);
    }
})();
