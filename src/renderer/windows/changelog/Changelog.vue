<script setup lang="ts">
import markdownit from "markdown-it";
const md = markdownit({
  linkify: true,
  html: true
});

const releaseMetadata = await window.ytmd.getReleaseMetadata();
const mdRender = md.render(releaseMetadata.notes);

const appVersion = await window.ytmd.getAppVersion();
</script>

<template>
  <div class="changelog-container">
    <h1 class="updated-header">
      YTMDesktop has Updated!
    </h1>
    <h2 class="app-version">
      {{ releaseMetadata.name }}
    </h2>
    <div
      class="release-notes"
      v-html="mdRender"
    />
  </div>
</template>

<style scoped>
.changelog-container {
  height: 100%;
  background: #000000;
  padding: 16px;
}

.updated-header {
  margin: 0;
  text-align: center;
}

.app-version {
  border-bottom: 1px solid #212121;
  padding-bottom: 8px;
  margin: 0;
}
</style>
