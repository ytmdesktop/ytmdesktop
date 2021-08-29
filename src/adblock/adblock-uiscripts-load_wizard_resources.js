'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser */

// Binds keypress enter to trigger click action on
// default button or trigger click action on focused
// button.
function bindEnterClickToDefault($dialog) {
  if (window.GLOBAL_BIND_ENTER_CLICK_TO_DEFAULT) {
    return;
  }
  window.GLOBAL_BIND_ENTER_CLICK_TO_DEFAULT = true;
  $('html').on('keypress', (e) => {
    if (e.keyCode === 13 && !$('button:focus').length) {
      e.preventDefault();
      $dialog.find('.adblock-default-button').filter(':visible').trigger('click');
    }
  });
}

// Inputs:
//   - $base : jQuery Element to attach the CSS as children
//   - callback : function to call when loading is complete
function loadWizardResources($base, callback) {
  function loadCss(cssSrc) {
    const cssUrl = browser.runtime.getURL(cssSrc);
    const fontCssUrl = browser.runtime.getURL('fonts/font-face.css');
    const $styleTag = $('<style />').addClass('adblock-ui-stylesheet');

    // HTML element <link> is ignored in shadow tree in Chrome 53
    // so we must load the CSS file in some other ways e.g. using <style>
    fetch(cssUrl).then(response => response.text()).then((wizardCssRules) => {
      $styleTag.text(`${$styleTag.text()}${wizardCssRules}`);
    });
    fetch(fontCssUrl).then(response => response.text()).then((fontFaceRules) => {
      $styleTag.text(`${$styleTag.text()}${fontFaceRules}`);
    });

    $base.append($styleTag);
  }

  function loadFont(name, style, weight, unicodeRange) {
    return new FontFace('Lato', `url(${browser.runtime.getURL(`/fonts/${name}.woff`)}`, { style, weight, unicodeRange });
  }

  loadCss('adblock-uiscripts-adblock-wizard.css');

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

// required return value for tabs.executeScript
/* eslint-disable-next-line no-unused-expressions */
'';

//# sourceURL=/uiscripts/load_wizard_resources.js
