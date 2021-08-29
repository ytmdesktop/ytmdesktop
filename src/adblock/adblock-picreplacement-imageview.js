'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, localizePage, parseUri, translate */

$(() => {
  localizePage();
  if (window.location && window.location.search) {
    const sectionEl = document.getElementById('imgDIV');
    const newPic = document.createElement('img');
    const searchQuery = parseUri.parseSearch(window.location.search);
    let styleString = 'background-position: 0px 0px; float: none;left: auto; top: auto; bottom: auto; right: auto; display: inline-block;';
    if (searchQuery && searchQuery.url && searchQuery.url.startsWith('file:///')) {
      browser.storage.local.get(searchQuery.url).then((savedCustomImageData) => {
        newPic.src = savedCustomImageData[searchQuery.url].src;
        styleString = `${styleString} width: ${savedCustomImageData[searchQuery.url].width}px; height: ${savedCustomImageData[searchQuery.url].height}px;`;
      });
    } else if (searchQuery && searchQuery.url) {
      newPic.src = searchQuery.url;
      newPic.classList.add('center');
      styleString = `${styleString} width: ${searchQuery.width}px; height: ${searchQuery.height}px;`;
    }
    if (searchQuery.width) {
      newPic.width = searchQuery.width;
    }
    if (searchQuery.height) {
      newPic.height = searchQuery.height;
    }
    if (searchQuery.channel) {
      newPic.alt = translate('preview_channel_image', translate(searchQuery.channel));
    }
    newPic.style.cssText = styleString;
    sectionEl.appendChild(newPic);
  }
});
