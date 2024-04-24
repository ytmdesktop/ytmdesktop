<script setup lang="ts">
import { onBeforeMount, ref } from "vue";

const appName = ref("");
const code = ref("");

function denyCompanion() {
  window.ytmd.sendResult(false);
}

function allowCompanion() {
  window.ytmd.sendResult(true);
}

onBeforeMount(async () => {
  appName.value = await window.ytmd.getAppName();
  code.value = await window.ytmd.getCode();
});
</script>

<template>
  <div class="container-wrapper">
    <div class="container">
      <h1 class="title">Companion Authorization Request</h1>
      <p class="subtitle">
        <b>{{ appName }}</b> would like to control YouTube Music Desktop App
      </p>
      <p class="code-confirm">
        Please ensure the code below matches what <b>{{ appName }}</b> is showing
      </p>
      <p class="code">{{ code }}</p>
      <div class="buttons">
        <button class="deny" @click="denyCompanion">Deny</button>
        <button class="allow" @click="allowCompanion">Allow</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container-wrapper {
  width: 100%;
  height: calc(100% - 36px);
  background-color: #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}

.container {
  padding: 8%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}

.title,
.subtitle,
.code-confirm,
.code {
  margin: unset;
  text-align: center;
}

.title {
  margin-bottom: 16px;
  font-size: 36px;
}

.subtitle {
  font-weight: normal;
  font-size: 20px;
}

.code-confirm {
  margin-top: 32px;
  font-size: 20px;
}

.code {
  margin-top: 16px;
  font-size: 36px;
  color: #f44336;
}

.buttons {
  margin-top: 48px;
}

.allow,
.deny {
  background: unset;
  border: 1px solid #212121;
  padding: 16px 32px;
  margin-right: 32px;
  border-radius: 4px;
  cursor: pointer;
}

.allow:hover {
  background-color: #212121;
}

.deny {
  background-color: #d32f2f;
}

.deny:hover {
  background-color: #c62828;
}
</style>
