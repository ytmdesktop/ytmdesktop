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
        YTMD_UPDATE_FEED_OWNER: `"ytmdesktop"`,
        YTMD_UPDATE_FEED_REPOSITORY: `"ytmdesktop"`,
        YTMD_DISABLE_UPDATES: true
    }
});
