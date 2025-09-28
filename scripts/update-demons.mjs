#!/usr/bin/env node
/* eslint-env node */

import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { applyCsvFileToDemons, writeDemonsFile } from '../server/services/demonCsvImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage(message) {
    if (message) {
        console.error(`Error: ${message}`);
    }
    console.log(`
Usage:
  node scripts/update-demons.mjs [--json <path>] [--csv <path>] [--out <path>]
                                 [--dry-run] [--strict] [-y|--yes]

Defaults:
  --json ../server/data/demons.json
  --csv  ./demon_import.csv
  --out  same as --json
`);
    process.exit(message ? 1 : 0);
}

function parseArgs() {
    const args = {
        json: path.join(__dirname, '..', 'server', 'data', 'demons.json'),
        csv: path.join(__dirname, 'demon_import.csv'),
        out: null,
        dryRun: false,
        strict: false,
        yes: false,
    };

    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        switch (token) {
            case '--json':
                args.json = argv[++i];
                break;
            case '--csv':
                args.csv = argv[++i];
                break;
            case '--out':
                args.out = argv[++i];
                break;
            case '--dry-run':
                args.dryRun = true;
                break;
            case '--strict':
                args.strict = true;
                break;
            case '-y':
            case '--yes':
                args.yes = true;
                break;
            case '--help':
            case '-h':
                usage();
                break;
            default:
                usage(`Unknown argument: ${token}`);
        }
    }

    if (!args.out) args.out = args.json;
    return args;
}

async function confirmPrompt(message) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(`${message} [y/N]: `, (answer) => {
            rl.close();
            const normalized = String(answer || '').trim().toLowerCase();
            resolve(normalized === 'y' || normalized === 'yes');
        });
    });
}

function formatReport(result) {
    const lines = [];
    lines.push(`Rows processed: ${result.rowsProcessed}`);
    lines.push(`Demons updated: ${result.demonsUpdated}`);
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        lines.push('');
        lines.push('Warnings:');
        for (const warning of result.warnings) {
            lines.push(` - ${warning}`);
        }
    }
    lines.push('');
    for (const entry of result.changeLog) {
        const head = entry.who ? `→ ${entry.who}` : '→ (row)';
        if (entry.note) {
            lines.push(`${head}: ${entry.note}`);
        } else if (entry.changes?.length) {
            lines.push(`${head}:`);
            for (const change of entry.changes) {
                lines.push(`   ${change}`);
            }
        }
    }
    return lines.join('\n');
}

function timestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(
        now.getMinutes(),
    )}-${pad(now.getSeconds())}`;
}

(async () => {
    const options = parseArgs();

    try {
        const csvExists = await fs
            .access(options.csv)
            .then(() => true)
            .catch(() => false);
        if (!csvExists) usage(`CSV file not found: ${options.csv}`);

        const jsonExists = await fs
            .access(options.json)
            .then(() => true)
            .catch(() => false);
        if (!jsonExists) usage(`JSON file not found: ${options.json}`);

        const result = await applyCsvFileToDemons({
            csvPath: options.csv,
            jsonPath: options.json,
            strict: options.strict,
        });

        const report = formatReport(result);
        if (options.dryRun) {
            console.log('[DRY RUN] No files were written.\n');
            console.log(report);
            process.exit(0);
        }

        const outPath = options.out ? path.resolve(options.out) : path.resolve(options.json);
        const jsonPath = path.resolve(options.json);

        if (!options.yes && outPath === jsonPath) {
            const proceed = await confirmPrompt(`About to overwrite ${jsonPath}. Backup will be created. Proceed?`);
            if (!proceed) {
                console.log('Aborted by user.');
                process.exit(0);
            }
        }

        const originalContent = await fs.readFile(jsonPath, 'utf8');
        const backupPath = `${jsonPath}.${timestamp()}.bak`;
        await fs.writeFile(backupPath, originalContent, 'utf8');
        await writeDemonsFile(result.demons, outPath);

        console.log(`Backup created: ${backupPath}`);
        console.log(`Wrote updates to: ${outPath}\n`);
        console.log(report);
    } catch (err) {
        console.error(err?.stack || err?.message || String(err));
        process.exit(1);
    }
})();
