<script setup lang="ts">
import TitleBar from "../../components/TitleBar.vue";
import Auth from "./Auth.vue";
</script>

<template>
  <div class="container">
    <Suspense>
      <TitleBar class="titlebar" />
    </Suspense>
    <Suspense>
      <Auth class="auth"></Auth>
    </Suspense>
  </div>
</template>

<style scoped>
.auth {
  border-top: 1px solid #212121;
  background-color: #000000;
  height: calc(100% - 36px);
}

.container {
  width: 100%;
  height: 100%;
  background-color: #000000;
}
</style>
