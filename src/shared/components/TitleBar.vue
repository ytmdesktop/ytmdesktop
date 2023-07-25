<script setup lang="ts">
import { slotFlagsText } from '@vue/shared';
import { stringify } from 'json5';
import { ref } from 'vue';

defineProps({
    title: String,
    icon: String,
    hasSettingsButton: Boolean,
    hasMinimizeButton: Boolean,
    hasMaximizeButton: Boolean
})

const minimizeWindow = window.ytmd.minimizeWindow;
const maximizeWindow = window.ytmd.maximizeWindow;
const restoreWindow = window.ytmd.restoreWindow;
const closeWindow = window.ytmd.closeWindow;

const openSettingsWindow = window.ytmd.openSettingsWindow;

const windowMaximized = ref(false);

window.ytmd.handleWindowEvents((event, state) => {
    windowMaximized.value = state.maximized;
});
</script>

<template>
    <div class="titlebar">
        <div class="left">
            <div v-if="title" class="title">
                <span v-if="icon" class="icon material-symbols-outlined">{{ icon }}</span>
                {{ title }}
            </div>
        </div>
        <div class="right">
            <div class="app-buttons">
                <button v-if="hasSettingsButton" class="app-button" @click="openSettingsWindow" tabindex="1">
                    <span class="material-symbols-outlined">settings</span>
                </button>
            </div>
            <div class="windows-action-buttons">
                <button v-if="hasMinimizeButton" class="action-button window-minimize" @click="minimizeWindow"
                    tabindex="2">
                    <span class="material-symbols-outlined">remove</span>
                </button>
                <button v-if="hasMaximizeButton && !windowMaximized" class="action-button window-maximize"
                    @click="maximizeWindow" tabindex="3">
                    <span class="material-symbols-outlined">square</span>
                </button>
                <button v-if="hasMinimizeButton && windowMaximized" class="action-button window-restore"
                    @click="restoreWindow" tabindex="4">
                    <span class="material-symbols-outlined">filter_none</span>
                </button>
                <button class="action-button window-close" @click="closeWindow" tabindex="5">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.titlebar {
    width: 100%;
    height: 36px;
    user-select: none;
    -webkit-app-region: drag;
    background-color: #000000;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.titlebar .left,
.titlebar .right {
    display: flex;
    align-items: center;
    justify-content: center;
}

.title {
    display: flex;
    align-items: center;
    justify-content: center;
}

.title .icon {
    margin-left: 4px;
    margin-right: 4px;
    font-size: 24px;
    font-variation-settings:
        'FILL' 0,
        'wght' 100,
        'GRAD' 0,
        'opsz' 24;
}

/*button:focus {
    outline: none;
}*/

.app-button {
    width: 28px;
    height: 28px;
    background: none;
    color: #BBBBBB;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: no-drag;
    border: none;
    border-radius: 4px;
    font-variation-settings:
        'FILL' 0,
        'wght' 100,
        'GRAD' 0,
        'opsz' 28;
    cursor: pointer;
}

.app-button:hover {
    background-color: #222222;
}

.app-button>.material-symbols-outlined {
    font-size: 28px;
}

.action-button {
    width: 40px;
    height: 36px;
    background: none;
    color: #BBBBBB;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: no-drag;
    border: none;
    font-variation-settings:
        'FILL' 0,
        'wght' 100,
        'GRAD' 0,
        'opsz' 24;
}

.action-button:hover {
    background-color: #222222;
}

.action-button>.material-symbols-outlined {
    font-size: 24px;
}

.windows-action-buttons {
    display: flex;
    margin-left: 8px;
}

.window-restore>.material-symbols-outlined {
    transform: rotate(180deg);
}

.window-close:hover {
    background-color: #E81123;
}
</style>