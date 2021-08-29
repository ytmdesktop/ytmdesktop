'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global BG, parseUri, optionalSettings:true, abpPrefPropertyNames, settingsNotifier,
   DownloadableSubscription, Subscription, Prefs, synchronizer, filterStorage, filterNotifier,
   port, updateAcceptableAdsUI, activateTab, MABPayment, License, autoReloadingPage:true,
   updateAcceptableAdsUIFN */

// Handle incoming clicks from bandaids.js & '/installed'
try {
  if (parseUri.parseSearch(window.location.search).aadisabled === 'true') {
    $('#acceptable_ads_info').show();
  }
} catch (ex) {
  // do nothing
}

// Check or uncheck each loaded DOM option checkbox according to the
// user's saved settings.
const initialize = function init() {
  if (typeof BG.LocalCDN === 'object') {
    $('#local_cdn_option').css('display', 'flex');
  }
  const subs = BG.getSubscriptionsMinusText();

  // if the user is currently subscribed to AA
  // then 'check' the acceptable ads button.
  if ('acceptable_ads' in subs && subs.acceptable_ads.subscribed) {
    updateAcceptableAdsUIFN(true, false);
  }

  if ('acceptable_ads_privacy' in subs && subs.acceptable_ads_privacy.subscribed) {
    updateAcceptableAdsUIFN(true, true);
  }

  for (const name in optionalSettings) {
    $(`#enable_${name}`).prop('checked', optionalSettings[name]);
  }
  if (optionalSettings && !optionalSettings.show_advanced_options) {
    $('.advanced').hide();
  }
  if (optionalSettings && !optionalSettings.youtube_manage_subscribed) {
    $('#youtube_manage_subscribed_link').removeClass('link-text-color');
    $('#youtube_manage_subscribed_link').removeClass('pointer');
    $('#youtube_manage_subscribed_link').addClass('disabled-link-text-color');
  }


  for (const inx in abpPrefPropertyNames) {
    const name = abpPrefPropertyNames[inx];
    $(`#prefs__${name}`).prop('checked', BG.Prefs[name]);
  }

  const acceptableAdsPrivacyClicked = function (isEnabled) {
    const acceptableAds = Subscription.fromURL(Prefs.subscriptions_exceptionsurl);
    const acceptableAdsPrivacy = Subscription.fromURL(Prefs.subscriptions_exceptionsurl_privacy);

    if (isEnabled) {
      if (acceptableAdsPrivacy instanceof DownloadableSubscription) {
        synchronizer.execute(acceptableAdsPrivacy);
      }
      filterStorage.addSubscription(acceptableAdsPrivacy);
      filterStorage.removeSubscription(acceptableAds);
      updateAcceptableAdsUI(true, true);
    } else {
      filterStorage.addSubscription(acceptableAds);
      filterStorage.removeSubscription(acceptableAdsPrivacy);
      updateAcceptableAdsUI(true, false);
    }
  };

  const acceptableAdsClicked = function (isEnabled) {
    const subscription = Subscription.fromURL(Prefs.subscriptions_exceptionsurl);
    const acceptableAdsPrivacy = Subscription.fromURL(Prefs.subscriptions_exceptionsurl_privacy);

    if (isEnabled) {
      filterStorage.addSubscription(subscription);
      if (subscription instanceof DownloadableSubscription) {
        synchronizer.execute(subscription);
      }
      updateAcceptableAdsUI(true, false);
    } else {
      filterStorage.removeSubscription(subscription);
      filterStorage.removeSubscription(acceptableAdsPrivacy);
      updateAcceptableAdsUI(false, false);
    }
  };

  $('input.feature[type=\'checkbox\']').on('change', function onOptionSelectionChange() {
    const isEnabled = $(this).is(':checked');

    // This change of settings causes the Options page to be automatically reloaded
    // so the CTA display logic is handled on the Options page unload/load time
    if (this.id !== 'enable_show_advanced_options') {
      MABPayment.displaySyncCTAs(true);
    }

    if (this.id === 'acceptable_ads') {
      acceptableAdsClicked(isEnabled);
      return;
    }

    if (this.id === 'acceptable_ads_privacy') {
      acceptableAdsPrivacyClicked(isEnabled);
      return;
    }

    const name = this.id.substring(7); // TODO: hack
    // if the user enables/disables the context menu
    // update the pages
    if (name === 'shouldShowBlockElementMenu') {
      BG.updateButtonUIAndContextMenus();
    }
    if (abpPrefPropertyNames.indexOf(name) >= 0) {
      BG.Prefs[name] = isEnabled;
      return;
    }

    BG.setSetting(name, isEnabled, true);

    // if the user enables/disable data collection
    // start or end the data collection process
    if (name === 'data_collection_v2') {
      if (isEnabled) {
        BG.DataCollectionV2.start();
      } else {
        BG.DataCollectionV2.end();
      }
    }
    // if the user enables/disable Local CDN
    // start or end the Local CDN
    if (typeof BG.LocalCDN === 'object' && name === 'local_cdn') {
      if (isEnabled) {
        BG.LocalCDN.start();
      } else {
        BG.LocalCDN.end();
      }
    }
    // if the user enables/disable YouTube Channel allowlisting
    // add or remove history state listners
    if (name === 'youtube_channel_whitelist') {
      if (isEnabled) {
        BG.addYTChannelListeners();
      } else {
        window.setTimeout(() => {
          BG.setSetting('youtube_manage_subscribed', isEnabled, true);
          $('#youtube_manage_subscribed_link').removeClass('link-text-color');
          $('#youtube_manage_subscribed_link').removeClass('pointer');
          $('#youtube_manage_subscribed_link').addClass('disabled-link-text-color');
        }, 250);
        BG.removeYTChannelListeners();
      }
    }

    // if the user enables/disable the Manage AdBlock settings from YouTube™ subscriptions page
    // also, wait a moment to allow the current 'set' to save,
    // then enable YouTube Channel allowlisting
    if (name === 'youtube_manage_subscribed') {
      if (isEnabled && !optionalSettings.youtube_channel_whitelist) {
        window.setTimeout(() => {
          BG.setSetting('youtube_channel_whitelist', isEnabled, true);
          BG.addYTChannelListeners();
        }, 250);
      }
      if (!isEnabled) {
        $('#youtube_manage_subscribed_link').removeClass('link-text-color');
        $('#youtube_manage_subscribed_link').removeClass('pointer');
        $('#youtube_manage_subscribed_link').addClass('disabled-link-text-color');
      } else {
        $('#youtube_manage_subscribed_link').addClass('link-text-color');
        $('#youtube_manage_subscribed_link').addClass('pointer');
        $('#youtube_manage_subscribed_link').removeClass('disabled-link-text-color');
      }
    }

    // if the user enables/disable Twitch Channel allow listing
    // add or remove listners
    if (name === 'twitch_channel_allowlist') {
      if (isEnabled) {
        BG.addTwitchAllowlistListeners();
      } else {
        BG.removeTwitchAllowlistListeners();
      }
    }

    optionalSettings = BG.getSettings();
  });

  $('#youtube_manage_subscribed_link').on('click', () => {
    if (optionalSettings && optionalSettings.youtube_manage_subscribed) {
      BG.openYTManagedSubPage();
    }
  });
};

const showSeparators = function () {
  const $allGeneralOptions = $('#general-option-list li');
  const $lastVisibleOption = $('#general-option-list li:visible:last');
  $allGeneralOptions.addClass('bottom-line');
  $lastVisibleOption.removeClass('bottom-line');
};

$('#enable_show_advanced_options').on('change', function onAdvancedOptionsChange() {
  // Reload the page to show or hide the advanced options on the
  // options page -- after a moment so we have time to save the option.
  // Also, disable all advanced options, so that non-advanced users will
  // not end up with debug/beta/test options enabled.
  if (!this.checked) {
    $('.advanced input[type=\'checkbox\']:checked').each(function forEachAdvancedOption() {
      BG.setSetting(this.id.substr(7), false);
    });
  }

  window.setTimeout(() => {
    autoReloadingPage = true;
    window.location.reload();
  }, 50);
});

$(() => {
  initialize();
  showSeparators();

  if (!License || $.isEmptyObject(License) || !MABPayment) {
    return;
  }
  const payInfo = MABPayment.initialize('general');
  if (License.shouldShowMyAdBlockEnrollment()) {
    MABPayment.freeUserLogic(payInfo);
  } else if (License.isActiveLicense()) {
    MABPayment.paidUserLogic(payInfo);
  }

  MABPayment.displaySyncCTAs();
  $('.sync-cta #get-it-now-general').on('click', MABPayment.userClickedSyncCTA);
  $('.sync-cta #close-sync-cta-general').on('click', MABPayment.userClosedSyncCTA);
  $('a.link-to-tab').on('click', (event) => {
    activateTab($(event.target).attr('href'));
  });
});

const onSettingsChanged = function (name, currentValue, previousValue) {
  const checkBoxElement = $(`#enable_${name}`);
  if (checkBoxElement.length === 1 && checkBoxElement.is(':checked') === previousValue) {
    $(`#enable_${name}`).prop('checked', currentValue);
    if (name === 'show_advanced_options') {
      $('.advanced').toggle(currentValue);
    }
  }
};

settingsNotifier.on('settings.changed', onSettingsChanged);

window.addEventListener('unload', () => {
  settingsNotifier.off('settings.changed', onSettingsChanged);
});

port.postMessage({
  type: 'prefs.listen',
  filter: abpPrefPropertyNames,
});

port.onMessage.addListener((message) => {
  if (message.type === 'prefs.respond') {
    for (const inx in abpPrefPropertyNames) {
      const name = abpPrefPropertyNames[inx];
      $(`#prefs__${name}`).prop('checked', BG.Prefs[name]);
    }
  }
});

const onSubAdded = function (item) {
  const acceptableAds = BG.Prefs.subscriptions_exceptionsurl;
  const acceptableAdsPrivacy = BG.Prefs.subscriptions_exceptionsurl_privacy;

  if (item && item.url === acceptableAds) {
    updateAcceptableAdsUI(true, false);
  } else if (item && item.url === acceptableAdsPrivacy) {
    updateAcceptableAdsUI(true, true);
  }
};
filterNotifier.on('subscription.added', onSubAdded);

const onSubRemoved = function (item) {
  const aa = BG.Prefs.subscriptions_exceptionsurl;
  const aaPrivacy = BG.Prefs.subscriptions_exceptionsurl_privacy;
  const aaSubscribed = filterStorage.hasSubscription(aa);
  const aaPrivacySubscribed = filterStorage.hasSubscription(aaPrivacy);

  if (item && item.url === aa && !aaPrivacySubscribed) {
    updateAcceptableAdsUI(false, false);
  } else if (item && item.url === aa && aaPrivacySubscribed) {
    updateAcceptableAdsUI(true, true);
  } else if (item && item.url === aaPrivacy && !aaSubscribed) {
    updateAcceptableAdsUI(false, false);
  } else if (item && item.url === aaPrivacy && aaSubscribed) {
    updateAcceptableAdsUI(true, false);
  }
};
filterNotifier.on('subscription.removed', onSubRemoved);

window.addEventListener('unload', () => {
  filterNotifier.off('subscription.removed', onSubRemoved);
  filterNotifier.off('subscription.added', onSubAdded);
});
