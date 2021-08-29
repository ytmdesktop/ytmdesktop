'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser setLangAndDirAttributes, DOMPurify */

(function onScriptLoad() {
  const divID = '_ABoverlay';

  const removeIcon = function () {
    const el = document.getElementById(divID);
    if (el) {
      el.parentNode.removeChild(el);
    }
  };

  // Inputs:
  //   - base : the DIV element to attach the CSS as children
  //   - callback : function to call when loading is complete
  function loadIconResources(base, callback) {
    function loadCss(cssSrc) {
      const cssUrl = browser.runtime.getURL(cssSrc);
      const fontCssUrl = browser.runtime.getURL('fonts/font-face.css');
      const styleElement = document.createElement('style');
      styleElement.classList.add('adblock-ui-stylesheet');

      const cssPromise = fetch(cssUrl).then(response => response.text());
      const fontCSSPromise = fetch(fontCssUrl).then(response => response.text());
      Promise.all([cssPromise, fontCSSPromise]).then((detailsArray) => {
        styleElement.textContent = `${detailsArray[0]} \n ${detailsArray[1]}`;
      });
      base.appendChild(styleElement);
    }

    function loadFont(name, style, weight, unicodeRange) {
      return new FontFace('Lato', `url(${browser.runtime.getURL(`/fonts/${name}.woff`)}`, { style, weight, unicodeRange });
    }

    loadCss('adblock-onpage-icon.css');

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
      callback();
    }).catch(() => {
      callback();
    });
  }

  // create the icon DIV, including the children and insert them into the DOM
  const showOverlay = function (titleText, msgText, buttonText, buttonAction, surveyId) {
    // if either the DIV already exists, don't add another one, just return
    if (document.getElementById(divID)) {
      return;
    }
    const mainBody = document.body;
    if (mainBody) {
      const overlayElement = document.createElement('div');
      overlayElement.id = divID;
      const sanitizedTitleText = DOMPurify.sanitize(titleText);
      const sanitizedMsgText = DOMPurify.sanitize(msgText);
      const sanitizedButtonText = DOMPurify.sanitize(buttonText);
      const overlayChildElement = DOMPurify.sanitize(`
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
            <div id="speech-bubble-content">
              <div id="titleText">${sanitizedTitleText}</div>
              <div id="msgText">${sanitizedMsgText}</div>
              <div id="footer">
                <button
                  type="button"
                  id="btnLearnMore"
                >${sanitizedButtonText}</button>
              </div>
            </div>
          </div>
          <div id="overlayIcon">
              <object id="iconlogo" type="image/svg+xml" data='${browser.runtime.getURL('adblock-onpage-icon.svg')}'></object>
          </div>
        </div>
      `, {
        ALLOW_UNKNOWN_PROTOCOLS: true, RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['data'], ADD_TAGS: ['object'],
      });
      if (DOMPurify.removed && DOMPurify.removed.length > 0) {
        browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'onpagemessage_invalid_msg', additionalParams: { surveyId } });
        return;
      }

      const settingsIcon = overlayChildElement.querySelector('#settingsIcon');
      settingsIcon.onclick = function settingsClicked() {
        removeIcon();
        browser.runtime.sendMessage({ command: 'openTab', urlToOpen: browser.runtime.getURL('options.html#general') });
        browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'onpagemessage_settings_clicked', additionalParams: { surveyId } });
      };

      const closeIcon = overlayChildElement.querySelector('#closeIcon');
      closeIcon.onclick = function closedClicked() {
        removeIcon();
        browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'onpagemessage_closed_clicked', additionalParams: { surveyId } });
      };

      const leanMoreBtn = overlayChildElement.querySelector('#btnLearnMore');
      if (buttonText && buttonAction) {
        leanMoreBtn.onclick = function learnMoreClicked() {
          removeIcon();
          if (buttonAction && buttonAction.startsWith('/')) {
            browser.runtime.sendMessage({ command: 'openTab', urlToOpen: `https://getadblock.com${buttonAction}` });
          } else if (buttonAction && buttonAction.startsWith('#')) {
            browser.runtime.sendMessage({ command: 'openTab', urlToOpen: browser.runtime.getURL(`options.html${buttonAction}`) });
          }
          browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'onpagemessage_btn_clicked', additionalParams: { surveyId } });
        };
      } else {
        leanMoreBtn.style.display = 'none';
      }

      const adBlockIcon = overlayChildElement.querySelector('#overlayIcon');
      const mouseHandler = function () {
        adBlockIcon.removeEventListener('mouseenter', mouseHandler);
        browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'onpagemessage_expanded', additionalParams: { surveyId } });
        browser.runtime.sendMessage({ onpageiconevent: 'mouseenter' });
      };
      adBlockIcon.addEventListener('mouseenter', mouseHandler);

      const baseShadow = overlayElement.attachShadow({ mode: 'closed' });
      loadIconResources(baseShadow, () => {
        setLangAndDirAttributes(overlayChildElement);
        baseShadow.appendChild(overlayChildElement);
        (document.body || document.documentElement).appendChild(overlayElement);
        browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'onpagemessage_shown', additionalParams: { surveyId } });
      });
    }
  };

  browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === 'showonpageicon' && request.tabURL === document.location.href) {
      showOverlay(request.titleText, request.msgText,
        request.buttonText, request.buttonURL, request.surveyId);
      sendResponse({ ack: request.command });
    }
    if (request.command === 'removeIcon') {
      removeIcon();
      sendResponse({});
    }
  });
}());
