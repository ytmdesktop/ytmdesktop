<script setup lang="ts">
import TitleBar from '../../components/TitleBar.vue';
import Changelog from './Changelog.vue';
</script>

<template>
  <div class="container">
    <TitleBar class="titlebar" title="Changelog" icon="news" />
    <Suspense>
      <Changelog class="changelog" />
    </Suspense>
  </div>
</template>

<style scoped>
.container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.changelog {
  flex: 1;
  min-height: 0;
}
</style>
