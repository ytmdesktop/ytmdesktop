/*
 * Same as the original source adblockplusui\adblockpluschrome\devtools.js
 * except:
 * - updated the panel name, and icon file name
 */
"use strict";

let panelWindow = null;

(async() =>
{
  // Versions of Firefox before 54 do not support the devtools.panels API; on
  // these platforms, even when the option is enabled, we cannot show the
  // devtools panel.
  if ("panels" in browser.devtools)
  {
    let enabled = await browser.runtime.sendMessage(
      {type: "prefs.get", key: "show_devtools_panel"}
    );
    if (enabled)
    {
      let panel = await browser.devtools.panels.create(
        "AdBlock", "icons/ab-32.png", "devtools-panel.html"
      );

      panel.onShown.addListener(window =>
      {
        panelWindow = window;
      });

      panel.onHidden.addListener(window => {
        panelWindow = null;
      });

      if (panel.onSearch) {
        panel.onSearch.addListener((eventName, queryString) => {
          if (panelWindow) {
            panelWindow.postMessage({ type: eventName, queryString }, "*");
          }
        });
      }
    }
  }
})();
