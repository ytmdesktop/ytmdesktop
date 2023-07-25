<script setup lang="ts">
import TitleBar from '../../shared/components/TitleBar.vue';
import Auth from './Auth.vue';
</script>

<template>
    <div class="container">
        <TitleBar class="titlebar" />
        <Suspense>
            <Auth></Auth>
        </Suspense>
    </div>
</template>

<style scoped>
.titlebar {
    border-bottom: 1px solid #212121;
}

.container {
    width: 100%;
    height: 100%;
    background-color: #000000;
}
</style>