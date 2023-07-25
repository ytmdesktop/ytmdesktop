<script setup lang="ts">
import { ref } from 'vue';
import KeybindInput from '../../shared/components/KeybindInput.vue'
import { StoreSchema } from '../store/schema';

const currentTab = ref(1);

const store = window.ytmd.store;
const safeStorage = window.ytmd.safeStorage;

const general: StoreSchema['general'] = await store.get('general');
const playback: StoreSchema['playback'] = await store.get('playback');
const integrations: StoreSchema['integrations'] = await store.get('integrations');
const shortcuts: StoreSchema['shortcuts'] = await store.get('shortcuts');

const hideToTrayOnClose = ref<boolean>(general.hideToTrayOnClose);
const showNotificationOnSongChange = ref<boolean>(general.showNotificationOnSongChange);
const startOnBoot = ref<boolean>(general.startOnBoot);
const startMinimized = ref<boolean>(general.startMinimized);
const alwaysShowVolumeSlider = ref<boolean>(general.alwaysShowVolumeSlider);

const continueWhereYouLeftOff = ref<boolean>(playback.continueWhereYouLeftOff);
const continueWhereYouLeftOffPaused = ref<boolean>(playback.continueWhereYouLeftOffPaused);
const progressInTaskbar = ref<boolean>(playback.progressInTaskbar);

const companionServerEnabled = ref<boolean>(integrations.companionServerEnabled);
const companionServerAuthWindowEnabled = ref<boolean>(await safeStorage.decryptString(integrations.companionServerAuthWindowEnabled) === 'true' ? true : false);
const discordPresenceEnabled = ref<boolean>(integrations.discordPresenceEnabled);

const shortcutPlayPause = ref<string>(shortcuts.playPause);
const shortcutNext = ref<string>(shortcuts.next);
const shortcutPrevious = ref<string>(shortcuts.previous);
const shortcutThumbsUp = ref<string>(shortcuts.thumbsUp);
const shortcutThumbsDown = ref<string>(shortcuts.thumbsDown);
const shortcutVolumeUp = ref<string>(shortcuts.volumeUp);
const shortcutVolumeDown = ref<string>(shortcuts.volumeDown);

store.onDidAnyChange(async (newState, oldState) => {
    hideToTrayOnClose.value = newState.general.hideToTrayOnClose;
    showNotificationOnSongChange.value = newState.general.showNotificationOnSongChange;
    startOnBoot.value = newState.general.startOnBoot;
    startMinimized.value = newState.general.startMinimized;
    alwaysShowVolumeSlider.value = newState.general.alwaysShowVolumeSlider;

    continueWhereYouLeftOff.value = newState.playback.continueWhereYouLeftOff;
    continueWhereYouLeftOffPaused.value = newState.playback.continueWhereYouLeftOffPaused;
    progressInTaskbar.value = newState.playback.progressInTaskbar;

    companionServerEnabled.value = newState.integrations.companionServerEnabled;
    companionServerAuthWindowEnabled.value = await safeStorage.decryptString(newState.integrations.companionServerAuthWindowEnabled) === 'true' ? true : false
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
    store.set('general.hideToTrayOnClose', hideToTrayOnClose.value);
    store.set('general.showNotificationOnSongChange', showNotificationOnSongChange.value);
    store.set('general.startOnBoot', startOnBoot.value);
    store.set('general.startMinimized', startMinimized.value);
    store.set("general.alwaysShowVolumeSlider", alwaysShowVolumeSlider.value);

    store.set('playback.continueWhereYouLeftOff', continueWhereYouLeftOff.value);
    store.set('playback.continueWhereYouLeftOffPaused', continueWhereYouLeftOffPaused.value);
    store.set('playback.progressInTaskbar', progressInTaskbar.value);

    store.set('integrations.companionServerEnabled', companionServerEnabled.value);
    store.set('integrations.companionServerAuthWindowEnabled', await safeStorage.encryptString(companionServerAuthWindowEnabled.value.toString()));
    store.set('integrations.discordPresenceEnabled', discordPresenceEnabled.value);

    store.set('shortcuts.playPause', shortcutPlayPause.value);
    store.set('shortcuts.next', shortcutNext.value);
    store.set('shortcuts.previous', shortcutPrevious.value);
    store.set('shortcuts.thumbsUp', shortcutThumbsUp.value);
    store.set('shortcuts.thumbsDown', shortcutThumbsDown.value);
    store.set('shortcuts.volumeUp', shortcutVolumeUp.value);
    store.set('shortcuts.volumeDown', shortcutVolumeDown.value);
}

function changeTab(newTab: number) {
    currentTab.value = newTab
}
</script>

<template>
    <div class="content-container">
        <ul class="sidebar">
            <li :class="{ active: currentTab === 1 }" @click="changeTab(1)"><span
                    class="material-symbols-outlined">settings_applications</span>General</li>
                    <li :class="{ active: currentTab === 2 }" @click="changeTab(2)"><span
                    class="material-symbols-outlined">brush</span>Appearance</li>
            <li :class="{ active: currentTab === 3 }" @click="changeTab(3)"><span
                    class="material-symbols-outlined">music_note</span>Playback</li>
            <li :class="{ active: currentTab === 4 }" @click="changeTab(4)"><span
                    class="material-symbols-outlined">wifi_tethering</span>Integrations</li>
            <li :class="{ active: currentTab === 5 }" @click="changeTab(5)"><span
                    class="material-symbols-outlined">keyboard</span>Shortcuts</li>
        </ul>
        <div class="content">
            <div v-if="currentTab === 1" class="general-tab">
                <div class="setting">
                    <p>Hide to tray on close</p>
                    <input v-model="hideToTrayOnClose" @change="settingsChanged" class="toggle" type="checkbox" />
                </div>
                <!--<div class="setting">
                    <p>Show notification on song change</p>
                    <input v-model="showNotificationOnSongChange" @change="settingsChanged" class="toggle"
                        type="checkbox" />
                </div>-->
                <div class="setting">
                    <p>Start on boot</p>
                    <input v-model="startOnBoot" @change="settingsChanged" class="toggle" type="checkbox" />
                </div>
                <!--<div class="setting">
                    <p>Start minimized</p>
                    <input v-model="startMinimized" @change="settingsChanged" class="toggle" type="checkbox" />
                </div>-->
            </div>
            <div v-if="currentTab === 2" class="appearance-tab">
                <div class="setting">
                    <p>Always show volume slider</p>
                    <input v-model="alwaysShowVolumeSlider" @change="settingsChanged" class="toggle" type="checkbox" />
                </div>
            </div>
            <div v-if="currentTab === 3" class="playback-tab">
                <div class="setting">
                    <p>Continue where you left off</p>
                    <input v-model="continueWhereYouLeftOff" @change="settingsChanged" class="toggle" type="checkbox" />
                </div>
                <div v-if="continueWhereYouLeftOff" class="setting indented">
                    <p>Pause on application launch</p>
                    <input v-model="continueWhereYouLeftOffPaused" @change="settingsChanged" class="toggle" type="checkbox" />
                </div>
                <div class="setting">
                    <p>Show track progress on taskbar</p>
                    <input v-model="progressInTaskbar" @change="settingsChanged" class="toggle" type="checkbox" />
                </div>
            </div>
            <div v-if="currentTab === 4" class="integrations-tab">
                <div class="setting">
                    <p>Companion server</p>
                    <input v-model="companionServerEnabled" @change="settingsChanged" class="toggle" type="checkbox" />
                </div>
                <div v-if="companionServerEnabled" class="setting indented">
                    <div class="name-with-description">
                        <p class="name">Enable companion authorization</p>
                        <p class="description">Automatically disables after the first successful authorization or 5
                            minutes has passed</p>
                    </div>
                    <input v-model="companionServerAuthWindowEnabled" @change="settingsChanged" class="toggle"
                        type="checkbox" />
                </div>
                <div class="setting">
                    <p>Discord rich presence</p>
                    <input v-model="discordPresenceEnabled" @change="settingsChanged" class="toggle" type="checkbox" />
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
        </div>
    </div>
</template>

<style scoped>
.content-container {
    height: 100%;
    display: flex;
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
}

.sidebar li {
    display: flex;
    align-items: center;
    padding: 16px;
    cursor: pointer;
    color: #BBBBBB;
}

.sidebar li .material-symbols-outlined {
    font-size: 28px;
    font-variation-settings:
        'FILL' 0,
        'wght' 100,
        'GRAD' 0,
        'opsz' 28;
}

.sidebar li:hover {
    background-color: #111111;
}

.sidebar li.active {
    background-color: #212121;
    color: #EEEEEE;
}

.sidebar li .material-symbols-outlined {
    margin-right: 8px;
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
    background-color: #F44336;
}

.toggle:checked:before {
    left: 32px;
}
</style>