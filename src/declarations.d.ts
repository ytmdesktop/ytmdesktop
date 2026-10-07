/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

declare module "*?raw" {
    const src: string;
    export default src;
}