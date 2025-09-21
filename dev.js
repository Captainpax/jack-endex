/* eslint-env node */
import process from 'process';
import { spawn } from 'child_process';

const server = spawn('node', ['server.js'], { stdio: 'inherit' });

function close() {
  if (!server.killed) {
    server.kill();
  }
}

server.on('exit', code => { close(); process.exit(code ?? 0); });

process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
