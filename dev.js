/* eslint-env node */
import process from 'process';
import { spawn } from 'child_process';

const server = spawn('node', ['server.js'], { stdio: 'inherit' });

let exiting = false;
function close(code = 0) {
  if (exiting) return;
  exiting = true;
  if (!server.killed) {
    server.kill();
  }
  process.exit(code);
}

server.on('exit', code => close(code ?? 0));
server.on('error', err => {
  console.error('Error starting server:', err);
  close(1);
});

process.on('SIGINT', () => close(0));
process.on('SIGTERM', () => close(0));
