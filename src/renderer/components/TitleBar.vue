<script setup lang="ts">
import { onBeforeMount, ref } from "vue";

const props = defineProps({
  title: {
    type: String,
    default: null
  },
  icon: {
    type: String,
    default: null
  },
  iconFile: {
    type: String,
    default: null
  },
  hasHomeButton: Boolean,
  hasSettingsButton: Boolean,
  hasMinimizeButton: Boolean,
  hasMaximizeButton: Boolean,
  centerTitleText: Boolean,
  isMainWindow: {
    type: Boolean,
    default: false
  }
});

const minimizeWindow = window.ytmd.minimizeWindow;
const maximizeWindow = window.ytmd.maximizeWindow;
const restoreWindow = window.ytmd.restoreWindow;
const closeWindow = window.ytmd.closeWindow;

const openSettingsWindow = window.ytmd.openSettingsWindow;
const navigateToDefault = window.ytmd.ytmViewNavigateDefault;

const wcoVisible = ref(window.navigator.windowControlsOverlay.visible);
const windowMaximized = ref(false);
const windowFullscreen = ref(false);

window.ytmd.handleWindowEvents((event, state) => {
  windowMaximized.value = state.maximized;
  windowFullscreen.value = state.fullscreen;
});

window.navigator.windowControlsOverlay.addEventListener("geometrychange", event => {
  wcoVisible.value = event.visible;
});

function restartApplicationForUpdate() {
  window.ytmd.restartApplicationForUpdate();
}

const ytmViewUnresponsive = ref<boolean>(false);
const appUpdateDownloaded = ref<boolean>(false);

if (props.isMainWindow) {
  const memoryStore = window.ytmd.memoryStore;

  onBeforeMount(async () => {
    ytmViewUnresponsive.value = (await memoryStore.get("ytmViewUnresponsive")) ?? false;
    appUpdateDownloaded.value = (await memoryStore.get("appUpdateDownloaded")) ?? false;
  });

  memoryStore.onStateChanged(newState => {
    ytmViewUnresponsive.value = newState.ytmViewUnresponsive;
    appUpdateDownloaded.value = newState.appUpdateDownloaded;
  });
}
</script>

<template>
  <div v-if="!windowFullscreen" class="titlebar">
    <div class="left">
      <div class="title">
        <span v-if="icon" class="icon material-symbols-outlined">{{ icon }}</span>
        <img v-if="iconFile" class="icon" :src="iconFile" />
        <p v-if="title && !centerTitleText" class="title-text">{{ title }}{{ ytmViewUnresponsive ? " (Unresponsive)" : "" }}</p>
      </div>
    </div>
    <div v-if="title && centerTitleText" class="center">
      <p class="title-text">{{ title }}{{ ytmViewUnresponsive ? " (Unresponsive)" : "" }}</p>
    </div>
    <div class="right">
      <div v-if="isMainWindow" class="update-buttons">
        <button
          v-if="appUpdateDownloaded"
          class="app-button update-button"
          tabindex="1"
          title="Update ready! Click to restart"
          @click="restartApplicationForUpdate"
        >
          <span class="material-symbols-outlined">upgrade</span>
        </button>
      </div>
      <div class="app-buttons">
        <slot name="app-buttons"></slot>
        <button v-if="hasHomeButton" class="app-button" tabindex="2" @click="navigateToDefault">
          <span class="material-symbols-outlined">home</span>
        </button>
        <button v-if="hasSettingsButton" class="app-button" tabindex="3" @click="openSettingsWindow">
          <span class="material-symbols-outlined">settings</span>
        </button>
      </div>
      <div v-if="!wcoVisible" class="windows-action-buttons">
        <button v-if="hasMinimizeButton" class="action-button window-minimize" tabindex="4" @click="minimizeWindow">
          <span class="material-symbols-outlined">remove</span>
        </button>
        <button v-if="hasMaximizeButton && !windowMaximized" class="action-button window-maximize" tabindex="5" @click="maximizeWindow">
          <span class="material-symbols-outlined">square</span>
        </button>
        <button v-if="hasMinimizeButton && windowMaximized" class="action-button window-restore" tabindex="6" @click="restoreWindow">
          <span class="material-symbols-outlined">filter_none</span>
        </button>
        <button class="action-button window-close" tabindex="7" @click="closeWindow">
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
  display: flex;
  flex-direction: row;
  margin-right: 16px;
}

.title {
  display: flex;
  align-items: center;
  justify-content: center;
}

.title .icon {
  margin-left: 8px;
  margin-right: 8px;
  font-size: 13px;
  font-variation-settings:
    "FILL" 0,
    "wght" 100,
    "GRAD" 0,
    "opsz" 24;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.title .icon.material-symbols-outlined {
  font-size: 18px;
}

.title-text {
  font-family: "Open Sans", sans-serif;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  font-size: 14px;
}

.app-button {
  margin-right: 4px;
  height: 28px;
  width: 28px;
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
    "wght" 200,
    "GRAD" 0,
    "opsz" 28;
  cursor: pointer;
}

.app-button:hover {
  background-color: #222222;
}

.app-button > .material-symbols-outlined {
  font-size: 20px;
  color: #b4b4b4;
}

.app-buttons .divider {
  margin: 2px 4px;
  position: relative;
}

.app-buttons .divider:not(:last-child) {
  margin: 2px 4px 2px 1px;
  position: relative;
}

.app-buttons .divider:after {
  content: "";
  position: absolute;
  border-left: 1px solid #666666;
  right: 0;
  height: 100%;
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

.update-button {
  color: #f44336;
  margin-right: 24px;
}
</style>
