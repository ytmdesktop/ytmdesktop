'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, getSettings, translate, FilterListUtil, activateTab,
   CustomFilterListUploadUtil, localizePage, storageSet, chromeStorageSetHelper,
   chromeStorageGetHelper, debounced, determineUserLanguage, setStorageCookie
   THIRTY_MINUTES_IN_MILLISECONDS, setLangAndDirAttributes */

const BG = browser.extension.getBackgroundPage();
const { Filter } = BG;
const { WhitelistFilter } = BG;
const { Subscription } = BG;
const { SpecialSubscription } = BG;
const { DownloadableSubscription } = BG;
const { parseFilter } = BG;
const { filterStorage } = BG;
const { filterNotifier } = BG;
const { settingsNotifier } = BG;
const { channelsNotifier } = BG;
const { Prefs } = BG;
const { synchronizer } = BG;
const { isSelectorFilter } = BG;
const { isWhitelistFilter } = BG;
const { isSelectorExcludeFilter } = BG;
const { License } = BG;
const { SyncService } = BG;
const { isValidTheme } = BG;
const { abpPrefPropertyNames } = BG;
const { info } = BG;
const { rateUsCtaKey, vpnWaitlistCtaKey } = BG;
const FIVE_SECONDS = 5000;
const TWENTY_SECONDS = FIVE_SECONDS * 4;
const SIXTY_SECONDS = FIVE_SECONDS * 20;
let autoReloadingPage;
let timeoutID;

const language = determineUserLanguage();
let optionalSettings = {};
let delayedSubscriptionSelection = null;
const port = browser.runtime.connect({ name: 'ui' });
let syncErrorCode = 0;

// Function to check the last known Sync Error Code,
// only allows an event handler to run if there is
// no error to prevent data loss
function checkForSyncError(handler) {
  return function syncError(event) {
    if (syncErrorCode >= 400) {
      return;
    }
    handler(event);
  };
}

function displayVersionNumber() {
  const currentVersion = browser.runtime.getManifest().version;
  $('#version_number').text(translate('optionsversion', [currentVersion]));
}

function displayTranslationCredit() {
  if (language === 'en' || language.startsWith('en')) {
    return;
  }
  const translators = [];

  $.getJSON(browser.runtime.getURL('translators.json'), (response) => {
    let matchFound = false;
    const langSubstring = language.substring(0, 2);
    let langEnd = '';
    if (language.length >= 5) {
      langEnd = language.substring(3, 5).toLowerCase();
    }
    for (const id in response) {
      const idEqualToLang = id === language || id === language.toLowerCase();
      const idEqualToLangSubstring = id.substring(0, 2) === langSubstring
        || id.substring(0, 2) === langSubstring.toLowerCase();

      // if matching id hasn't been found and id matches lang
      if (
        !matchFound
        && (idEqualToLang || idEqualToLangSubstring)
        && (((id.length <= 3) || (id.length >= 5 && langEnd === id.substring(3, 5).toLowerCase())))
      ) {
        matchFound = true;

        // Check if this language is professionally translated
        const professionalLang = response[id].professional;
        for (const translator in response[id].translators) {
          // If the language is not professionally translated, or if this translator
          // is a professional, then add the name to the list of credits
          if (!professionalLang || response[id].translators[translator].professional) {
            const name = response[id].translators[translator].credit;
            translators.push(` ${name}`);
          }
        }
      }
    }

    const $translatorsCreditBubble = $('.translation_credits');
    if (translators.length > 0) {
      const $translatorCreditDiv = $('<div></div>');
      const $translatorNamesDiv = $('<div></div>');

      $translatorCreditDiv.addClass('speech-bubble-content').text(translate('translator_credit2'));
      $translatorNamesDiv.addClass('speech-bubble-content').text(translators.toString());
      $translatorsCreditBubble.empty()
        .addClass('speech-bubble')
        .removeClass('do-not-display')
        .append($translatorCreditDiv)
        .append($translatorNamesDiv);
    } else {
      $translatorsCreditBubble.addClass('do-not-display').empty();
    }
  });
}

function startSubscriptionSelection(title, url) {
  const list = document.getElementById('language_select');
  const noFilterListUtil = typeof FilterListUtil === 'undefined' || FilterListUtil === null;
  const customFilterUtilUndefined = typeof CustomFilterListUploadUtil === 'undefined';

  let noCustomFilterListUploadUtil;
  if (customFilterUtilUndefined) {
    noCustomFilterListUploadUtil = true;
  } else {
    noCustomFilterListUploadUtil = CustomFilterListUploadUtil === null;
  }

  if (!list || noFilterListUtil || noCustomFilterListUploadUtil) {
    activateTab('#filters');
    delayedSubscriptionSelection = [title, url];
    return;
  }
  const translatedMsg = translate('subscribeconfirm', title);
  // eslint-disable-next-line no-alert
  if (window.confirm(translatedMsg)) {
    const existingFilterList = FilterListUtil.checkUrlForExistingFilterList(url);

    if (existingFilterList) {
      CustomFilterListUploadUtil.updateExistingFilterList(existingFilterList);
    } else if (/^https?:\/\/[^<]+$/.test(url)) {
      CustomFilterListUploadUtil.performUpload(url, `url:${url}`, title);
    } else {
      // eslint-disable-next-line no-alert
      alert(translate('failedtofetchfilter'));
    }
    // show the link icon for the new filter list, if the advance setting is set and the
    // show links button has been clicked (not visible)
    if (
      optionalSettings
      && optionalSettings.show_advanced_options
      && $('#btnShowLinks').is(':visible') === false
    ) {
      $('.filter-list-link').fadeIn('slow');
    }
  }
}

port.onMessage.addListener((message) => {
  if (message.type === 'app.respond' && message.action === 'addSubscription') {
    const subscription = message.args[0];
    startSubscriptionSelection(subscription.title, subscription.url);
  }
});

port.postMessage({
  type: 'app.listen',
  filter: ['addSubscription'],
});

window.addEventListener('unload', () => port.disconnect());

function setSelectedThemeColor() {
  let optionsTheme = 'default_theme';
  if (BG && BG.getSettings()) {
    const settings = BG.getSettings();
    optionsTheme = settings.color_themes.options_page;
  }
  $('body').attr('id', optionsTheme).data('theme', optionsTheme);
  $('#sidebar-adblock-logo').attr('src', `icons/${optionsTheme}/logo.svg`);
}

const requestSyncMessageRemoval = function (delayTime) {
  return new Promise((resolve) => {
    if (typeof delayTime !== 'number') {
      resolve();
    }
    timeoutID = setTimeout(() => {
      $('.sync-header-message-text').text('');
      $('.unsync-header').addClass('sync-message-hidden');
      $('.sync-header-message')
        .removeClass('sync-message-good sync-message-error')
        .addClass('sync-message-hidden');
      $('.sync-out-of-date-header-message').addClass('sync-message-hidden');
      resolve();
    }, delayTime);
  });
};

const showOutOfDateExtensionError = function () {
  $('.sync-out-of-date-header-message').removeClass('sync-message-hidden');
  requestSyncMessageRemoval(TWENTY_SECONDS);
};

const showNoLongerSyncError = function () {
  if (timeoutID) {
    window.clearTimeout(timeoutID);
  }
  requestSyncMessageRemoval(0).then(() => {
    $('.unsync-header').removeClass('sync-message-hidden');
    if ($('#sync').is(':visible')) {
      const maxHeight = Math.max($('#unsync-message-box-close-sync-tab').height(),
        $('#sync-reload-page-message').height());
      $('#unsync-message-box-close-sync-tab').height(maxHeight);
      $('#sync-reload-page-message').height(maxHeight);
    }

    SyncService.resetAllErrors();
  });
};

const addUnSyncErrorClickHandler = function () {
  $('span[i18n="sync_removed_error_msg_part_2"]').on('click', () => {
    $('.unsync-header').addClass('sync-message-hidden');
    activateTab('#sync');
  });
  $('#unsync-message-box-close i, #unsync-message-box-close-sync-tab i').on('click', () => {
    $('.unsync-header').addClass('sync-message-hidden');
  });
  $('#sync-reload-page-message').on('click', () => {
    window.location.reload();
  });
};

// this function is invoked from the tabs.js module
const checkForUnSyncError = function () {
  if (
    optionalSettings
    && !optionalSettings.sync_settings
    && (SyncService.getLastGetStatusCode() === 403
        || SyncService.getLastPostStatusCode() === 403)
  ) {
    showNoLongerSyncError();
    SyncService.resetAllErrors();
  }
};

const showSyncMessage = function (msgText, doneIndicator, errorIndicator) {
  if (!msgText) {
    return;
  }
  $('.unsync-header').addClass('sync-message-hidden');
  $('.sync-header-message-text').text(msgText);
  if (!doneIndicator && errorIndicator) {
    $('.sync-icon').text('error_outline');
    $('.sync-header-message')
      .removeClass('sync-message-hidden sync-message-good')
      .addClass('sync-message-error');
    requestSyncMessageRemoval(TWENTY_SECONDS);
  } else if (doneIndicator && !errorIndicator) {
    $('.sync-icon').text('check_circle');
    $('.sync-header-message')
      .removeClass('sync-message-hidden sync-message-error')
      .addClass('sync-message-good');
    requestSyncMessageRemoval(FIVE_SECONDS);
  } else {
    $('.sync-icon').text('sync');
    $('.sync-header-message')
      .removeClass('sync-message-hidden sync-message-error')
      .addClass('sync-message-good');
  }
};

const onExtensionNameError = function () {
  const messagePrefix = translate('sync_header_message_setup_fail_prefix');
  const messageSuffix = translate('sync_header_message_setup_fail_part_2');
  showSyncMessage(`${messagePrefix} ${messageSuffix}`, false, true);
};

const onPostDataSending = function () {
  showSyncMessage(translate('sync_header_message_in_progress'));
};

const onPostDataSent = function () {
  syncErrorCode = 0;
  showSyncMessage(translate('sync_header_message_sync_complete'), true);
};

const onPostDataSentError = function (errorCode, initialGet) {
  const setupFailMsgPrefix = translate('sync_header_message_setup_fail_prefix');
  const setupFailMsg2 = translate('sync_header_message_setup_fail_part_2');
  const $customizeSyncHeaderText = $('#customize .sync-header-message-text');
  const $customizeSyncHeaderIcon = $('#customize .sync-icon');
  $customizeSyncHeaderIcon.text('error_outline');

  if (errorCode === 403) {
    showNoLongerSyncError();
  } else if (errorCode === 409) {
    const errMsgPrefix = translate('sync_header_message_error_prefix');
    const oldCommitMsg2 = translate('sync_header_message_old_commit_version_part_2');
    const oldCommitMsg3 = translate('sync_header_message_old_commit_version_part_3');
    showSyncMessage(`${errMsgPrefix} ${oldCommitMsg2} ${oldCommitMsg3}`, false, true);

    if ($('#customize').is(':visible')) {
      const customize2 = translate('sync_header_message_old_commit_version_customize_tab_part_2');
      const customize3 = translate('sync_header_message_old_commit_version_customize_tab_part_3');
      $customizeSyncHeaderText.text(`${errMsgPrefix} ${customize2} ${customize3}`);
      syncErrorCode = errorCode;
    }
  } else if (initialGet && [0, 401, 404, 500].includes(errorCode)) {
    showSyncMessage(`${setupFailMsgPrefix} ${setupFailMsg2}`, false, true);
    if ($('#customize').is(':visible')) {
      $customizeSyncHeaderText.text(`${setupFailMsgPrefix} ${setupFailMsg2}`);
      syncErrorCode = errorCode;
    }
  } else if (!initialGet && [0, 401, 404, 500].includes(errorCode)) {
    const revertMsg2 = translate('sync_header_error_save_message_part_2');
    const revertMsg3 = translate('sync_header_error_save_message_part_3');
    showSyncMessage(`${setupFailMsgPrefix} ${revertMsg2} ${revertMsg3}`, false, true);
    $customizeSyncHeaderText.text(`${setupFailMsgPrefix} ${revertMsg2} ${revertMsg3}`);
    syncErrorCode = errorCode;
  }
};

const onSyncDataGetting = function () {
  showSyncMessage(translate('sync_header_message_in_progress'));
};

const onSyncDataReceieved = function () {
  showSyncMessage(translate('sync_header_message_sync_complete'), true);
};

const onSyncDataGettingError = function (errorCode, responseJSON) {
  // NOTE - currently, there are no error messages for  404, 500
  if (errorCode === 400 && responseJSON && responseJSON.code === 'invalid_sync_version') {
    showOutOfDateExtensionError();
    return;
  }
  if (errorCode === 403) {
    showNoLongerSyncError();
    return;
  }
  showSyncMessage(translate('sync_header_message_no_license'), false, true);
};

const onSyncDataInitialGettingError = function () {
  const syncSetupFailMsgPrefix = translate('sync_header_message_setup_fail_prefix');
  const syncSetupFailMsg2 = translate('sync_header_message_setup_fail_part_2');
  showSyncMessage(`${syncSetupFailMsgPrefix} ${syncSetupFailMsg2}`, false, true);
};

const removeSyncListeners = function () {
  SyncService.syncNotifier.off('post.data.sending', onPostDataSending);
  SyncService.syncNotifier.off('post.data.sent', onPostDataSent);
  SyncService.syncNotifier.off('post.data.sent.error', onPostDataSentError);
  SyncService.syncNotifier.off('sync.data.getting', onSyncDataGetting);
  SyncService.syncNotifier.off('sync.data.receieved', onSyncDataReceieved);
  SyncService.syncNotifier.off('sync.data.getting.error', onSyncDataGettingError);
  SyncService.syncNotifier.off('sync.data.getting.error.initial.fail', onSyncDataInitialGettingError);
  SyncService.syncNotifier.off('extension.name.updated.error', onExtensionNameError);
};

const addSyncListeners = function () {
  SyncService.syncNotifier.on('post.data.sending', onPostDataSending);
  SyncService.syncNotifier.on('post.data.sent', onPostDataSent);
  SyncService.syncNotifier.on('post.data.sent.error', onPostDataSentError);
  SyncService.syncNotifier.on('sync.data.getting', onSyncDataGetting);
  SyncService.syncNotifier.on('sync.data.receieved', onSyncDataReceieved);
  SyncService.syncNotifier.on('sync.data.getting.error', onSyncDataGettingError);
  SyncService.syncNotifier.on('sync.data.getting.error.initial.fail', onSyncDataInitialGettingError);
  SyncService.syncNotifier.on('extension.name.updated.error', onExtensionNameError);
};

function loadOptionalSettings() {
  if (BG && typeof BG.getSettings !== 'function') {
    // if the backgroudPage isn't available, wait 50 ms, and reload page
    window.setTimeout(() => {
      window.location.reload();
    }, 50);
  }
  if (BG && typeof BG.getSettings === 'function') {
    // Check or uncheck each option.
    optionalSettings = BG.getSettings();
  }
  if (optionalSettings && optionalSettings.sync_settings) {
    addSyncListeners();
    window.addEventListener('unload', () => {
      removeSyncListeners();
    });
  }
}

// Update Acceptable Ads UI in the General tab. To be called
// when there is a change in the AA and AA Privacy subscriptions
// Inputs: - checkAA: Bool, true if we must check AA
//         - checkAAprivacy: Bool, true if we must check AA privacy
const updateAcceptableAdsUIFN = function (checkAA, checkAAprivacy) {
  const $aaInput = $('input#acceptable_ads');
  const $aaPrivacyInput = $('input#acceptable_ads_privacy');
  const $aaPrivacyHelper = $('#aa-privacy-helper');
  const $aaYellowBanner = $('#acceptable_ads_info');

  if (!checkAA && !checkAAprivacy) {
    $aaInput.prop('checked', false);
    $aaPrivacyInput.prop('checked', false);
    $aaYellowBanner.slideDown();
    $aaPrivacyHelper.slideUp();
  } else if (checkAA && checkAAprivacy) {
    $aaInput.removeClass('feature').prop('checked', true).addClass('feature');
    $aaPrivacyInput.prop('checked', true);
    $aaYellowBanner.slideUp();
    if (navigator.doNotTrack === '1') {
      $aaPrivacyHelper.slideUp();
    } else {
      $aaPrivacyHelper.slideDown();
    }
  } else if (checkAA && !checkAAprivacy) {
    $aaInput.prop('checked', true);
    $aaPrivacyInput.prop('checked', false);
    $aaYellowBanner.slideUp();
    $aaPrivacyHelper.slideUp();
  }
};

const debounceWaitTime = 1000; // time in ms before
const updateAcceptableAdsUI = debounced(debounceWaitTime, updateAcceptableAdsUIFN);

const shouldShowRateUsCTA = function () {
  const mql = window.matchMedia('(max-width: 890px)');
  if (!mql.matches && (info.application === 'chrome' || info.application === 'edge')) {
    chromeStorageGetHelper(rateUsCtaKey).then((alreadyRatedUs) => {
      if (!alreadyRatedUs) {
        if (info.application === 'edge') {
          $('#rate-us').attr('href', 'https://microsoftedge.microsoft.com/addons/detail/adblock-%E2%80%94-best-ad-blocker/ndcileolkflehcjpmjnfbnaibdcgglog');
        }
        $('#rate-us-cta').show();
        $('#rate-us-cta a#rate-us').on('click', () => {
          chromeStorageSetHelper(rateUsCtaKey, true);
          $('#rate-us-cta').hide();
        });
      }
    });
  }
};

const shouldShowVPNWaitlistCTA = function () {
  const mql = window.matchMedia('(max-width: 890px)');
  if (!mql.matches) {
    chromeStorageGetHelper(vpnWaitlistCtaKey).then((alreadyClickedVPNWaitlist) => {
      if (!alreadyClickedVPNWaitlist) {
        $('#waitlist-cta').show();
        $('#waitlist-cta a#vpn-waitlist-link').on('click', () => {
          chromeStorageSetHelper(vpnWaitlistCtaKey, true);
          $('#waitlist-cta').hide();
          shouldShowRateUsCTA();
        });
      } else {
        shouldShowRateUsCTA();
      }
    });
  }
};


$(() => {
  // delay opening of a second port due to a race condition in the ABP code
  // the delay allows the confirmation message to the user to function correctly
  window.setTimeout(() => {
    const port2 = browser.runtime.connect({ name: 'ui' });
    port2.postMessage({
      type: 'app.listen',
      filter: ['addSubscription'],
    });
  }, 500);

  const onSettingsChanged = function (name, currentValue) {
    if (name === 'color_themes') {
      $('body').attr('id', currentValue.options_page).data('theme', currentValue.options_page);
      $('#sidebar-adblock-logo').attr('src', `icons/${currentValue.options_page}/logo.svg`);
    }
  };
  settingsNotifier.on('settings.changed', onSettingsChanged);
  window.addEventListener('unload', () => {
    settingsNotifier.off('settings.changed', onSettingsChanged);
  });

  setSelectedThemeColor();
  loadOptionalSettings();
  displayVersionNumber();
  localizePage();
  displayTranslationCredit();
  shouldShowVPNWaitlistCTA();
});

storageSet(License.pageReloadedOnSettingChangeKey, false);
window.onbeforeunload = function leavingOptionsPage() {
  if (autoReloadingPage) {
    storageSet(License.pageReloadedOnSettingChangeKey, true);
  }
  storageSet(License.userSawSyncCTAKey, true);
};

document.addEventListener('readystatechange', () => {
  if ((document.readyState === 'complete') && (typeof setLangAndDirAttributes === 'function')) {
    setLangAndDirAttributes();
  }
});
