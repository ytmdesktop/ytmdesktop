/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/latest/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import "material-symbols/outlined.css";
import "~assets/app.css";

import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import App from "./Index.vue";

import enUS from "~locales/en-US.json";

const i18n = createI18n({
  legacy: false,
  locale: navigator.language,
  fallbackLocale: "en-US"
});

// Developer note: i18n is not explicitly constructed with en-US on the messages property due to type strictness issues from i18n when doing so
i18n.global.setLocaleMessage("en-US", enUS);

const app = createApp(App);
app.use(i18n);
app.mount("#app");
