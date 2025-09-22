import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv, envString } from '../config/env.js';
import { DEFAULT_DEMONS_PATH, loadDemonEntries } from '../lib/demonImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export async function importDemons({ file = DEFAULT_DEMONS_PATH, dryRun = false, dropMissing = true } = {}) {
    await loadEnv({ root: repoRoot });
    const entries = await loadDemonEntries({ file });
    if (dryRun) {
        console.log(`[dry-run] Prepared ${entries.length} demons for import.`);
        const sample = entries.slice(0, 3).map((entry) => ({ slug: entry.slug, name: entry.name, level: entry.level }));
        console.log('[dry-run] Sample:', sample);
        return { count: entries.length, entries: sample };
    }

    const mongooseModule = await import('../lib/mongoose.js');
    const mongoose = mongooseModule.default ?? mongooseModule;
    const DemonModule = await import('../models/Demon.js');
    const Demon = DemonModule.default ?? DemonModule;

    const uri = envString('MONGODB_URI');
    const dbName = envString('MONGODB_DB_NAME');
    if (!uri) {
        throw new Error('MONGODB_URI is not configured.');
    }

    await mongoose.connect(uri, { dbName: dbName || undefined });

    const bulkOps = entries.map((entry) => ({
        replaceOne: {
            filter: { slug: entry.slug },
            replacement: entry,
            upsert: true,
        },
    }));

    if (bulkOps.length > 0) {
        await Demon.bulkWrite(bulkOps, { ordered: false });
    }

    if (dropMissing) {
        const slugs = entries.map((entry) => entry.slug);
        await Demon.deleteMany({ slug: { $nin: slugs } });
    }

    await mongoose.disconnect();
    console.log(`Imported ${entries.length} demons into MongoDB.`);
    return { count: entries.length };
}

if (import.meta.url === process.argv[1] || import.meta.url === `file://${process.argv[1]}`) {
    const args = new Set(process.argv.slice(2));
    const dryRun = args.has('--dry-run');
    const keep = args.has('--keep-missing');
    importDemons({ dryRun, dropMissing: !keep })
        .catch((err) => {
            console.error('Failed to import demons:', err);
            process.exit(1);
        });
}
