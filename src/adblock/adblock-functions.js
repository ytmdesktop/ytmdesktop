'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, log, License, runBandaids, openTab */

// Set to true to get noisier console.log statements
const VERBOSE_DEBUG = false;
let loggingEnable = false;
const THIRTY_MINUTES_IN_MILLISECONDS = 1800000;

// Enabled in adblock_start_common.js and background.js if the user wants
const logging = function (enabled) {
  if (enabled) {
    loggingEnable = true;
    window.log = function log(...args) {
      if (VERBOSE_DEBUG || args[0] !== '[DEBUG]') { // comment out for verbosity
        // eslint-disable-next-line no-console
        console.log(...args);
      }
    };
  } else {
    window.log = function log() {
    };

    loggingEnable = false;
  }
};

logging(false); // disabled by default

// Behaves very similarly to $.ready() but does not require jQuery.
const onReady = function (callback) {
  if (document.readyState === 'complete') {
    window.setTimeout(callback, 0);
  } else {
    window.addEventListener('load', callback, false);
  }
};

// Excecute any bandaid for the specific site, if the bandaids.js was loaded.
onReady(() => {
  if (typeof runBandaids === 'function') {
    runBandaids();
  }
});

// Inputs:
//   - messageName : Str
//   - substitutions : Array of Str or a String
const translate = function (messageName, substitutions) {
  if (!messageName || typeof messageName !== 'string') {
    // eslint-disable-next-line no-console
    console.trace('missing messageName');
    return '';
  }

  let parts = substitutions;
  if (Array.isArray(parts)) {
    for (let i = 0; i < parts.length; i++) {
      if (typeof parts[i] !== 'string') {
        parts[i] = parts[i].toString();
      }
    }
  } else if (parts && typeof parts !== 'string') {
    parts = parts.toString();
  }

  // if VERBOSE_DEBUG is set to true, duplicate (double the length) of the translated strings
  // used for testing purposes only
  if (VERBOSE_DEBUG) {
    return `${browser.i18n.getMessage(messageName, parts)}
            ${browser.i18n.getMessage(messageName, parts)}`;
  }
  return browser.i18n.getMessage(messageName, parts);
};

const splitMessageWithReplacementText = function (rawMessageText, messageID) {
  const anchorStartPos = rawMessageText.indexOf('[[');
  const anchorEndPos = rawMessageText.indexOf(']]');

  if (anchorStartPos === -1 || anchorEndPos === -1) {
    log('replacement tag not found', messageID, rawMessageText, anchorStartPos, anchorEndPos);
    return { error: 'no brackets found' };
  }
  const returnObj = {};
  returnObj.anchorPrefixText = rawMessageText.substring(0, anchorStartPos);
  returnObj.anchorText = rawMessageText.substring(anchorStartPos + 2, anchorEndPos);
  returnObj.anchorPostfixText = rawMessageText.substring(anchorEndPos + 2);
  return returnObj;
};

const processReplacementChildren = function ($el, replacementText, messageId) {
  // Replace a dummy <a/> inside of localized text with a real element.
  // Give the real element the same text as the dummy link.
  const $element = $el;
  const messageID = $element.attr('i18n') || messageId;
  if (!messageID || typeof messageID !== 'string') {
    $(this).addClass('i18n-replaced');
    return;
  }
  if (!$element.get(0).firstChild) {
    log('returning, no first child found', $element.attr('i18n'));
    return;
  }
  if (!$element.get(0).lastChild) {
    log('returning, no last child found', $element.attr('i18n'));
    return;
  }
  const replaceElId = `#${$element.attr('i18n_replacement_el')}`;
  if ($(replaceElId).length === 0) {
    log('returning, no child element found', $element.attr('i18n'), replaceElId);
    return;
  }
  const rawMessageText = browser.i18n.getMessage(messageID) || '';
  const messageSplit = splitMessageWithReplacementText(rawMessageText, messageID);
  $element.get(0).firstChild.nodeValue = messageSplit.anchorPrefixText;
  $element.get(0).lastChild.nodeValue = messageSplit.anchorPostfixText;
  if ($(replaceElId).get(0).tagName === 'INPUT') {
    $(`#${$element.attr('i18n_replacement_el')}`).prop('value', replacementText || messageSplit.anchorText);
  } else {
    $(`#${$element.attr('i18n_replacement_el')}`).text(replacementText || messageSplit.anchorText);
  }

  // If localizePage is run again, don't let the [i18n] code above
  // clobber our work
  $element.addClass('i18n-replaced');
};

// Processes any replacement children in the passed-in element. Unlike the
// above processReplacementChildren, this function expects the text to already
// be inside the element (as textContent).
const processReplacementChildrenInContent = function ($el) {
  // Replace a dummy <a/> inside of localized text with a real element.
  // Give the real element the same text as the dummy link.
  const $element = $el;
  const message = $element.get(0).textContent;
  if (!message || typeof message !== 'string' || !$element.get(0).firstChild || !$element.get(0).lastChild) {
    return;
  }
  const replaceElId = `#${$element.attr('i18n_replacement_el')}`;
  const replaceEl = $element.find(replaceElId);
  if (replaceEl.length === 0) {
    log('returning, no child element found', replaceElId);
    return;
  }
  const messageSplit = splitMessageWithReplacementText(message);
  $element.get(0).firstChild.nodeValue = messageSplit.anchorPrefixText;
  $element.get(0).lastChild.nodeValue = messageSplit.anchorPostfixText;
  if (replaceEl.get(0).tagName === 'INPUT') {
    replaceEl.prop('value', messageSplit.anchorText);
  } else {
    replaceEl.text(messageSplit.anchorText);
  }
};

// Determine what language the user's browser is set to use
const determineUserLanguage = function () {
  return browser.i18n.getUILanguage();
};

// Set dir and lang attributes to the given el or to document.documentElement by default
const setLangAndDirAttributes = function (el) {
  const element = el instanceof HTMLElement ? el : document.documentElement;
  browser.runtime.sendMessage({
    type: 'app.get',
    what: 'localeInfo',
  }).then((localeInfo) => {
    element.lang = localeInfo.locale;
    // Note: the 'dir' attribute is only set to RTL on 'our' pages with the
    // (AdBlock Menu, Options) to prevent AdBlock for incorrectly setting it on webpages where
    // this file is injected.
    if (
      localeInfo
      && localeInfo.bidiDir === 'rtl'
      && (window.location.protocol.startsWith('moz-extension:')
      || window.location.protocol.startsWith('chrome-extension:'))) {
      let lang = determineUserLanguage();
      // For RTL languages, only update the directionality of the page if
      // an appropriate locale message file is bundled with the extension
      // Note: this code is assuming that we would only have generic message files
      // for any RTL languages (just 'ar'), and not any country
      // specific RTL locale files like 'en-US'
      lang = lang.substring(0, 2);
      fetch(`_locales/${lang}/messages.json`).then(() => {
        element.dir = localeInfo.bidiDir;
      }).catch(() => {
        element.dir = 'ltr';
      });
    } else {
      element.dir = localeInfo.bidiDir;
    }
  });
};

const isLangRTL = function (language) {
  const lang = language || determineUserLanguage();
  return (lang.startsWith('ar') || lang.startsWith('he') || lang.startsWith('fa'));
};

const localizePage = function () {
  // translate a page into the users language
  $('[i18n]:not(.i18n-replaced, [i18n_replacement_el])').each(function i18n() {
    $(this).text(translate($(this).attr('i18n')));
  });

  $('[i18n_value]:not(.i18n-replaced)').each(function i18nValue() {
    $(this).val(translate($(this).attr('i18n_value')));
  });

  $('[i18n_title]:not(.i18n-replaced)').each(function i18nTitle() {
    $(this).attr('title', translate($(this).attr('i18n_title')));
  });

  $('[i18n_placeholder]:not(.i18n-replaced)').each(function i18nPlaceholder() {
    $(this).attr('placeholder', translate($(this).attr('i18n_placeholder')));
  });

  $('[i18n_replacement_el]:not(.i18n-replaced)').each(function i18nReplacementEl() {
    processReplacementChildren($(this));
  });

  $('[i18n-alt]').each(function i18nImgAlt() {
    $(this).attr('alt', translate($(this).attr('i18n-alt')));
  });

  $('[i18n-aria-label]').each(function i18nAriaLabel() {
    $(this).attr('aria-label', translate($(this).attr('i18n-aria-label')));
  });
}; // end of localizePage

// Parse a URL. Based upon http://blog.stevenlevithan.com/archives/parseuri
// parseUri 1.2.2, (c) Steven Levithan <stevenlevithan.com>, MIT License
// Inputs: url: the URL you want to parse
// Outputs: object containing all parts of |url| as attributes
const parseUriRegEx = /^(([^:]+(?::|$))(?:(?:\w+:)?\/\/)?(?:[^:@/]*(?::[^:@/]*)?@)?(([^:/?#]*)(?::(\d*))?))((?:[^?#/]*\/)*[^?#]*)(\?[^#]*)?(#.*)?/;
const parseUri = function (url) {
  const matches = parseUriRegEx.exec(url);

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

// Inputs: key:string.
// Returns value if key exists, else undefined.
const sessionStorageGet = function (key) {
  const json = sessionStorage.getItem(key);
  if (json == null) {
    return undefined;
  }
  try {
    return JSON.parse(json);
  } catch (e) {
    log(`Couldn't parse json for ${key}`);
    return undefined;
  }
};

// Inputs: key:string.
// Returns value if key exists, else undefined.
const sessionStorageSet = function (key, value) {
  if (value === undefined) {
    sessionStorage.removeItem(key);
    return;
  }
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (ex) {
    if (ex.name === 'QUOTA_EXCEEDED_ERR') {
      // eslint-disable-next-line no-alert
      alert(translate('storage_quota_exceeded'));
      openTab('options/index.html#ui-tabs-2');
    }
  }
};

// Inputs: key:string.
// Returns object from localStorage.
// The following two functions should only be used when
// multiple 'sets' & 'gets' may occur in immediately preceding each other
// browser.storage.local.get & set instead
const storageGet = function (key) {
  const store = localStorage;
  const json = store.getItem(key);
  if (json == null) {
    return undefined;
  }
  try {
    return JSON.parse(json);
  } catch (e) {
    log(`Couldn't parse json for ${key}`, e);
    return undefined;
  }
};

// Inputs: key:string, value:object.
// If value === undefined, removes key from storage.
// Returns undefined.
const storageSet = function (key, value) {
  const store = localStorage;
  if (value === undefined) {
    store.removeItem(key);
    return;
  }
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (ex) {
    // eslint-disable-next-line no-console
    console.log(ex);
  }
};

const chromeStorageSetHelper = function (key, value, callback) {
  const items = {};
  items[key] = value;
  browser.storage.local.set(items).then(() => {
    if (typeof callback === 'function') {
      callback();
    }
  }).catch((error) => {
    if (typeof callback === 'function') {
      callback(error);
    }
  });
};

const chromeStorageGetHelper = function (storageKey) {
  return new Promise(((resolve, reject) => {
    browser.storage.local.get(storageKey).then((items) => {
      resolve(items[storageKey]);
    }).catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      reject(error);
    });
  }));
};

const chromeLocalStorageOnChangedHelper = function (storageKey, callback) {
  browser.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') {
      return;
    }
    for (const key in changes) {
      if (key !== storageKey) {
        return;
      }
      callback();
    }
  });
};

const reloadOptionsPageTabs = function () {
  const optionTabQuery = {
    url: `chrome-extension://${browser.runtime.id}/options.html*`,
  };
  browser.tabs.query(optionTabQuery).then((tabs) => {
    for (const i in tabs) {
      browser.tabs.reload(tabs[i].id);
    }
  });
};

const reloadAllOpenedTabs = function () {
  const optionTabQuery = {
    url: `chrome-extension://${browser.runtime.id}/*`,
  };
  browser.tabs.query(optionTabQuery).then((tabs) => {
    for (const i in tabs) {
      browser.tabs.reload(tabs[i].id);
    }
  });
};

// selected attaches a click and keydown event handler to the matching selector and calls
// the handler if a click or keydown event occurs (with a CR or space is pressed). We support
// both mouse and keyboard events to increase accessibility of the popup menu.
// Returns a reference to the keydown handler for future removal.
const selected = function (selector, handler) {
  const $matched = $(selector);
  $matched.on('click', handler);
  function keydownHandler(event) {
    if (event.which === 13 || event.which === 32) {
      handler(event);
    }
  }
  $matched.on('keydown', keydownHandler);
  return keydownHandler;
};

// selectedOff removes a click and keydown event handler from the matching selector.
const selectedOff = function (selector, clickHandler, keydownHandler) {
  const $matched = $(selector);
  $matched.off('click', clickHandler);
  $matched.off('keydown', keydownHandler);
};

// selectedOnce adds event listeners to the given element for mouse click or keydown CR or space
// events which runs the handler and immediately removes the event handlers so it cannot fire again.
const selectedOnce = function (element, handler) {
  if (!element) {
    return;
  }
  const clickHandler = function () {
    element.removeEventListener('click', clickHandler);
    handler();
  };
  element.addEventListener('click', clickHandler);

  const keydownHandler = function (event) {
    if (event.keyCode === 13 || event.keyCode === 32) {
      element.removeEventListener('keydown', keydownHandler);
      handler();
    }
  };
  element.addEventListener('keydown', keydownHandler);
};

// Join 2 or more sentences once translated.
// Inputs: arg:str -- Each arg is the string of a full sentence in message.json
const i18nJoin = function (...args) {
  let joined = '';
  for (let i = 0; i < args.length; i++) {
    const isLastSentence = i + 1 === args.length;
    if (!isLastSentence) {
      joined += `${translate(args[i])} `;
    } else {
      joined += `${translate(args[i])}`;
    }
  }
  return joined;
};

const isEmptyObject = obj => !!(Object.keys(obj).length === 0 && obj.constructor === Object);

// Sets expirable object in storage to be used in place of a cookie
// Inputs:
//   name: string,
//   value: object,
//   millisecondsUntilExpire: number of milliseconds until the "cookie" expires
const setStorageCookie = function (name, value, millisecondsUntilExpire) {
  const expirationTime = Date.now() + (millisecondsUntilExpire || 0);
  storageSet(name, { value, expires: expirationTime });
};

// Returns value of storage "cookie" or undefined if the it doesn't exist or
// has expired
// Inputs:
//  name: string
const getStorageCookie = function (name) {
  const storedCookie = storageGet(name);
  if (storedCookie && (storedCookie.expires > Date.now())) {
    return storedCookie.value;
  }

  return undefined;
};

// the Navigator object is used here because this code is
// executed in functions.js, which is loaded prior to any other
// background page JS modules (like 'info').
// Althought 'webp' is a preferred for Custom Image Swap
// because it is generally a smaller, more efficient image format,
// Firefox doesn't like working with 'webp' as much as 'png' in Blobs and Data URLs.
let customImageSwapMimeType = 'image/webp';
const firefoxMatch = navigator.userAgent.match(/(?:Firefox)\/([\d.]+)/);
if (firefoxMatch) {
  customImageSwapMimeType = 'image/png';
}

// converts a Base64 encoded string to
// a Blob.
// Used in the custom image swap processing
// Input:
//   base64Data: a string, base64 string encoded representing an image
// Returns:
//   a Blob
const base64toBlob = function (base64Data) {
  let updatedBase64Data = base64Data;
  if (updatedBase64Data.startsWith('data:image/')) {
    [, updatedBase64Data] = updatedBase64Data.split(',');
  }
  const sliceSize = 512;
  const byteChars = atob(updatedBase64Data);
  const byteArrays = [];
  const len = byteChars.length;
  for (let offset = 0; offset < len; offset += sliceSize) {
    const chunk = byteChars.slice(offset, offset + sliceSize);
    const chunkLength = chunk.length;
    const byteNumbers = new Array(chunkLength);
    for (let i = 0; i < chunkLength; i++) {
      byteNumbers[i] = chunk.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }
  return new Blob(byteArrays, { type: customImageSwapMimeType });
};

function debounced(delay, fn) {
  let timerId;
  return function debouncedAgain(...args) {
    if (timerId) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      fn(...args);
      timerId = null;
    }, delay);
  };
}

Object.assign(window, {
  sessionStorageSet,
  sessionStorageGet,
  storageGet,
  storageSet,
  parseUri,
  determineUserLanguage,
  chromeStorageSetHelper,
  logging,
  translate,
  chromeStorageGetHelper,
  reloadOptionsPageTabs,
  reloadAllOpenedTabs,
  chromeLocalStorageOnChangedHelper,
  selected,
  selectedOnce,
  i18nJoin,
  isEmptyObject,
  setStorageCookie,
  getStorageCookie,
  THIRTY_MINUTES_IN_MILLISECONDS,
  debounced,
});
