'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global exports:true */

// Used by both channels.js and picreplacement.js
// Since this file is conditional loaded, and not part of the content script web pack,
// 'exports' may not be defined, so we use this hack
if (typeof exports === 'undefined') {
  const overrideExports = {};
  window.exports = overrideExports;
}

const imageSizesMap = new Map([
  ['NONE', 0],
  ['wide', 1],
  ['tall', 2],
  ['skinnywide', 4],
  ['skinnytall', 8],
  ['big', 16],
  ['small', 32],
]);

exports.imageSizesMap = imageSizesMap;
exports.WIDE = imageSizesMap.get('wide');
exports.TALL = imageSizesMap.get('tall');
exports.BIG = imageSizesMap.get('big');
exports.SMALL = imageSizesMap.get('small');
exports.SKINNYWIDE = imageSizesMap.get('skinnywide');
exports.SKINNYTALL = imageSizesMap.get('skinnytall');
