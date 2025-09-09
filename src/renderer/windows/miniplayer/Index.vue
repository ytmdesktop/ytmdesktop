<script setup lang="ts">
import { ref } from "vue";
import Miniplayer from "./Miniplayer.vue";

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
    <button
      class="pin"
      title="Pin/Unpin Miniplayer"
      @click="pinUnpinMiniplayer"
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
  <Suspense>
    <Miniplayer />
  </Suspense>
</template>

<style scoped>
.topbar {
  height: 36px;
  -webkit-app-region: drag;
  display: flex;
  justify-content: right;
}

.topbar button {
  background-color: transparent;
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
