import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const devApiTarget = process.env.VITE_DEV_API_TARGET || 'http://localhost:3000'

function toWebSocketTarget(input) {
    const fallback = 'ws://localhost:3000'
    if (!input) return fallback
    try {
        const url = new URL(input)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        return url.toString()
    } catch {
        return fallback
    }
}

const devRealtimeTarget = process.env.VITE_DEV_REALTIME_TARGET || toWebSocketTarget(devApiTarget)

const projectRootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
    root: 'client',
    publicDir: '../public',
    build: {
        outDir: '../dist',
        emptyOutDir: true,
    },
    plugins: [react()],
    resolve: {
        alias: {
            '@shared': path.resolve(projectRootDir, 'shared'),
        },
    },
    server: {
        host: true,
        port: 5173,
        strictPort: true,
        allowedHosts: ['jack-endex.darkmatterservers.com'],
        fs: {
            allow: [projectRootDir],
        },
        proxy: {
            '/api': {
                target: devApiTarget,
                changeOrigin: true,
                secure: false,
                ws: true,
            },
            '/ws': {
                target: devRealtimeTarget,
                changeOrigin: true,
                secure: false,
                ws: true,
            }
        }
    }
})

