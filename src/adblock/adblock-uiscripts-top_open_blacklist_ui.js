'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, translate, BlacklistUi, bindEnterClickToDefault, mayOpenDialogUi:true,
   setLangAndDirAttributes, rightClickedItem:true, loadWizardResources, i18nJoin,
   processReplacementChildrenInContent, isLangRTL */

// Global lock so we can't open more than once on a tab.
if (typeof window.mayOpenDialogUi === 'undefined') {
  window.mayOpenDialogUi = true;
}

// This script is injected each time the white list wizard is selected. Until we switch to ES6
// modules (aka import) we need to protect the code in a namespace so classes aren't declared
// multiple times.
function topOpenBlacklistUI(options) {
  // DragElement makes a given DOM element draggable. It assumes the element is positioned
  // absolutely and adjusts the element's `top` and `left` styles directly.
  // Inputs:
  //    - el : DOM element that activates dragging on mousedown (e.g. wizard header)
  //    - elementToDrag : DOM element that should drag while dragging (e.g. entire wizard)
  class DragElement {
    constructor(el, elementToDrag) {
      this.pos1 = 0;
      this.pos2 = 0;
      this.pos3 = 0;
      this.pos4 = 0;
      this.el = elementToDrag;
      this.dragging = false;
      this.activationElement = el;

      if (document.getElementById(`${el.d}header`)) {
        document.getElementById(`${el.id}header`).onmousedown = this.dragMouseDown.bind(this);
      } else {
        this.activationElement.onmousedown = this.dragMouseDown.bind(this);
      }
    }

    dragMouseDown(e) {
      const event = e || window.event;
      event.preventDefault();
      this.pos3 = event.clientX;
      this.pos4 = event.clientY;
      this.dragging = true;
      document.onmouseup = this.closeDragElement.bind(this);
      document.onmousemove = this.elementDrag.bind(this);
    }

    elementDrag(e) {
      const event = e || window.event;
      event.preventDefault();
      // calculate the new cursor position:
      this.pos1 = this.pos3 - event.clientX;
      this.pos2 = this.pos4 - event.clientY;
      this.pos3 = event.clientX;
      this.pos4 = event.clientY;
      // set the element's new position:
      this.el.style.top = `${this.el.offsetTop - this.pos2}px`;
      this.el.style.left = `${this.el.offsetLeft - this.pos1}px`;
    }

    closeDragElement() {
      // stop moving when mouse button is released:
      document.onmouseup = null;
      document.onmousemove = null;
      this.dragging = false;
    }
  }

  if (!mayOpenDialogUi) {
    return;
  }

  mayOpenDialogUi = false;

  // Get Flash objects out of the way of our UI
  browser.runtime.sendMessage({ command: 'sendContentToBack' });

  // A empty base <div> is appended to the page's DOM and then a shadow is hosted in it.
  // The shadow protects our dialog from outside CSS 'leaking' in.
  // Existing page styles are reset in the shadow/base at the top of `adblock-wizard.css`
  // using `:host` to select our base and the CCS rule `all:initial;` to perform the reset.
  const base = document.createElement('div');
  const $base = $(base.attachShadow({ mode: 'open' }));

  loadWizardResources($base, () => {
    // If they chose 'Block an ad on this page...' ask them to click the ad
    if (options.nothingClicked) {
      rightClickedItem = null;
    }

    // If they right clicked in a frame in Chrome, use the frame instead
    if (options.info && options.info.frameUrl) {
      const frame = $('iframe').filter((i, el) => el.src === options.info.frameUrl);
      if (frame.length === 1) {
        rightClickedItem = frame.get(0);
      }
    }
    if (rightClickedItem && rightClickedItem.nodeName === 'BODY') {
      rightClickedItem = null;
    }

    // check if we're running on website with a frameset, if so, tell
    // the user we can't run on it.
    if ($('frameset').length >= 1) {
      // eslint-disable-next-line no-alert
      alert(translate('wizardcantrunonframesets'));
      mayOpenDialogUi = true;
      return;
    }
    const html = `
    <div id='hiding-wizard'>
      <div class='page' id='page_0'>
        <header class="center-and-right">
          <h1>${translate('blockanadtitle')}</h1>
          <i class="material-icons md-18 close" role="img" aria-label="${translate('close')}">close</i>
        </header>
        <section>
          <p>${translate('clickthead')}</p>
        </section>
      </div>
      <div class='page' id='page_1' style='display:none;'>
        <header class="left-center-right">
          <i class="material-icons md-18 back" role="img" aria-label="${translate('back')}">chevron_left</i>
          <h1>${translate('blockanadtitle')}</h1>
          <i class="material-icons md-18 close" role="img" aria-label="${translate('close')}">close</i>
        </header>
        <section>
          <p class="boldText">${translate('isithidden')}</p>
          <p class="advanced-user-row" >${translate('blacklisterblockedelement')}</p>
          <p class="advanced-user-row" id='selected-data'>
            <span id='selected_node_name'></span>
          </p>
          <p>${translate('sliderexplanation')}</p>
          <input id='slider' type='range' min='0' value='0'/>
          <p class="warningText non-advanced-user-text">${translate('sliderwarning')}</p>
          <div class="buttonRow" ><button class='primary looks-good adblock-default-button'>${translate('buttonlooksgood')}</button></div>
        </section>
      </div>
      <div class='page' id='page_2' style='display:none;'>
        <header class="left-center-right">
          <i class="material-icons md-18 back" role="img" aria-label="${translate('back')}">chevron_left</i>
          <h1>${translate('blockanadtitle')}</h1>
          <i class="material-icons md-18 close" role="img" aria-label="${translate('close')}">close</i>
        </header>
        <section>
          <p class="boldText">${translate('blacklisteroptions1')}</p>
          <p class="advanced-user-row" >
            <input id="txtAdvanceFilter" type="text" disabled="true" />
            <span id="editBtnSpan">
              <i id="editBtn" class="material-icons md-18" role="img" aria-label="${translate('buttonedit')}">mode_edit</i>
            </span>
          </p>
          <p class="filter-warning-row" >
            <span id="warningIconSpan"><i id="warningIcon" class="material-icons md-18 warning-icon" role="img" aria-label="${translate('warning')}">warning</i></span><span id='filter-warning-text' ></span>
          </p>
          <p class="advanced-user-row advanced-user-row-disarm boldText detail-header" id="add_info">${translate('add_info')}</p>
          <p class="advanced-user-row advanced-user-row-disarm detail-header" >${translate('confirm_msg')}</p>
          <div id='adblock-details'></div>
          <div id='summary'></div>
          <p>${translate('blacklisternotsure_part_I')} <span class="non-advanced-user-text">${translate('blacklisternotsure_part_II')}</span></p>
          <p id="countRow"><span id="count"></span>&nbsp;${translate('hiddenelementmessagecount')} <i id="helpIcon" class="material-icons md-18" role="img" aria-label="${translate('learn_more_without_period')}">live_help</i></p>
          <div class="buttonRow" ><button class='primary confirm adblock-default-button'>${translate('buttonconfirm')}</button></div>
        </section>
      </div>
      <div class='page' id='page_3' style='display:none;'>
        <header class="center-and-right">
          <h1>${translate('adblock_premium')}</h1>
          <i class="material-icons md-18 close" role="img" aria-label="${translate('close')}">close</i>
        </header>
        <section>
          <span style="display: flex; flex-direction: column;">
            <span style="font-size: 18px; font-weight: bold;">${translate('wizard_premium_cta_title')}</span>
            <span style="margin-top: 22px;">${translate('wizard_premium_cta_part_I')}  ${translate('wizard_premium_cta_part_II')}</span>
          </span>
          <img aria-hidden='true' src='${browser.runtime.getURL('adblock-wizard_sync_cta.svg')}' style="height: 200px; width: 245px;">
        </section>
        <hr />
        <footer id='blacklist-cta' >
          <button id='find_out_more' class='btnClose'>${translate('find_out_more')}</button>
          <span id='opt-out-msg' class='btnClose'>${translate('dont_show_me_again')}</span>
        </footer>
      </div>
    </div>
    `;
    const $dialog = $(html);

    // Make any right-to-left translation
    if (isLangRTL()) {
      $dialog.find('i.back').text('chevron_right');
    }
    $dialog.find('header').each((i, header) => {
      // eslint-disable-next-line no-new
      new DragElement(header, $dialog.get(0));
    });

    $dialog.find('i.close,.btnClose').on('click', () => {
      mayOpenDialogUi = true;
      (document.body || document.documentElement).removeChild(base);
    });

    setLangAndDirAttributes($dialog.get(0));
    bindEnterClickToDefault($dialog);

    $base.append($dialog);
    const blacklistUI = new BlacklistUi(rightClickedItem, options.settings.show_advanced_options,
      options.isActiveLicense, options.showBlacklistCTA, $dialog);
    blacklistUI.cancel(() => {
      mayOpenDialogUi = true;
    });
    blacklistUI.block(() => {
      mayOpenDialogUi = true;
    });
    blacklistUI.show();
  });
  (document.body || document.documentElement).appendChild(base);
}

// required return value for tabs.executeScript
/* eslint-disable-next-line no-unused-expressions */
'';

//# sourceURL=/uiscripts/top_open_blacklist_ui.js
