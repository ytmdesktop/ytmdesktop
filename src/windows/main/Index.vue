<script setup lang="ts">
import { onMounted, ref } from "vue";
import TitleBar from "../../shared/components/TitleBar.vue";
import YTMViewLoadTimeout from "../../shared/components/YTMViewLoadTimeout.vue";

const keyboardFocus = ref<HTMLElement>(null);
const keyboardFocusZero = ref<HTMLElement>(null);

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
});
</script>

<template>
    <div ref="keyboardFocusZero" tabindex="0"></div>
    <TitleBar has-home-button has-settings-button has-minimize-button has-maximize-button title="YouTube Music Desktop App" :icon-file="require('../../assets/icons/ytmd_white.png')" />
    <Suspense>
      <YTMViewLoadTimeout class="ytmview-load-timeout" />
    </Suspense>
    <div ref="keyboardFocus" tabindex="32767"></div>
</template>
