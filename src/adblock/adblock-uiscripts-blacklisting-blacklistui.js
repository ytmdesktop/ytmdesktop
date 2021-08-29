'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global ClickWatcher, ElementChain, translate, browser, DOMPurify */

// Requires clickwatcher.js and elementchain.js and jQuery

// Create a selector that matches an element.
function selectorFromElm(el) {
  const attrs = ['id', 'class', 'name', 'src', 'href', 'data'];
  const result = [el.prop('nodeName')];
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    const val = el.attr(attr);
    if (val) {
      result.push(`[${attr}=${JSON.stringify(val)}]`);
    }
  }
  return result.join('');
}

// Wizard that walks the user through selecting an element and choosing
// properties to block.
// clickedItem: the element that was right clicked, if any.
// advancedUser:bool
// showBlacklistCTA:bool
function BlacklistUi(clickedItem, advancedUser, isActiveLicense, showBlacklistCTA, $base) {
  // If a dialog is ever closed without setting this to false, the
  // object fires a cancel event.
  this.cancelled = true;

  // steps through dialog - see preview()
  this.currentStep = 0;

  this.callbacks = { cancel: [], block: [] };

  this.clickedItem = clickedItem;
  this.isActiveLicense = isActiveLicense;
  this.advancedUser = advancedUser;
  this.showBlacklistCTA = showBlacklistCTA;
  this.$dialog = $base;
  this.clickWatcher = null;
}

BlacklistUi.prototype.reset = function reset() {
  this.cancelled = true;
  this.currentStep = 0;
  this.clickedItem = null;
};

// TODO: same event framework as ClickWatcher
BlacklistUi.prototype.cancel = function cancel(callback) {
  this.callbacks.cancel.push(callback);
};
BlacklistUi.prototype.block = function block(callback) {
  this.callbacks.block.push(callback);
};
BlacklistUi.prototype.fire = function fire(eventName, arg) {
  const callbacks = this.callbacks[eventName];
  for (let i = 0; i < callbacks.length; i++) {
    callbacks[i](arg);
  }
};
BlacklistUi.prototype.onClose = function onClose() {
  if (this.cancelled === true) {
    $('.adblock-ui-stylesheet').remove();
    if (this.chain) {
      this.chain.current().show();
    }
    this.fire('cancel');
  }
};
BlacklistUi.prototype.CloseBtnClickHandler = function CloseBtnClickHandler() {
  this.preview(null);
  this.onClose();
};
BlacklistUi.prototype.handleChange = function handleChange() {
  this.last.show();
  this.chain.current().hide();
  this.last = this.chain.current();
  this.redrawPage1();
  this.redrawPage2();
  this.preview(selectorFromElm(this.chain.current()));
};
// Add style rules hiding the given list of selectors.
BlacklistUi.prototype.blockListViaCSS = function blockListViaCSS(selectors) {
  if (!selectors.length) {
    return;
  }
  const cssChunk = document.createElement('style');
  cssChunk.type = 'text/css';
  // Documents may not have a head
  (document.head || document.documentElement).insertBefore(cssChunk, null);

  function fillInCSSchunk() {
    if (!cssChunk.sheet) {
      window.setTimeout(fillInCSSchunk, 0);
      return;
    }
    for (let i = 0; i < selectors.length; i++) {
      const rule = `${selectors[i]} { display:none !important; visibility: hidden !important; orphans: 4321 !important; }`;
      cssChunk.sheet.insertRule(rule, 0);
    }
  }
  fillInCSSchunk();
};

BlacklistUi.prototype.show = function show(showBackButton) {
  const that = this;
  // If we don't know the clicked element, we must find it first.
  if (!that.clickedItem) {
    if (!that.clickWatcher) {
      that.clickWatcher = new ClickWatcher();
      that.clickWatcher.cancel(() => {
        that.preview(null);
        that.fire('cancel');
      });
      that.clickWatcher.click((element) => {
        that.clickedItem = element;
        that.show(true);
      });
    }
    that.preview('*');
    that.clickWatcher.enable();

    that.$dialog.children('.page')
      .on('mouseenter', () => {
        that.clickWatcher.highlighter.disable();
      })
      .on('mouseleave', () => {
        that.clickWatcher.highlighter.enable();
      });
    that.$dialog.children('.page').hide();
    const $pageZero = that.$dialog.children('#page_0');
    $pageZero.show(showBackButton);
    const $pageZeroCloseBtn = $pageZero.find('i.close');
    const pageZeroCloseClickHandler = () => {
      that.preview(null);
      that.onClose();
      if (that.clickWatcher) {
        that.clickWatcher.disable();
      }
    };
    $pageZeroCloseBtn.off('click', pageZeroCloseClickHandler);
    $pageZeroCloseBtn.on('click', pageZeroCloseClickHandler);
    return;
  }

  // If we do know the clicked element, go straight to the slider.
  that.chain = new ElementChain(that.clickedItem);
  that.buildPage1(showBackButton);
  that.last = that.chain.current();
  that.chain.change(that, that.handleChange);
  that.chain.change();
  that.redrawPage1();
};

BlacklistUi.prototype.buildPage1 = function buildPage1(showBackButton) {
  const that = this;
  let depth = 0;
  let $element = this.chain.current();
  const $pageOne = that.$dialog.children('#page_1');
  const $pageOneSlider = $pageOne.find('#slider');
  const $pageOneOkBtn = $pageOne.find('button.looks-good');
  const $pageOneBackBtn = $pageOne.find('i.back');
  const $pageOneCloseBtn = $pageOne.find('i.close');

  // Reset and hide all wizard pages
  that.$dialog.children('.page').hide();

  // Add events to page 1 and its components
  if (showBackButton) {
    const backBtnClickHandler = () => {
      this.chain.current().show();
      that.$dialog.children('.page').hide();
      that.preview(null);
      that.fire('cancel');
      that.reset();
      that.show();
    };
    $pageOneBackBtn.unbind();
    $pageOneBackBtn.on('click', backBtnClickHandler);
  } else {
    $pageOneBackBtn.remove();
    $pageOne.find('header').addClass('center-and-right').removeClass('left-center-right');
  }

  if (this.advancedUser) {
    $pageOne.find('.non-advanced-user-text').hide();
  }
  const closeBtnClickHandler = this.CloseBtnClickHandler.bind(this);
  $pageOneCloseBtn.off('click', closeBtnClickHandler);
  $pageOneCloseBtn.on('click', closeBtnClickHandler);

  const pageOneOkBtnClickHandler = () => {
    that.cancelled = false;
    that.buildPage2();
    that.cancelled = true;
    that.redrawPage2();
  };
  $pageOneOkBtn.unbind();
  $pageOneOkBtn.on('click', pageOneOkBtnClickHandler);

  $pageOne.show();
  that.currentStep = 1;
  that.preview(selectorFromElm(that.chain.current()));

  while ($element.length > 0 && $element[0].nodeName !== 'BODY') {
    $element = $element.parent();
    depth += 1;
  }
  $pageOneSlider
    .attr('max', Math.max(depth - 1, 1))
    .on('input change', function sliderInputChange() {
      that.chain.moveTo(this.valueAsNumber);
    });
};

BlacklistUi.prototype.buildPage2 = function buildPage2() {
  const that = this;
  const $pageTwo = that.$dialog.children('#page_2');
  const $pageTwoConfirmBtn = $pageTwo.find('button.confirm');
  const $pageTwoEditBtn = $pageTwo.find('#editBtnSpan'); // advanced user only
  const $pageTwoEditIcon = $pageTwo.find('#editBtn'); // advanced user only
  const $txtAdvanceFilter = $pageTwo.find('#txtAdvanceFilter'); // advanced user only
  const $summary = $pageTwo.find('#summary');
  const $pageTwoBackBtn = $pageTwo.find('i.back');
  const $pageTwoCancelBtn = $pageTwo.find('i.close');
  const $pageTwoHelpIcon = $pageTwo.find('#helpIcon');
  const $pageTwoWarningTxt = $pageTwo.find('#filter-warning-text');
  const $pageTwoWarningSpan = $pageTwo.find('#warningIconSpan');
  const $pageTwoWarningRow = $pageTwo.find('.filter-warning-row');

  // Reset and hide all wizard pages
  that.$dialog.children('.page').hide();

  function displayErrorMessage(errMessage) {
    if (that.advancedUser) {
      $pageTwoWarningTxt.text(errMessage);
      $pageTwoWarningSpan.css('display', 'inline-flex');
      $pageTwoWarningRow.css('display', 'flex');
    } else {
      // eslint-disable-next-line no-alert
      alert(errMessage);
    }
  }

  if (that.advancedUser) {
    const originalFilterRule = $txtAdvanceFilter.val() || '';
    $summary.data('filter-text', originalFilterRule);
    $summary.data('original-filter-text', true);
    $pageTwoEditBtn.unbind();
    $pageTwoEditBtn.on('click', () => {
      const inputFieldEnabled = $txtAdvanceFilter.prop('disabled');
      const $checkBoxes = $pageTwo.find('input[type="checkbox"]');
      if (inputFieldEnabled) {
        $pageTwoEditIcon.text('check');
        $pageTwoEditBtn.addClass('editEnabled');
        $txtAdvanceFilter.prop('disabled', false);
        $checkBoxes.prop('disabled', true);
        $pageTwo.find('.advanced-user-row-disarm').css('color', 'var(--button-background-disable)');
        $pageTwoConfirmBtn.prop('disabled', true);
        $pageTwoConfirmBtn.addClass('disabled');
      } else {
        const customFilter = $txtAdvanceFilter.val();
        if (originalFilterRule === customFilter) {
          $checkBoxes.prop('disabled', false);
          $pageTwo.find('.advanced-user-row-disarm').css('color', 'var(--text-color)');
        }
        $pageTwoEditIcon.text('mode_edit');
        $pageTwoEditBtn.removeClass('editEnabled');
        $txtAdvanceFilter.prop('disabled', true);
        $pageTwoConfirmBtn.prop('disabled', false);
        $pageTwoConfirmBtn.removeClass('disabled');
        browser.runtime.sendMessage({ command: 'parseFilter', filterTextToParse: customFilter }).then((parseResult) => {
          if (parseResult && parseResult.error) {
            displayErrorMessage(translate('blacklistereditinvalid1', translate(parseResult.error.reason)));
            $pageTwoConfirmBtn.prop('disabled', true);
            $pageTwoConfirmBtn.addClass('disabled');
          } else {
            $summary.data('filter-text', customFilter);
            $summary.data('original-filter-text', (originalFilterRule === customFilter));
          }
        });
      }
    });
  }

  $pageTwoConfirmBtn.unbind();
  $pageTwoConfirmBtn.on('click', () => {
    const cssHidingText = $summary.data('filter-text');
    $pageTwoWarningSpan.css('display', 'none');
    if (cssHidingText) {
      let useOriginalText = true;
      let filter = `${document.location.hostname}##${cssHidingText}`;
      // if it's an advance user, and the rule text been validated above,
      // add what ever they've enterred
      if (that.advancedUser) {
        useOriginalText = $summary.data('original-filter-text');
        if (!useOriginalText || (useOriginalText && cssHidingText.startsWith(`${document.location.hostname}##`))) {
          filter = cssHidingText;
        }
      }
      browser.runtime.sendMessage({ command: 'addCustomFilter', filterTextToAdd: filter }).then((response) => {
        if (!response.error) {
          // if it's an advance user, and they've edited the rule text, they could have changed
          // any / all of the rule text to some other rule type
          // (e.g. - a blocking rule on a different site), so don't attempt to add a hiding rule
          // to the document
          if (!that.advancedUser) {
            that.blockListViaCSS([cssHidingText]);
          } else if (that.advancedUser && useOriginalText) {
            const theFilter = that.makeFilter();
            that.blockListViaCSS([theFilter]);
          }
          that.fire('block');
          that.blockedText = cssHidingText;
          that.buildPage3();
        } else {
          displayErrorMessage(translate('blacklistereditinvalid1', translate(response.error)));
        }
      });
    } else {
      displayErrorMessage(translate('blacklisternofilter'));
    }
  });
  $pageTwoBackBtn.unbind();
  $pageTwoBackBtn.on('click', () => {
    that.$dialog.children('.page').hide();
    that.$dialog.children('#page_1').show();
  });

  const closeBtnClickHandler = this.CloseBtnClickHandler.bind(this);
  $pageTwoCancelBtn.off('click', closeBtnClickHandler);
  $pageTwoCancelBtn.on('click', closeBtnClickHandler);
  $pageTwoHelpIcon.unbind();
  $pageTwoHelpIcon.on('click', () => {
    browser.runtime.sendMessage({ command: 'openTab', urlToOpen: 'https://help.getadblock.com/support/solutions/articles/6000246376-about-the-adblock-hiding-wizard-and-html-tags/' });
  });

  // Show page 2
  $pageTwo.show();
  that.currentStep = 2;
  that.preview($summary.text());
};

BlacklistUi.prototype.buildPage3 = function buildPage3() {
  const that = this;
  const $pageThree = that.$dialog.children('#page_3');
  const $pageThreeFindOutBtn = $pageThree.find('button#find_out_more');
  const $pageThreeOptOutBtn = $pageThree.find('#opt-out-msg');
  const $pageThreeCancelBtn = $pageThree.find('i.close');

  // Reset and hide all wizard pages
  that.$dialog.children('.page').hide();

  $pageThreeFindOutBtn.unbind();
  $pageThreeFindOutBtn.on('click', () => {
    browser.runtime.sendMessage({ command: 'openPremiumPayURL' });
    browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'blacklist_cta_clicked' });
    that.preview(null);
    that.onClose();
  });
  $pageThreeOptOutBtn.unbind();
  $pageThreeOptOutBtn.on('click', () => {
    browser.runtime.sendMessage({ command: 'setBlacklistCTAStatus', isEnabled: false });
    browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'blacklist_cta_closed' });
    that.preview(null);
    that.onClose();
  });
  const closeBtnClickHandler = this.CloseBtnClickHandler.bind(this);
  $pageThreeCancelBtn.off('click', closeBtnClickHandler);
  $pageThreeCancelBtn.on('click', closeBtnClickHandler);

  if (!this.isActiveLicense && this.showBlacklistCTA) {
    // Show page 3
    $pageThree.show();
    that.currentStep = 3;
    browser.runtime.sendMessage({ command: 'recordGeneralMessage', msg: 'blacklist_cta_seen' });
  } else {
    // simulate the user clicking the cancel/close icon is the easiest way to trigger all of the
    // close / clean up logic to run
    $pageThreeCancelBtn.trigger('click');
  }
};

BlacklistUi.prototype.redrawPage1 = function redrawPage1() {
  const element = this.chain.current();
  const elementTag = element[0].nodeName;
  const attrs = ['id', 'class', 'name', 'src', 'href', 'data'];
  const $selectedData = this.$dialog.children('.page').find('#selected-data');
  const $selectedNodeName = $selectedData.find('#selected_node_name');

  // Set selected element tag name
  $selectedNodeName.text(elementTag);

  // Empty all previous HTML for name value pairs of attributes
  $selectedData.find('.node_attr').remove();

  // Add new HTML for name value pairs of attributes
  let attrHTML = '';
  for (const i in attrs) {
    const attrName = attrs[i];
    const attrValue = BlacklistUi.ellipsis(element.attr(attrName));
    if (attrValue) {
      attrHTML = `${attrHTML} <span class="node_attr">${attrName}="${attrValue}"</span>`;
    }
  }
  attrHTML = `<span class="node_attr">[</span>${attrHTML}<span class="node_attr">]</span>`;
  $(attrHTML).insertAfter($selectedNodeName);

  if (this.advancedUser) {
    this.$dialog.find('#page_1 .advanced-user-row').css({ display: '-webkit-box' });
  }
};

// Return the CSS selector generated by the blacklister.  If the
// user has not yet gotten far enough through the wizard to
// determine the selector, return an empty string.
BlacklistUi.prototype.makeFilter = function makeFilter() {
  const result = [];
  const el = this.chain.current();
  const $pageTwo = this.$dialog.children('#page_2');
  const $pageTwoDetails = $pageTwo.find('#adblock-details');
  const $pageTwoWarningTxt = $pageTwo.find('#filter-warning-text');
  const $pageTwoWarningRow = $pageTwo.find('.filter-warning-row');
  const $pageTwoWarningSpan = $pageTwo.find('#warningIconSpan');

  if (
    !this.advancedUser
    || (this.advancedUser && $("input[type='checkbox']#cknodeName", $pageTwoDetails).is(':checked'))) {
    result.push(el.prop('nodeName'));
    // Some iframed ads are in a bland iframe.  If so, at least try to
    // be more specific by walking the chain from the body to the iframe
    // in the CSS selector.
    if (el.prop('nodeName') === 'IFRAME' && el.attr('id') === '') {
      let cur = el.parent();
      while (cur.prop('nodeName') !== 'BODY') {
        result.unshift(`${cur.prop('nodeName')} `);
        cur = cur.parent();
      }
    }
  }
  const attrs = ['id', 'class', 'name', 'src', 'href', 'data'];
  for (const i in attrs) {
    if (
      el.attr(attrs[i])
      && (!this.advancedUser
        || (this.advancedUser && $(`#ck${attrs[i]}`, $pageTwoDetails).is(':checked')))) {
      result.push(`[${attrs[i]}=${JSON.stringify(el.attr(attrs[i]))}]`);
    }
  }

  let warningMessage = '';
  if (result.length === 0) {
    warningMessage = translate('blacklisterwarningnofilter');
  } else if (
    result.length === 1
    && $("input[type='checkbox']#cknodeName", $pageTwoDetails).is(':checked')
  ) {
    warningMessage = translate('blacklisterblocksalloftype', [result[0]]);
  }

  $pageTwoWarningTxt.text(warningMessage);
  if (this.advancedUser) {
    if (warningMessage) {
      $pageTwoWarningSpan.css('display', 'inline-flex');
    } else {
      $pageTwoWarningSpan.css('display', 'none');
    }
    $pageTwoWarningRow.css('display', 'flex');
  }
  return result.join('');
};

BlacklistUi.prototype.redrawPage2 = function redrawPage2() {
  const el = this.chain.current();
  const that = this;
  const attrs = ['nodeName', 'id', 'class', 'name', 'src', 'href', 'data'];
  const $pageTwo = that.$dialog.children('#page_2');
  const $pageTwoDetails = $pageTwo.find('#adblock-details');
  const $pageTwoSummary = $pageTwo.find('#summary');
  const $userInput = $pageTwo.find('#txtAdvanceFilter');
  const $countRow = $pageTwo.find('#countRow');

  function updateFilter() {
    const theFilter = that.makeFilter();
    $pageTwoSummary.data('filter-text', theFilter);
    $userInput.val(`${document.location.hostname}##${theFilter}`);

    if (that.advancedUser) {
      $countRow.hide();
    } else {
      const matchCount = $(theFilter).not('.dialog').length;
      if (matchCount > 1) {
        $pageTwo.find('#count').text(matchCount - 1);
        $countRow.show();
      } else {
        $countRow.hide();
      }
    }
  }
  if (that.advancedUser) {
    $pageTwo.find('.non-advanced-user-text').hide();
    $pageTwoDetails.empty();

    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      const longVal = (attr === 'nodeName' ? el.prop('nodeName') : el.attr(attr));
      const val = BlacklistUi.ellipsis(longVal);
      const attrName = attr === 'nodeName' ? translate('blacklistertype') : attr;
      if (val) {
        // Check src, data and href only by default if no other identifiers are
        // present except for the nodeName selector.
        let checked = true;
        if (attr === 'src' || attr === 'href' || attr === 'data') {
          checked = $('input', $pageTwoDetails).length === 1;
        }

        // Create <label> tag
        const nameHTML = `<b>${attrName}</b>`;
        const valueHTML = `<i>${val}</i>`;
        const $checkboxlabel = $('<label></label>')
          .addClass('adblock')
          .attr('for', `ck${attr}`)
          .html(DOMPurify.sanitize(translate('blacklisterattrwillbe', [nameHTML, valueHTML]), { SAFE_FOR_JQUERY: true }));

        // Create <input> tag
        const $checkboxInput = $('<input></input')
          .addClass('adblock')
          .attr('type', 'checkbox')
          .attr('checked', checked)
          .attr('id', `ck${attr}`)
          .on('change', () => {
            updateFilter();
            that.preview($pageTwoSummary.data('filter-text'));
          });

        // Aggregate <input> and <label> within a <div>
        const $checkbox = $('<div class="advanced-user-row detail-row advanced-user-row-disarm"></div>')
          .addClass('adblock')
          .addClass('check-box')
          .addClass('small')
          .append($checkboxInput)
          .append($checkboxlabel);

        $pageTwoDetails.append($checkbox);
      }
    }
    this.$dialog.find('#page_2 .advanced-user-row').css({ display: 'flex' });
    $pageTwoDetails.show();
  }
  updateFilter();
};

// Change the appearance of a CSS selector on the page, or if null, undo the change.
// Inputs: selector:string - the selector generated by the blacklist wizard
BlacklistUi.prototype.preview = function preview(selector) {
  $('#adblock_blacklistpreview_css').remove();
  if (!selector) {
    return;
  }

  const csspreview = document.createElement('style');
  csspreview.type = 'text/css';
  csspreview.id = 'adblock_blacklistpreview_css';

  if (this.currentStep === 0) {
    // Raise highlight.
    csspreview.innerText = 'body .adblock-highlight-node,';
  } else if (this.currentStep === 1) {
    // Show ui_page1.
    csspreview.innerText = 'body, body * {opacity:1!important;} ';
  } else if (this.currentStep === 2) {
    // Fade the selector, while skipping any matching children.
    csspreview.innerText += `
    ${selector} {
      opacity:.1!important;
    }
    ${selector} ${selector} {
      opacity:1!important;
    }`;
  }
  document.documentElement.appendChild(csspreview);
};

// Return a copy of value that has been truncated with an ellipsis in
// the middle if it is too long.
// Inputs: valueToTruncate:string - value to truncate
//         maxSize?:int - max size above which to truncate, defaults to 50
BlacklistUi.ellipsis = function ellipsis(valueToTruncate, maxSize) {
  let value = valueToTruncate;
  let size = maxSize;

  if (!value) {
    return value;
  }

  if (!size) {
    size = 50;
  }

  const half = size / 2 - 2; // With ellipsis, the total length will be ~= size
  if (value.length > size) {
    value = (`${value.substring(0, half)}...${value.substring(value.length - half)}`);
  }

  return value;
};

// required return value for tabs.executeScript
/* eslint-disable-next-line no-unused-expressions */
'';

//# sourceURL=/uiscripts/blacklisting/blacklistui.js
