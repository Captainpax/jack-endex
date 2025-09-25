import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react' // remove if not using React

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5173,
        strictPort: true,
        allowedHosts: ['jack-endex.darkmatterservers.com'],
        proxy: {
            // Frontend calls `/api/...` and Vite forwards to your Node API
            '/api': {
                target: 'https://jack-api.darkmatterservers.com', // <- your API port
                changeOrigin: true,
                secure: false,
                ws: true,
                // if your backend expects the path without the /api prefix, uncomment:
                // rewrite: (path) => path.replace(/^\/api/, '')
            },
            // Proxy websocket connections used for real-time features in dev mode
            '/ws': {
                target: 'wss://jack-api.darkmatterservers.com',
                changeOrigin: true,
                secure: false,
                ws: true,
            },
        }
    }
})