<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import TitleBar from "../../components/TitleBar.vue";
import logo from "~assets/icons/ytmd_white.png";
import type { ListenTogetherUIState } from "~shared/listentogether/ipc";

const keyboardFocus = ref<HTMLElement>(null);
const keyboardFocusZero = ref<HTMLElement>(null);

const isMainWindow = ref<boolean>(window.ytmd.isMainWindow());
const listenTogetherState = ref<ListenTogetherUIState | null>(null);
let unsubListenTogether: (() => void) | null = null;

const listenTogetherDotClass = computed(() => {
  const state = listenTogetherState.value;
  if (!state?.room) return null;
  if (state.errorBanner) return "dot-error";

  const { syncStatus, degradedSync } = state.room;
  if (syncStatus === "reconnecting" || syncStatus === "host-disconnected") {
    return "dot-error";
  }
  if (
    syncStatus === "starting" ||
    syncStatus === "syncing" ||
    syncStatus === "paused-for-ad" ||
    degradedSync
  ) {
    return "dot-waiting";
  }
  return "dot-synced";
});

const listenTogetherTooltip = computed(() => {
  const room = listenTogetherState.value?.room;
  if (!room) return "Listen Together";
  return `Listen Together (${room.members.length} in room)`;
});

onMounted(async () => {
  window.onfocus = () => {
    if (document.activeElement != keyboardFocusZero.value) {
      // This resets the focus of keyboard navigation
      keyboardFocusZero.value.focus();
      keyboardFocusZero.value.blur();
    }
  };

  keyboardFocus.value.onfocus = () => {
    window.ytmd.switchFocus("ytm");
  };

  window.ytmd.requestWindowState();

  unsubListenTogether = window.ytmd.listenTogether.onStateChanged(
    (nextState) => {
      listenTogetherState.value = nextState;
    },
  );
  try {
    listenTogetherState.value = await window.ytmd.listenTogether.getState();
  } catch {
    listenTogetherState.value = null;
  }
});

onUnmounted(() => {
  unsubListenTogether?.();
});

function openMiniplayer() {
  window.ytmd.openMiniplayerWindow();
}

function toggleListenTogether() {
  window.ytmd.listenTogether.togglePanel?.();
}
</script>

<template>
  <div ref="keyboardFocusZero" tabindex="0" />
  <TitleBar
    :is-main-window="isMainWindow"
    :has-home-button="isMainWindow"
    :has-settings-button="isMainWindow"
    has-minimize-button
    has-maximize-button
    title="YTMDesktop"
    :icon-file="logo"
  >
    <template #app-buttons>
      <button
        class="app-button listen-together-button"
        :class="{ active: listenTogetherState?.panelOpen }"
        :title="listenTogetherTooltip"
        @click="toggleListenTogether"
      >
        <span class="material-symbols-outlined">group</span>
        <span
          v-if="listenTogetherDotClass"
          class="listen-together-dot"
          :class="listenTogetherDotClass"
        />
      </button>
      <button class="app-button" @click="openMiniplayer">
        <span class="material-symbols-outlined">pip</span>
      </button>
    </template>
  </TitleBar>
  <div ref="keyboardFocus" tabindex="32767" />
</template>

<style scoped>
.listen-together-button {
  position: relative;
}

.listen-together-button.active {
  background-color: #212121;
}

.listen-together-dot {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  pointer-events: none;
}

.listen-together-dot.dot-synced {
  background-color: #4caf50;
}

.listen-together-dot.dot-waiting {
  background-color: #eeeeee;
  animation: lt-dot-pulse 1.2s ease-in-out infinite;
}

.listen-together-dot.dot-error {
  background-color: #f44336;
}

@keyframes lt-dot-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
