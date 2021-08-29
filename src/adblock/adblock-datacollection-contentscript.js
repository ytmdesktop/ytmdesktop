'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser */
// listen to messages from the background page
const onDataCollectionMessage = function (request, sender, sendResponse) {
  if (request.command === 'ping_dc_content_script') {
    sendResponse({ status: 'yes' });
  }
};
browser.runtime.onMessage.addListener(onDataCollectionMessage);

let pairs = [];
const matchSelectors = [];
const matchExceptions = [];
const chunkSize = 1000;
function* genFunc() {
  let i = pairs.length;
  while (i > 0) {
    i -= 1;
    yield pairs.splice((-1 * chunkSize), chunkSize);
  }
}

browser.runtime.sendMessage({ type: 'getSelectors' }).then((response) => {
  if (document.readyState !== 'loading') {
    pairs = response.selectors;
    const { exceptions } = response;

    const interval = setInterval(() => {
      const val = genFunc().next();
      if (val.done) {
        clearInterval(interval);
        if (matchSelectors.length > 0) {
          const noDuplicates = Array.from(new Set(matchSelectors)); // remove any duplicates
          browser.runtime.sendMessage({
            type: 'datacollection.elementHide',
            selectors: noDuplicates,
          });
        }
        for (const exceptionSelectors of exceptions) {
          if (document.querySelectorAll(exceptionSelectors.body).length) {
            matchExceptions.push(exceptionSelectors.text);
          }
        }
        if (matchExceptions.length > 0) {
          const noDuplicates = Array.from(new Set(matchExceptions)); // remove any duplicates
          browser.runtime.sendMessage({ type: 'datacollection.exceptionElementHide', exceptions: noDuplicates });
        }
      } else {
        const selectors = val.value;
        for (const selector of selectors) {
          for (const element of document.querySelectorAll(selector)) {
            // Only consider selectors that actually have an effect on the
            // computed styles, and aren't overridden by rules with higher
            // priority, or haven't been circumvented in a different way.
            if (getComputedStyle(element).display === 'none') {
              matchSelectors.push(selector);
            }
          }
        }
      }
    }, 10); // pause 10 milli-seconds between each chunck
  }
});
