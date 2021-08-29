'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, onReady, DOMPurify, parseUri */

if (window.top === window.self && /^www\.youtube\.com$/.test(window.location.hostname) === true) {
  /*
  This content script, when injected into tab that is on youtube.com, will:
    1) Inject a script tag into the youtube.com page context to:
      1.a) listen for event messages from content script (update URL with channel name)
      1.b) send event messages (channel name, video id) to content script
      1.c) wrapped XHR to capture the channel name in the JSON response (for '/watch' URLs only)
      1.d) define the 'ytInitialPlayerResponse' object to monitor for its creation, to capture
          the channel name
      1.e) when the channel name is found in (1.c or 1.d) above,
      1.e.1) send a event message to the content script (1.b above)
      1.e.2) parse the channel name, and update the pages URL

    2) Add listeners for messages from background page, and injected script
  */

  const toContentScriptRandomEventName = `ab-yt-channel-name-${Math.random().toString(36).substr(2)}`;
  const fromContentScriptRandomEventName = `yt-ab-channel-name-${Math.random().toString(36).substr(2)}`;

  // retain the last known channel name and video id
  // to be used when the URL is updated, and the ab-channel query string parameter is removed
  let gChannelName = '';
  let gNextVideoId = '';

  // listen to messages from the background page
  const onMessage = function (request, sender, sendResponse) {
    if (request.command === 'updateURLWithYouTubeChannelName') {
      if (gNextVideoId === parseUri.parseSearch(window.location.href).v) {
        window.postMessage({
          eventName: fromContentScriptRandomEventName,
          channelName: String(gChannelName),
        }, '*');
        sendResponse({});
        return;
      }

      // fallback if the video ids don't match, get the channel name from the DOM
      // If YouTube updates the website, then the selector below may no longer work.
      const thisChannelList = document.querySelectorAll('ytd-video-owner-renderer ytd-channel-name');
      if ((thisChannelList.length > 0) && thisChannelList[0].innerText) {
        const tempChannelName = String(thisChannelList[0].innerText.trim());
        if (tempChannelName && (gNextVideoId === parseUri.parseSearch(window.location.href).v)) {
          window.postMessage({
            eventName: fromContentScriptRandomEventName,
            channelName: String(gChannelName),
          }, '*');
          sendResponse({});
        }
      }
    }
    if (request.message === 'ping_yt_content_script') {
      sendResponse({ status: 'yes' });
    }
    if (request.message === 'removeYouTubeChannelName') {
      window.postMessage({
        eventName: fromContentScriptRandomEventName,
        removeChannelName: true,
      }, '*');
      sendResponse({});
    }
  };
  browser.runtime.onMessage.addListener(onMessage);

  // the following code will be injected into the tab JS page context.
  const captureAJAXRequests = function (toContentScriptEventName, fromContentScriptEventName) {
    if (XMLHttpRequest.wrapped === true) {
      return;
    }
    // used to decode all encoded HTML (convert '&' to &amp;)
    const parseElem = document.createElement('textarea');

    const parseChannelName = function (channelNameToParse) {
      function fixedEncodeURIComponent(str) {
        return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
      }
      parseElem.innerHTML = DOMPurify.sanitize(channelNameToParse);
      const channelName = parseElem.innerText;
      // Remove whitespace, and encode
      return fixedEncodeURIComponent(channelName.replace(/\s/g, ''));
    };
    // Parse a URL. Based upon http://blog.stevenlevithan.com/archives/parseuri
    // parseUri 1.2.2, (c) Steven Levithan <stevenlevithan.com>, MIT License
    // Inputs: url: the URL you want to parse
    // Outputs: object containing all parts of |url| as attributes
    const parseUriRegEx = /^(([^:]+(?::|$))(?:(?:\w+:)?\/\/)?(?:[^:@/]*(?::[^:@/]*)?@)?(([^:/?#]*)(?::(\d*))?))((?:[^?#/]*\/)*[^?#]*)(\?[^#]*)?(#.*)?/;
    const parseUri = function (theURL) {
      const matches = parseUriRegEx.exec(theURL);

      // The key values are identical to the JS location object values for that key
      const keys = ['href', 'origin', 'protocol', 'host', 'hostname', 'port',
        'pathname', 'search', 'hash'];
      const uri = {};
      for (let i = 0; (matches && i < keys.length); i++) {
        uri[keys[i]] = matches[i] || '';
      }
      return uri;
    };

    // Parses the search part of a URL into a key: value object.
    // e.g., ?hello=world&ext=adblock would become {hello:"world", ext:"adblock"}
    // Inputs: search: the search query of a URL. Must have &-separated values.
    parseUri.parseSearch = function parseSearch(searchQuery) {
      const params = {};
      let search = searchQuery;
      let pair;

      // Fails if a key exists twice (e.g., ?a=foo&a=bar would return {a:"bar"}
      search = search.substring(search.indexOf('?') + 1).split('&');

      for (let i = 0; i < search.length; i++) {
        pair = search[i].split('=');
        if (pair[0] && !pair[1]) {
          pair[1] = '';
        }
        const pairKey = decodeURIComponent(pair[0]);
        const pairValue = decodeURIComponent(pair[1]);
        if (pairKey && pairValue !== 'undefined') {
          params[pairKey] = pairValue;
        }
      }
      return params;
    };

    // Strip third+ level domain names from the domain and return the result.
    // Inputs: domain: the domain that should be parsed
    // keepDot: true if trailing dots should be preserved in the domain
    // Returns: the parsed domain
    parseUri.secondLevelDomainOnly = function stripThirdPlusLevelDomain(domain, keepDot) {
      if (domain) {
        const match = domain.match(/([^.]+\.(?:co\.)?[^.]+)\.?$/) || [domain, domain];
        return match[keepDot ? 0 : 1].toLowerCase();
      }

      return domain;
    };

    function updateURLWrapped(channelName) {
      if (channelName) {
        const parsedChannelName = parseChannelName(channelName);
        let updatedUrl;
        let [baseUrl] = window.location.href.split('&ab_channel');
        [baseUrl] = baseUrl.split('?ab_channel');
        if (parseUri(window.location.href).search.indexOf('?') === -1) {
          updatedUrl = `${baseUrl}?&ab_channel=${parsedChannelName}`;
        } else {
          updatedUrl = `${baseUrl}&ab_channel=${parsedChannelName}`;
        }
        // Add the name of the channel to the end of URL
        window.history.replaceState(null, null, updatedUrl);
      }
    }

    function processVideoData(data) {
      if (
        data
        && data.videoDetails
        && data.videoDetails.author
      ) {
        const { author, videoId } = data.videoDetails;
        updateURLWrapped(author);
        window.postMessage({
          eventName: toContentScriptEventName,
          channelName: String(author),
          videoId,
        }, '*');
      }
    }

    let currentDescriptor = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse');
    if (currentDescriptor) {
      const descOneSetOrigin = currentDescriptor.set;
      currentDescriptor.set = function set(newValue) {
        descOneSetOrigin(newValue);
        processVideoData(newValue);
      };
    } else {
      let ytInitialPlayerResponseWrapped;
      currentDescriptor = {
        configurable: true,
        get() {
          return ytInitialPlayerResponseWrapped;
        },
        set(newValue) {
          ytInitialPlayerResponseWrapped = newValue;
          processVideoData(newValue);
        },
      };
    }
    Object.defineProperty(window, 'ytInitialPlayerResponse', currentDescriptor);

    const theObjectDefineProperty = Object.defineProperty;
    Object.defineProperty = function defineProperties(obj, prop, descriptor) {
      // Prevent YT specific snippets from clobbering or overriding
      if (prop === 'ytInitialPlayerResponse') {
        return;
      }
      theObjectDefineProperty(obj, prop, descriptor);
    };

    const XHR = XMLHttpRequest.prototype;
    XMLHttpRequest.wrapped = true;
    const mySend = XHR.send;
    const myOpen = XHR.open;
    XHR.open = function theOpen(...args) {
      if (args.length > 1) {
        [, this.url] = args;
      } else {
        this.url = '';
      }
      return myOpen.apply(this, args);
    };
    XHR.send = function theSend(...args) {
      if (this.url.includes('https://www.youtube.com/watch?v=')) {
        this.addEventListener('load', function eventHandler() {
          try {
            const responseArray = JSON.parse(this.response);
            if (responseArray) {
              for (const item in responseArray) {
                if (
                  responseArray[item]
                  && responseArray[item].playerResponse
                  && responseArray[item].playerResponse.videoDetails
                  && responseArray[item].playerResponse.videoDetails.author
                ) {
                  const { author, videoId } = responseArray[item].playerResponse.videoDetails;
                  updateURLWrapped(author);
                  window.postMessage({
                    eventName: toContentScriptEventName,
                    channelName: String(author),
                    videoId,
                  }, '*');
                  return;
                }
              }
            }
          } catch (ex) {
            // eslint-disable-next-line no-console
            console.log('ex', ex);
          }
        });
      }
      return mySend.apply(this, args);
    };

    const postRequestCheck = function (response) {
      if (response && response.url && response.url.startsWith('https://www.youtube.com/youtubei/v1/player')) {
        response.clone().json().then((respObj) => {
          if (respObj && respObj.videoDetails) {
            const { author, videoId } = respObj.videoDetails;
            updateURLWrapped(author);
            window.postMessage({
              eventName: toContentScriptEventName,
              channelName: String(author),
              videoId,
            }, '*');
          }
        });
      }
    };

    const myFetch = window.fetch;
    window.fetch = function theFetch(...args) {
      return new Promise((resolve, reject) => {
        myFetch.apply(this, args)
          .then((response) => {
            postRequestCheck(response);
            resolve(response);
          })
          .catch((error) => {
            reject(error);
          });
      });
    };

    // process the event messages from the content script
    window.addEventListener('message', (event) => {
      if (
        event
        && event.data
        && event.data.channelName
        && (event.data.eventName === fromContentScriptEventName
          || event.data.eventName === toContentScriptEventName)) {
        updateURLWrapped(event.data.channelName);
      }
      if (
        event
        && event.data
        && event.data.removeChannelName
        && event.data.eventName === fromContentScriptEventName
      ) {
        // remove the query string from the URL
        const params = parseUri.parseSearch(window.location.search);
        const queryString = Object.keys(params).reduce((prev, key, i) => {
          if (key !== 'ab_channel') {
            return `${prev}${i !== 0 ? '&' : ''}${key}=${params[key]}`;
          }
          return prev;
        }, '');
        window.history.replaceState(null, null, `${window.location.origin}${window.location.pathname}?${queryString}`);
      }
    });
  }; // End of captureAJAXRequests

  const runOnYT = function () {
    const elemDOMPurify = document.createElement('script');
    elemDOMPurify.src = browser.runtime.getURL('purify.min.js');
    const scriptToInject = `(${captureAJAXRequests.toString()})('${toContentScriptRandomEventName}', '${fromContentScriptRandomEventName}');`;
    const elem = document.createElement('script');
    elem.appendChild(document.createTextNode(scriptToInject));
    try {
      (document.head || document.documentElement).appendChild(elemDOMPurify);
      (document.head || document.documentElement).appendChild(elem);
    } catch (ex) {
      // eslint-disable-next-line no-console
      console.log(ex);
    }

    // process the event messages from the injected script
    window.addEventListener('message', (event) => {
      if (
        event
        && event.data
        && event.data.channelName
        && event.data.eventName === toContentScriptRandomEventName
      ) {
        gChannelName = event.data.channelName;
        if (event && event.data && event.data.videoId) {
          gNextVideoId = event.data.videoId;
        }
        browser.runtime.sendMessage({ command: 'updateYouTubeChannelName', channelName: event.data.channelName });
      }
    });
  };
  browser.runtime.sendMessage({ command: 'getSettings' }).then((settings) => {
    if (settings && settings.youtube_channel_whitelist) {
      runOnYT();
    }
  });
}
