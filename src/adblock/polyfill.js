/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-present eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

{
  let asyncAPIs = [
    "browserAction.setIcon",
    "browserAction.getPopup",
    "contentSettings.cookies.get",
    "contentSettings.javascript.get",
    "contextMenus.removeAll",
    "devtools.panels.create",
    "management.getAll",
    "management.getSelf",
    "notifications.clear",
    "notifications.create",
    "permissions.contains",
    "permissions.remove",
    "permissions.request",
    "runtime.getBrowserInfo",
    "runtime.getPlatformInfo",
    "runtime.openOptionsPage",
    "runtime.sendMessage",
    "runtime.setUninstallURL",
    "storage.local.get",
    "storage.local.remove",
    "storage.local.set",
    "storage.managed.get",
    "tabs.captureVisibleTab",
    "tabs.create",
    "tabs.executeScript",
    "tabs.get",
    "tabs.getCurrent",
    "tabs.insertCSS",
    "tabs.query",
    "tabs.reload",
    "tabs.remove",
    "tabs.removeCSS",
    "tabs.sendMessage",
    "tabs.update",
    "webNavigation.getAllFrames",
    "webRequest.handlerBehaviorChanged",
    "windows.create",
    "windows.update"
  ];

  // Chrome (<= 66) and Opera (<= 54) don't accept passing a callback for
  // browserAction.setBadgeText and browserAction.setBadgeBackgroundColor
  const maybeAsyncAPIs = [
    ["browserAction.setBadgeText", {text: ""}],
    ["browserAction.setBadgeBackgroundColor", {color: [0, 0, 0, 0]}]
  ];
  let syncAPIs = [];

  // Since we add a callback for all messaging API calls in our wrappers,
  // Chrome assumes we're interested in the response; when there's no response,
  // it sets runtime.lastError
  const portClosedBeforeResponseError =
    // Older versions of Chrome have a typo:
    // https://crrev.com/c33f51726eacdcc1a487b21a13611f7eab580d6d
    /^The message port closed before a res?ponse was received\.$/;

  // This is the error Firefox throws when a message listener is not a
  // function.
  const invalidMessageListenerError = "Invalid listener for runtime.onMessage.";

  let messageListeners = new WeakMap();

  function getAPIWrappables(api)
  {
    let object = browser;
    let path = api.split(".");
    let name = path.pop();

    for (let node of path)
    {
      object = object[node];

      if (!object)
        return;
    }

    let func = object[name];
    if (!func)
      return;

    return {object, name, func};
  }

  function wrapAsyncAPI(api)
  {
    let wrappables = getAPIWrappables(api);

    if (!wrappables)
      return;

    let {object, name, func} = wrappables;

    // If the property is not writable assigning it will fail, so we use
    // Object.defineProperty here instead. Assuming the property isn't
    // inherited its other attributes (e.g. enumerable) are preserved,
    // except for accessor attributes (e.g. get and set) which are discarded
    // since we're specifying a value.
    Object.defineProperty(object, name, {
      value(...args)
      {
        let resolvePromise = null;
        let rejectPromise = null;

        func.call(object, ...args, result =>
        {
          let error = browser.runtime.lastError;
          if (error && !portClosedBeforeResponseError.test(error.message))
            rejectPromise(new Error(error.message));
          else
            resolvePromise(result);
        });

        return new Promise((resolve, reject) =>
        {
          resolvePromise = resolve;
          rejectPromise = reject;
        });
      }
    });
  }

  function wrapSyncAPI(api)
  {
    let wrappables = getAPIWrappables(api);

    if (!wrappables)
      return;

    let {object, name, func} = wrappables;

    Object.defineProperty(object, name, {
      value(...args)
      {
        return Promise.resolve(func.call(object, ...args));
      }
    });
  }

  function wrapRuntimeOnMessage()
  {
    let {onMessage} = browser.runtime;
    let {addListener, removeListener} = onMessage;

    onMessage.addListener = function(listener)
    {
      if (typeof listener != "function")
        throw new Error(invalidMessageListenerError);

      // Don't add the same listener twice or we end up with multiple wrappers.
      if (messageListeners.has(listener))
        return;

      let wrapper = (message, sender, sendResponse) =>
      {
        let wait = listener(message, sender, sendResponse);

        if (wait instanceof Promise)
        {
          wait.then(sendResponse, reason =>
          {
            try
            {
              sendResponse();
            }
            catch (error)
            {
              // sendResponse can throw if the internal port is closed; be sure
              // to throw the original error.
            }

            throw reason;
          });
        }

        return !!wait;
      };

      addListener.call(onMessage, wrapper);
      messageListeners.set(listener, wrapper);
    };

    onMessage.removeListener = function(listener)
    {
      if (typeof listener != "function")
        throw new Error(invalidMessageListenerError);

      let wrapper = messageListeners.get(listener);
      if (wrapper)
      {
        removeListener.call(onMessage, wrapper);
        messageListeners.delete(listener);
      }
    };

    onMessage.hasListener = function(listener)
    {
      if (typeof listener != "function")
        throw new Error(invalidMessageListenerError);

      return messageListeners.has(listener);
    };
  }

  function shouldWrapAPIs()
  {
    try
    {
      return !(browser.storage.local.get([]) instanceof Promise);
    }
    catch (error)
    {
    }

    return true;
  }

  function acceptsCallback(func, args)
  {
    try
    {
      func(...args, () => {});
      return true;
    }
    catch (e)
    {
      return false;
    }
  }

  if (shouldWrapAPIs())
  {
    // Unlike Firefox, Chrome doesn't have a "browser" object, but provides
    // the extension API through the "chrome" namespace (non-standard).
    if (typeof browser == "undefined")
      self.browser = chrome;

    for (let [api, ...testArgs] of maybeAsyncAPIs)
    {
      let wrappables = getAPIWrappables(api);

      if (!wrappables)
        continue;

      let {func} = wrappables;

      (acceptsCallback(func, testArgs) ? asyncAPIs : syncAPIs).push(api);
    }

    for (let api of asyncAPIs)
      wrapAsyncAPI(api);

    for (let api of syncAPIs)
      wrapSyncAPI(api);

    wrapRuntimeOnMessage();
  }
}

// Object.values is not supported in Chrome <54.
if (!("values" in Object))
  Object.values = obj => Object.keys(obj).map(key => obj[key]);

// Firefox <56 separates the locale parts with an underscore instead of a dash.
// https://bugzilla.mozilla.org/show_bug.cgi?id=1374552
let {getUILanguage} = browser.i18n;
browser.i18n.getUILanguage = function()
{
  return getUILanguage().replace("_", "-");
};

// Chrome <69 does not support OffscreenCanvas
if (typeof OffscreenCanvas == "undefined")
{
  self.OffscreenCanvas = function(width, height)
  {
    let canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
}

// Some Node.js modules rely on the global reference.
self.global = self;
