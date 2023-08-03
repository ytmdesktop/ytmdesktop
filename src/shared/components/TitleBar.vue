<script setup lang="ts">
import { ref } from "vue";

defineProps({
  title: {
    type: String,
    default: null
  },
  icon: {
    type: String,
    default: null
  },
  hasSettingsButton: Boolean,
  hasMinimizeButton: Boolean,
  hasMaximizeButton: Boolean
});

const minimizeWindow = window.ytmd.minimizeWindow;
const maximizeWindow = window.ytmd.maximizeWindow;
const restoreWindow = window.ytmd.restoreWindow;
const closeWindow = window.ytmd.closeWindow;

const openSettingsWindow = window.ytmd.openSettingsWindow;

const wcoVisible = ref(window.navigator.windowControlsOverlay.visible);

const windowMaximized = ref(false);
const windowFullscreen = ref(false);

window.ytmd.handleWindowEvents((event, state) => {
  windowMaximized.value = state.maximized;
  windowFullscreen.value = state.fullscreen;
});
</script>

<template>
  <div v-if="!windowFullscreen" class="titlebar">
    <div class="left">
      <div v-if="title" class="title">
        <span v-if="icon" class="icon material-symbols-outlined">{{ icon }}</span>
        {{ title }}
      </div>
    </div>
    <div class="right">
      <div class="app-buttons">
        <button v-if="hasSettingsButton" class="app-button" tabindex="1" @click="openSettingsWindow">
          <span class="material-symbols-outlined">settings</span>
        </button>
      </div>
      <div v-if="!wcoVisible" class="windows-action-buttons">
        <button v-if="hasMinimizeButton" class="action-button window-minimize" tabindex="2" @click="minimizeWindow">
          <span class="material-symbols-outlined">remove</span>
        </button>
        <button v-if="hasMaximizeButton && !windowMaximized" class="action-button window-maximize" tabindex="3" @click="maximizeWindow">
          <span class="material-symbols-outlined">square</span>
        </button>
        <button v-if="hasMinimizeButton && windowMaximized" class="action-button window-restore" tabindex="4" @click="restoreWindow">
          <span class="material-symbols-outlined">filter_none</span>
        </button>
        <button class="action-button window-close" tabindex="5" @click="closeWindow">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  left: env(titlebar-area-x, 0);
  width: env(titlebar-area-width, 100%);
  height: 36px;
  user-select: none;
  -webkit-app-region: drag;
  background-color: #000000;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
}

.titlebar .left,
.titlebar .right {
  display: flex;
  align-items: center;
  justify-content: center;
}

.titlebar .left {
  margin-left: 4px;
}

.titlebar .right .app-buttons {
  margin-right: 4px;
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
    "FILL" 0,
    "wght" 100,
    "GRAD" 0,
    "opsz" 24;
}

.app-button {
  width: 28px;
  height: 28px;
  background: none;
  color: #bbbbbb;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  border: none;
  border-radius: 4px;
  font-variation-settings:
    "FILL" 0,
    "wght" 100,
    "GRAD" 0,
    "opsz" 28;
  cursor: pointer;
}

.app-button:hover {
  background-color: #222222;
}

.app-button > .material-symbols-outlined {
  font-size: 28px;
}

.action-button {
  width: 40px;
  height: 36px;
  background: none;
  color: #bbbbbb;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  border: none;
  font-variation-settings:
    "FILL" 0,
    "wght" 100,
    "GRAD" 0,
    "opsz" 24;
}

.action-button:hover {
  background-color: #222222;
}

.action-button > .material-symbols-outlined {
  font-size: 24px;
}

.windows-action-buttons {
  display: flex;
  margin-left: 8px;
}

.window-restore > .material-symbols-outlined {
  transform: rotate(180deg);
}

.window-close:hover {
  background-color: #e81123;
}
</style>
