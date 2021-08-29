'use strict';

// Requires jquery.

// Lets you move up and down the DOM starting from a specific element.
function ElementChain(el) {
  this.stack = [];
  this.changeEvents = [];
  this.stack.push($(el));
}
ElementChain.prototype.current = function current() {
  return this.stack[this.stack.length - 1];
};

ElementChain.prototype.moveUp = function moveUp() {
  if (this.current().parent().length > 0 && this.current().parent()[0].nodeName !== 'BODY') {
    this.stack.push(this.current().parent());
    this.change();
    return true;
  }
  return false;
};

ElementChain.prototype.moveDown = function moveDown() {
  if (this.stack.length > 1) {
    this.stack.pop();
    this.change();
    return true;
  }
  return false;
};

// Moves to the appropriate parent depth.  0 is the original element,
// 1 is its parent, etc.
ElementChain.prototype.moveTo = function moveTo(depth) {
  while (this.stack.length > depth + 1) {
    if (!this.moveDown()) {
      break;
    }
  }
  while (this.stack.length < depth + 1) {
    if (!this.moveUp()) {
      break;
    }
  }
};

ElementChain.prototype.change = function change(listener, callback) {
  if (callback) {
    this.changeEvents.push([listener, callback]);
  } else {
    for (let i = 0; i < this.changeEvents.length; i++) {
      const data = this.changeEvents[i];
      data[1].call(data[0]);
    }
  }
};

// required return value for tabs.executeScript
/* eslint-disable-next-line no-unused-expressions */
'';

//# sourceURL=/uiscripts/blacklisting/elementchain.js
