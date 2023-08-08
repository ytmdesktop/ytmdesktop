<script setup lang="ts">
import { ref } from "vue";
import KeybindInput from "../../shared/components/KeybindInput.vue";
import { StoreSchema } from "../store/schema";

declare const YTMD_GIT_COMMIT_HASH: string;
declare const YTMD_GIT_BRANCH: string;

const ytmdVersion = await window.ytmd.getAppVersion();
const ytmdCommitHash = YTMD_GIT_COMMIT_HASH.substring(0, 6);
const ytmdBranch = YTMD_GIT_BRANCH;

const currentTab = ref(1);
const requiresRestart = ref(false);
const checkingForUpdate = ref(false);
const updateAvailable = ref(await window.ytmd.isAppUpdateAvailable());
const updateNotAvailable = ref(false);
const updateDownloaded = ref(await window.ytmd.isAppUpdateDownloaded());

const store = window.ytmd.store;
const safeStorage = window.ytmd.safeStorage;

const general: StoreSchema["general"] = await store.get("general");
const appearance: StoreSchema["appearance"] = await store.get("appearance");
const playback: StoreSchema["playback"] = await store.get("playback");
const integrations: StoreSchema["integrations"] = await store.get("integrations");
const shortcuts: StoreSchema["shortcuts"] = await store.get("shortcuts");

const hideToTrayOnClose = ref<boolean>(general.hideToTrayOnClose);
const showNotificationOnSongChange = ref<boolean>(general.showNotificationOnSongChange);
const startOnBoot = ref<boolean>(general.startOnBoot);
const startMinimized = ref<boolean>(general.startMinimized);
const disableHardwareAcceleration = ref<boolean>(general.disableHardwareAcceleration);

const alwaysShowVolumeSlider = ref<boolean>(appearance.alwaysShowVolumeSlider);

const continueWhereYouLeftOff = ref<boolean>(playback.continueWhereYouLeftOff);
const continueWhereYouLeftOffPaused = ref<boolean>(playback.continueWhereYouLeftOffPaused);
const progressInTaskbar = ref<boolean>(playback.progressInTaskbar);
const enableSpeakerFill = ref<boolean>(playback.enableSpeakerFill);

const companionServerEnabled = ref<boolean>(integrations.companionServerEnabled);
const companionServerAuthWindowEnabled = ref<boolean>(
  (await safeStorage.decryptString(integrations.companionServerAuthWindowEnabled)) === "true" ? true : false
);
const discordPresenceEnabled = ref<boolean>(integrations.discordPresenceEnabled);

const shortcutPlayPause = ref<string>(shortcuts.playPause);
const shortcutNext = ref<string>(shortcuts.next);
const shortcutPrevious = ref<string>(shortcuts.previous);
const shortcutThumbsUp = ref<string>(shortcuts.thumbsUp);
const shortcutThumbsDown = ref<string>(shortcuts.thumbsDown);
const shortcutVolumeUp = ref<string>(shortcuts.volumeUp);
const shortcutVolumeDown = ref<string>(shortcuts.volumeDown);

store.onDidAnyChange(async newState => {
  hideToTrayOnClose.value = newState.general.hideToTrayOnClose;
  showNotificationOnSongChange.value = newState.general.showNotificationOnSongChange;
  startOnBoot.value = newState.general.startOnBoot;
  startMinimized.value = newState.general.startMinimized;
  disableHardwareAcceleration.value = newState.general.disableHardwareAcceleration;

  alwaysShowVolumeSlider.value = newState.appearance.alwaysShowVolumeSlider;

  continueWhereYouLeftOff.value = newState.playback.continueWhereYouLeftOff;
  continueWhereYouLeftOffPaused.value = newState.playback.continueWhereYouLeftOffPaused;
  progressInTaskbar.value = newState.playback.progressInTaskbar;
  enableSpeakerFill.value = newState.playback.enableSpeakerFill;

  companionServerEnabled.value = newState.integrations.companionServerEnabled;
  companionServerAuthWindowEnabled.value = (await safeStorage.decryptString(newState.integrations.companionServerAuthWindowEnabled)) === "true" ? true : false;
  discordPresenceEnabled.value = newState.integrations.discordPresenceEnabled;

  shortcutPlayPause.value = newState.shortcuts.playPause;
  shortcutNext.value = newState.shortcuts.next;
  shortcutPrevious.value = newState.shortcuts.previous;
  shortcutThumbsUp.value = newState.shortcuts.thumbsUp;
  shortcutThumbsDown.value = newState.shortcuts.thumbsDown;
  shortcutVolumeUp.value = newState.shortcuts.volumeUp;
  shortcutVolumeDown.value = newState.shortcuts.volumeDown;
});

async function settingsChanged() {
  store.set("general.hideToTrayOnClose", hideToTrayOnClose.value);
  store.set("general.showNotificationOnSongChange", showNotificationOnSongChange.value);
  store.set("general.startOnBoot", startOnBoot.value);
  store.set("general.startMinimized", startMinimized.value);
  store.set("general.disableHardwareAcceleration", disableHardwareAcceleration.value);

  store.set("appearance.alwaysShowVolumeSlider", alwaysShowVolumeSlider.value);

  store.set("playback.continueWhereYouLeftOff", continueWhereYouLeftOff.value);
  store.set("playback.continueWhereYouLeftOffPaused", continueWhereYouLeftOffPaused.value);
  store.set("playback.progressInTaskbar", progressInTaskbar.value);
  store.set("playback.enableSpeakerFill", enableSpeakerFill.value);

  store.set("integrations.companionServerEnabled", companionServerEnabled.value);
  store.set("integrations.companionServerAuthWindowEnabled", await safeStorage.encryptString(companionServerAuthWindowEnabled.value.toString()));
  store.set("integrations.discordPresenceEnabled", discordPresenceEnabled.value);

  store.set("shortcuts.playPause", shortcutPlayPause.value);
  store.set("shortcuts.next", shortcutNext.value);
  store.set("shortcuts.previous", shortcutPrevious.value);
  store.set("shortcuts.thumbsUp", shortcutThumbsUp.value);
  store.set("shortcuts.thumbsDown", shortcutThumbsDown.value);
  store.set("shortcuts.volumeUp", shortcutVolumeUp.value);
  store.set("shortcuts.volumeDown", shortcutVolumeDown.value);
}

async function settingChangedRequiresRestart() {
  requiresRestart.value = true;
  settingsChanged();
}

function changeTab(newTab: number) {
  currentTab.value = newTab;
}

function restartApplication() {
  window.ytmd.restartApplication();
}

function restartApplicationForUpdate() {
  window.ytmd.restartApplicationForUpdate();
}

function checkForUpdates() {
  window.ytmd.checkForUpdates();
  checkingForUpdate.value = true;
}

window.ytmd.handleCheckingForUpdate(() => {
  checkingForUpdate.value = true;
});

window.ytmd.handleUpdateAvailable(() => {
  checkingForUpdate.value = false;
  updateAvailable.value = true;
  updateNotAvailable.value = false;
});

window.ytmd.handleUpdateNotAvailable(() => {
  checkingForUpdate.value = false;
  updateNotAvailable.value = true;
  updateAvailable.value = false;
});

window.ytmd.handleUpdateDownloaded(() => {
  checkingForUpdate.value = false;
  updateNotAvailable.value = false;
  updateAvailable.value = false;
  updateDownloaded.value = true;
});
</script>

<template>
  <div class="settings-container">
    <div v-if="requiresRestart" class="restart-banner">
      <p class="message"><span class="material-symbols-outlined">autorenew</span> Restart app to apply changes</p>
      <button class="restart-button" @click="restartApplication">Restart</button>
    </div>
    <div class="content-container">
      <ul class="sidebar">
        <li :class="{ active: currentTab === 1 }" @click="changeTab(1)"><span class="material-symbols-outlined">settings_applications</span>General</li>
        <li :class="{ active: currentTab === 2 }" @click="changeTab(2)"><span class="material-symbols-outlined">brush</span>Appearance</li>
        <li :class="{ active: currentTab === 3 }" @click="changeTab(3)"><span class="material-symbols-outlined">music_note</span>Playback</li>
        <li :class="{ active: currentTab === 4 }" @click="changeTab(4)"><span class="material-symbols-outlined">wifi_tethering</span>Integrations</li>
        <li :class="{ active: currentTab === 5 }" @click="changeTab(5)"><span class="material-symbols-outlined">keyboard</span>Shortcuts</li>
        <span class="push"></span>
        <li :class="{ active: currentTab === 99 }" @click="changeTab(99)"><span class="material-symbols-outlined">info</span>About</li>
      </ul>
      <div class="content">
        <div v-if="currentTab === 1" class="general-tab">
          <div class="setting">
            <p>Hide to tray on close</p>
            <input v-model="hideToTrayOnClose" class="toggle" type="checkbox" @change="settingsChanged" />
          </div>
          <!--<div class="setting">
          <p>Show notification on song change</p>
          <input v-model="showNotificationOnSongChange" @change="settingsChanged" class="toggle"
              type="checkbox" />
        </div>-->
          <div class="setting">
            <p>Start on boot</p>
            <input v-model="startOnBoot" class="toggle" type="checkbox" @change="settingsChanged" />
          </div>
          <!--<div class="setting">
          <p>Start minimized</p>
          <input v-model="startMinimized" @change="settingsChanged" class="toggle" type="checkbox" />
        </div>-->
          <div class="setting">
            <p>Disable hardware acceleration <span class="reload-required material-symbols-outlined">autorenew</span></p>
            <input v-model="disableHardwareAcceleration" class="toggle" type="checkbox" @change="settingChangedRequiresRestart" />
          </div>
        </div>

        <div v-if="currentTab === 2" class="appearance-tab">
          <div class="setting">
            <p>Always show volume slider</p>
            <input v-model="alwaysShowVolumeSlider" class="toggle" type="checkbox" @change="settingsChanged" />
          </div>
        </div>

        <div v-if="currentTab === 3" class="playback-tab">
          <div class="setting">
            <p>Continue where you left off</p>
            <input v-model="continueWhereYouLeftOff" class="toggle" type="checkbox" @change="settingsChanged" />
          </div>
          <div v-if="continueWhereYouLeftOff" class="setting indented">
            <p>Pause on application launch</p>
            <input v-model="continueWhereYouLeftOffPaused" class="toggle" type="checkbox" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p>Show track progress on taskbar</p>
            <input v-model="progressInTaskbar" class="toggle" type="checkbox" @change="settingsChanged" />
          </div>
          <!-- enableSpeakerFill -->
          <div class="setting">
            <p>Enable speaker fill <span class="reload-required material-symbols-outlined">autorenew</span></p>
            <input v-model="enableSpeakerFill" class="toggle" type="checkbox" @change="settingChangedRequiresRestart" />
          </div>
        </div>

        <div v-if="currentTab === 4" class="integrations-tab">
          <div class="setting">
            <p>Companion server</p>
            <input v-model="companionServerEnabled" class="toggle" type="checkbox" @change="settingsChanged" />
          </div>
          <div v-if="companionServerEnabled" class="setting indented">
            <div class="name-with-description">
              <p class="name">Enable companion authorization</p>
              <p class="description">Automatically disables after the first successful authorization or 5 minutes has passed</p>
            </div>
            <input v-model="companionServerAuthWindowEnabled" class="toggle" type="checkbox" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p>Discord rich presence</p>
            <input v-model="discordPresenceEnabled" class="toggle" type="checkbox" @change="settingsChanged" />
          </div>
        </div>

        <div v-if="currentTab === 5" class="shortcuts-tab">
          <div class="setting">
            <p>Play/Pause</p>
            <KeybindInput v-model="shortcutPlayPause" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p>Next</p>
            <KeybindInput v-model="shortcutNext" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p>Previous</p>
            <KeybindInput v-model="shortcutPrevious" @change="settingsChanged" />
          </div>
          <!--<div class="setting">
                    <p>Thumbs Up</p>
                    <KeybindInput v-model="shortcutThumbsUp" @change="settingsChanged" />
                </div> 
                <div class="setting">
                    <p>Thumbs Down</p>
                    <KeybindInput v-model="shortcutThumbsDown" @change="settingsChanged" />
                </div>-->
          <div class="setting">
            <p>Increase Volume</p>
            <KeybindInput v-model="shortcutVolumeUp" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p>Decrease Volume</p>
            <KeybindInput v-model="shortcutVolumeDown" @change="settingsChanged" />
          </div>
        </div>

        <div v-if="currentTab === 99" class="about-tab">
          <img class="icon" src="../../assets/icons/ytmd.png" />
          <h2 class="app-name">YouTube Music Desktop App</h2>
          <p class="made-by">Made by YTMDesktop Team</p>
          <button
            v-if="!updateDownloaded"
            :disabled="!(!checkingForUpdate && !updateAvailable && !updateDownloaded)"
            class="update-check-button"
            @click="checkForUpdates"
          >
            <span class="material-symbols-outlined">update</span>Check for updates
          </button>
          <button v-if="updateDownloaded" class="update-button" @click="restartApplicationForUpdate">
            <span class="material-symbols-outlined">upgrade</span>Restart to update
          </button>
          <p v-if="checkingForUpdate && !updateAvailable && !updateDownloaded" class="updating">
            <span class="material-symbols-outlined">progress_activity</span>Checking for updates...
          </p>
          <p v-if="updateAvailable && !updateDownloaded" class="updating">
            <span class="material-symbols-outlined">progress_activity</span>Downloading update...
          </p>
          <p v-if="updateNotAvailable" class="no-update">Update not available</p>
          <span class="version-info">
            <p class="version">Version: {{ ytmdVersion }}</p>
            <p class="branch">Branch: {{ ytmdBranch }}</p>
            <p class="commit">Commit: {{ ytmdCommitHash }}</p>
          </span>
          <div class="links">
            <a href="https://github.com/ytmdesktop/ytmdesktop" target="_blank">GitHub</a>
            <a href="https://ytmdesktop.app" target="_blank">Website</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-container {
  height: calc(100% - 36px);
  display: flex;
  flex-direction: column;
  user-select: none;
}

.content-container {
  display: flex;
  flex-grow: 1;
}

.content {
  overflow: auto;
  flex-grow: 1;
  padding: 4px 16px;
}

.sidebar {
  width: 25%;
  min-width: 25%;
  list-style-type: none;
  margin: unset;
  padding: unset;
  height: 100%;
  border-right: 1px solid #212121;
  display: flex;
  flex-direction: column;
}

.sidebar li {
  display: flex;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  color: #bbbbbb;
}

.sidebar li .material-symbols-outlined {
  font-size: 28px;
  font-variation-settings:
    "FILL" 0,
    "wght" 100,
    "GRAD" 0,
    "opsz" 28;
}

.sidebar li:hover {
  background-color: #111111;
}

.sidebar li.active {
  background-color: #212121;
  color: #eeeeee;
}

.sidebar li .material-symbols-outlined {
  margin-right: 8px;
}

.sidebar .push {
  flex-grow: 1;
}

.setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.setting.indented {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid #212121;
}

.name-with-description .name {
  margin-bottom: unset;
}

.name-with-description .description {
  margin-top: 4px;
  color: #969696;
}

.toggle {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  min-width: 62px;
  min-height: 32px;
  width: 62px;
  height: 32px;
  display: inline-block;
  position: relative;
  border-radius: 50px;
  overflow: hidden;
  outline: none;
  border: none;
  cursor: pointer;
  background-color: #212121;
  transition: background-color ease 0.3s;
}

.toggle:before {
  content: "";
  display: block;
  position: absolute;
  z-index: 2;
  width: 28px;
  height: 28px;
  background: #fff;
  left: 2px;
  top: 2px;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: all ease 0.3s;
}

.toggle:checked {
  background-color: #f44336;
}

.toggle:checked:before {
  left: 32px;
}

.reload-required {
  vertical-align: middle;
}

.about-tab {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  height: 100%;
}

.icon {
  width: 128px;
  height: 128px;
  margin-bottom: 16px;
}

.app-name {
  margin: 0;
}

.version,
.branch,
.commit {
  margin: 4px 0;
  color: #bbbbbb;
}

.made-by {
  margin: 16px 0;
}

.links {
  margin-top: 32px;
  width: 100%;
  display: flex;
  justify-content: space-evenly;
}

.links a {
  color: #bbbbbb;
}

.restart-banner {
  background-color: #f44336;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.restart-banner .message {
  display: flex;
  align-items: center;
}

.restart-banner .message .material-symbols-outlined {
  margin: 0 8px;
}

.restart-banner .restart-button {
  margin: 0 8px;
  background-color: transparent;
  border: 1px solid #ffffff;
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
}

.update-check-button {
  display: flex;
  align-items: center;
  background-color: transparent;
  border: 1px solid #ffffff;
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.updating,
.no-update {
  display: flex;
  align-items: center;
  color: #888888;
  margin: 0 0 8px 0;
}

.updating .material-symbols-outlined {
  animation: rotation 1s infinite linear;
}

@keyframes rotation {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(359deg);
  }
}

.update-button {
  display: flex;
  align-items: center;
  background-color: #f44336;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.update-check-button .material-symbols-outlined,
.updating .material-symbols-outlined,
.update-button .material-symbols-outlined {
  margin-right: 4px;
}

.version-info {
  user-select: text;
}
</style>
