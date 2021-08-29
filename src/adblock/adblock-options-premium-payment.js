'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global License, parseUri, BG, storageSet, storageGet */

// MABPayment can be used in all the Options page tabs and should be used to display
// the CTAs to pay for Premium.
const MABPayment = (function mabPayment() {
  const userClosedSyncCTA = storageGet(License.userClosedSyncCTAKey);
  const userSawSyncCTA = storageGet(License.userSawSyncCTAKey);
  const pageReloadedOnSettingChange = storageGet(License.pageReloadedOnSettingChangeKey);

  return {
    // Called to generate the correct info necessary to display/hide/use the CTA in the template
    // Input:
    // page:string - name of script of origin and should match the suffix in the CTA ids
    initialize(page) {
      return {
        id: `locked-user-pay-section-${page}`,
        linkId: `get-it-now-${page}`,
        url: License.MAB_CONFIG.payURL,
      };
    },
    // Called if the user hasn't paid and MAB is locked
    // Input:
    // payInfo:object - the object returned by initialize()
    // Returns:object - the object with functions handling the logic for Sync CTAs
    freeUserLogic(payInfo) {
      const $paySection = $(`#${payInfo.id}`);
      const $payLink = $(`#${payInfo.linkId}`);
      $payLink.attr('href', payInfo.url);
      $paySection.slideDown();
    },
    // Called if the user is active and Premium is unlocked
    // Input:
    // payInfo:object - the object returned by initialize()
    paidUserLogic(payInfo) {
      const $paySection = $(`#${payInfo.id}`);
      $paySection.hide();
      $('.mab-feature.locked').removeClass('locked').addClass('hover-shadow');
      $('.theme-wrapper.locked').removeClass('locked');
      $('.overlay-icon').text('check');
    },
    // When the Options page loads we show the Sync CTAs on the General,
    // Filter Lists and Customize tabs only in the following conditions:
    //   - Free users see the CTA on page load only on their first Options page visit
    //   - Free users never see a Sync CTA after dismissing one by clicking on the close button
    //   - Free users see the CTA again only if they changed settings and never closed the CTA
    //   - Paid users should never see the CTA
    // Input:
    //  settingChanged:bool|undefined - true if user just changed a setting
    displaySyncCTAs: (settingChanged) => {
      const userChangedSettings = settingChanged || pageReloadedOnSettingChange;
      const alreadyShowingCTAs = $('.sync-cta:visible').length;
      if (!License || !License.shouldShowMyAdBlockEnrollment() || userClosedSyncCTA) {
        return;
      }
      if (!alreadyShowingCTAs && (userChangedSettings || !userSawSyncCTA)) {
        $('.sync-cta').fadeIn(1000);
        BG.recordGeneralMessage('options_page_sync_cta_seen');
      }
    },
    userClosedSyncCTA: () => {
      const $syncCTAs = $('.sync-cta');
      const $getSyncCTAs = $('.get-sync-cta');
      const $goodbyeSyncCTAs = $('.goodbye-sync-cta');
      $getSyncCTAs.fadeOut(1000, () => {
        $goodbyeSyncCTAs.fadeIn(1000, () => {
          setTimeout(() => {
            $goodbyeSyncCTAs.fadeOut(1000, () => {
              $syncCTAs.slideUp();
            });
          }, 10000);
        });
      });
      storageSet(License.userClosedSyncCTAKey, true);
      BG.recordGeneralMessage('options_page_sync_cta_closed');
    },
    userClickedSyncCTA: () => {
      BG.recordGeneralMessage('options_page_sync_cta_clicked');
    },
  };
}());
