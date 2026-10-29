export {}

declare global {
    interface Window {
        __YTMD_HOOK__: {
            ytmPlayerController: any,
            ytmStateStore: any
        }
    }
}