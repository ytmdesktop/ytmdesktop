'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global pageInfo, transitionTo, logHelpFlowResults, filterUpdateError:true,
  browser */

// Help flow button actions -- called when the associated buttons are clicked
const popupMenuHelpActionMap = {
  // Checks if the page is whitelisted. If the page isn't whitelisted,
  // updates filter lists and checks for update errors
  // Disables button while updating the filter lists and reenables it
  // when updating is complete or after 6 seconds
  okCheckWhitelistAction() {
    if (pageInfo.whitelisted) {
      transitionTo('seeAdOnWhitelist', false);
    } else {
      transitionTo('seeAdNotOnWhitelist', false);
      $('button').prop('disabled', true);
      browser.runtime.sendMessage({ command: 'updateFilterLists' });
      setTimeout(() => {
        browser.runtime.sendMessage({ command: 'checkUpdateProgress' }).then((progress) => {
          if (progress.inProgress) {
            setTimeout(() => {
              browser.runtime.sendMessage({ command: 'checkUpdateProgress' }).then((progress2) => {
                if (progress2.inProgress || progress2.filterError) {
                  filterUpdateError = true;
                }
                $('button').prop('disabled', false);
              });
            }, 5000); // wait five seconds and check again
          } else {
            $('button').prop('disabled', false);
          }
          if (progress.filterError && !progress.inProgress) {
            filterUpdateError = true;
          }
        });
      }, 1000); // wait one second and check
    }
  },
  dontRemoveWhitelistAction() {
    transitionTo('dontRemoveWhitelist', false);
  },
  removeWhitelistAction() {
    if (pageInfo.url) {
      browser.runtime.sendMessage({ command: 'tryToUnwhitelist', url: pageInfo.url.href });
    }
    transitionTo('removeWhitelist', false);
  },
  finishFlowAction() {
    logHelpFlowResults('finishFlow');
    window.close();
  },
  reloadFinishFlowAction() {
    browser.tabs.reload();
    logHelpFlowResults('reloadFinishFlow');
    window.close();
  },
  reloadCheckAction() {
    browser.tabs.reload();
    transitionTo('checkedBasics', false);
  },
  stillSeeAdAction() {
    if (filterUpdateError) {
      transitionTo('seeAdFilterError', false);
    } else {
      transitionTo('seeAdFiltersGood', false);
    }
  },
  problemSolvedAction() {
    transitionTo('problemSolved', false);
  },
  seeAdEnglishSiteAction() {
    transitionTo('seeAdEnglishSite', false);
  },
  seeAdNotEnglishSiteAction() {
    transitionTo('seeAdNotEnglishSite', false);
  },
  // Unpauses and reloads the page
  unpauseAndReloadAction() {
    if (pageInfo.paused) {
      browser.runtime.sendMessage({ command: 'adblockIsPaused', newValue: false }).then(() => {
        browser.tabs.reload();
        transitionTo('unpauseAndReload', false);
      });
    } else if (pageInfo.url) {
      browser.runtime.sendMessage({ command: 'adblockIsDomainPaused', activeTab: { url: pageInfo.url.href, id: pageInfo.id }, newValue: false }).then(() => {
        browser.tabs.reload();
        transitionTo('unpauseAndReload', false);
      });
    } else {
      browser.tabs.reload();
      transitionTo('unpauseAndReload', false);
    }
  },
  dontChangeSeeAdsAction() {
    transitionTo('dontChangeSeeAds', false);
  },
  seeAdsUnpausedAction() {
    transitionTo('seeAdFiltersGood', false);
  },
  // Pauses and reloads the page
  reloadStillBrokenAction() {
    browser.runtime.sendMessage({ command: 'adblockIsPaused', newValue: true }).then(() => {
      browser.tabs.reload();
      transitionTo('reloadStillBroken', false);
    });
  },
  stillBrokenNotAdBlockAction() {
    transitionTo('stillBrokenNotAdBlock', false);
  },
  stillBrokenAdBlockAction() {
    transitionTo('stillBrokenAdBlock', false);
  },
};
