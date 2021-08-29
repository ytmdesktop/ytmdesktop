"use strict";

// Workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=1408996
let ext = window.ext; // eslint-disable-line no-redeclare

// Firefox 55 erroneously sends messages from the content script to the
// devtools panel:
// https://bugzilla.mozilla.org/show_bug.cgi?id=1383310
// As a workaround, listen for messages only if this isn't the devtools panel.
// Note that Firefox processes API access lazily, so browser.devtools will
// always exist but will have undefined as its value on other pages.
if (!browser.devtools)
{
  // Listen for messages from the background page.
  browser.runtime.onMessage.addListener((message, sender, sendResponse) =>
  {
    return ext.onMessage._dispatch(message, {}, sendResponse).includes(true);
  });
}

{
  let port = null;
  let registeredListeners = null;

  ext.onExtensionUnloaded = {
    addListener(listener)
    {
      if (!port)
      {
        port = browser.runtime.connect();
        registeredListeners = 0;
      }

      if (!port.onDisconnect.hasListener(listener))
      {
        // When the extension is reloaded, disabled or uninstalled the
        // background page dies and automatically disconnects all ports
        port.onDisconnect.addListener(listener);
        registeredListeners++;
      }
    },
    removeListener(listener)
    {
      if (port)
      {
        if (port.onDisconnect.hasListener(listener))
        {
          port.onDisconnect.removeListener(listener);
          registeredListeners--;
        }

        if (registeredListeners == 0)
        {
          port.disconnect();
          port = null;
          registeredListeners = null;
        }
      }
    }
  };
}
