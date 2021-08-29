'use strict';

function Overlay(options) {
  const el = $(options.domElement);

  this.image = $("<div class='adblock-killme-overlay'></div>")
    .css({
      left: el.position().left,
      top: el.position().top,
      'background-color': 'transparent !important',
      position: 'absolute',
      'z-index': 1000000,
    })
    .width(el.width() || 0)
    .height(el.height() || 0);
  this.el = el;
  this.clickHandler = options.clickHandler;

  this.image
    .on('mouseenter', function onEnter() {
      // crbug.com/110084
      this.style.setProperty('background-color', 'rgba(130, 180, 230, 0.5)', 'important');
    })
    .on('mouseleave', function onLeave() {
      // crbug.com/110084
      this.style.setProperty('background-color', 'transparent', 'important');
    });

  Overlay.instances.push(this);
}

Overlay.instances = [];

Overlay.removeAll = function removeAllOverlays() {
  $.each(Overlay.instances, (i, overlay) => {
    overlay.image.remove();
  });
  Overlay.instances = [];
};

Overlay.prototype.display = function displayOverlay() {
  const that = this;
  this.image
    .appendTo(that.el.parent())
    .on('click', () => {
      that.clickHandler(that.el);
      return false;
    });
};

// required return value for tabs.executeScript
/* eslint-disable-next-line no-unused-expressions */
'';

//# sourceURL=/uiscripts/blacklisting/overlay.js
