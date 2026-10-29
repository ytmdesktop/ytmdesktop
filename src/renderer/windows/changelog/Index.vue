<script setup lang="ts">
import TitleBar from "../../components/TitleBar.vue";
import Changelog from "./Changelog.vue";
</script>

<template>
  <TitleBar
    class="titlebar"
    title="Changelog"
    icon="news"
  />
  <Suspense>
    <Changelog />
  </Suspense>
</template>

<style scoped></style>
