'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, translate, onReady, imageSizesMap,
   base64toBlob  */

const { hostname } = window.location;
let totalSwaps = 0;
const hideElements = [];
const hiddenElements = [];
let cssRules = [];
const minDimension = 60;
const CUSTOM_IMAGES_KEY = 'customImages';

const typeMap = new Map([
  ['img', 'IMAGE'],
  ['input', 'IMAGE'],
  ['picture', 'IMAGE'],
  ['audio', 'MEDIA'],
  ['video', 'MEDIA'],
  ['frame', 'SUBDOCUMENT'],
  ['iframe', 'SUBDOCUMENT'],
  ['object', 'OBJECT'],
  ['embed', 'OBJECT'],
]);

browser.runtime.sendMessage({ type: 'getSelectors' }).then((response) => {
  if (response && response.selectors) {
    cssRules = response.selectors;
  }
});

const imageSwap = {
  /**
  * @param {Object} data Information about the element
  *   @param {Node} data.el
  *   @param {Boolean} [data.blocked]
  *   @param {Object} [data.size]
  *   @param {Number} [data.dimension]
  *   @param {CSSStyleDeclaration} [data.computedStyle]
  * @param {Function} callback Called when replacement was done
  * */
  replaceSection(data, callback) {
    const { el } = data;
    // We may have already replaced this section...
    if (el.getAttribute('picreplacementreplaced')) {
      return;
    }
    el.setAttribute('picreplacementreplaced', true);

    if (data.blocked) {
      const size = this.getStyle(data, 'backgroundPosition').match(/^(\w+) (\w+)$/);
      if (size) {
        // Restore el.width & el.height to whatever they were before AdBlock.
        const dims = { width: size[1], height: size[2] };
        for (const dim in dims) {
          if (dims[dim] === '-1px') {
            el.removeAttribute(dim);
          } else {
            el.setAttribute(dim, dims[dim]);
          }
        }
      }
    }

    const oldCssText = el.style.cssText;
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('display', 'block', 'important');

    this.replace(data, callback);

    el.style.cssText = oldCssText; // Re-hide the section
  },

  // Given details about a picture and a target rectangle, return details
  // about how to place the picture in the target.
  //
  // pic object contains
  //   x - width
  //   y - height
  //   left - max crop allowed from left
  //   right - max crop allowed from right
  //   top - max crop allowed from top
  //   bot - max crop allowed from bottom
  //
  // target object contains
  //   x - width
  //   y - height
  //
  // result object contains
  //   x - width of background image to use (before crop)
  //   y - height of background image to use (before crop)
  //   top  - amount to offset top of photo in target to cause a vertical crop
  //   left - amount to offset left of photo in target to cause a horizontal crop
  //   width - width of visible area of result image
  //   height - height of visible area of result image
  //   offsettop  - amount to pad with blank space above picture
  //   offsetleft - amount to pad with blank space to left of picture
  //                These are used to center a picture in a tall or wide target
  fit(pic, target) {
    const p = pic;
    const t = target;
    // Step 0: if t.ratio > p.ratio, rotate |p| and |t| about their NW<->SE axes.
    if (!p.x) {
      p.x = p.width;
    }
    if (!p.y) {
      p.y = p.height;
    }
    if (!t.x) {
      t.x = t.width;
    }
    if (!t.y) {
      t.y = t.height;
    }
    if (!p.left) {
      p.left = 0;
    }
    if (!p.right) {
      p.right = 0;
    }
    if (!t.left) {
      t.left = 0;
    }
    if (!t.right) {
      t.right = 0;
    }
    // Our math in Step 1 and beyond relies on |t| being skinner than |p|.  We
    // rotate |t| and |p| about their NW<->SE axis if needed to make that true.
    const tRatio = t.x / t.y;
    const pRatio = p.x / p.y;

    if (tRatio > pRatio) {
      const { rotate } = this;
      rotate(pic);
      rotate(target);
      const result = this.fit(pic, target);
      rotate(pic);
      rotate(target);
      rotate(result);
      return result;
    }

    // |t| is skinnier than |p|, so we need to crop the picture horizontally.
    // Step 1: Calculate |cropX|: total horizontal crop needed.
    const cropMax = Math.max(p.left + p.right, 0.001);
    // Crop as much as we must, but not past the max allowed crop.
    const cropX = Math.min(p.x - p.y * tRatio, cropMax);

    // Step 2: Calculate how much of that crop should be done on the left side
    // of the picture versus the right.

    // We will execute the crop by giving a background-image a CSS left offset,
    // so we only have to calculate the left crop and the right crop will happen
    // naturally due to the size of the target area not fitting the entire image.

    const cropLeft = p.left * (cropX / cropMax);

    // Step 3: Calculate how much we must scale up or down the original picture.

    const scale = t.x / (p.x - cropX);

    // Scale the original picture and crop amounts in order to determine the width
    // and height of the visible display area, the x and y dimensions of the image
    // to display in it, and the crop amount to offset the image.  The end result
    // is an image positioned to show the correct pixels in the target area.

    const result = {};
    result.x = Math.round(p.x * scale);
    result.y = Math.round(p.y * scale);
    result.left = Math.round(cropLeft * scale);
    result.width = Math.round(t.x);
    result.height = Math.round(result.y);

    // Step 4: Add vertical padding if we weren't allowed to crop as much as we
    // liked, resulting in an image not tall enough to fill the target.
    result.offsettop = Math.round((t.y - result.height) / 2);

    // Done!
    result.top = 0;
    result.offsetleft = 0;
    return result;
  },

  // Rotate a picture/target about its NW<->SE axis.
  rotate(objectToRotate) {
    const o = objectToRotate;
    const pairs = [['x', 'y'], ['top', 'left'], ['bot', 'right'],
      ['offsettop', 'offsetleft'], ['width', 'height']];
    pairs.forEach((pair) => {
      const [a, b] = pair;
      let tmp;
      if (o[a] || o[b]) {
        tmp = o[b]; o[b] = o[a]; o[a] = tmp; // swap
      }
    });
  },

  dim(data, prop) {
    function intFor(val) {
      // Match two or more digits; treat < 10 as missing.  This lets us set
      // dims that look good for e.g. 1px tall ad holders (cnn.com footer.)
      const match = (val || '').match(/^([1-9][0-9]+)(px)?$/);
      if (!match) {
        return undefined;
      }
      return parseInt(match[1], 10);
    }
    return intFor(imageSwap.getStyle(data, prop));
  },

  parentDim(data, prop) {
    let { el } = data;
    if (hostname === 'www.facebook.com') {
      return undefined;
    }
    let result;
    while (!result && el.parentNode) {
      const parentData = { el: el.parentNode };
      result = this.dim(parentData, prop);
      el = el.parentNode;
    }
    return result;
  },

  getSize(data) {
    const { el } = data;
    let t = {
      x: this.dim(data, 'width'),
      y: this.dim(data, 'height'),
      position: this.getStyle(data, 'position'),
    };

    if (!t.x && !t.y && !typeMap.get(el.localName) && el.hasChildNodes()) {
      // Since we're now injecting a 'user' stylesheet to hide elements, temporarily
      // setting the display to block to unhide the element will not work, so..
      // attempt to determine the size of one of children
      for (let i = 0; i < el.children.length; i++) {
        const nextChildData = { el: el.children[i] };
        t = imageSwap.getSize(nextChildData);
        if (t.x && t.y) {
          break;
        }
      }
    }

    // Make it rectangular if ratio is appropriate, or if we only know one dim
    // and it's so big that the 180k pixel max will force the pic to be skinny.
    if (t.x && !t.y && t.x > 400) {
      t.type = imageSizesMap.get('wide');
    } else if (t.y && !t.x && t.y > 400) {
      t.type = imageSizesMap.get('tall');
    } else if ( // false unless (t.x && t.y)
      (Math.max(t.x, t.y) / Math.min(t.x, t.y) >= 1.5)
      && (Math.max(t.x, t.y) / Math.min(t.x, t.y) < 7)
    ) {
      t.type = (t.x > t.y ? imageSizesMap.get('wide') : imageSizesMap.get('tall'));
    } else if (Math.max(t.x, t.y) / Math.min(t.x, t.y) > 7) { // false unless (t.x && t.y)
      t.type = (t.x > t.y ? imageSizesMap.get('skinnywide') : imageSizesMap.get('skinnytall'));
    }

    if (!t.type) { // we didn't choose wide/tall
      t.type = ((t.x || t.y) > 125 ? imageSizesMap.get('big') : imageSizesMap.get('small'));
    }

    return t;
  },

  // Returns placement details to replace |el|, or null
  // if we do not have enough info to replace |el|.
  placementFor(data, callback) {
    let t;
    const { el } = data;
    const that = this;

    // if there's previously calculate size, use it
    if (data.size != null && Object.keys(data.size).length) {
      t = data.size;
    } else {
      t = this.getSize(data);
      if (this.isInvalidSize(t)) {
        callback(false);
        return false;
      }
    }

    // Let's not go ahead if the parent element of |el| has display none
    const parent = el.parentNode;
    if (!(parent.offsetWidth || parent.offsetHeight || parent.getClientRects().length)) {
      callback(false);
      return false;
    }

    browser.runtime.sendMessage({
      message: 'get_random_listing',
      opts: {
        width: t.x, height: t.y, type: t.type, position: t.position,
      },
    }).then((picture) => {
      const pic = picture;
      if (!pic || pic.disabledOnPage) {
        callback(false);
        return false;
      }
      if (typeof pic.height === 'string') {
        pic.height = Number(pic.height);
      }
      if (typeof pic.width === 'string') {
        pic.width = Number(pic.width);
      }

      // If we only have one dimension, we may choose to use the picture's ratio;
      // but don't go over 180k pixels (so e.g. 1000x__ doesn't insert a 1000x1000
      // picture (cnn.com)).  And if an ancestor has a size, don't exceed that.
      const max = 180000;
      if (t.x && !t.y) {
        const newY = Math.round(Math.min(pic.height * t.x / pic.width, max / t.x));
        const parentY = that.parentDim(data, 'height');
        t.y = (parentY ? Math.min(newY, parentY) : newY);
      }
      if (t.y && !t.x) {
        const newX = Math.round(Math.min(pic.width * t.y / pic.height, max / t.y));
        const parentX = that.parentDim(data, 'width');
        t.x = (parentX ? Math.min(newX, parentX) : newX);
      }

      const result = that.fit(pic, t);

      result.url = pic.url;
      result.attributionUrl = pic.attributionUrl;
      result.photoTitle = pic.title;
      result.infoUrl = pic.attributionUrl;
      result.type = t.type;
      result.t = t;
      result.listingHeight = pic.listingHeight;
      result.listingWidth = pic.listingWidth;
      result.channelName = pic.channelName;
      result.customImage = pic.customImage;
      callback(result);
      return true;
    });
    return undefined;
  },
  // Create a container with the new image and overlay
  // Return an object with the container and its children nodes
  createNewPicContainer(placement) {
    // Container, inherit some CSS from replaced element
    const imageSwapContainer = document.createElement('div');
    imageSwapContainer.id = `ab-image-swap-container-${new Date().getTime()}`;

    // Wrapper, necessary to set postition: relative
    const imageSwapWrapper = document.createElement('div');
    imageSwapWrapper.classList.add('ab-image-swap-wrapper');

    // New image
    let newPic;
    if (placement.customImage === true) {
      newPic = document.createElement('div');
      browser.storage.local.get(placement.url).then((savedCustomImageData) => {
        const base = newPic.attachShadow({ mode: 'closed' });
        // a closed shadow root is utilized to protect users images
        // from being accessed by websites where the images are injected
        const innerHTMLText = `:host {
                               content: url("${savedCustomImageData[placement.url].src}");
                             }`;
        const styleTag = document.createElement('style');
        styleTag.type = 'text/css';
        styleTag.textContent = innerHTMLText;
        base.appendChild(styleTag);
      });
    } else {
      newPic = document.createElement('img');
      newPic.src = placement.url;
      newPic.alt = translate('image_of_channel', translate(placement.channelName));
      newPic.setAttribute('referrerpolicy', 'no-referrer');
    }
    newPic.classList.add('picreplacement-image');

    // Overlay info card
    const infoCardOverlay = document.createElement('div');
    infoCardOverlay.classList.add('picinjection-infocard');

    const overlayLogo = document.createElement('img');
    overlayLogo.classList.add('ab-logo-header');
    overlayLogo.src = browser.runtime.getURL('icons/dark_theme/logo.svg');
    overlayLogo.alt = translate('adblock_logo');

    const overlayIcons = document.createElement('div');
    overlayIcons.classList.add('ab-icons-header');

    const seeIcon = document.createElement('i');
    seeIcon.innerText = 'remove_red_eye';
    seeIcon.classList.add('ab-material-icons');

    const settingsIcon = document.createElement('i');
    settingsIcon.innerText = 'settings';
    settingsIcon.classList.add('ab-material-icons');

    const closeIcon = document.createElement('i');
    closeIcon.innerText = 'close';
    closeIcon.classList.add('ab-material-icons');

    overlayIcons.appendChild(seeIcon);
    overlayIcons.appendChild(settingsIcon);
    overlayIcons.appendChild(closeIcon);
    infoCardOverlay.appendChild(overlayLogo);
    infoCardOverlay.appendChild(overlayIcons);
    imageSwapWrapper.appendChild(newPic);
    imageSwapWrapper.appendChild(infoCardOverlay);
    imageSwapContainer.appendChild(imageSwapWrapper);

    return {
      container: imageSwapContainer,
      imageWrapper: imageSwapWrapper,
      image: newPic,
      overlay: infoCardOverlay,
      logo: overlayLogo,
      icons: overlayIcons,
      closeIcon,
      settingsIcon,
      seeIcon,
    };
  },
  // Add a <style> tag into the host page's header to style all the HTML we use to replace the ad
  // including the container, the image, the overlay, the logo and the icons
  injectCSS(data, placement, containerID) {
    const adblockLogoWidth = placement.type === imageSizesMap.get('skinnywide') ? '81px' : '114px';
    const adblockLogoHeight = placement.type === imageSizesMap.get('skinnywide') ? '20px' : '29px';
    const materialIconsURL = browser.runtime.getURL('/icons/MaterialIcons-Regular.woff2');
    const styleTag = document.createElement('style');
    styleTag.type = 'text/css';
    styleTag.textContent = `
      div#${containerID} {
        position: ${this.getStyle(data, 'position')};
        width: fit-content;
        height: fit-content;
        font-family: 'Lato', Arial, sans-serif;
        line-height: normal;
        box-sizing: initial;
        top: ${this.getStyle(data, 'top')};
        left: ${this.getStyle(data, 'left')};
        right: ${this.getStyle(data, 'right')};
        bottom: ${this.getStyle(data, 'bottom')};
        /* nytimes.com float:right ad at top is on the left without this */
        float: ${this.getStyle(data, 'float')};
      }
      div#${containerID} > .ab-image-swap-wrapper {
        position: relative;
        display: inline-grid;
        grid-template-columns: 1fr;
        grid-template-rows: 1fr;
        grid-template-areas: 'overlap';
      }
      div#${containerID} > .ab-image-swap-wrapper > .picreplacement-image {
        width: ${placement.width}px;
        height: ${placement.height}px;
        background-position: -${placement.left}px -${placement.top}px;
        background-size: ${placement.x}px ${placement.y}px;
        margin: ${placement.offsettop}px ${placement.offsetleft}px;
        border: none; /* some sites borders all imgs */
        grid-area: overlap;
      }
      div#${containerID} > .ab-image-swap-wrapper > .picinjection-infocard {
        display: none;
        padding: 3px;
        position: absolute;
        min-width: ${placement.width}px;
        min-height: ${placement.height}px;
        box-sizing: border-box;
        border: 2px solid rgb(128, 128, 128);
        color: black;
        background-color: rgba(0, 0, 0, 0.7);
        margin: ${placement.offsettop}px ${placement.offsetleft}px;
        grid-area: overlap;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
      }
      div#${containerID} > .ab-image-swap-wrapper > .picinjection-infocard:hover,
      div#${containerID} > .ab-image-swap-wrapper > .picreplacement-image:hover ~ .picinjection-infocard {
        display: block;
      }
      div#${containerID} > .ab-image-swap-wrapper > .picinjection-infocard > .ab-logo-header {
        float: left;
        border: none; /* some sites borders all imgs */
        margin-top: 0;
        margin-left: 0;
        height: ${adblockLogoHeight};
        width: ${adblockLogoWidth};
      }
      div#${containerID} > .ab-image-swap-wrapper > .picinjection-infocard > .ab-icons-header {
        margin-top: 0px;
        margin-right: 0px;
        vertical-align: middle;
        line-height: ${adblockLogoHeight};
        height: ${adblockLogoHeight};
        float: right;
        display: inline;
      }
      div#${containerID} > .ab-image-swap-wrapper > .picinjection-infocard .ab-material-icons {
        color: #666666;
        margin-right: 8px;
      }
      div#${containerID} > .ab-image-swap-wrapper > .picinjection-infocard .ab-material-icons:hover {
        color: white;
      }
      div#${containerID} > .ab-image-swap-wrapper > .picinjection-infocard .ab-material-icons:last-child {
        margin-right: 0;
      }
      div#${containerID} > .ab-image-swap-wrapper .ab-material-icons {
        font-family: 'Material Icons';
        color: #999;
        cursor: pointer;
        font-weight: normal;
        font-style: normal;
        font-size: 24px;
        display: inline-block;
        line-height: 1;
        text-transform: none;
        letter-spacing: normal;
        word-wrap: normal;
        white-space: nowrap;
        direction: ltr;
        vertical-align: middle;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }
      @font-face {
        font-family: 'Material Icons';
        font-style: normal;
        font-weight: normal;
        src: local('Material Icons'), url(${materialIconsURL});
      }
    `;
    document.head.appendChild(styleTag);
  },
  setupEventHandlers(placement, containerNodes) {
    containerNodes.image.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }, false);
    containerNodes.image.addEventListener('error', () => {
      containerNodes.container.parentNode.removeChild(containerNodes.container);
      return false;
    }, false);
    containerNodes.image.addEventListener('abort', () => {
      containerNodes.container.parentNode.removeChild(containerNodes.container);
      return false;
    }, false);
    containerNodes.seeIcon.addEventListener('click', () => {
      const url = encodeURIComponent(placement.attributionUrl);
      const width = placement.listingWidth;
      const height = placement.listingHeight;
      const channel = placement.channelName;
      const queryStrings = `url=${url}&width=${width}&height=${height}&channel=${channel}`;
      browser.runtime.sendMessage({ command: 'openTab', urlToOpen: `adblock-picreplacement-imageview.html?${queryStrings}` });
    });
    containerNodes.settingsIcon.addEventListener('click', () => {
      browser.runtime.sendMessage({ command: 'openTab', urlToOpen: 'options.html#mab-image-swap' });
    });
    containerNodes.closeIcon.addEventListener('click', () => {
      containerNodes.container.parentNode.removeChild(containerNodes.container);
    });
  },
  // Given a target element, replace it with a picture.
  // Returns the replacement element if replacement works, or null if the target
  // element could not be replaced.
  replace(elementData, callback) {
    const that = this;
    const data = elementData;
    that.placementFor(data, (placement) => {
      if (!placement) {
        callback(false);
        return false; // don't know how to replace |data.el|
      }

      // We only want to replace 2 ads per page
      if (totalSwaps > 1) {
        callback(false);
        return false;
      }

      const containerNodes = that.createNewPicContainer(placement);
      that.injectCSS(data, placement, containerNodes.container.id);
      that.setupEventHandlers(placement, containerNodes);

      data.el.parentNode.insertBefore(containerNodes.container, data.el);

      // Force showing the image in case it was not showing
      containerNodes.image.style.display = 'inline-block';
      callback(true);
      return true;
    });
  },

  translate(key) {
    return browser.i18n.getMessage(key);
  },
  isInvalidSize(size) {
    return !size.x || !size.y || size.x < minDimension || size.y < minDimension;
  },
  // Check if an element is nested in any element in array
  // Return true if |el| is nested or a duplicate
  isNested(el, elements) {
    let isNestedElement = false;
    for (let j = 0; j < elements.length; j++) {
      const otherElement = elements[j].el;
      if (el !== otherElement && otherElement.contains(el)) {
        isNestedElement = true;
        break;
      }
    }
    return isNestedElement;
  },
  // Return property value of the given |data.el|
  getStyle(elementData, property) {
    const data = elementData;
    const alreadyComputed = data.computedStyle;
    if (alreadyComputed) {
      return alreadyComputed[property];
    }
    const inlineValue = data.el.style[property];
    if (inlineValue) {
      return inlineValue;
    }
    const attribute = data.el.getAttribute(property);
    if (attribute) {
      return attribute;
    }
    data.computedStyle = window.getComputedStyle(data.el);
    return data.computedStyle[property];
  },
  // Function called after an ad was replaced with an image
  done(replaced) {
    if (replaced) {
      // on some sites, such as freepik.com with absolute positioning,
      // the position of other elements is calculated before our pic replacement is injected.
      // a forced window resize event repaints the page to correctly lay it out
      totalSwaps += 1;
      window.dispatchEvent(new Event('resize'));
      browser.runtime.sendMessage({ message: 'recordOneAdReplaced' });
    }
  },
}; // end imageSwap

// hideElement may get call after the page has completed loading on certain sites that have infinite
// scroll for example. If the user is on on these infinite scroll sites, such as FB, then attempt
// to do a pic replacement
const checkElement = function (element) {
  const data = {
    el: element,
    blocked: !!typeMap.get(element.localName),
  };
  if (
    document.readyState === 'complete'
    || (window.top === window && hostname === 'www.facebook.com')
  ) {
    imageSwap.replaceSection(data, imageSwap.done);
  } else {
    hideElements.push(data);
  }
};


// a slightly faster alternative to just using 'querySelectorAll'
// Note: this function may return:
//       - an HTMLCOllection of elements,
//       - or a NodeList of elements
//       - or an Array with 1 element
const queryDOM = function (selectorText) {
  if (selectorText.startsWith('#')) {
    const element = document.getElementById(selectorText.substr(1));
    if (element) {
      return [element];
    }
    return [];
  }
  if (selectorText.startsWith('.')) {
    const classes = selectorText.substr(1).replace(/\./g, ' ');
    return document.getElementsByClassName(classes);
  }
  // Default to `querySelectorAll`
  return document.querySelectorAll(selectorText);
};

// when the page has completed loading:
// 1) get the currently loaded CSS hiding rules
// 2) find any hidden elements using the hiding rules from #1 that meet the
//    minimum dimensions required. if so, add them to an array
// 3) find any hidden elements that were captured from the hideElement() function that meet the
//    minimum dimensions required. if so, add them to an array
// 4) sort the array by size -- we want to replace the large elements first
// 5) process the sorted array, attempting to do a pic replacment for each element
onReady(() => {
  let elementsData = [];

  for (let i = 0; i < cssRules.length; i++) {
    const elements = queryDOM(cssRules[i]);
    for (let j = 0; j < elements.length; j++) {
      const data = { el: elements[j] };
      hiddenElements.push(data);
    }
  }

  // Add any elements from the collapsedElements array
  for (let i = 0; i < window.collapsedElements.length; i++) {
    const data = { el: window.collapsedElements[i] };
    hiddenElements.push(data);
  }

  // If no elements to swap, stop
  if (!hiddenElements.length && !hideElements.length) {
    return;
  }

  const allElements = hideElements.concat(hiddenElements);
  for (let i = 0; i < allElements.length; i++) {
    const data = allElements[i];
    const size = imageSwap.getSize(data);

    if (!imageSwap.isInvalidSize(size)) {
      data.size = size;
      data.dimension = (size.x * size.y);
      // Add element only if it is not nested in other
      // elements and it's not equal to other elements
      if (!imageSwap.isNested(data.el, allElements)) {
        elementsData.push(data);
      }
    }
  }

  // Put first elements of larger dimensions
  elementsData = elementsData.sort((a, b) => (b.dimension > a.dimension ? 1 : -1));
  for (let i = 0; i < elementsData.length; i++) {
    imageSwap.replaceSection(elementsData[i], imageSwap.done);
  }
});
