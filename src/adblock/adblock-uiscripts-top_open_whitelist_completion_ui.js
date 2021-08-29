'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, translate, bindEnterClickToDefault, mayOpenDialogUi:true, i18nJoin,
   processReplacementChildrenInContent, setLangAndDirAttributes, loadWizardResources */


// Global lock so we can't open more than once on a tab.
if (typeof window.mayOpenDialogUi === 'undefined') {
  window.mayOpenDialogUi = true;
}

// This script is injected each time the white list wizard is completed. Until we switch to ES6
// modules (aka import) we need to protect the code in a namespace so classes aren't declared
// multiple times.


// topOpenWhitelistUI displays the whitelist wizard completion page if it's not already open.
// See README for details.
function topOpenWhitelistCompletionUI(options) {
  if (!mayOpenDialogUi) {
    return;
  }

  mayOpenDialogUi = false;

  // Get Flash objects out of the way of our UI
  browser.runtime.sendMessage({ command: 'sendContentToBack' });

  // A empty base <div> is appended to the page's DOM and then a shadow is hosted in it.
  // The shadow protects our dialog from outside CSS "leaking" in.
  // Existing page styles are reset in the shadow at the top of `adblock-wizard.css`
  // using `:host` to select our base and the CCS rule `all:initial;` to perform the reset.
  const base = document.createElement('div');
  const $base = $(base.attachShadow({ mode: 'open' }));

  loadWizardResources($base, () => {
    // check if we're running on website with a frameset, if so, tell
    // the user we can't run on it.
    if ($('frameset').length >= 1) {
      // eslint-disable-next-line no-alert
      alert(translate('wizardcantrunonframesets'));
      mayOpenDialogUi = true;
      return;
    }

    const html = `
    <div id="wizard">
      <header >
        <img aria-hidden="true" src="${browser.runtime.getURL('/icons/icon24.png')}">
        <h1 >${translate('whitelistertitle2')}</h1>
      </header>
      <section>
        <div class='messageWithLink' i18n_replacement_el='settings-link'>
          ${i18nJoin('successfully_whitelisted', 'future_show_ads', 'change_behavior_settings')}
          <a id='settings-link' class='link' href='#'></a>
        </div>
      </section>
      <section >
        <div>${translate('adblock_wont_run_on_pages_matching')}</div>
        <div dir="ltr" id="adblock-rule"></div>
      </section>
      <section class='body-button'>
        <button class='cancel'>${translate('done')}</button>
      </section>
      <footer id='whitelist-cta' style='display:none;'>
        <div id='dismissed-msg' class='messageWithLink' i18n_replacement_el='premium-link' style='display:none;'>
          ${i18nJoin('wont_show_again', 'check_out_premium')}
          <a id='premium-link' class='link' href='#'></a>
        </div>
        <div id='premium-cta'>
          <div id='cta-msg'>${i18nJoin('whitelisted_a_site', 'never_lose_settings')}</div>
          <div id='cta-buttons'>
            <button class='learn-more'>${translate('learn_more_without_period')}</button>
            <button class='close material-icons'>close</button>
          </div>
        </div>
      </footer>
    </div>
    `;

    const $dialog = $(html);
    const $adblockRule = $dialog.find('#adblock-rule');
    const $doneBtn = $dialog.find('button.cancel');
    const $learnMoreBtn = $dialog.find('button.learn-more');
    const $closeBtn = $dialog.find('button.close');
    const $settingsLink = $dialog.find('#settings-link');
    const $premiumLink = $dialog.find('#premium-link');
    const $dismissedMsg = $dialog.find('#dismissed-msg');
    const $premiumCTA = $dialog.find('#premium-cta');

    $adblockRule.text(options.rule || '');

    $doneBtn.on('click', () => {
      mayOpenDialogUi = true;
      (document.body || document.documentElement).removeChild(base);
    });
    $learnMoreBtn.on('click', () => {
      browser.runtime.sendMessage({ command: 'openPremiumPayURL' });
      browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'whitelist_cta_clicked' });
    });
    $closeBtn.on('click', () => {
      browser.runtime.sendMessage({ command: 'setWhitelistCTAStatus', isEnabled: false });
      browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'whitelist_cta_closed' });
      $premiumCTA.hide();
      $dismissedMsg.show();
    });
    $settingsLink.on('click', () => {
      browser.runtime.sendMessage({ command: 'openTab', urlToOpen: 'options.html#customize' });
    });
    $premiumLink.on('click', () => {
      browser.runtime.sendMessage({ command: 'openTab', urlToOpen: 'options.html#mab' });
    });

    $dialog.find('.messageWithLink').each(function replaceLinks() {
      processReplacementChildrenInContent($(this));
    });

    setLangAndDirAttributes($dialog.get(0));
    bindEnterClickToDefault($dialog);

    // Check whether to show CTA
    if (!options.isActiveLicense && options.showWhitelistCTA) {
      $dialog.find('#whitelist-cta').show();
      browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'whitelist_cta_seen' });
    }

    // Show page
    $base.append($dialog);
  });
  (document.body || document.documentElement).appendChild(base);
}

// required return value for tabs.executeScript
/* eslint-disable-next-line no-unused-expressions */
'';

//# sourceURL=/uiscripts/top_open_whitelist_ui.js
