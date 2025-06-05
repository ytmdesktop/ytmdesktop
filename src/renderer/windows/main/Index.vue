<script setup lang="ts">
import { onMounted, ref } from "vue";
import TitleBar from "../../components/TitleBar.vue";
import YTMViewLoading from "../../components/YTMViewLoading.vue";
import logo from "~assets/icons/ytmd_white.png";

const keyboardFocus = ref<HTMLElement>(null);
const keyboardFocusZero = ref<HTMLElement>(null);
const memoryStore = window.ytmd.memoryStore;
const sslGenerated = ref<boolean>(!!memoryStore.get("ssl_cert_generated"));

onMounted(() => {
  window.onfocus = () => {
    if (document.activeElement != keyboardFocusZero.value) {
      // This resets the focus of keyboard navigation
      keyboardFocusZero.value.focus();
      keyboardFocusZero.value.blur();
    }
  };

  keyboardFocus.value.onfocus = () => {
    window.ytmd.switchFocus("ytm");
  };

  window.ytmd.requestWindowState();

  /*if (window.electronAPI?.onSSLGenerated) {
    window.electronAPI.onSSLGenerated(() => {
      memoryStore.set("ssl_cert_generated", true);
      sslGenerated.value = true;
    });
  }*/

  sslGenerated.value = <boolean>!!memoryStore.get("ssl_cert_generated");
});
</script>

<template>
  <div ref="keyboardFocusZero" tabindex="0"></div>
  <Suspense>
    <TitleBar is-main-window has-home-button has-settings-button has-minimize-button has-maximize-button title="YouTube Music Desktop App" :icon-file="logo" />
  </Suspense>
  <Suspense>
    <YTMViewLoading />
  </Suspense>
  <div ref="keyboardFocus" tabindex="32767"></div>
</template>
