import { spawn } from 'child_process';

const server = spawn('node', ['server.js'], { stdio: 'inherit' });
const client = spawn('node', ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });

function close() {
  server.kill();
  client.kill();
}

server.on('exit', code => { close(); process.exit(code ?? 0); });
client.on('exit', code => { close(); process.exit(code ?? 0); });

process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
