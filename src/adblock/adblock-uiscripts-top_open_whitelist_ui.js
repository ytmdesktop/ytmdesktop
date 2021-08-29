'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, translate, bindEnterClickToDefault, mayOpenDialogUi:true,
   setLangAndDirAttributes, loadWizardResources, parseUri */


// Global lock so we can't open more than once on a tab.
if (typeof window.mayOpenDialogUi === 'undefined') {
  window.mayOpenDialogUi = true;
}

// This script is injected each time the white list wizard is selected. Until we switch to ES6
// modules (aka import) we need to protect the code in a namespace so classes aren't declared
// multiple times.


// topOpenWhitelistUI displays the whitelist wizard if it's not already open. See README for
// details.
function topOpenWhitelistUI() {
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

  // ExceptionFilterEditor maintains the data model for a modifiable domain filter.
  class ExceptionFilterEditor {
    constructor(location) {
      this.domain = location.host;
      this.pathname = location.pathname;
      this.location = location.pathname.match(/(.*?)(\/?)(\?|$)/);

      const fixedDomainPart = parseUri.secondLevelDomainOnly(this.domain, true);
      this.domainParts = this.domain.substr(0, this.domain.lastIndexOf(fixedDomainPart)).split('.');
      this.domainParts.splice(this.domainParts.length - 1, 1, fixedDomainPart);

      const path = this.pathname.match(/(.*?)(\/?)(\?|$)/);
      this.pathParts = path[1].split('/');
      this.pathParts.shift(); // first item is always empty

      // Don't show the domain slider on
      // - sites without a third level domain name (e.g. foo.com)
      // - sites with an ip domain (e.g. 1.2.3.4)
      // Don't show the location slider on domain-only locations
      const noThirdLevelDomain = (this.domainParts.length === 1);
      const domainIsIp = /^(\d+\.){3}\d+$/.test(this.domain);
      this.showDomain = !(noThirdLevelDomain || domainIsIp);
      this.showPath = !!(path[1]);
      this.showSliders = this.showDomain || this.showPath;
      this.maxDomainParts = Math.max(this.domainParts.length - 1, 1);
      this.maxPathParts = Math.max(this.pathParts.length, 1);
    }

    // Generate the URL. If forDisplay is true, then it will truncate long URLs
    generateUrl(forDisplay, domainSliderValue, pathSliderValue) {
      let result = '';

      // Make clear that it includes subdomains
      if (forDisplay && domainSliderValue !== 0) {
        result = '*.';
      }

      // Append the chosen parts of a domain
      for (let i = domainSliderValue; i <= (this.domainParts.length - 2); i++) {
        result += `${this.domainParts[i]}.`;
      }
      result += this.domainParts[this.domainParts.length - 1];
      for (let i = 0; i < pathSliderValue; i++) {
        result += `/${this.pathParts[i]}`;
      }

      // Append a final slash for for example filehippo.com/download_dropbox/
      if (this.pathParts.length !== pathSliderValue || !this.location[1]) {
        result += '/';
        if (forDisplay) {
          result += '*';
        }
      } else if (this.location[2]) {
        result += this.location[2];
      }

      if (forDisplay) {
        result = result.replace(/(\/[^/]{6})[^/]{3,}([^/]{6})/g, '$1...$2');
        if (result.indexOf('/') > 30 && result.length >= 60) {
          result = result.replace(/^([^/]{20})[^/]+([^/]{6}\/)/, '$1...$2');
        }
        while (result.length >= 60) {
          result = result.replace(/(\/.{4}).*?\/.*?(.{4})(?:\/|$)/, '$1...$2/');
        }
        [this.domainPart] = result.match(/^[^/]+/);
        [this.pathPart] = result.match(/\/.*$/);
      } else {
        return result;
      }
      return undefined;
    }
  }

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
  <section >
    <p >${translate('adblock_wont_run_on_pages_matching')}</p>
    <ul id="adblock-parts">
        <li id="adblock-domain-part"></li>
        <li id="adblock-path-part"></li>
    </ul>
    <p id="slider-directions">${translate('you_can_slide_to_change')}</p>
    <form  id="adblock-wizard-form">
        <fieldset id="adblock-sliders">
          <div id="modifydomain">
            <label for="adblock-domain-slider">${translate('modifydomain')}</label>
            <input id="adblock-domain-slider" type="range" min="0" value="0"/>
          </div>
          <div id="modifypath">
            <label for="adblock-path-slider">${translate('modifypath')}</label>
            <input id="adblock-path-slider" type="range" min="0" value="0"/>
          </div>
        </fieldset>
        <fieldset >
          <input type="checkbox" id="adblock-reload-page" checked/>
          <label for="adblock-reload-page">${translate('reloadpageafterwhitelist')}</label>
        </fieldset>
    </form>
  </section>
  <footer >
    <button class="primary adblock-default-button">${translate('buttonexclude')}</button>
    <button class="cancel">${translate('buttoncancel')}</button>
  </footer>
</div>
`;
    const $dialog = $(html);
    // eslint-disable-next-line no-new
    new DragElement(
      $dialog.find('header').get(0),
      $dialog.get(0),
    );
    const domainFilter = new ExceptionFilterEditor(document.location);

    const $domainPart = $dialog.find('#adblock-domain-part');
    const $pathPart = $dialog.find('#adblock-path-part');
    const $domainSlider = $dialog.find('#adblock-domain-slider')[0];
    const $pathSlider = $dialog.find('#adblock-path-slider')[0];

    domainFilter.generateUrl(true, $domainSlider.valueAsNumber, $pathSlider.valueAsNumber);

    if (!domainFilter.showDomain) {
      $dialog.find('#modifydomain').hide();
    }
    if (!domainFilter.showPath) {
      $dialog.find('#modifypath').hide();
    }
    if (!domainFilter.showSliders) {
      $dialog.find('#slider-directions').hide();
    }

    $dialog.find('#adblock-domain-slider').attr('max', domainFilter.maxDomainParts);
    $dialog.find('#adblock-path-slider').attr('max', domainFilter.maxPathParts);
    $dialog.find('#adblock-path-slider, #adblock-domain-slider').on('input change', () => {
      domainFilter.generateUrl(true, $domainSlider.valueAsNumber, $pathSlider.valueAsNumber);
      $domainPart.text(domainFilter.domainPart);
      $pathPart.text(domainFilter.pathPart);
    });

    $domainPart.text(domainFilter.domainPart);
    $pathPart.text(domainFilter.pathPart);

    $dialog.find('button.primary').on('click', () => {
      const rule = domainFilter.generateUrl(
        false,
        $domainSlider.valueAsNumber,
        $pathSlider.valueAsNumber,
      );
      const filter = `@@||${rule}$document`;
      browser.runtime.sendMessage({ command: 'addCustomFilter', filterTextToAdd: filter }).then(() => {
        if ($dialog.find('#adblock-reload-page').is(':checked')) {
          browser.runtime.sendMessage({ command: 'reloadTabForWhitelist', rule });
        } else {
          mayOpenDialogUi = true;
          (document.body || document.documentElement).removeChild(base);
          browser.runtime.sendMessage({ command: 'showWhitelistCompletion', rule });
        }
      });
    });

    $dialog.find('button.cancel').on('click', () => {
      mayOpenDialogUi = true;
      (document.body || document.documentElement).removeChild(base);
    });

    setLangAndDirAttributes($dialog.get(0));
    bindEnterClickToDefault($dialog);

    $base.append($dialog);
  });
  (document.body || document.documentElement).appendChild(base);
}

// required return value for tabs.executeScript
/* eslint-disable-next-line no-unused-expressions */
'';

//# sourceURL=/uiscripts/top_open_whitelist_ui.js
