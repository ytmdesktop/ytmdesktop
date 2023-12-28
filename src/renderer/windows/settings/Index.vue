<script setup lang="ts">
import TitleBar from "../../components/TitleBar.vue";
import Settings from "./Settings.vue";
</script>

<template>
  <div class="container">
    <Suspense>
      <TitleBar class="titlebar" title="Settings" icon="settings" />
    </Suspense>
    <Suspense>
      <Settings class="settings" />
    </Suspense>
  </div>
</template>

<style scoped>
.settings {
  border-top: 1px solid #212121;
  background-color: #1d1d1d;
  height: calc(100% - 36px);
}

.container {
  width: 100%;
  height: 100%;
  background-color: #1d1d1d;
}
</style>
