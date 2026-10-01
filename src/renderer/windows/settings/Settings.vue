<script setup lang="ts">
import { ref, watch } from "vue";
import KeybindInput from "../../components/KeybindInput.vue";
import YTMDSetting from "../../components/YTMDSetting.vue";
import { StoreSchema, TrayIconStyle } from "~shared/store/schema";
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
const extensions: StoreSchema["extensions"] = (await store.get("extensions")) ?? {
  extensionPaths: [],
  disabledPaths: []
};
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

const companionServerEnabled = ref<boolean>(integrations.companionServerEnabled);
const companionServerAuthTokens = ref<AuthToken[]>(
  safeStorageAvailable.value ? (JSON.parse(await safeStorage.decryptString(integrations.companionServerAuthTokens)) ?? []) : []
);
const companionServerCORSWildcardEnabled = ref<boolean>(integrations.companionServerCORSWildcardEnabled);
const discordPresenceEnabled = ref<boolean>(integrations.discordPresenceEnabled);
const lastFMEnabled = ref<boolean>(integrations.lastFMEnabled);

const extensionPaths = ref<string[]>(extensions.extensionPaths ?? []);
const extensionDisabledPaths = ref<string[]>(extensions.disabledPaths ?? []);
const extensionManifests = ref<
  Record<
    string,
    {
      name: string;
      version: string;
      description: string;
      author: string;
      iconDataUrl: string | null;
      extensionId: string | null;
      webStoreUrl: string | null;
      optionsPage: string | null;
    } | null
  >
>({});
const extensionInfoPath = ref<string | null>(null);
const extensionStoreUrl = ref("");
const extensionInstallLoading = ref(false);
const extensionInstallError = ref<string | null>(null);
const extensionInstallErrorDetail = ref<string | null>(null);

const extensionInstallErrorCopied = ref(false);

function setExtensionError(message: string, detail: unknown = null) {
  extensionInstallError.value = message;
  extensionInstallErrorDetail.value =
    detail != null ? (detail instanceof Error ? detail.message + (detail.stack ? "\n" + detail.stack : "") : String(detail)) : null;
}

async function copyExtensionErrorToClipboard() {
  if (!extensionInstallError.value) return;
  const text = extensionInstallErrorDetail.value
    ? `${extensionInstallError.value}\n\nError details:\n${extensionInstallErrorDetail.value}`
    : extensionInstallError.value;
  try {
    await navigator.clipboard.writeText(text);
    extensionInstallErrorCopied.value = true;
    setTimeout(() => {
      extensionInstallErrorCopied.value = false;
    }, 2000);
  } catch {
    extensionInstallErrorCopied.value = false;
  }
}

async function loadExtensionManifests() {
  const paths = extensionPaths.value;
  const next: Record<string, (typeof extensionManifests.value)[string]> = { ...extensionManifests.value };
  for (const p of paths) {
    if (next[p] !== undefined) continue;
    next[p] = null;
    const manifest = await window.ytmd.getExtensionManifest(p);
    next[p] = manifest;
  }
  extensionManifests.value = next;
}

watch(
  () => [currentTab.value, extensionPaths.value] as const,
  ([tab, paths]) => {
    if (tab === 6 && paths.length > 0) loadExtensionManifests();
  },
  { immediate: true }
);

function isExtensionDisabled(path: string) {
  return extensionDisabledPaths.value.includes(path);
}

async function toggleExtensionDisabled(path: string) {
  const disabled = !isExtensionDisabled(path);
  await window.ytmd.setExtensionDisabled(path, disabled);
  if (disabled) {
    extensionDisabledPaths.value = [...extensionDisabledPaths.value, path];
  } else {
    extensionDisabledPaths.value = extensionDisabledPaths.value.filter(p => p !== path);
  }
  requiresRestart.value = true;
  settingsChanged();
}

function showExtensionInfo(path: string) {
  extensionInfoPath.value = path;
}

function closeExtensionInfo() {
  extensionInfoPath.value = null;
}

function openExternalUrl(url: string) {
  window.ytmd.openExternalUrl(url);
}

function openExtensionOptions(extPath: string) {
  window.ytmd.openExtensionOptions(extPath);
}

function extensionDisplayName(extPath: string) {
  const manifest = extensionManifests.value[extPath];
  if (manifest?.name) return manifest.name;
  const parts = extPath.replace(/\/$/, "").split(/[/\\]/);
  return parts[parts.length - 1] ?? extPath;
}

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

  companionServerEnabled.value = newState.integrations.companionServerEnabled;
  companionServerAuthTokens.value = safeStorageAvailable.value
    ? (JSON.parse(await safeStorage.decryptString(newState.integrations.companionServerAuthTokens)) ?? [])
    : [];
  companionServerCORSWildcardEnabled.value = newState.integrations.companionServerCORSWildcardEnabled;
  discordPresenceEnabled.value = newState.integrations.discordPresenceEnabled;
  lastFMEnabled.value = newState.integrations.lastFMEnabled;
  extensionPaths.value = newState.extensions?.extensionPaths ?? [];
  extensionDisabledPaths.value = newState.extensions?.disabledPaths ?? [];
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

  store.set("integrations.companionServerEnabled", companionServerEnabled.value);
  store.set("integrations.companionServerCORSWildcardEnabled", companionServerCORSWildcardEnabled.value);
  store.set("integrations.discordPresenceEnabled", discordPresenceEnabled.value);
  store.set("integrations.lastFMEnabled", lastFMEnabled.value);
  store.set("extensions.extensionPaths", JSON.parse(JSON.stringify(extensionPaths.value)));
  store.set("extensions.disabledPaths", JSON.parse(JSON.stringify(extensionDisabledPaths.value)));
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

async function addExtension() {
  const extPath = await window.ytmd.selectExtensionFolder();
  if (extPath && !extensionPaths.value.includes(extPath)) {
    extensionPaths.value = [...extensionPaths.value, extPath];
    requiresRestart.value = true;
    await settingsChanged();
  }
}

async function addExtensionFromStoreUrl() {
  const url = extensionStoreUrl.value?.trim();
  if (!url) return;
  extensionInstallError.value = null;
  extensionInstallErrorDetail.value = null;
  extensionInstallLoading.value = true;
  try {
    const { path: extPath, error } = await window.ytmd.installExtensionFromStoreUrl(url);
    extensionInstallLoading.value = false;
    if (error) {
      setExtensionError(error);
      return;
    }
    if (extPath && !extensionPaths.value.includes(extPath)) {
      extensionPaths.value = [...extensionPaths.value, extPath];
      requiresRestart.value = true;
      extensionStoreUrl.value = "";
      try {
        await settingsChanged();
      } catch (err) {
        store.set("extensions.extensionPaths", JSON.parse(JSON.stringify(extensionPaths.value)));
        setExtensionError("Extension was installed and added to the list, but saving all settings failed. Restart the app to use the extension.", err);
      }
    }
  } catch (err) {
    extensionInstallLoading.value = false;
    setExtensionError('Install failed (see details below). You can try "Add from .crx file" or "Add unpacked folder" instead.', err);
  }
}

async function addExtensionFromCrxFile() {
  extensionInstallError.value = null;
  extensionInstallErrorDetail.value = null;
  extensionInstallLoading.value = true;
  try {
    const { path: extPath, error } = await window.ytmd.installExtensionFromCrxFile();
    extensionInstallLoading.value = false;
    if (error) {
      setExtensionError(error);
      return;
    }
    if (extPath && !extensionPaths.value.includes(extPath)) {
      extensionPaths.value = [...extensionPaths.value, extPath];
      requiresRestart.value = true;
      try {
        await settingsChanged();
      } catch (err) {
        store.set("extensions.extensionPaths", JSON.parse(JSON.stringify(extensionPaths.value)));
        setExtensionError("Extension was installed and added to the list, but saving all settings failed. Restart the app to use the extension.", err);
      }
    }
  } catch (err) {
    extensionInstallLoading.value = false;
    setExtensionError('Install failed (see details below). Try "Add unpacked folder" if the .crx is invalid.', err);
  }
}

function removeExtension(index: number) {
  const path = extensionPaths.value[index];
  extensionPaths.value = extensionPaths.value.filter((_, i) => i !== index);
  if (path) {
    extensionDisabledPaths.value = extensionDisabledPaths.value.filter(p => p !== path);
    const next = { ...extensionManifests.value };
    delete next[path];
    extensionManifests.value = next;
  }
  if (extensionInfoPath.value === path) extensionInfoPath.value = null;
  requiresRestart.value = true;
  settingsChanged();
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
    <div class="content-container">
      <ul class="sidebar">
        <li :class="{ active: currentTab === 1 }" @click="changeTab(1)"><span class="material-symbols-outlined">settings_applications</span>General</li>
        <li :class="{ active: currentTab === 2 }" @click="changeTab(2)"><span class="material-symbols-outlined">brush</span>Appearance</li>
        <li :class="{ active: currentTab === 3 }" @click="changeTab(3)"><span class="material-symbols-outlined">music_note</span>Playback</li>
        <li :class="{ active: currentTab === 4 }" @click="changeTab(4)"><span class="material-symbols-outlined">wifi_tethering</span>Integrations</li>
        <li :class="{ active: currentTab === 6 }" @click="changeTab(6)"><span class="material-symbols-outlined">extension</span>Extensions</li>
        <li :class="{ active: currentTab === 5 }" @click="changeTab(5)"><span class="material-symbols-outlined">keyboard</span>Shortcuts</li>
        <span class="push"></span>
        <li :class="{ active: currentTab === 99 }" @click="changeTab(99)"><span class="material-symbols-outlined">info</span>About</li>
      </ul>
      <div class="content">
        <div v-if="requiresRestart && !(currentTab === 6 && extensionInstallError)" class="restart-banner">
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

        <div v-if="currentTab === 6" class="extensions-tab">
          <YTMDSetting
            type="custom"
            flex-column
            name="Chrome extensions"
            description="Load extensions from the Chrome Web Store, a .crx file, or an unpacked folder. You can enable/disable each extension without removing it. Restart required after adding, removing, or toggling."
            restart-required
            @change="settingsChanged"
          >
            <div class="extension-paths-list">
              <div
                v-for="(extPath, index) in extensionPaths"
                :key="extPath"
                class="extension-card"
                :class="{ 'extension-disabled': isExtensionDisabled(extPath) }"
              >
                <img v-if="extensionManifests[extPath]?.iconDataUrl" class="extension-icon" :src="extensionManifests[extPath].iconDataUrl" alt="" />
                <span v-else class="extension-icon-placeholder material-symbols-outlined">extension</span>
                <div class="extension-main">
                  <span class="extension-name">{{ extensionDisplayName(extPath) }}</span>
                  <span class="extension-version">{{ extensionManifests[extPath]?.version ?? "—" }}</span>
                </div>
                <div class="extension-actions">
                  <button
                    v-if="extensionManifests[extPath]?.optionsPage && !isExtensionDisabled(extPath)"
                    type="button"
                    class="icon-btn"
                    title="Extension options / settings"
                    @click="openExtensionOptions(extPath)"
                  >
                    <span class="material-symbols-outlined">settings</span>
                  </button>
                  <button type="button" class="icon-btn" title="Extension details" @click="showExtensionInfo(extPath)">
                    <span class="material-symbols-outlined">info</span>
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    :title="isExtensionDisabled(extPath) ? 'Enable (restart required)' : 'Disable (restart required)'"
                    @click="toggleExtensionDisabled(extPath)"
                  >
                    <span class="material-symbols-outlined">
                      {{ isExtensionDisabled(extPath) ? "toggle_off" : "toggle_on" }}
                    </span>
                  </button>
                  <button type="button" class="icon-btn" title="Remove" @click="removeExtension(index)">
                    <span class="material-symbols-outlined">delete</span>
                  </button>
                </div>
              </div>
              <div v-if="extensionPaths.length === 0" class="no-extensions">No extensions added</div>
            </div>
            <div v-if="extensionInfoPath" class="extension-info-overlay" @click.self="closeExtensionInfo">
              <div class="extension-info-modal">
                <div class="extension-info-header">
                  <img
                    v-if="extensionManifests[extensionInfoPath]?.iconDataUrl"
                    class="extension-info-icon"
                    :src="extensionManifests[extensionInfoPath].iconDataUrl"
                    alt=""
                  />
                  <span v-else class="material-symbols-outlined extension-info-icon-placeholder">extension</span>
                  <h3 class="extension-info-title">{{ extensionManifests[extensionInfoPath]?.name ?? extensionInfoPath }}</h3>
                  <button type="button" class="icon-btn close-btn" title="Close" @click="closeExtensionInfo">
                    <span class="material-symbols-outlined">close</span>
                  </button>
                </div>
                <div class="extension-info-body">
                  <p v-if="extensionManifests[extensionInfoPath]?.version"><strong>Version:</strong> {{ extensionManifests[extensionInfoPath].version }}</p>
                  <p v-if="extensionManifests[extensionInfoPath]?.extensionId">
                    <strong>Extension ID:</strong>
                    <code>{{ extensionManifests[extensionInfoPath].extensionId }}</code>
                  </p>
                  <p v-if="extensionManifests[extensionInfoPath]?.optionsPage && !isExtensionDisabled(extensionInfoPath)">
                    <strong>Options:</strong>
                    <button type="button" class="link-btn" @click="openExtensionOptions(extensionInfoPath)">Open extension options</button>
                  </p>
                  <p v-if="extensionManifests[extensionInfoPath]?.webStoreUrl">
                    <strong>Chrome Web Store:</strong>
                    <button type="button" class="link-btn" @click="openExternalUrl(extensionManifests[extensionInfoPath].webStoreUrl)">Open in store</button>
                  </p>
                  <p v-if="extensionManifests[extensionInfoPath]?.author"><strong>Author:</strong> {{ extensionManifests[extensionInfoPath].author }}</p>
                  <p v-if="extensionManifests[extensionInfoPath]?.description" class="extension-info-desc">
                    <strong>Description:</strong> {{ extensionManifests[extensionInfoPath].description }}
                  </p>
                  <p class="extension-info-path"><strong>Path:</strong> {{ extensionInfoPath }}</p>
                </div>
              </div>
            </div>
            <div v-if="extensionInstallError" class="extension-install-error-box">
              <div class="extension-install-error-row">
                <div class="extension-install-error">
                  <span class="material-symbols-outlined">error</span>
                  {{ extensionInstallError }}
                </div>
                <button type="button" class="extension-error-copy-btn" title="Copy error to clipboard" @click="copyExtensionErrorToClipboard">
                  <span class="material-symbols-outlined">{{ extensionInstallErrorCopied ? "check" : "content_copy" }}</span>
                  {{ extensionInstallErrorCopied ? "Copied!" : "Copy" }}
                </button>
              </div>
              <div v-if="extensionInstallErrorDetail" class="extension-install-error-detail">
                <strong>Error details:</strong>
                <pre>{{ extensionInstallErrorDetail }}</pre>
              </div>
            </div>
            <div class="extension-add-actions">
              <div class="store-url-row">
                <input
                  v-model="extensionStoreUrl"
                  type="text"
                  placeholder="Chrome Web Store URL or extension ID (e.g. cjpalhdlnbpafiamejdnhcphjbkeiagm)"
                  class="store-url-input"
                  :disabled="extensionInstallLoading"
                  @keydown.enter="addExtensionFromStoreUrl"
                />
                <button class="add-extension-btn" :disabled="extensionInstallLoading || !extensionStoreUrl?.trim()" @click="addExtensionFromStoreUrl">
                  <span v-if="extensionInstallLoading" class="material-symbols-outlined spin">progress_activity</span>
                  <span v-else class="material-symbols-outlined">store</span>
                  Add from store
                </button>
              </div>
              <button class="add-extension-btn" :disabled="extensionInstallLoading" @click="addExtensionFromCrxFile">
                <span v-if="extensionInstallLoading" class="material-symbols-outlined spin">progress_activity</span>
                <span v-else class="material-symbols-outlined">folder_open</span>
                Add from .crx file
              </button>
              <button class="add-extension-btn" :disabled="extensionInstallLoading" @click="addExtension">
                <span class="material-symbols-outlined">add</span>
                Add unpacked folder
              </button>
            </div>
          </YTMDSetting>
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

.extensions-tab .extension-paths-list {
  width: 100%;
  margin-bottom: 8px;
}

.extensions-tab .extension-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background-color: #212121;
  border-radius: 8px;
  margin-bottom: 6px;
}

.extensions-tab .extension-card.extension-disabled {
  opacity: 0.65;
}

.extensions-tab .extension-icon {
  width: 40px;
  height: 40px;
  object-fit: contain;
  flex-shrink: 0;
  border-radius: 4px;
}

.extensions-tab .extension-icon-placeholder {
  width: 40px;
  height: 40px;
  font-size: 28px;
  color: #666;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.extensions-tab .extension-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.extensions-tab .extension-name {
  font-size: 14px;
  font-weight: 500;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extensions-tab .extension-version {
  font-size: 12px;
  color: #888;
}

.extensions-tab .extension-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.extensions-tab .extension-actions .icon-btn {
  padding: 6px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: #aaa;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.extensions-tab .extension-actions .icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ccc;
}

.extensions-tab .extension-actions .material-symbols-outlined {
  font-size: 20px;
}

.extensions-tab .extension-info-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.extensions-tab .extension-info-modal {
  background: #2a2a2a;
  border-radius: 12px;
  max-width: 440px;
  width: 100%;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.extensions-tab .extension-info-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #3a3a3a;
}

.extensions-tab .extension-info-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 8px;
  flex-shrink: 0;
}

.extensions-tab .extension-info-icon-placeholder {
  width: 48px;
  height: 48px;
  font-size: 32px;
  color: #666;
}

.extensions-tab .extension-info-title {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extensions-tab .extension-info-header .close-btn {
  padding: 6px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: #aaa;
  cursor: pointer;
  flex-shrink: 0;
}

.extensions-tab .extension-info-header .close-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ccc;
}

.extensions-tab .extension-info-body {
  padding: 16px;
  overflow-y: auto;
  font-size: 13px;
  color: #bbb;
}

.extensions-tab .extension-info-body p {
  margin: 0 0 10px 0;
}

.extensions-tab .extension-info-body p:last-child {
  margin-bottom: 0;
}

.extensions-tab .extension-info-body code {
  font-size: 12px;
  background: #1a1a1a;
  padding: 2px 6px;
  border-radius: 4px;
}

.extensions-tab .extension-info-body a {
  color: #8ab4f8;
  text-decoration: none;
}

.extensions-tab .extension-info-body a:hover {
  text-decoration: underline;
}

.extensions-tab .extension-info-body .link-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: inherit;
  color: #8ab4f8;
  cursor: pointer;
  text-decoration: none;
}

.extensions-tab .extension-info-body .link-btn:hover {
  text-decoration: underline;
}

.extensions-tab .extension-info-desc {
  word-break: break-word;
}

.extensions-tab .extension-info-path {
  font-size: 11px;
  color: #777;
  word-break: break-all;
}

.extensions-tab .no-extensions {
  color: #969696;
  padding: 8px;
  font-style: italic;
}

.extensions-tab .extension-install-error-box {
  background: rgba(244, 67, 54, 0.08);
  border: 1px solid #f44336;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.extensions-tab .extension-install-error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.extensions-tab .extension-install-error {
  display: flex;
  align-items: center;
  color: #f44336;
  font-size: 13px;
  font-weight: 500;
  flex: 1;
  min-width: 0;
}

.extensions-tab .extension-error-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: #888;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
}

.extensions-tab .extension-error-copy-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #bbb;
}

.extensions-tab .extension-error-copy-btn .material-symbols-outlined {
  font-size: 16px;
}

.extensions-tab .extension-install-error .material-symbols-outlined {
  margin-right: 4px;
  font-size: 18px;
}

.extensions-tab .extension-install-error-detail {
  margin-top: 8px;
  font-size: 12px;
  color: #b0b0b0;
}

.extensions-tab .extension-install-error-detail strong {
  color: #888;
  display: block;
  margin-bottom: 4px;
}

.extensions-tab .extension-install-error-detail pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 11px;
  max-height: 120px;
  overflow-y: auto;
}

.extensions-tab .extension-add-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.extensions-tab .store-url-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.extensions-tab .store-url-input {
  flex: 1;
  min-width: 200px;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid #414141;
  background-color: #212121;
  color: #eee;
  font-size: 13px;
}

.extensions-tab .store-url-input::placeholder {
  color: #969696;
}

.extensions-tab .store-url-input:focus {
  outline: none;
  border-color: #616161;
}

.extensions-tab .add-extension-btn {
  display: flex;
  align-items: center;
}

.extensions-tab .add-extension-btn .material-symbols-outlined {
  margin-right: 4px;
}

.extensions-tab .add-extension-btn .material-symbols-outlined.spin {
  animation: rotation 1s linear infinite;
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
</style>
