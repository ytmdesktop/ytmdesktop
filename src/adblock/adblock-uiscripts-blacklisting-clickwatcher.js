'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global Overlay */

// Requires overlay.js and jquery

// Highlight DOM elements with an overlayed box, similar to Webkit's inspector.
// Creates an absolute-positioned div that is translated & scaled following
// mousemove events. Holds a pointer to target DOM element.
function Highlighter() {
  let target = null;
  let enabled = false;
  let then = Date.now();
  let box = $("<div id='overlay-box' class='adblock-highlight-node'></div>");
  box.css({
    'background-color': 'rgba(130, 180, 230, 0.5)',
    'box-sizing': 'border-box',
    outline: 'solid 1px #0F4D9A',
    position: 'absolute',
    zIndex: 214748364,
  });
  box.appendTo($(document.body));

  function handler(e) {
    let el = e.target;
    const now = Date.now();

    if (now - then < 25) {
      return;
    }
    then = now;
    if (el === box[0]) {
      box.hide();
      el = document.elementFromPoint(e.clientX, e.clientY);
    }
    if (el === target) {
      box.show();
      return;
    }
    if (el === document.body || el.className === 'adblock-killme-overlay') {
      box.hide();
      return;
    }
    target = el;

    const $el = $(el);
    const offset = $el.offset();
    box.css({
      height: $el.outerHeight() || 0,
      width: $el.outerWidth() || 0,
      left: offset.left,
      top: offset.top,
    });
    box.show();
  }

  this.getCurrentNode = function getCurrentNode(el) {
    return el === box[0] ? target : el;
  };
  this.enable = function enable() {
    if (box && !enabled) {
      $(document.body).on('mousemove', handler);
    }
    enabled = true;
  };
  this.disable = function disable() {
    if (box && enabled) {
      box.hide();
      $(document.body).off('mousemove', handler);
    }
    enabled = false;
  };
  this.destroy = function destroy() {
    this.disable();
    if (box) {
      box.remove();
      box = null;
    }
  };
}

// Class that watches the whole page for a click, including iframes and
// objects.  Shows a modal while doing so.
function ClickWatcher() {
  this.callbacks = { cancel: [], click: [] };
  this.clickedElement = null;
  this.highlighter = null;
}

ClickWatcher.prototype.cancel = function cancel(callback) {
  this.callbacks.cancel.push(callback);
};
ClickWatcher.prototype.click = function click(callback) {
  this.callbacks.click.push(callback);
};
ClickWatcher.prototype.fire = function fire(eventName, arg) {
  const callbacks = this.callbacks[eventName];
  for (let i = 0; i < callbacks.length; i++) {
    callbacks[i](arg);
  }
};

ClickWatcher.prototype.enable = function enable() {
  const that = this;
  that.highlighter = new Highlighter();
  that.highlighter.enable();
  that.eventsListener();
};

// Clean up / remove added DOM elements.
ClickWatcher.prototype.disable = function disable() {
  $('body').off('click', '.adblock-killme-overlay, .adblock-highlight-node', this.clickHandler);
  $('body').unbind();
  Overlay.removeAll();
  this.onClose();
};

// Called externally to close ClickWatcher.  Doesn't cause any events to
// fire.
ClickWatcher.prototype.close = function close() {
  // Delete our event listeners so we don't fire any cancel events
  this.callbacks.cancel = [];
};

// The dialog is closing, either because the user clicked cancel, or the
// close button, or because they clicked an item.
ClickWatcher.prototype.onClose = function onClose() {
  if (!this.clickedElement) {
    // User clicked Cancel button or X
    this.fire('cancel');
  } else {
    // User clicked a page item
    this.fire('click', this.clickedElement);
  }
  this.highlighter.destroy();
};

ClickWatcher.prototype.clickHandler = function clickHandler(event) {
  if (event && event.data && event.data.clickWatcherRef) {
    const theClickWatcherRef = event.data.clickWatcherRef;
    theClickWatcherRef.clickedElement = theClickWatcherRef.highlighter.getCurrentNode(this);
    theClickWatcherRef.disable();
  }
  return false;
};

// Catches clicks on elements and mouse hover on the wizard
// when element is clicked we stored the element in clickedElement
// and close all ClickWatcher processes
ClickWatcher.prototype.eventsListener = function eventsListener() {
  const that = this;

  // Most things can be blacklisted with a simple click handler.
  $('body').on('click', '.adblock-killme-overlay, .adblock-highlight-node', { clickWatcherRef: that }, that.clickHandler);

  // Since iframes that will get clicked will almost always be an entire
  // ad, and I *really* don't want to figure out inter-frame communication
  // so that the blacklist UI's slider works between multiple layers of
  // iframes... just overlay iframes and treat them as a giant object.
  $('object,embed,iframe,[onclick]:empty')
    .each((i, el) => {
      // Don't add overlay's for hidden elements
      if (el.style && el.style.display === 'none') {
        return;
      }
      const killmeOverlay = new Overlay({
        domElement: el,
        clickHandler: that.clickHandler,
      });
      killmeOverlay.display();
    });
};


// required return value for tabs.executeScript
/* eslint-disable-next-line no-unused-expressions */
'';

//# sourceURL=/uiscripts/blacklisting/clickwatcher.js
