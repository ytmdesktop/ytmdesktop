'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, adblock_installed, adblock_userid, adblock_version, adblock_ext_id */

const invalidGUIDChars = /[^a-z0-9]/g;

const gabHostnames = ['getadblock.com', 'dev.getadblock.com', 'dev1.getadblock.com', 'dev2.getadblock.com', 'getadblockpremium.com'];
const gabHostnamesWithProtocal = ['https://getadblock.com', 'http://dev.getadblock.com', 'http://dev1.getadblock.com', 'http://dev2.getadblock.com', 'https://getadblockpremium.com'];

let abort = (function shouldAbort() {
  if (document instanceof HTMLDocument === false) {
    if (document instanceof XMLDocument === false
            || document.createElement('div') instanceof HTMLDivElement === false) {
      return true;
    }
  }
  if ((document.contentType || '').lastIndexOf('image/', 0) === 0) {
    return true;
  }
  return false;
}());


if (!abort) {
  let { hostname } = window.location;

  if (hostname === '') {
    hostname = (function getHostname() {
      let win = window;
      let hn = '';
      let max = 10;
      try {
        for (;;) {
          hn = win.location.hostname;
          if (hn !== '') {
            return hn;
          }
          if (win.parent === win) {
            break;
          }
          win = win.parent;
          if (!win) {
            break;
          }
          if ((max -= 1) === 0) {
            break;
          }
        }
      } catch (ex) {
        // emtpy
      }
      return hn;
    }());
  }
  // Don't inject if document is from local network.
  abort = /^192\.168\.\d+\.\d+$/.test(hostname);
}

const getAdblockDomain = function () {
  // eslint-disable-next-line no-global-assign
  adblock_installed = true;
};

const getAdblockDomainWithUserID = function (userid) {
  // eslint-disable-next-line no-global-assign
  adblock_userid = userid;
};

const getAdblockVersion = function (version) {
  // eslint-disable-next-line no-global-assign
  adblock_version = version;
};

const getAdblockExtId = function (extId) {
  // eslint-disable-next-line no-global-assign
  adblock_ext_id = extId;
};

// listen to messages from the background page
function onMessage(request, sender, sendResponse) {
  if (Object.prototype.hasOwnProperty.call(request, 'dataMigrationStatus')) {
    browser.runtime.onMessage.removeListener(onMessage);
    window.postMessage({ dataMigrationStatus: request.dataMigrationStatus }, '*');
    sendResponse({});
  }
}

function receiveMessage(event) {
  if (
    event.data
    && gabHostnamesWithProtocal.includes(event.origin)
    && event.data.command === 'payment_success'
  ) {
    window.removeEventListener('message', receiveMessage);
    browser.runtime.onMessage.addListener(onMessage);
    browser.runtime.sendMessage({ command: 'payment_success', version: 1, origin: event.origin })
      .then((response) => {
        window.postMessage(response, '*');
      });
  }
}

(function onLoad() {
  if (abort) {
    return;
  }

  // Only for dynamically created frames and http/https documents.
  if (/^(https?:|about:)/.test(window.location.protocol) !== true) {
    return;
  }

  const doc = document;
  const parent = doc.head || doc.documentElement;
  if (parent === null) {
    return;
  }

  // Have the script tag remove itself once executed (leave a clean
  // DOM behind).
  const cleanup = function () {
    const c = document.currentScript;
    const p = c && c.parentNode;
    if (p) {
      p.removeChild(c);
    }
  };

  if (gabHostnames.includes(document.location.hostname) && window.top === window.self) {
    window.addEventListener('message', receiveMessage, false);
    browser.storage.local.get('userid').then((response) => {
      let adblockUserId = response.userid;
      if (adblockUserId.match(invalidGUIDChars)) {
        adblockUserId = 'invalid';
      }
      const adblockVersion = browser.runtime.getManifest().version;
      const elem = document.createElement('script');
      const scriptToInject = `(${getAdblockDomain.toString()})();`
            + `(${cleanup.toString()})();`
            + `(${getAdblockDomainWithUserID.toString()})('${adblockUserId}');`
            + `(${getAdblockExtId.toString()})('${browser.runtime.id}');`
            + `(${getAdblockVersion.toString()})('${adblockVersion}');`;
      elem.appendChild(document.createTextNode(scriptToInject));
      try {
        (document.head || document.documentElement).appendChild(elem);
      } catch (ex) {
        // empty
      }
    });
  }
}());

const runBandaids = function () {
  const { hostname } = window.location;
  // Tests to determine whether a particular bandaid should be applied
  let applyBandaidFor = '';
  if (/mail\.live\.com/.test(hostname)) {
    applyBandaidFor = 'hotmail';
  } else if (gabHostnames.includes(hostname) && window.top === window.self) {
    applyBandaidFor = 'getadblock';
  }

  const bandaids = {
    hotmail() {
      // removing the space remaining in Hotmail/WLMail
      const cssChunk = document.createElement('style');
      cssChunk.type = 'text/css';
      (document.head || document.documentElement).insertBefore(cssChunk, null);
      cssChunk.sheet.insertRule('.WithRightRail { right:0px !important; }', 0);
      cssChunk.sheet.insertRule(`#RightRailContainer
      {
        display: none !important;
        visibility: none !important;
        orphans: 4321 !important;
      }`, 0);
    },
    getadblock() {
      browser.storage.local.get('userid').then((response) => {
        if (response.userid) {
          const elemDiv = document.createElement('div');
          elemDiv.id = 'adblockUserId';
          elemDiv.innerText = response.userid;
          elemDiv.style.display = 'none';
          document.body.appendChild(elemDiv);
        }
      });
      const enableShowSurvey = document.getElementById('enable_show_survey');
      if (enableShowSurvey) {
        enableShowSurvey.onclick = function showSurvey() {
          browser.runtime.sendMessage({ command: 'setSetting', name: 'show_survey', isEnabled: !enableShowSurvey.checked });
        };
      }
      const aaElements = document.querySelectorAll('#disableacceptableads');
      if (aaElements && aaElements.length) {
        for (let i = 0; i < aaElements.length; ++i) {
          aaElements[i].onclick = function unsubscribeAcceptableAds(event) {
            if (event.isTrusted === false) {
              return;
            }
            event.preventDefault();
            browser.runtime.sendMessage({ command: 'unsubscribe', id: 'acceptable_ads' }).then(() => {
              browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'disableacceptableads_clicked' }).then(() => {
                browser.runtime.sendMessage({ command: 'openTab', urlToOpen: 'options.html?aadisabled=true#general' });
              });
            });
          };
        }
      }

      // Listen to clicks on 'Get Started With MyAdBlock' on v4 payment page
      const getStartedElements = document.querySelectorAll('.get-started-with-myadblock');
      if (getStartedElements && getStartedElements.length) {
        for (let i = 0; i < getStartedElements.length; ++i) {
          getStartedElements[i].onclick = function getStartedWithMyAdBlock(event) {
            if (event.isTrusted === false) {
              return;
            }
            event.stopImmediatePropagation();
            event.preventDefault();
            browser.runtime.sendMessage({ command: 'openTab', urlToOpen: 'options.html#mab' });
          };
        }
      }

      // add click handler for adblock subscribe clicks
      // similiar to the code here:
      // https://github.com/adblockplus/adblockpluschrome/blob/master/subscriptionLink.postload.js
      // the link host check ('subscribe.getadblock.com') is specific to the getadblock.com domain
      document.addEventListener('click', (event) => {
        // Ignore right-clicks
        if (event.button === 2) {
          return;
        }

        // Ignore simulated clicks.
        if (event.isTrusted === false) {
          return;
        }

        // Search the link associated with the click
        let link = event.target;
        while (!(link instanceof HTMLAnchorElement)) {
          link = link.parentNode;

          if (!link) {
            return;
          }
        }

        let queryString = null;
        if (link.protocol === 'http:' || link.protocol === 'https:') {
          if (link.host === 'subscribe.getadblock.com' && link.pathname === '/') {
            queryString = link.search.substr(1);
          }
        } else {
          return;
        }

        if (!queryString) {
          return;
        }

        // This is our link - make sure the browser doesn't handle it
        event.preventDefault();
        event.stopPropagation();

        // Decode URL parameters
        let title = null;
        let url = null;
        for (const param of queryString.split('&')) {
          const parts = param.split('=', 2);
          if (parts.length === 2) {
            switch (parts[0]) {
              case 'title':
                title = decodeURIComponent(parts[1]);
                break;
              case 'location':
                url = decodeURIComponent(parts[1]);
                break;
              default: // do nothing
            }
          }
        }
        if (!url) {
          return;
        }

        // Default title to the URL
        if (!title) {
          title = url;
        }

        // Trim spaces in title and URL
        title = title.trim();
        url = url.trim();
        if (!/^(https?|ftp):/.test(url)) {
          return;
        }

        browser.runtime.sendMessage({
          type: 'subscriptions.add',
          title,
          url,
          confirm: true,
        });
      }, true);
    },
  }; // end bandaids

  if (applyBandaidFor) {
    bandaids[applyBandaidFor]();
  }
};
