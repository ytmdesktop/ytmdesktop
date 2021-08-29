'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, onReady, DOMPurify */

if (window.top === window.self && /(^|\.)twitch\.tv$/.test(window.location.hostname) === true) {
  /*
    This content script, when injected into tab that is on twitch.tv, will:
      1) Inject a script tag into the twitch.tv page context to:
        1.a) listen for event messages from content script (update URL with channel name)
        1.b) send event messages (channel name, video id) to content script
        1.c) wrapped the Fetch API to capture the channel name in the JSON request or response
        1.d) when the channel name is found,
           1.d.1) send a event message to the content script (1.b above)
           1.d.2) parse the channel name, and update the pages URL

      2) Add listeners for messages from background page, and injected script
  */

  const toContentScriptRandomEventName = `ab-twitch-channel-name-${Math.random().toString(36).substr(2)}`;
  const fromContentScriptRandomEventName = `twitch-ab-channel-name-${Math.random().toString(36).substr(2)}`;

  // the following code will be injected into the Twitch JS page context.
  const captureFetchRequests = function
  (settings, toContentScriptEventName, fromContentScriptEventName) {
    if (XMLHttpRequest.wrapped === true) {
      return;
    }

    // const isWhitelisted = false;
    // const thePath = '';

    if (settings && settings.twitch_channel_allowlist) {
      const myHistory = History.prototype;
      const myPushState = myHistory.pushState;
      // capture the Twitch channel name when Twitch updates the History
      myHistory.pushState = function thePushState(...args) {
        if (args && args.length > 2 && typeof args[2] === 'string' && !args[2].startsWith('/directory/')) {
          document.dispatchEvent(new CustomEvent(toContentScriptEventName,
            { detail: { path: args[2] } }));
        }
        return myPushState.apply(this, args);
      };
    }

    // used to decode all encoded HTML  (convert '&' to &amp;)
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
        const parsedChannelName = parseChannelName(channelName).toLowerCase();
        if (window.location.href.indexOf(`ab_channel=${parsedChannelName}`) > 0) {
          return;
        }
        // prevent adding the channel name(s) from the home page carousel
        if (window.location.pathname === '/') {
          return;
        }

        let updatedUrl;
        let [baseUrl] = window.location.href.split('&ab_channel');
        [baseUrl] = baseUrl.split('?ab_channel');
        if (baseUrl.indexOf('?') === -1) {
          updatedUrl = `${baseUrl}?ab_channel=${parsedChannelName}`;
        } else {
          updatedUrl = `${baseUrl}&ab_channel=${parsedChannelName}`;
        }
        // Add the name of the channel to the end of URL
        window.history.replaceState(null, null, updatedUrl);
      }
    }

    // process the event messages from the AdBlock content script
    document.addEventListener(fromContentScriptEventName, (event) => {
      if (event && event.detail && event.detail.path === window.location.pathname) {
        // if (event && event.detail &&
        //   Object.prototype.hasOwnProperty.call(event.detail, 'isWhitelisted')) {
        //  ({ isWhitelisted } = event.detail);
        // }
        // thePath = event.detail.path;
        // if the URL doesn't contain the query string with the channel name in it, add it.
        // for example, this situation can occur when clicking between the same 'followed'
        // channels several times
        if (
          !document.location.href.includes('ab_channel=')
           && window.location.href.match(/\//g).length === 1
        ) {
          let channelName = event.detail.path;
          if (channelName.startsWith('/')) {
            channelName = channelName.substr(1);
          }
          updateURLWrapped(channelName);
          document.dispatchEvent(new CustomEvent(toContentScriptEventName,
            { detail: { channelName } }));
        }
      }
    });

    let preProcessCheck = function () {
      // no-op
    };
    let postRequestCheck = function () {
      // no-op
    };
    // This is the code that used for obtaining the channel name (if enabled)
    if (settings && settings.twitch_channel_allowlist) {
      preProcessCheck = function (input, params) {
        if (params.length >= 2
            && typeof input === 'string'
            && input.includes('https://gql.twitch.tv/gql')
        ) {
          let body = {};
          try {
            body = JSON.parse(params[1].body);
          } catch (ex) {
            // eslint-disable-next-line no-console
            console.log('ex', ex);
          }
          // the following is invoked from a /team/ page
          if (body && Array.isArray(body) && body.length > 0 && body[0].variables && body[0].variables.channel && window.location.pathname.startsWith('/team/')) {
            updateURLWrapped(body[0].variables.channel);
            document.dispatchEvent(new CustomEvent(toContentScriptEventName,
              { detail: { channelName: body[0].variables.channel } }));
          }
          // the following is invoked from the home page
          if (body && Array.isArray(body) && body.length > 0 && body[0].variables && body[0].variables.channel && window.location.pathname.startsWith('/team/')) {
            updateURLWrapped(body[0].variables.channel);
            document.dispatchEvent(new CustomEvent(toContentScriptEventName,
              { detail: { channelName: body[0].variables.channel } }));
          }
        }
      };

      postRequestCheck = function (response) {
        if (response && response.url === 'https://gql.twitch.tv/gql') {
          response.clone().json().then((respObj) => {
            if (Array.isArray(respObj) && respObj.length > 0) {
              let nameFound = false;
              for (let inx = 0; (inx < respObj.length && nameFound === false); inx++) {
                const entry = respObj[inx];
                // capture channel name when loading a video with the URL https://www.twitch.tv/videos/...
                if (entry && entry.data && entry.data.video && entry.data.video.owner && entry.data.video.owner.displayName && window.location.pathname.startsWith('/videos/')) {
                  nameFound = true;
                  updateURLWrapped(entry.data.video.owner.displayName);
                  document.dispatchEvent(new CustomEvent(toContentScriptEventName,
                    { detail: { channelName: entry.data.video.owner.displayName } }));
                }
                // capture channel name when loading a video with the URL https://www.twitch.tv/clips/...
                if (entry && entry.data && entry.data.clip && entry.data.clip.broadcaster && entry.data.clip.broadcaster.displayName && window.location.pathname.indexOf('/clip/')) {
                  nameFound = true;
                  updateURLWrapped(entry.data.clip.broadcaster.displayName);
                  document.dispatchEvent(new CustomEvent(toContentScriptEventName,
                    { detail: { channelName: entry.data.clip.broadcaster.displayName } }));
                }
                if (entry && entry.data && entry.data.user && entry.data.user.displayName && (entry.data.user.channel || entry.data.user.stream) && !window.location.pathname.startsWith('/directory/')) {
                  nameFound = true;
                  updateURLWrapped(entry.data.user.displayName);
                  document.dispatchEvent(new CustomEvent(toContentScriptEventName,
                    { detail: { channelName: entry.data.user.displayName } }));
                }
                // capture channel name when clicking on the same channels multiple times
                // in the 'followed channels' panel on the left on the home page
                if (!nameFound && entry && entry.data && entry.data.community && entry.data.community.displayName && !window.location.pathname.startsWith('/directory/')) {
                  nameFound = true;
                  updateURLWrapped(entry.data.community.displayName);
                  document.dispatchEvent(new CustomEvent(toContentScriptEventName,
                    { detail: { channelName: entry.data.community.displayName } }));
                }
              }
            }
          });
        }
      };
    } // end of if


    const myFetch = window.fetch;
    XMLHttpRequest.wrapped = true;
    window.fetch = function theFetch(...args) {
      const params = args;
      let input = '';
      if (params.length >= 1) {
        [input] = params;
      }

      preProcessCheck(input, params);
      return new Promise((resolve, reject) => {
        myFetch.apply(this, params)
          .then((response) => {
            postRequestCheck(response);
            resolve(response);
          })
          .catch((error) => {
            reject(error);
          });
      });
    };
  }; // end of captureFetchRequests() - injected into Twitch's page context

  const addEventListeners = function () {
    // process the event messages from the injected script
    document.addEventListener(toContentScriptRandomEventName, (event) => {
      if (event && event.detail && event.detail.channelName) {
        browser.runtime.sendMessage({ command: 'updateTwitchChannelName', channelName: event.detail.channelName });
      }
      if (event && event.detail && event.detail.path) {
        const thePage = {};
        thePage.url = new URL(`https://www.twitch.tv${event.detail.path}`);
        browser.runtime.sendMessage({ command: 'pageIsWhitelisted', page: JSON.stringify(thePage) }).then((isWhitelisted) => {
          document.dispatchEvent(new CustomEvent(fromContentScriptRandomEventName,
            { detail: { path: event.detail.path, isWhitelisted } }));
        });
        browser.runtime.sendMessage({ command: 'allowlistingStateRevalidate' });
      }
    });
  };

  const injectWrappers = function (settings) {
    const elemDOMPurify = document.createElement('script');
    elemDOMPurify.src = browser.runtime.getURL('purify.min.js');
    const scriptToInject = `(${captureFetchRequests.toString()})(${JSON.stringify(settings)}, '${toContentScriptRandomEventName}', '${fromContentScriptRandomEventName}');`;
    const elem = document.createElement('script');
    elem.appendChild(document.createTextNode(scriptToInject));
    try {
      (document.head || document.documentElement).appendChild(elemDOMPurify);
      (document.head || document.documentElement).appendChild(elem);
    } catch (ex) {
      // eslint-disable-next-line no-console
      console.log(ex);
    }
  };

  browser.runtime.sendMessage({ command: 'getSettings' }).then((settings) => {
    injectWrappers(settings);
    if (settings && settings.twitch_channel_allowlist) {
      addEventListeners();
    }
  });
}// end of top if
