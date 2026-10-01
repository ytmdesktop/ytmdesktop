<script setup lang="ts">
import { ref } from "vue";
import KeybindInput from "../../components/KeybindInput.vue";
import YTMDSetting from "../../components/YTMDSetting.vue";
import { StoreSchema, TrayIconStyle, InstalledExtension } from "~shared/store/schema";
import { AuthToken } from "~shared/integrations/companion-server/types";
import logo from "~assets/icons/ytmd.png";

declare const YTMD_GIT_COMMIT_HASH: string;
declare const YTMD_GIT_BRANCH: string;

const ytmdVersion = await window.ytmd.getAppVersion();
const ytmdCommitHash = YTMD_GIT_COMMIT_HASH.substring(0, 7);
const ytmdBranch = YTMD_GIT_BRANCH;

const isDarwin = window.ytmd.isDarwin;
const isLinux = window.ytmd.isLinux;

const currentTab = ref(1);
const requiresRestart = ref(false);
const checkingForUpdate = ref(false);
const updateAvailable = ref(await window.ytmd.isAppUpdateAvailable());
const updateNotAvailable = ref(false);
const updateDownloaded = ref(await window.ytmd.isAppUpdateDownloaded());

const store = window.ytmd.store;
const memoryStore = window.ytmd.memoryStore;
const safeStorage = window.ytmd.safeStorage;

const safeStorageAvailable = ref<boolean>(await memoryStore.get("safeStorageAvailable"));

const general: StoreSchema["general"] = await store.get("general");
const appearance: StoreSchema["appearance"] = await store.get("appearance");
const playback: StoreSchema["playback"] = await store.get("playback");
const integrations: StoreSchema["integrations"] = await store.get("integrations");
const shortcuts: StoreSchema["shortcuts"] = await store.get("shortcuts");
const lastFM: StoreSchema["lastfm"] = await store.get("lastfm");

const disableHardwareAcceleration = ref<boolean>(general.disableHardwareAcceleration);
const hideToTrayOnClose = ref<boolean>(general.hideToTrayOnClose);
const showNotificationOnSongChange = ref<boolean>(general.showNotificationOnSongChange);
const startOnBoot = ref<boolean>(general.startOnBoot);
const startMinimized = ref<boolean>(general.startMinimized);

const alwaysShowVolumeSlider = ref<boolean>(appearance.alwaysShowVolumeSlider);
const customCSSEnabled = ref<boolean>(appearance.customCSSEnabled);
const customCSSPath = ref<string>(appearance.customCSSPath);
const zoom = ref<number>(appearance.zoom);
const trayIconStyle = ref<number>(appearance.trayIconStyle);

const continueWhereYouLeftOff = ref<boolean>(playback.continueWhereYouLeftOff);
const continueWhereYouLeftOffPaused = ref<boolean>(playback.continueWhereYouLeftOffPaused);
const enableSpeakerFill = ref<boolean>(playback.enableSpeakerFill);
const progressInTaskbar = ref<boolean>(playback.progressInTaskbar);
const ratioVolume = ref<boolean>(playback.ratioVolume);
const skipSilence = ref<boolean>(playback.skipSilence ?? true);
const adBlock = ref<boolean>(playback.adBlock ?? true);

const downloaderConfig: StoreSchema["downloader"] = (await store.get("downloader")) || {
  enabled: true,
  autoDownload: false,
  downloadPath: null
};
const autoDownload = ref<boolean>(downloaderConfig.autoDownload ?? false);
const downloadFolder = ref<string>("Downloads\\YouTube Music");

try {
  const p = await window.ytmd.downloader?.getDownloadPath?.();
  if (p) downloadFolder.value = p;
} catch {
  // ignore
}

async function toggleAutoDownload() {
  store.set("downloader.autoDownload", autoDownload.value);
}

async function openDownloadFolder() {
  await window.ytmd.downloader?.openFolder?.();
}

async function changeDownloadFolder() {
  const selected = await window.ytmd.downloader?.selectFolder?.();
  if (selected) {
    downloadFolder.value = selected;
  }
}

const companionServerEnabled = ref<boolean>(integrations.companionServerEnabled);
const companionServerAuthTokens = ref<AuthToken[]>(
  safeStorageAvailable.value ? (JSON.parse(await safeStorage.decryptString(integrations.companionServerAuthTokens)) ?? []) : []
);
const companionServerCORSWildcardEnabled = ref<boolean>(integrations.companionServerCORSWildcardEnabled);
const discordPresenceEnabled = ref<boolean>(integrations.discordPresenceEnabled);
const lastFMEnabled = ref<boolean>(integrations.lastFMEnabled);

const shortcutPlayPause = ref<string>(shortcuts.playPause);
const shortcutNext = ref<string>(shortcuts.next);
const shortcutPrevious = ref<string>(shortcuts.previous);
const shortcutThumbsUp = ref<string>(shortcuts.thumbsUp);
const shortcutThumbsDown = ref<string>(shortcuts.thumbsDown);
const shortcutVolumeUp = ref<string>(shortcuts.volumeUp);
const shortcutVolumeDown = ref<string>(shortcuts.volumeDown);

const lastFMSessionKey = ref<string>(lastFM.sessionKey);
const scrobblePercent = ref<number>(lastFM.scrobblePercent);

store.onDidAnyChange(async newState => {
  disableHardwareAcceleration.value = newState.general.disableHardwareAcceleration;
  hideToTrayOnClose.value = newState.general.hideToTrayOnClose;
  showNotificationOnSongChange.value = newState.general.showNotificationOnSongChange;
  startOnBoot.value = newState.general.startOnBoot;
  startMinimized.value = newState.general.startMinimized;

  alwaysShowVolumeSlider.value = newState.appearance.alwaysShowVolumeSlider;
  customCSSEnabled.value = newState.appearance.customCSSEnabled;
  customCSSPath.value = newState.appearance.customCSSPath;
  zoom.value = newState.appearance.zoom;
  trayIconStyle.value = newState.appearance.trayIconStyle;

  continueWhereYouLeftOff.value = newState.playback.continueWhereYouLeftOff;
  continueWhereYouLeftOffPaused.value = newState.playback.continueWhereYouLeftOffPaused;
  enableSpeakerFill.value = newState.playback.enableSpeakerFill;
  progressInTaskbar.value = newState.playback.progressInTaskbar;
  ratioVolume.value = newState.playback.ratioVolume;
  skipSilence.value = newState.playback.skipSilence ?? true;
  adBlock.value = newState.playback.adBlock ?? true;

  if (newState.downloader) {
    autoDownload.value = newState.downloader.autoDownload ?? false;
  }

  companionServerEnabled.value = newState.integrations.companionServerEnabled;
  companionServerAuthTokens.value = safeStorageAvailable.value
    ? (JSON.parse(await safeStorage.decryptString(newState.integrations.companionServerAuthTokens)) ?? [])
    : [];
  companionServerCORSWildcardEnabled.value = newState.integrations.companionServerCORSWildcardEnabled;
  discordPresenceEnabled.value = newState.integrations.discordPresenceEnabled;
  lastFMEnabled.value = newState.integrations.lastFMEnabled;
  lastFMSessionKey.value = newState.lastfm.sessionKey;
  scrobblePercent.value = newState.lastfm.scrobblePercent;

  shortcutPlayPause.value = newState.shortcuts.playPause;
  shortcutNext.value = newState.shortcuts.next;
  shortcutPrevious.value = newState.shortcuts.previous;
  shortcutThumbsUp.value = newState.shortcuts.thumbsUp;
  shortcutThumbsDown.value = newState.shortcuts.thumbsDown;
  shortcutVolumeUp.value = newState.shortcuts.volumeUp;
  shortcutVolumeDown.value = newState.shortcuts.volumeDown;
});

const discordPresenceConnectionFailed = ref<boolean>(await memoryStore.get("discordPresenceConnectionFailed"));

const shortcutsPlayPauseRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsPlayPauseRegisterFailed"));
const shortcutsNextRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsNextRegisterFailed"));
const shortcutsPreviousRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsPreviousRegisterFailed"));
const shortcutsThumbsUpRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsThumbsUpRegisterFailed"));
const shortcutsThumbsDownRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsThumbsDownRegisterFailed"));
const shortcutsVolumeUpRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsVolumeUpRegisterFailed"));
const shortcutsVolumeDownRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsVolumeDownRegisterFailed"));

const companionServerAuthWindowEnabled = ref<boolean>(await memoryStore.get("companionServerAuthWindowEnabled"));

const autoUpdaterDisabled = ref<boolean>(await memoryStore.get("autoUpdaterDisabled"));

memoryStore.onStateChanged(newState => {
  discordPresenceConnectionFailed.value = newState.discordPresenceConnectionFailed;

  shortcutsPlayPauseRegisterFailed.value = newState.shortcutsPlayPauseRegisterFailed;
  shortcutsNextRegisterFailed.value = newState.shortcutsNextRegisterFailed;
  shortcutsPreviousRegisterFailed.value = newState.shortcutsPreviousRegisterFailed;
  shortcutsThumbsUpRegisterFailed.value = newState.shortcutsThumbsUpRegisterFailed;
  shortcutsThumbsDownRegisterFailed.value = newState.shortcutsThumbsDownRegisterFailed;
  shortcutsVolumeUpRegisterFailed.value = newState.shortcutsVolumeUpRegisterFailed;
  shortcutsVolumeDownRegisterFailed.value = newState.shortcutsVolumeDownRegisterFailed;

  companionServerAuthWindowEnabled.value = newState.companionServerAuthWindowEnabled;

  safeStorageAvailable.value = newState.safeStorageAvailable;

  autoUpdaterDisabled.value = newState.autoUpdaterDisabled;
});

async function memorySettingsChanged() {
  memoryStore.set("companionServerAuthWindowEnabled", companionServerAuthWindowEnabled.value);
}

async function settingsChanged() {
  store.set("general.hideToTrayOnClose", hideToTrayOnClose.value);
  store.set("general.showNotificationOnSongChange", showNotificationOnSongChange.value);
  store.set("general.startOnBoot", startOnBoot.value);
  store.set("general.startMinimized", startMinimized.value);
  store.set("general.disableHardwareAcceleration", disableHardwareAcceleration.value);

  store.set("appearance.alwaysShowVolumeSlider", alwaysShowVolumeSlider.value);
  store.set("appearance.customCSSEnabled", customCSSEnabled.value);
  store.set("appearance.zoom", zoom.value);
  store.set("appearance.trayIconStyle", trayIconStyle.value);

  store.set("playback.continueWhereYouLeftOff", continueWhereYouLeftOff.value);
  store.set("playback.continueWhereYouLeftOffPaused", continueWhereYouLeftOffPaused.value);
  store.set("playback.progressInTaskbar", progressInTaskbar.value);
  store.set("playback.enableSpeakerFill", enableSpeakerFill.value);
  store.set("playback.ratioVolume", ratioVolume.value);
  store.set("playback.skipSilence", skipSilence.value);
  store.set("playback.adBlock", adBlock.value);

  store.set("integrations.companionServerEnabled", companionServerEnabled.value);
  store.set("integrations.companionServerCORSWildcardEnabled", companionServerCORSWildcardEnabled.value);
  store.set("integrations.discordPresenceEnabled", discordPresenceEnabled.value);
  store.set("integrations.lastFMEnabled", lastFMEnabled.value);
  store.set("lastfm.scrobblePercent", scrobblePercent.value);

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

async function settingChangedFile(event: Event) {
  const target = event.target as HTMLInputElement;

  const setting = target.dataset.setting;
  if (!setting) {
    throw new Error("No setting specified in File Input");
  }

  store.set(setting, target.files.length > 0 ? window.ytmd.getTrueFilePath(target.files[0]) : null);

  target.value = null;
}

async function restartDiscordPresence() {
  discordPresenceEnabled.value = false;
  await settingsChanged();
  discordPresenceEnabled.value = true;
  await settingsChanged();
}

async function deleteCompanionAuthToken(appId: string) {
  const index = companionServerAuthTokens.value.findIndex(token => token.appId === appId);
  if (index > -1) {
    companionServerAuthTokens.value.splice(index, 1);
  }

  if (safeStorageAvailable.value)
    store.set("integrations.companionServerAuthTokens", await safeStorage.encryptString(JSON.stringify(companionServerAuthTokens.value)));
}

function removeCustomCSSPath() {
  store.set("appearance.customCSSPath", null);
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

async function logoutLastFM() {
  store.set("lastfm.sessionKey", null);
  lastFMEnabled.value = false;
  lastFMSessionKey.value = null;
  await settingsChanged();
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

// Extensions state & methods
const extensionsList = ref<InstalledExtension[]>([]);
const extensionInput = ref("");
const isInstallingExtension = ref(false);
const extensionError = ref("");
const extensionSuccess = ref("");

async function refreshExtensions() {
  if (window.ytmd?.extensions?.getItems) {
    try {
      extensionsList.value = await window.ytmd.extensions.getItems();
    } catch {
      extensionsList.value = [];
    }
  }
}

await refreshExtensions();

function isPresetInstalled(id: string): boolean {
  return extensionsList.value.some(ext => ext.id === id);
}

async function installFromWebStore() {
  if (!extensionInput.value.trim()) return;
  isInstallingExtension.value = true;
  extensionError.value = "";
  extensionSuccess.value = "";
  try {
    const ext = await window.ytmd.extensions.installFromUrlOrId(extensionInput.value.trim());
    extensionSuccess.value = `Berhasil memasang "${ext.name}"!`;
    extensionInput.value = "";
    await refreshExtensions();
  } catch (err: unknown) {
    extensionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    isInstallingExtension.value = false;
  }
}

async function installPresetExtension(id: string) {
  isInstallingExtension.value = true;
  extensionError.value = "";
  extensionSuccess.value = "";
  try {
    const ext = await window.ytmd.extensions.installFromUrlOrId(id);
    extensionSuccess.value = `Berhasil memasang "${ext.name}"!`;
    await refreshExtensions();
  } catch (err: unknown) {
    extensionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    isInstallingExtension.value = false;
  }
}

async function installFromFolder() {
  extensionError.value = "";
  extensionSuccess.value = "";
  try {
    const ext = await window.ytmd.extensions.installFromFolder();
    if (ext) {
      extensionSuccess.value = `Berhasil memasang "${ext.name}" dari folder!`;
      await refreshExtensions();
    }
  } catch (err: unknown) {
    extensionError.value = err instanceof Error ? err.message : String(err);
  }
}

async function installFromArchive() {
  extensionError.value = "";
  extensionSuccess.value = "";
  try {
    const ext = await window.ytmd.extensions.installFromArchive();
    if (ext) {
      extensionSuccess.value = `Berhasil memasang "${ext.name}" dari file arsip!`;
      await refreshExtensions();
    }
  } catch (err: unknown) {
    extensionError.value = err instanceof Error ? err.message : String(err);
  }
}

async function toggleExtension(ext: InstalledExtension) {
  extensionError.value = "";
  try {
    await window.ytmd.extensions.toggle(ext.id, ext.enabled);
    await refreshExtensions();
  } catch (err: unknown) {
    extensionError.value = err instanceof Error ? err.message : String(err);
  }
}

async function removeExtension(id: string) {
  extensionError.value = "";
  try {
    await window.ytmd.extensions.remove(id);
    await refreshExtensions();
  } catch (err: unknown) {
    extensionError.value = err instanceof Error ? err.message : String(err);
  }
}

async function openExtensionFolder(id: string) {
  await window.ytmd.extensions.openFolder(id);
}

async function reloadPlayer() {
  await window.ytmd.extensions.reloadView();
}
</script>

<template>
  <div class="settings-container">
    <div class="content-container">
      <ul class="sidebar">
        <li :class="{ active: currentTab === 1 }" @click="changeTab(1)"><span class="material-symbols-outlined">settings_applications</span>General</li>
        <li :class="{ active: currentTab === 2 }" @click="changeTab(2)"><span class="material-symbols-outlined">brush</span>Appearance</li>
        <li :class="{ active: currentTab === 3 }" @click="changeTab(3)"><span class="material-symbols-outlined">music_note</span>Playback</li>
        <li :class="{ active: currentTab === 4 }" @click="changeTab(4)"><span class="material-symbols-outlined">wifi_tethering</span>Integrations</li>
        <li :class="{ active: currentTab === 5 }" @click="changeTab(5)"><span class="material-symbols-outlined">keyboard</span>Shortcuts</li>
        <li :class="{ active: currentTab === 6 }" @click="changeTab(6)"><span class="material-symbols-outlined">extension</span>Extensions</li>
        <li :class="{ active: currentTab === 7 }" @click="changeTab(7)"><span class="material-symbols-outlined">download</span>Downloads</li>
        <span class="push"></span>
        <li :class="{ active: currentTab === 99 }" @click="changeTab(99)"><span class="material-symbols-outlined">info</span>About</li>
      </ul>
      <div class="content">
        <div v-if="requiresRestart" class="restart-banner">
          <p class="message"><span class="material-symbols-outlined">autorenew</span> Restart app to apply changes</p>
          <button class="restart-button" @click="restartApplication">Restart</button>
        </div>
        <div v-if="currentTab === 1" class="general-tab">
          <YTMDSetting v-if="!isDarwin" v-model="hideToTrayOnClose" type="checkbox" name="Hide to tray on close" @change="settingsChanged" />
          <YTMDSetting v-model="showNotificationOnSongChange" type="checkbox" name="Show notification on song change" @change="settingsChanged" />
          <YTMDSetting v-model="startOnBoot" type="checkbox" name="Start on boot" @change="settingsChanged" />
          <!--<div class="setting">
            <p>Start minimized</p>
            <input v-model="startMinimized" @change="settingsChanged" class="toggle" type="checkbox" />
          </div>-->
          <YTMDSetting
            v-model="disableHardwareAcceleration"
            type="checkbox"
            restart-required
            name="Disable hardware acceleration"
            @change="settingChangedRequiresRestart"
          />
        </div>

        <div v-if="currentTab === 2" class="appearance-tab">
          <YTMDSetting v-model="alwaysShowVolumeSlider" type="checkbox" name="Always show volume slider" @change="settingsChanged" />
          <YTMDSetting v-model="customCSSEnabled" type="checkbox" name="Custom CSS" @change="settingsChanged" />
          <YTMDSetting
            v-if="customCSSEnabled"
            v-model="customCSSPath"
            type="file"
            indented
            bind-setting="appearance.customCSSPath"
            name="Custom CSS file path"
            @file-change="settingChangedFile"
            @clear="removeCustomCSSPath"
          />
          <YTMDSetting v-model="zoom" type="range" max="300" min="30" step="10" name="Zoom" @change="settingsChanged" />
          <YTMDSetting
            v-if="isLinux"
            v-model="trayIconStyle"
            :options-map="{ [TrayIconStyle.Auto]: 'Auto', [TrayIconStyle.White]: 'White', [TrayIconStyle.Black]: 'Black' }"
            type="select"
            name="Tray icon style"
            @change="settingsChanged"
          />
        </div>

        <div v-if="currentTab === 3" class="playback-tab">
          <YTMDSetting v-model="continueWhereYouLeftOff" name="Continue where you left off" type="checkbox" @change="settingsChanged" />
          <YTMDSetting
            v-if="continueWhereYouLeftOff"
            v-model="continueWhereYouLeftOffPaused"
            type="checkbox"
            indented
            name="Pause on application launch"
            @change="settingsChanged"
          />
          <YTMDSetting v-model="progressInTaskbar" type="checkbox" name="Show track progress on taskbar" @change="settingsChanged" />
          <YTMDSetting v-model="enableSpeakerFill" type="checkbox" restart-required name="Enable speaker fill" @change="settingChangedRequiresRestart" />
          <YTMDSetting v-model="ratioVolume" type="checkbox" name="Ratio volume" @change="settingsChanged" />
          <YTMDSetting
            v-model="skipSilence"
            type="checkbox"
            name="Skip silence (Lewati audio hening)"
            description="Secara otomatis melewati bagian hening / audio kosong di awal dan di akhir lagu secara presisi"
            @change="settingsChanged"
          />
          <YTMDSetting
            v-model="adBlock"
            type="checkbox"
            name="Blokir Iklan Otomatis (Built-in Ad Blocker)"
            description="Blokir semua iklan audio, banner, dan video secara otomatis di YouTube Music"
            @change="settingsChanged"
          />
        </div>

        <div v-if="currentTab === 4" class="integrations-tab">
          <YTMDSetting
            v-model="companionServerEnabled"
            type="checkbox"
            name="Companion server"
            :disabled="!safeStorageAvailable"
            disabled-message="This integration cannot be enabled due to safeStorage being unavailable"
            @change="settingsChanged"
          />
          <YTMDSetting
            v-if="companionServerEnabled && safeStorageAvailable"
            v-model="companionServerCORSWildcardEnabled"
            type="checkbox"
            indented
            name="Allow browser communication"
            description="This setting could be dangerous as it allows any website you visit to communicate with the companion server"
            @change="settingsChanged"
          />
          <YTMDSetting
            v-if="companionServerEnabled && safeStorageAvailable"
            v-model="companionServerAuthWindowEnabled"
            type="checkbox"
            indented
            name="Enable companion authorization"
            description="Automatically disables after the first successful authorization or 5 minutes has passed"
            @change="memorySettingsChanged"
          />
          <YTMDSetting
            v-if="companionServerEnabled && safeStorageAvailable"
            type="custom"
            flex-column
            indented
            name="Authorized companions"
            description="This is a list of companions that currently have access to the companion server"
            @change="settingsChanged"
          >
            <table class="authorized-companions-table">
              <thead>
                <tr>
                  <th class="companion">Companion</th>
                  <th class="version">Version</th>
                  <th class="controls"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="authToken in companionServerAuthTokens" :key="authToken.appId">
                  <td class="companion">
                    <span class="name">{{ authToken.appName }}</span
                    ><br />
                    <span class="id">{{ authToken.appId }}</span>
                  </td>
                  <td class="version">{{ authToken.appVersion }}</td>
                  <td class="controls">
                    <button @click="deleteCompanionAuthToken(authToken.appId)"><span class="material-symbols-outlined">delete</span></button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="companionServerAuthTokens.length === 0" class="no-authorized-companions">
              <td>No authorized companions</td>
            </div>
          </YTMDSetting>
          <YTMDSetting v-model="discordPresenceEnabled" type="checkbox" name="Discord rich presence" @change="settingsChanged" />
          <div v-if="discordPresenceEnabled && discordPresenceConnectionFailed" class="setting indented">
            <p class="discord-failure">Discord connection could not be established after 30 attempts</p>
            <button @click="restartDiscordPresence">Retry</button>
          </div>
          <YTMDSetting
            v-model="lastFMEnabled"
            type="checkbox"
            name="Last.fm scrobbling"
            :disabled="!safeStorageAvailable"
            disabled-message="This integration cannot be enabled due to safeStorage being unavailable"
            @change="settingsChanged"
          />
          <div v-if="lastFMEnabled" class="setting indented">
            <div class="name-with-description">
              <p class="description">
                User is Authenticated:
                <span v-if="lastFMSessionKey" style="color: #4caf50">Yes</span>
                <span v-else style="color: #ff1100">No</span>
              </p>
            </div>
            <button v-if="lastFMSessionKey" @click="logoutLastFM">Logout</button>
          </div>
          <YTMDSetting
            v-if="lastFMEnabled"
            v-model="scrobblePercent"
            class="settings indented"
            type="range"
            name="Scrobble percent"
            description="Determines when a song is scrobbled"
            min="50"
            max="95"
            step="5"
            @change="settingsChanged"
          />
        </div>

        <div v-if="currentTab === 5" class="shortcuts-tab">
          <div class="setting">
            <p class="shortcut-title">
              Play/Pause<span
                v-if="shortcutsPlayPauseRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutPlayPause" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Next<span
                v-if="shortcutsNextRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutNext" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Previous<span
                v-if="shortcutsPreviousRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutPrevious" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Thumbs Up<span
                v-if="shortcutsThumbsUpRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutThumbsUp" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Thumbs Down<span
                v-if="shortcutsThumbsDownRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutThumbsDown" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Increase Volume<span
                v-if="shortcutsVolumeUpRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutVolumeUp" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Decrease Volume<span
                v-if="shortcutsVolumeDownRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutVolumeDown" @change="settingsChanged" />
          </div>
        </div>

        <div v-if="currentTab === 6" class="extensions-tab">
          <!-- Notification banners -->
          <div v-if="extensionSuccess" class="ext-alert success">
            <span class="material-symbols-outlined">check_circle</span>
            <p>{{ extensionSuccess }}</p>
            <button class="ext-alert-close" @click="extensionSuccess = ''"><span class="material-symbols-outlined">close</span></button>
          </div>
          <div v-if="extensionError" class="ext-alert error">
            <span class="material-symbols-outlined">error</span>
            <p>{{ extensionError }}</p>
            <button class="ext-alert-close" @click="extensionError = ''"><span class="material-symbols-outlined">close</span></button>
          </div>

          <!-- Section: Built-in Features -->
          <div class="ext-section builtin-section">
            <h3 class="ext-section-title">
              <span class="material-symbols-outlined">verified</span>
              Fitur Bawaan Terpasang Otomatis
            </h3>
            <p class="ext-section-desc">Fitur lirik tersinkronisasi dan pemblokir iklan sudah terintegrasi secara otomatis saat aplikasi dibuka:</p>
            <div class="builtin-cards-container">
              <div class="builtin-feat-card">
                <div class="builtin-feat-top">
                  <span class="material-symbols-outlined builtin-feat-icon lyrics">lyrics</span>
                  <div class="builtin-feat-info">
                    <strong>Better Lyrics (Lirik Tersinkronisasi)</strong>
                    <span class="builtin-tag">Aktif Otomatis</span>
                  </div>
                </div>
                <p>Lirik bergulir realtime kata per kata mengikuti lagu, opsi terjemahan, dan kustomisasi tema visual pada panel lirik.</p>
              </div>

              <div class="builtin-feat-card">
                <div class="builtin-feat-top">
                  <span class="material-symbols-outlined builtin-feat-icon adblock">shield</span>
                  <div class="builtin-feat-info">
                    <strong>AdBlocker Built-in</strong>
                    <span class="builtin-tag">Aktif Otomatis</span>
                  </div>
                </div>
                <p>Memfilter request jaringan iklan dan otomatis melewati interupsi iklan video seketika tanpa jeda.</p>
              </div>
            </div>
          </div>

          <!-- Section: Install from Web Store -->
          <div class="ext-section">
            <h3 class="ext-section-title">
              <span class="material-symbols-outlined">add_circle</span>
              Pasang dari Chrome Web Store
            </h3>
            <p class="ext-section-desc">Masukkan URL dari Chrome Web Store atau Extension ID (32 karakter) untuk mengunduh dan memasang ekstensi langsung.</p>
            <div class="ext-install-form">
              <input
                v-model="extensionInput"
                type="text"
                class="ext-url-input"
                placeholder="Contoh: https://chromewebstore.google.com/detail/... atau ID ekstensi"
                :disabled="isInstallingExtension"
                @keyup.enter="installFromWebStore"
              />
              <button class="ext-btn primary" :disabled="isInstallingExtension || !extensionInput.trim()" @click="installFromWebStore">
                <span v-if="!isInstallingExtension" class="material-symbols-outlined">download</span>
                <span v-else class="material-symbols-outlined spinning">progress_activity</span>
                {{ isInstallingExtension ? "Memasang..." : "Pasang" }}
              </button>
            </div>
          </div>

          <!-- Section: Recommended Extensions -->
          <div class="ext-section">
            <h3 class="ext-section-title">
              <span class="material-symbols-outlined">recommend</span>
              Rekomendasi Ekstensi Populer
            </h3>
            <div class="ext-presets-grid">
              <div class="ext-preset-card">
                <div class="preset-info">
                  <strong>Better Lyrics</strong>
                  <p>Lirik tersinkronisasi (time-synced lyrics) kata per kata, terjemahan real-time, dan tema kustom untuk YouTube Music.</p>
                </div>
                <button
                  class="ext-btn small"
                  :class="{ installed: isPresetInstalled('effdbpeggelllpfkjppbokhmmiinhlmg') }"
                  :disabled="isInstallingExtension || isPresetInstalled('effdbpeggelllpfkjppbokhmmiinhlmg')"
                  @click="installPresetExtension('effdbpeggelllpfkjppbokhmmiinhlmg')"
                >
                  <span class="material-symbols-outlined">{{ isPresetInstalled("effdbpeggelllpfkjppbokhmmiinhlmg") ? "check" : "add" }}</span>
                  {{ isPresetInstalled("effdbpeggelllpfkjppbokhmmiinhlmg") ? "Terpasang" : "Pasang" }}
                </button>
              </div>

              <div class="ext-preset-card">
                <div class="preset-info">
                  <strong>SponsorBlock for YouTube</strong>
                  <p>Lewati segmen sponsor, intro, dan promosi secara otomatis pada pemutar YouTube Music.</p>
                </div>
                <button
                  class="ext-btn small"
                  :class="{ installed: isPresetInstalled('mnjggcdmjocbbbhaepdhchncahnbgone') }"
                  :disabled="isInstallingExtension || isPresetInstalled('mnjggcdmjocbbbhaepdhchncahnbgone')"
                  @click="installPresetExtension('mnjggcdmjocbbbhaepdhchncahnbgone')"
                >
                  <span class="material-symbols-outlined">{{ isPresetInstalled("mnjggcdmjocbbbhaepdhchncahnbgone") ? "check" : "add" }}</span>
                  {{ isPresetInstalled("mnjggcdmjocbbbhaepdhchncahnbgone") ? "Terpasang" : "Pasang" }}
                </button>
              </div>

              <div class="ext-preset-card">
                <div class="preset-info">
                  <strong>uBlock Origin Lite</strong>
                  <p>Pemblokir iklan & pelacak resmi Manifest V3. Memblokir iklan YouTube Music, banner, dan tracker dengan efisiensi tinggi.</p>
                </div>
                <button
                  class="ext-btn small"
                  :class="{ installed: isPresetInstalled('ddkjiahejlhfcafbddmgiahcphecmpfh') }"
                  :disabled="isInstallingExtension || isPresetInstalled('ddkjiahejlhfcafbddmgiahcphecmpfh')"
                  @click="installPresetExtension('ddkjiahejlhfcafbddmgiahcphecmpfh')"
                >
                  <span class="material-symbols-outlined">{{ isPresetInstalled("ddkjiahejlhfcafbddmgiahcphecmpfh") ? "check" : "add" }}</span>
                  {{ isPresetInstalled("ddkjiahejlhfcafbddmgiahcphecmpfh") ? "Terpasang" : "Pasang" }}
                </button>
              </div>

              <div class="ext-preset-card">
                <div class="preset-info">
                  <strong>Return YouTube Dislike</strong>
                  <p>Mengembalikan jumlah dislike pada video YouTube Music.</p>
                </div>
                <button
                  class="ext-btn small"
                  :class="{ installed: isPresetInstalled('gebbhagfogifgggkldgodflihgfeippi') }"
                  :disabled="isInstallingExtension || isPresetInstalled('gebbhagfogifgggkldgodflihgfeippi')"
                  @click="installPresetExtension('gebbhagfogifgggkldgodflihgfeippi')"
                >
                  <span class="material-symbols-outlined">{{ isPresetInstalled("gebbhagfogifgggkldgodflihgfeippi") ? "check" : "add" }}</span>
                  {{ isPresetInstalled("gebbhagfogifgggkldgodflihgfeippi") ? "Terpasang" : "Pasang" }}
                </button>
              </div>
            </div>
          </div>

          <!-- Section: Local file install & reload actions -->
          <div class="ext-section">
            <h3 class="ext-section-title">
              <span class="material-symbols-outlined">folder_zip</span>
              Pasang dari File Lokal
            </h3>
            <div class="ext-actions-row">
              <button class="ext-btn secondary" @click="installFromFolder">
                <span class="material-symbols-outlined">folder_open</span>
                Pilih Folder Unpacked (manifest.json)
              </button>
              <button class="ext-btn secondary" @click="installFromArchive">
                <span class="material-symbols-outlined">archive</span>
                Pilih File .crx / .zip
              </button>
              <button class="ext-btn secondary" title="Muat ulang pemutar YouTube Music untuk menerapkan ekstensi" @click="reloadPlayer">
                <span class="material-symbols-outlined">refresh</span>
                Muat Ulang Pemutar
              </button>
            </div>
          </div>

          <!-- Section: Installed Extensions List -->
          <div class="ext-section">
            <div class="ext-list-header">
              <h3 class="ext-section-title">
                <span class="material-symbols-outlined">list</span>
                Ekstensi Terpasang
                <span class="ext-count-badge">{{ extensionsList.length }}</span>
              </h3>
            </div>

            <div v-if="extensionsList.length === 0" class="ext-empty-state">
              <span class="material-symbols-outlined empty-icon">extension_off</span>
              <h4>Belum Ada Ekstensi yang Terpasang</h4>
              <p>Anda dapat memasang ekstensi menggunakan form Chrome Web Store di atas atau memilih dari rekomendasi ekstensi.</p>
            </div>

            <div v-else class="ext-list">
              <div v-for="ext in extensionsList" :key="ext.id" class="ext-item-card" :class="{ disabled: !ext.enabled }">
                <div class="ext-item-main">
                  <img v-if="ext.icon" :src="ext.icon" class="ext-icon-img" alt="icon" />
                  <span v-else class="material-symbols-outlined ext-icon-placeholder">extension</span>

                  <div class="ext-item-details">
                    <div class="ext-item-title-row">
                      <span class="ext-item-name">{{ ext.name }}</span>
                      <span class="ext-item-version">v{{ ext.version }}</span>
                      <span class="ext-item-source-badge">{{ ext.source }}</span>
                    </div>
                    <p class="ext-item-description">{{ ext.description }}</p>
                  </div>
                </div>

                <div class="ext-item-actions">
                  <input
                    type="checkbox"
                    :checked="ext.enabled"
                    class="ext-toggle"
                    :title="ext.enabled ? 'Nonaktifkan ekstensi' : 'Aktifkan ekstensi'"
                    @change="toggleExtension(ext)"
                  />
                  <button class="ext-icon-btn" title="Buka Folder Ekstensi" @click="openExtensionFolder(ext.id)">
                    <span class="material-symbols-outlined">folder</span>
                  </button>
                  <button class="ext-icon-btn danger" title="Hapus Ekstensi" @click="removeExtension(ext.id)">
                    <span class="material-symbols-outlined">delete</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentTab === 7" class="downloads-tab">
          <div class="ext-section">
            <h3 class="ext-section-title">
              <span class="material-symbols-outlined">download_for_offline</span>
              Pengaturan Unduhan Musik (MP3 320kbps)
            </h3>
            <p class="ext-section-desc">
              Unduh lagu favorit langsung ke komputer Anda dalam format MP3 kualitas tertinggi (320kbps) lengkap dengan cover album dan metadata (judul, artis,
              album).
            </p>

            <div class="dl-setting-card">
              <div class="dl-setting-info">
                <strong>Download Otomatis (Auto-download Lagu)</strong>
                <p>Secara otomatis mengunduh setiap lagu yang sedang Anda putar ke folder komputer di latar belakang.</p>
              </div>
              <input v-model="autoDownload" type="checkbox" class="ext-toggle" @change="toggleAutoDownload" />
            </div>

            <div class="dl-setting-card dl-folder-card">
              <div class="dl-setting-info">
                <strong>Folder Lokasi Penyimpanan</strong>
                <p class="dl-folder-path">{{ downloadFolder }}</p>
              </div>
              <div class="dl-folder-actions">
                <button class="ext-btn" @click="openDownloadFolder">
                  <span class="material-symbols-outlined">folder_open</span>
                  Buka Folder
                </button>
                <button class="ext-btn secondary" @click="changeDownloadFolder">
                  <span class="material-symbols-outlined">edit</span>
                  Ubah Lokasi
                </button>
              </div>
            </div>

            <div class="dl-info-cards">
              <div class="dl-feature-pill">
                <span class="material-symbols-outlined">music_note</span>
                <div>
                  <strong>Format MP3 320kbps</strong>
                  <p>Bitrate maksimal untuk kualitas suara jernih.</p>
                </div>
              </div>
              <div class="dl-feature-pill">
                <span class="material-symbols-outlined">image</span>
                <div>
                  <strong>Cover Art & ID3 Tag</strong>
                  <p>Gambar album dan metadata lagu otomatis tertanam.</p>
                </div>
              </div>
              <div class="dl-feature-pill">
                <span class="material-symbols-outlined">smart_button</span>
                <div>
                  <strong>Tombol Player Bar</strong>
                  <p>Tombol unduh satu klik langsung di player bar YouTube Music.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentTab === 99" class="about-tab">
          <img class="icon" :src="logo" />
          <h2 class="app-name">YouTube Music Desktop App</h2>
          <p class="made-by">Made by YTMDesktop Team</p>
          <template v-if="!autoUpdaterDisabled">
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
          </template>
          <template v-if="autoUpdaterDisabled">
            <button disabled class="update-check-button"><span class="material-symbols-outlined">update</span>Check for updates</button>
            <p class="no-auto-updater">Auto updater disabled</p>
          </template>
          <span class="version-info">
            <p class="version">Version: {{ ytmdVersion }}</p>
            <p class="branch">Branch: {{ ytmdBranch }}</p>
            <p class="commit">Commit: {{ ytmdCommitHash }}</p>
          </span>
          <div class="links">
            <a href="https://github.com/ytmdesktop/ytmdesktop" target="_blank">GitHub</a>
            <a href="https://ytmdesktop.github.io/" target="_blank">Website</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-container {
  user-select: none;
}

.content-container {
  display: flex;
  height: 100%;
}

.content {
  overflow: auto;
  flex-grow: 1;
  padding: 4px 16px;
}

.content::-webkit-scrollbar {
  width: 12px;
}

.content::-webkit-scrollbar-track {
  background: #212121;
}

.content::-webkit-scrollbar-thumb {
  background-color: #414141;
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

.version-info .version,
.version-info .branch,
.version-info .commit {
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

.update-check-button:disabled {
  border: 1px solid #888888;
  cursor: not-allowed;
}

.updating,
.no-update {
  display: flex;
  align-items: center;
  color: #888888;
  margin: 0 0 8px 0;
}

.no-auto-updater {
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

.setting.disabled {
  color: #c6c6c6;
}

.authorized-companions-table {
  width: 100%;
  table-layout: fixed;
}

.authorized-companions-table tr .companion {
  width: 70%;
  word-wrap: break-word;
}

.authorized-companions-table tr .companion .id {
  color: #969696;
  font-size: 14px;
}

.authorized-companions-table tbody tr .version {
  word-wrap: break-word;
}

.authorized-companions-table tr th,
.authorized-companions-table tr td {
  padding: 4px;
}

.authorized-companions-table th {
  text-align: left;
}

.authorized-companions-table thead tr th {
  border-bottom: 1px solid #212121;
}
.authorized-companions-table thead tr .controls {
  width: 48px;
}

.authorized-companions-table tbody button {
  border-radius: 4px;
  padding: 4px;
  display: flex;
  align-items: center;
  background-color: #212121;
  cursor: pointer;
  border: none;
}

.no-authorized-companions {
  color: #bbbbbb;
  padding: 4px;
}

.discord-failure {
  margin: 0;
  color: #969696;
}

button {
  margin: 3px 3px 3px 4px;
  border-radius: 4px;
  padding: 8px;
  display: flex;
  align-items: center;
  background-color: #212121;
  cursor: pointer;
  border: none;
}

.shortcuts-tab .shortcut-title {
  display: flex;
  justify-content: center;
  align-items: center;
}

.shortcuts-tab .shortcut-title .register-error {
  margin-left: 4px;
  color: #f44336;
}

/* Extensions Tab Styles */
.extensions-tab {
  padding-bottom: 24px;
}

.ext-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 16px;
  color: #fff;
  font-size: 13px;
}

.ext-alert p {
  margin: 0;
  flex: 1;
}

.ext-alert.success {
  background-color: #2e7d32;
}

.ext-alert.error {
  background-color: #c62828;
}

.ext-alert-close {
  background: transparent;
  border: none;
  color: #fff;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  margin: 0;
}

.ext-section {
  background: #141414;
  border: 1px solid #242424;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.ext-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px 0;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.ext-section-title .material-symbols-outlined {
  font-size: 20px;
  color: #f44336;
}

.ext-section-desc {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: #9e9e9e;
}

.ext-install-form {
  display: flex;
  gap: 8px;
}

.ext-url-input {
  flex: 1;
  background: #212121;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 8px 12px;
  color: #fff;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.ext-url-input:focus {
  border-color: #f44336;
}

.ext-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  border: none;
  font-size: 13px;
  font-weight: 500;
  margin: 0;
  transition:
    background-color 0.2s,
    opacity 0.2s;
}

.ext-btn.primary {
  background-color: #f44336;
  color: #fff;
}

.ext-btn.primary:hover:not(:disabled) {
  background-color: #d32f2f;
}

.ext-btn.primary:disabled {
  background-color: #4a2020;
  color: #888;
  cursor: not-allowed;
}

.ext-btn.secondary {
  background-color: #212121;
  color: #eee;
  border: 1px solid #383838;
}

.ext-btn.secondary:hover {
  background-color: #2c2c2c;
  border-color: #4a4a4a;
}

.ext-btn.small {
  padding: 6px 12px;
  font-size: 12px;
  background-color: #f44336;
  color: #fff;
}

.ext-btn.small.installed {
  background-color: #2c2c2c;
  color: #888;
  border: 1px solid #383838;
  cursor: default;
}

.ext-actions-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ext-presets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.ext-preset-card {
  background: #1c1c1c;
  border: 1px solid #2c2c2c;
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
}

.preset-info strong {
  display: block;
  color: #fff;
  font-size: 13px;
  margin-bottom: 4px;
}

.preset-info p {
  margin: 0;
  font-size: 12px;
  color: #9e9e9e;
  line-height: 1.4;
}

.ext-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.ext-count-badge {
  background: #333;
  color: #eee;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 10px;
  font-weight: normal;
}

.ext-empty-state {
  text-align: center;
  padding: 32px 16px;
  background: #191919;
  border-radius: 6px;
  border: 1px dashed #333;
}

.ext-empty-state .empty-icon {
  font-size: 40px;
  color: #666;
  margin-bottom: 8px;
}

.ext-empty-state h4 {
  margin: 0 0 6px 0;
  color: #eee;
  font-size: 14px;
}

.ext-empty-state p {
  margin: 0;
  color: #888;
  font-size: 12px;
}

.ext-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ext-item-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #1c1c1c;
  border: 1px solid #2b2b2b;
  border-radius: 6px;
  padding: 10px 14px;
  transition:
    opacity 0.2s,
    border-color 0.2s;
}

.ext-item-card:hover {
  border-color: #383838;
}

.ext-item-card.disabled {
  opacity: 0.55;
}

.ext-item-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.ext-icon-img {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  object-fit: contain;
  background: #111;
  flex-shrink: 0;
}

.ext-icon-placeholder {
  font-size: 32px;
  color: #aaa;
  flex-shrink: 0;
}

.ext-item-details {
  flex: 1;
  min-width: 0;
}

.ext-item-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.ext-item-name {
  font-weight: 600;
  font-size: 14px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ext-item-version {
  font-size: 11px;
  color: #888;
}

.ext-item-source-badge {
  font-size: 10px;
  text-transform: uppercase;
  background: #292929;
  color: #aaa;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid #383838;
}

.ext-item-description {
  margin: 0;
  font-size: 12px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ext-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 12px;
}

.ext-toggle {
  appearance: none;
  width: 50px;
  height: 26px;
  background-color: #2b2b2b;
  border-radius: 13px;
  position: relative;
  cursor: pointer;
  outline: none;
  transition: background-color 0.2s;
  margin: 0;
}

.ext-toggle::before {
  content: "";
  display: block;
  position: absolute;
  width: 20px;
  height: 20px;
  background: #fff;
  left: 3px;
  top: 3px;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  transition: left 0.2s;
}

.ext-toggle:checked {
  background-color: #f44336;
}

.ext-toggle:checked::before {
  left: 27px;
}

.ext-icon-btn {
  background: transparent;
  border: none;
  color: #aaa;
  cursor: pointer;
  padding: 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  transition:
    color 0.2s,
    background-color 0.2s;
}

.ext-icon-btn .material-symbols-outlined {
  font-size: 20px;
}

.ext-icon-btn:hover {
  color: #fff;
  background: #2c2c2c;
}

.ext-icon-btn.danger:hover {
  color: #f44336;
  background: #331515;
}

.spinning {
  animation: rotation 1s infinite linear;
}

.builtin-cards-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
  margin-top: 10px;
}

.builtin-feat-card {
  background: #202020;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.builtin-feat-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.builtin-feat-icon {
  font-size: 28px;
  padding: 8px;
  border-radius: 8px;
}

.builtin-feat-icon.lyrics {
  color: #ff4081;
  background: rgba(255, 64, 129, 0.12);
}

.builtin-feat-icon.adblock {
  color: #00e676;
  background: rgba(0, 230, 118, 0.12);
}

.builtin-feat-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.builtin-feat-info strong {
  font-size: 14px;
  color: #eee;
}

.builtin-tag {
  font-size: 10px;
  font-weight: bold;
  text-transform: uppercase;
  color: #00e676;
  background: rgba(0, 230, 118, 0.15);
  padding: 2px 6px;
  border-radius: 4px;
  width: fit-content;
}

.builtin-feat-card p {
  margin: 0;
  font-size: 12px;
  color: #aaa;
  line-height: 1.4;
}

/* Downloads Tab Styles */
.dl-setting-card {
  background: #222;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.dl-setting-info strong {
  display: block;
  font-size: 14px;
  color: #eee;
  margin-bottom: 4px;
}

.dl-setting-info p {
  margin: 0;
  font-size: 12px;
  color: #999;
}

.dl-folder-path {
  color: #3ea6ff !important;
  font-family: monospace;
  font-size: 13px !important;
  background: #181818;
  padding: 4px 8px;
  border-radius: 4px;
  margin-top: 6px !important;
  word-break: break-all;
}

.dl-folder-actions {
  display: flex;
  gap: 8px;
  margin-left: 16px;
}

.dl-info-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.dl-feature-pill {
  background: #1c1c1c;
  border: 1px solid #2d2d2d;
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.dl-feature-pill .material-symbols-outlined {
  color: #3ea6ff;
  font-size: 24px;
  background: rgba(62, 166, 255, 0.1);
  padding: 6px;
  border-radius: 6px;
}

.dl-feature-pill strong {
  display: block;
  font-size: 13px;
  color: #eee;
  margin-bottom: 2px;
}

.dl-feature-pill p {
  margin: 0;
  font-size: 11px;
  color: #888;
}
</style>
