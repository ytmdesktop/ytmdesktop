'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, onReady, DOMPurify, translate */

/*
    This content script, when injected into tab that is on YouTube, it will:
    - wait for a message to add two different types of icons to the
      'https://www.youtube.com/feed/channels'  page
    - the two different types of icons are the On Page, and the In Page icon
    - The On Page icon has
      - a 'speech bubble' which is shown on mouse over / hover
      - the 'speech bubble' contains two buttons which allow the user to
        allow ads on ALL subscribed channels, or block ads on ALL subscribed channels
    - The In Page icons are added for each channel and allow the user to allow list,
      block ads on individual subscribed channel
    - The In Page icon has a small panel that is opened on clicking the icon.  This
      panel contains the current state of ad blocking for that channel, and an option
      to toggle that setting
  */

const onPageClickIconElem = DOMPurify.sanitize(`
  <div id="onPageIcon">
    <div id="messagePanel" >
      <div id="message-bubble-content" >
        <div id="lineOne" >
          <img id="lineOneIconLogo" type="image/svg+xml" src='${browser.runtime.getURL('adblock-ads-blocked-icon.svg')}' ></img>
          <span id="lineOneText" ></span>
        </div>
        <div id="lineTwo" >
          <img id="lineTwoIconLogo" type="image/svg+xml" src='${browser.runtime.getURL('adblock-ads-allowed-icon.svg')}' ></img>
          <span id="lineTwoText"></span>
        </div>
      </div>
    </div>
    <img id="iconlogo" type="image/svg+xml" ></img>
  </div>
`, {
  ALLOW_UNKNOWN_PROTOCOLS: true, RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['data'], ADD_TAGS: ['object'],
});

// The following CSS will be inserted into a Shadow DOM for each 'in page icon'
// for each YT Channel the user is subscribed to.
// The CSS is contained within this JS module to avoid loading the same CSS files multiple times.
const onPageClickIconStyleTextContent = ' #onPageIcon { display: flex; } '
                                        + ' #messagePanel { display: none; width: 235px; min-height: 75px; box-shadow: 0px 5px 20px rgba(0,0,0,0.15); border-radius: 6px; z-index: 3400; position: absolute; background-color: white; } '
                                          + ' #message-bubble-content { margin: 10px 0px; } '
                                          + ' #lineOne, #lineTwo { line-height: 28px; padding: 0px 16px; display: flex; align-items: center; } '
                                          + ' #lineOneIconLogo, #lineTwoIconLogo {  height: 18px; width: 18px; display: inline; margin: 0; } '
                                          + ' #lineOneText, #lineTwoText {  padding-left: 7px;  font-size: 14px; font-family: "Lato", Arial, sans-serif; } '
                                          + ' #iconlogo {  height: 18px; width: 18px; cursor: pointer; display: block; margin: auto; } ';


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

// Determine if a specific channel is allow listed
// Inputs:
//   userFilters - an array of user's custom filters which should be filtered
//                 to only include allowlisted rules for YouTube
//   channelName - string - the parsed name of the channel to be checked
// Returns:
//   The matching filter if found in the user's custom rules, false otherwise
const isAdsAllowed = function (userFilters, channelName) {
  if (!userFilters || userFilters.length === 0 || !channelName) {
    return false;
  }
  for (let inx = 0; inx < userFilters.length; inx++) {
    const filterText = userFilters[inx];
    if (filterText.includes(`youtube.com/*${channelName}|$document`)) {
      return filterText;
    }
  }
  return false;
};

// Inputs:
//   - base : the element to attach the CSS as children
//   - callback : function to call when loading is complete
const loadIconResources = function (base, callback) {
  if (document.getElementById('_ABStyleOverlay')) {
    return;
  }
  function loadCss() {
    const cssUrl = browser.runtime.getURL('adblock-yt-manage.css');
    const fontCssUrl = browser.runtime.getURL('fonts/font-face.css');
    const styleElement = document.createElement('style');
    styleElement.id = '_ABStyleOverlay';
    styleElement.classList.add('adblock-ui-stylesheet');

    const cssPromise = fetch(cssUrl).then(response => response.text());
    const fontCSSPromise = fetch(fontCssUrl).then(response => response.text());
    Promise.all([cssPromise, fontCSSPromise]).then((detailsArray) => {
      styleElement.textContent = `${detailsArray[0]} \n ${detailsArray[1]}`;
      callback();
    });
    base.appendChild(styleElement);
  }

  function loadFont(name, style, weight, unicodeRange) {
    return new FontFace('Lato', `url(${browser.runtime.getURL(`/fonts/${name}.woff`)}`, { style, weight, unicodeRange });
  }

  // load fonts programmatically
  // Referencing the fonts in CSS do not load the fonts properly (reason unknown)
  // but programmatically loading them performs reliably.
  const fonts = [];
  fonts.push(loadFont('lato-regular', 'normal', 'normal', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'));
  fonts.push(loadFont('lato-ext-regular', 'normal', 'normal', 'U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF'));
  fonts.push(loadFont('lato-ext-italic', 'italic', 'normal', 'U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF'));
  fonts.push(loadFont('lato-italic', 'italic', 'normal', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'));
  fonts.push(loadFont('lato-ext-bolditalic', 'italic', 'bold', 'U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF'));
  fonts.push(loadFont('lato-bolditalic', 'italic', 'bold', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'));
  fonts.push(loadFont('lato-ext-bold', 'normal', 'bold', 'U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF'));
  fonts.push(loadFont('lato-bold', 'normal', 'bold', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'));
  fonts.push(new FontFace('Material Icons', `url(${browser.runtime.getURL('/icons/MaterialIcons-Regular.woff2')}`, { style: 'normal', weight: 'normal' }));
  fonts.push(new FontFace('AdBlock Icons', `url(${browser.runtime.getURL('/icons/adblock-icons.woff2')}`, { style: 'normal', weight: 'normal' }));
  Promise.all(fonts).then((loaded) => {
    for (let i = 0; i < loaded.length; i++) {
      // documents.fonts supported in Chrome 60+ and documents.fonts.add() is experimental
      // https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet#Browser_compatibility
      // https://developer.mozilla.org/en-US/docs/Web/API/Document/fonts#Browser_compatibility
      document.fonts.add(loaded[i]);
    }
    loadCss();
  }).catch(() => {
    loadCss();
  });
};

// Query the DOM to retrieve all of the YT channel names
// Returns an object with the following structure:
//  key:
//    unparsed channel name
//  attributes:
//    node: the DOM element which contains the channel name
//    parsedChannelName: a string - the parsed channel name (special characters have been escaped)
//
const getAllSubscribedChannelNames = function () {
  const channelNodes = document.querySelectorAll('#info-section');
  const channelNameObs = Object.create(null);
  for (let inx = 0; inx < channelNodes.length; inx++) {
    const channelNode = channelNodes[inx];
    const channelNameNode = channelNode.querySelectorAll('#channel-title #container');
    if (channelNameNode && channelNameNode.length > 0) {
      const channelName = channelNameNode[0].innerText.trim();
      if (!channelNameObs[channelName]) {
        channelNameObs[channelName] = {};
        channelNameObs[channelName].node = channelNode;
        const parsedChannelName = parseChannelName(channelName);
        channelNameObs[channelName].parsedChannelName = parsedChannelName;
      }
    }
  }
  return channelNameObs;
};

const buildOverlay = function () {
  const titleText = translate('youtube_onpage_icon_msg');
  const allowAllButtonText = translate('youtube_onpage_icon_allow_all_btn_text');
  const blockAllButtonText = translate('youtube_onpage_icon_block_all_btn_text');
  const whatsThisText = translate('whats_this');
  const blockedCompleteText = translate('youtube_onpage_icon_blocked_complete_text');
  const allowedCompleteText = translate('youtube_onpage_icon_allowed_complete_text');
  const oneMomentText = translate('youtube_onpage_icon_one_moment_text');
  const signInMessageText = translate('youtube_onpage_icon_sign_in_text');
  const noChannelsFoundMessageText = translate('youtube_onpage_icon_no_channels_text');

  const footerString = `
    <div id="footer">
      <a id="linkWhatsThis"
        href="https://help.getadblock.com/support/solutions/articles/6000067131-can-i-use-adblock-and-still-allow-ads-on-my-favorite-youtube-channels-"
        target="_blank" rel="noopener">${whatsThisText}</a>
      </div>`;

  const normalContentString = `
    <div id="normalContent">
      <div id="titleText">${titleText}</div>
      <div id="buttonContent">
        <div id="btnAllowAll" class="onPageIconButton" >
          <div class="centerContent" >
            <img class="smallIconLogo" type="image/svg+xml" src='${browser.runtime.getURL('adblock-ads-allowed-icon.svg')}' ></img>
            <div class="textContent">${allowAllButtonText}</div>
          </div>
        </div>
        <div id="btnBlockAll" class="onPageIconButton">
          <div class="centerContent" >
            <img class="smallIconLogo" src='${browser.runtime.getURL('adblock-ads-blocked-icon.svg')}' ></img>
            <div class="textContent">${blockAllButtonText}</div>
          </div>
        </div>
      </div>
      ${footerString}
    </div>
    <div id="processingContent">
      <div class="center">
        <i
          id="loading_progress"
          class="spin-counter-clockwise material-icons md-128 accent-text"
          role="img"
          >loop</i
        >
      </div>
      <div class="center">${oneMomentText}</div>
    </div>
    <div id="allowAllDoneContent" >
        <img class="largeIconLogo" src='${browser.runtime.getURL('adblock-ads-allowed-icon.svg')}' ></img>
        <div>${allowedCompleteText}</div>
    </div>
    <div id="blockAllDoneContent" >
        <img class="largeIconLogo" src='${browser.runtime.getURL('adblock-ads-blocked-icon.svg')}' ></img>
        <div>${blockedCompleteText}</div>
    </div>`;

  const signInMessageContent = `
    <div id="signInMessageContent">
      <div>${signInMessageText}</div>
    </div>
    ${footerString}`;

  const noChannelsFoundMessageContent = `
    <div id="noChannelsFoundMessageContent">
      <div>${noChannelsFoundMessageText}</div>
    </div>
    ${footerString}`;

  const overlayPrefix = `
    <div class="hoverOverIcon">
      <div class="grow speech-bubble">
        <div id="header-icons">
          <span>
            <i
              tabindex="10"
              class="material-icons md-20"
              id="settingsIcon"
              role="img"
              aria-label="settings"
              >settings</i
            >
            <i
              tabindex="10"
              class="material-icons md-20"
              id="closeIcon"
              role="img"
              aria-label="close"
              >close</i
            >
          </span>
        </div>
        <div id="speech-bubble-content">`;

  const overlaySuffix = `
      </div>
    </div>
    <div id="overlayIcon">
        <object id="iconlogo" type="image/svg+xml" style="height: 32px; width: 32px;" data='${browser.runtime.getURL('adblock-ads-blocked-icon.svg')}'></object>
    </div>
  </div>`;

  let overlayChildString = '';
  if (document.querySelectorAll('#guide-renderer').length === 0) {
    overlayChildString = overlayPrefix + signInMessageContent + overlaySuffix;
  } else if (document.querySelectorAll('#info-section').length === 0) {
    overlayChildString = overlayPrefix + noChannelsFoundMessageContent + overlaySuffix;
  } else {
    overlayChildString = overlayPrefix + normalContentString + overlaySuffix;
  }
  const overlayElement = DOMPurify.sanitize(overlayChildString, {
    ALLOW_UNKNOWN_PROTOCOLS: true, RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['target', 'data'], ADD_TAGS: ['object'],
  });
  if (DOMPurify.removed && DOMPurify.removed.length > 0) {
    return null;
  }
  return overlayElement;
};


// create the 'on page icon' DIV, including the children and insert them into the DOM
const addOnPageIcon = function () {
  if (document.getElementById('_ABoverlay')) {
    return;
  }

  const mainBody = document.body;
  if (mainBody) {
    const overlayElement = document.createElement('div');
    overlayElement.id = '_ABoverlay';
    overlayElement.style.cssText = 'display: none; padding: 0; margin: 0; position: fixed;  z-index: 2147483647 !important;';
    const overlayChildElement = buildOverlay();
    if (!overlayChildElement) {
      return;
    }

    const normalContent = overlayChildElement.querySelector('#normalContent');
    const signInMessageContent = overlayChildElement.querySelector('#signInMessageContent');
    const noChannelsFoundMessageContent = overlayChildElement.querySelector('#noChannelsFoundMessageContent');
    const processingContent = overlayChildElement.querySelector('#processingContent');
    const allowAllDone = overlayChildElement.querySelector('#allowAllDoneContent');
    const blockAllDone = overlayChildElement.querySelector('#blockAllDoneContent');
    const hoverOverIconElem = overlayChildElement.querySelector('.hoverOverIcon');
    const growElem = overlayChildElement.querySelector('.grow');

    hoverOverIconElem.addEventListener('mouseenter', () => {
      if (allowAllDone && blockAllDone && processingContent && normalContent) {
        allowAllDone.style.display = 'none';
        blockAllDone.style.display = 'none';
        processingContent.style.display = 'none';
        normalContent.style.display = 'block';
      } else if (noChannelsFoundMessageContent) {
        noChannelsFoundMessageContent.style.display = 'flex';
      } else if (signInMessageContent) {
        signInMessageContent.style.display = 'flex';
      }

      // remove the annimation classes
      growElem.classList.remove('run-show-animation');
      growElem.classList.remove('run-hide-animation');

      // -> triggering a reflow so the annimation runs again for multiple mouse overs
      // eslint-disable-next-line no-void
      void growElem.offsetWidth;

      // re-add the annimation class
      growElem.classList.add('run-show-animation');
    });

    hoverOverIconElem.addEventListener('mouseleave', () => {
      growElem.classList.remove('run-show-animation');
      growElem.classList.remove('run-hide-animation');
    });

    const settingsIcon = overlayChildElement.querySelector('#settingsIcon');
    settingsIcon.onclick = function settingsClicked() {
      browser.runtime.sendMessage({ command: 'openTab', urlToOpen: browser.runtime.getURL('options.html#general') });
    };

    const closeIcon = overlayChildElement.querySelector('#closeIcon');
    closeIcon.onclick = function closedClicked() {
      overlayElement.parentElement.removeChild(overlayElement);
    };

    const postClickCleanup = function () {
      setTimeout(() => {
        // -> triggering a reflow so the annimation end fires for the second annimation sequence
        // eslint-disable-next-line no-void
        void growElem.offsetWidth;
        growElem.classList.add('run-hide-animation');
      }, 3000);
    };

    const btnAllowAll = overlayChildElement.querySelector('#btnAllowAll');
    if (btnAllowAll) {
      btnAllowAll.onclick = function closedClicked(event) {
        event.stopPropagation();
        normalContent.style.display = 'none';
        processingContent.style.display = 'flex';
        const channelNameObs = getAllSubscribedChannelNames();
        browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'whitelist_all_youtube_clicked' });
        browser.runtime.sendMessage({ command: 'allowAllSubscribedChannel', channelNames: channelNameObs }).then(() => {
          // eslint-disable-next-line no-use-before-define
          addInPageIcons();
          processingContent.style.display = 'none';
          allowAllDone.style.display = 'flex';
          postClickCleanup();
        });
      };
    }

    const btnBlockAll = overlayChildElement.querySelector('#btnBlockAll');
    if (btnBlockAll) {
      btnBlockAll.onclick = function closedClicked(event) {
        event.stopPropagation();
        normalContent.style.display = 'none';
        processingContent.style.display = 'flex';
        const channelNameObs = getAllSubscribedChannelNames();
        browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'remove_all_youtube_clicked' });
        browser.runtime.sendMessage({ command: 'blockAllSubscribedChannel', channelNames: channelNameObs }).then(() => {
          // eslint-disable-next-line no-use-before-define
          addInPageIcons();
          processingContent.style.display = 'none';
          blockAllDone.style.display = 'flex';
          postClickCleanup();
        });
      };
    }

    const baseShadow = overlayElement.attachShadow({ mode: 'closed' });
    loadIconResources(baseShadow, () => {
      if (document.getElementById('_ABoverlay')) {
        return;
      }
      baseShadow.appendChild(overlayChildElement);
      (document.body || document.documentElement).appendChild(overlayElement);
      overlayElement.style.display = 'block';
    });
  }
};

const configureChildElements = function (parentNodeArg, adsAllowedArg) {
  const parentNode = parentNodeArg;
  let adsAllowed = adsAllowedArg;
  if (adsAllowed === 'false') {
    adsAllowed = false;
  }

  const iconElem = parentNode.querySelector('#iconlogo');
  const lineOneElem = parentNode.querySelector('#lineOne');
  const lineTwoElem = parentNode.querySelector('#lineTwo');
  const lineOneTextElem = parentNode.querySelector('#lineOneText');
  const lineTwoTextElem = parentNode.querySelector('#lineTwoText');

  const lineOneClickHandler = function (event) {
    event.stopPropagation();
    this.parentElement.parentElement.style.display = 'none';
    this.getRootNode().host.classList.remove('openedABPanel');
    browser.runtime.sendMessage({ command: 'removeAllowlistFilterForYoutubeChannel', text: parentNode.dataset.filterText }).then(() => {
      browser.runtime.sendMessage({ command: 'getAllAdsAllowedUserFilters' }).then((response) => {
        const ytRules = response.adsAllowedUserFilters;
        const { parsedChannelName } = parentNode.dataset;
        parentNode.dataset.filterText = isAdsAllowed(ytRules, parsedChannelName);
        configureChildElements(parentNode, parentNode.dataset.filterText);
        browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'remove_whitelist_youtube_clicked' });
      });
    });
  };
  const lineTwoClickHandler = function (event) {
    event.stopPropagation();
    this.parentElement.parentElement.style.display = 'none';
    this.getRootNode().host.classList.remove('openedABPanel');
    browser.runtime.sendMessage({ command: 'createAllowlistFilterForYoutubeChannelName', channelName: parentNode.dataset.parsedChannelName }).then(() => {
      browser.runtime.sendMessage({ command: 'getAllAdsAllowedUserFilters' }).then((response) => {
        const ytRules = response.adsAllowedUserFilters;
        const { parsedChannelName } = parentNode.dataset;
        parentNode.dataset.filterText = isAdsAllowed(ytRules, parsedChannelName);
        configureChildElements(parentNode, parentNode.dataset.filterText);
        browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'whitelist_youtube_clicked' });
      });
    });
  };

  if (adsAllowed) {
    lineOneElem.onclick = lineOneClickHandler;
    iconElem.src = browser.runtime.getURL('adblock-ads-allowed-icon.svg');
    lineOneElem.style.backgroundColor = '#FFFFFF';
    lineOneElem.style.cursor = 'pointer';
    lineTwoElem.style.backgroundColor = '#E6E6E6';
    lineTwoElem.style.cursor = 'default';
    lineOneTextElem.textContent = translate('enable_adblock_on_this_channel');
    lineTwoTextElem.textContent = translate('youtube_onpage_icon_allowing_ads_on_channel');
  } else {
    lineTwoElem.onclick = lineTwoClickHandler;
    iconElem.src = browser.runtime.getURL('adblock-ads-blocked-icon.svg');
    lineOneElem.style.backgroundColor = '#E6E6E6';
    lineOneElem.style.cursor = 'default';
    lineTwoElem.style.backgroundColor = '#FFFFFF';
    lineTwoElem.style.cursor = 'pointer';
    lineOneTextElem.textContent = translate('youtube_onpage_icon_blocking_ads_on_channel');
    lineTwoTextElem.textContent = translate('allowlist_channel');
  }
};

let openedPanels = [];
// close any opened in page icon panels when the user clicks on other element on the page
const bodyClickHandler = function (event) {
  const openedABPanel = document.body.querySelector('.openedABPanel');
  if (
    openedABPanel
      && openedABPanel !== event.target
      && !openedABPanel.contains(event.target)
      && openedPanels.length
  ) {
    openedPanels.forEach((parent) => {
      const panel = parent.querySelector('#messagePanel');
      if (panel) {
        panel.style.display = 'none';
      }
    });
    openedPanels = [];
    openedABPanel.classList.remove('openedABPanel');
  }
};

const inpageIconClickHandler = function (event) {
  event.stopPropagation();
  const panel = this.querySelector('#messagePanel');
  const parent = this.getRootNode().host;
  const panelStyle = panel.style;
  if (parent.className.includes('openedABPanel')) {
    panelStyle.display = 'none';
    parent.classList.remove('openedABPanel');
    return;
  }
  parent.classList.add('openedABPanel');
  const currentPosition = this.getBoundingClientRect();
  const bodyRect = document.body.getBoundingClientRect();
  panelStyle.left = `${(currentPosition.left - bodyRect.left) - 237}px`;
  panelStyle.top = `${(currentPosition.top - bodyRect.top) - 5}px`;
  panelStyle.display = 'block';
  document.body.removeEventListener('click', bodyClickHandler);
  document.body.addEventListener('click', bodyClickHandler);
  openedPanels.push(this);
};

let addInProgress = false;

const addInPageIcons = function (initialAdd) {
  if (addInProgress) {
    return;
  }
  addInProgress = true;
  browser.runtime.sendMessage({ command: 'getAllAdsAllowedUserFilters' }).then((userFilters) => {
    const youTubeFilters = userFilters.adsAllowedUserFilters;
    const channelNameObs = getAllSubscribedChannelNames();
    let subdChannels = 0;
    let subdChannelsAllowlisted = 0;
    const channelsAllowlisted = (youTubeFilters && youTubeFilters.length) || 0;
    for (const [channelName] of Object.entries(channelNameObs)) {
      subdChannels += 1;
      const name = channelNameObs[channelName].parsedChannelName;
      channelNameObs[channelName].isAdsAllowed = isAdsAllowed(youTubeFilters, name);
      if (channelNameObs[channelName].isAdsAllowed) {
        subdChannelsAllowlisted += 1;
      }
    }
    // send a message with:
    // count of subscribed YT channels
    // count of subscribed YT channels on AllowList
    // count of YT channels (including channels not subscribed to) on AllowList
    if (initialAdd) {
      const additionalParams = { subdChannels, subdChannelsAllowlisted, channelsAllowlisted };
      const message = { command: 'recordGeneralMessage', msg: 'youtube_count_data', additionalParams };
      browser.runtime.sendMessage(message);
    }
    if (initialAdd) {
      for (const [channelName] of Object.entries(channelNameObs)) {
        const onPageClickIconParentElem = document.createElement('div');
        onPageClickIconParentElem.id = '_ABInPageIcon';
        onPageClickIconParentElem.style.display = 'flex';
        onPageClickIconParentElem.style.justifyContent = 'center';

        // an 'open' shadow DOM is utilized so that we can later use DOM queries (querySelector)
        // to easily find all of the in page icons
        const onPageBaseShadow = onPageClickIconParentElem.attachShadow({ mode: 'open' });

        const onPageClickIconStyleElement = document.createElement('style');
        onPageClickIconStyleElement.classList.add('adblock-ui-stylesheet');
        onPageClickIconStyleElement.textContent = onPageClickIconStyleTextContent;
        onPageBaseShadow.appendChild(onPageClickIconStyleElement);

        const theNode = onPageClickIconElem.firstElementChild.cloneNode(true);
        onPageBaseShadow.appendChild(theNode);
        theNode.dataset.filterText = channelNameObs[channelName].isAdsAllowed;
        theNode.dataset.parsedChannelName = channelNameObs[channelName].parsedChannelName;
        theNode.dataset.channelName = channelName;

        configureChildElements(theNode, channelNameObs[channelName].isAdsAllowed);

        const notifcationElem = channelNameObs[channelName].node.querySelector('#notification-preference-button');
        if (notifcationElem) {
          theNode.addEventListener('click', inpageIconClickHandler);
          notifcationElem.parentElement.appendChild(onPageClickIconParentElem);
        }
      }
    } else {
      const onPageNodes = document.body.querySelectorAll('#_ABInPageIcon');
      for (let inx = 0; inx < onPageNodes.length; inx++) {
        const theParentNode = onPageNodes[inx];
        const theNode = theParentNode.shadowRoot.querySelector('#onPageIcon');
        const { channelName } = theNode.dataset;
        theNode.dataset.filterText = channelNameObs[channelName].isAdsAllowed;
        if (theNode && channelName && channelNameObs[channelName]) {
          configureChildElements(theNode, channelNameObs[channelName].isAdsAllowed);
        }
      }
    }
    addInProgress = false;
  });
}; // end of addInPageIcons

const removeInPageIcons = function () {
  const onPageNodes = document.body.querySelectorAll('#_ABInPageIcon');
  for (let inx = 0; inx < onPageNodes.length; inx++) {
    const theNode = onPageNodes[inx];
    theNode.parentElement.removeChild(theNode);
  }
};

const removeOnPageIcon = function () {
  const onPageNodes = document.body.querySelectorAll('#_ABoverlay');
  for (let inx = 0; inx < onPageNodes.length; inx++) {
    const theNode = onPageNodes[inx];
    theNode.parentElement.removeChild(theNode);
  }
};

const navigateFinished = function () {
  window.removeEventListener('yt-navigate-finish', navigateFinished);
  addInPageIcons(true);
};

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.command === 'addYouTubeOnPageIcons') {
    removeInPageIcons();
    removeOnPageIcon();
    // if the user navigated to '/feed/channels' organically on the YT site,
    // then we need to wait until the data has finished loading.
    if (request.historyUpdated) {
      window.addEventListener('yt-navigate-finish', navigateFinished);
      addOnPageIcon();
    } else {
      addOnPageIcon();
      addInPageIcons(true);
    }
    sendResponse({});
  }
  if (request.command === 'ping_yt_manage_cs') {
    sendResponse({ status: 'yes' });
  }
});

document.addEventListener('yt-page-data-updated', () => {
  if (window.location.pathname !== '/feed/channels') {
    removeInPageIcons();
    removeOnPageIcon();
  }
});

const toContentScriptRandomEventName = `ab-yt-event-${Math.random().toString(36).substr(2)}`;
document.addEventListener(toContentScriptRandomEventName, (event) => {
  if (event && event.detail && event.detail.actionName === 'yt-append-continuation-items-action') {
    removeInPageIcons();
    addInPageIcons(true);
  }
});

const captureYTEvents = function (toContentScriptEventName) {
  document.addEventListener('yt-action', (event) => {
    if (event.detail && event.detail.actionName === 'yt-append-continuation-items-action') {
      document.dispatchEvent(new CustomEvent(toContentScriptEventName,
        { detail: { actionName: 'yt-append-continuation-items-action' } }));
    }
  });
};

const injectWrappers = function () {
  const elemDOMPurify = document.createElement('script');
  elemDOMPurify.src = browser.runtime.getURL('purify.min.js');
  const scriptToInject = `(${captureYTEvents.toString()})('${toContentScriptRandomEventName}');`;
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
injectWrappers();
