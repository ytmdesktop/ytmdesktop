<script setup lang="ts">
import { ref } from "vue";

const memoryStore = window.ytmd.memoryStore;

const ytmViewLoadTimedout = ref<boolean>(await memoryStore.get("ytmViewLoadTimedout"));

memoryStore.onStateChanged(newState => {
  ytmViewLoadTimedout.value = newState.ytmViewLoadTimedout;
});

function restartYTMView() {
  window.ytmd.ytmViewRecreate();
}
</script>

<template>
  <div v-if="ytmViewLoadTimedout" class="ytmview-load-timeout">
    <h1>:/</h1>
    <p>YouTube Music is taking longer than usual to load. If this issue persists please report it to the YTMDesktop Team.</p>
    <p>You can also try reloading YouTube Music by clicking the button below.</p>
    <button class="reload-button" @click="restartYTMView">
      <span class="material-symbols-outlined">refresh</span>Reload YouTube Music
    </button>
  </div>
</template>

<style scoped>
.ytmview-load-timeout {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.reload-button {
  display: flex;
  align-items: center;
  background-color: #f44336;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 8px;
  cursor: pointer;
}
</style>
