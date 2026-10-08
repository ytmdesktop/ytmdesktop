<script setup lang="ts">
import { ref } from "vue";
import Miniplayer from "./Miniplayer.vue";

const isWayland = ref(window.ytmd.isWayland());
const alwaysOnTop = ref(true);

window.ytmd.handleWindowEvents(windowState => {
  alwaysOnTop.value = windowState.alwaysOnTop;
});

function closeMiniplayer() {
  window.ytmd.closeWindow();
}

function pinUnpinMiniplayer() {
  window.ytmd.setAlwaysOnTopWindow(!alwaysOnTop.value);
}
</script>

<template>
  <div class="topbar">
    <div class="backdrop" />
    <div class="button-container">
      <button
        class="pin"
        :title="!isWayland ? `Pin/Unpin Miniplayer` : `Use your native window manager to pin the miniplayer`"
        @click="pinUnpinMiniplayer"
        :disabled="isWayland"
      >
        <span
          v-if="alwaysOnTop"
          class="icon material-symbols-outlined"
        >keep</span>
        <span
          v-if="!alwaysOnTop"
          class="icon material-symbols-outlined"
        >keep_off</span>
      </button>
      <button
        class="pip-exit"
        title="Close Miniplayer"
        @click="closeMiniplayer"
      >
        <span class="icon material-symbols-outlined">pip_exit</span>
      </button>
    </div>
  </div>
  <Suspense>
    <Miniplayer />
  </Suspense>
</template>

<style scoped>
.topbar {
  height: 36px;
  display: flex;
  justify-content: right;
  position: relative;
}

.topbar .backdrop {
  position: absolute;
  width: 100%;
  height: 200%;
  top: -100%;
  backdrop-filter: blur(10px);
  mask-image: linear-gradient(to bottom, black 0%, black 25%, transparent 100%);
  z-index: -888;
  background-color: rgba(0, 0, 0, 0.75);
}

.topbar button {
  background: transparent;
  border: none;
  cursor: pointer;
  width: 36px;
  height: 36px;
  -webkit-app-region: no-drag;
}

.topbar .icon {
  font-size: 20px;
}
</style>
