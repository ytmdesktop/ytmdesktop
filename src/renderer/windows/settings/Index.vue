<script setup lang="ts">
import { onBeforeMount, ref } from "vue";
import TitleBar from "../../components/TitleBar.vue";
import Settings from "./Settings.vue";

const memoryStore = window.ytmd.memoryStore;
const titleBarVisible = ref<boolean>(true);

onBeforeMount(async () => {
  titleBarVisible.value = (await memoryStore.get("titleBarVisible")) ?? true;
});

memoryStore.onStateChanged(newState => {
  titleBarVisible.value = newState.titleBarVisible;
});
</script>

<template>
  <div class="container">
    <TitleBar class="titlebar" title="Settings" icon="settings" />
    <Suspense>
      <Settings :class="['settings', { 'no-titlebar': !titleBarVisible }]" />
    </Suspense>
  </div>
</template>

<style scoped>
.settings {
  border-top: 1px solid #212121;
  background-color: #000000;
  height: calc(100% - 36px);
}

.settings.no-titlebar {
  height: 100%;
  border-top: none;
}

.container {
  width: 100%;
  height: 100%;
  background-color: #000000;
}
</style>
