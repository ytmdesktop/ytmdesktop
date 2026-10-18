import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
    build: {
        outDir: ".vite/main",
        rolldownOptions: {
            external: ["xosms"]
        }
    },
    define: {
        YTMD_UPDATE_FEED_OWNER: process.env.YTMD_UPDATE_FEED_OWNER ? JSON.stringify(process.env.YTMD_UPDATE_FEED_OWNER) : null,
        YTMD_UPDATE_FEED_REPOSITORY: process.env.YTMD_UPDATE_FEED_REPOSITORY ? JSON.stringify(process.env.YTMD_UPDATE_FEED_REPOSITORY) : null,
        YTMD_DISABLE_UPDATES: process.env.NODE_ENV !== "production"
    }
});
