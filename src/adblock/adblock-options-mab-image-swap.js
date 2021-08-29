'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global BG, channelsNotifier, License, localizePage, MABPayment,
   browser, DOMPurify, base64toBlob, info, customImageSwapMimeType
 */

// Althought 'webp' is a preferred for Custom Image Swap
// because it is generally a smaller, more efficient image format,
// Firefox doesn't like working with 'webp' as much as 'png' in Blobs and Data URLs.
let customImageSwapImageFormat = 'webp';
if (info.application === 'gecko') {
  customImageSwapImageFormat = 'png';
}

(function onImageSwapLoaded() {
  const { channels, setSetting } = BG;
  const customChannel = channels.channelGuide[channels.getIdByName('CustomChannel')].channel;
  let deleteFileURL = '';
  let errorData = {};

  function generateItemImageHTML(width, height) {
    return `<li class="custom-channel-box thumbnail" >
      <img></img>
      <div class="thumbnailOverlay">
        <div>${width}x${height}
        </div>
      </div>
      <i
        class="custom-delete-icon material-icons circle-icon-bg-24 selected-icon"
        role="img"
        i18n-aria-label="delete"
        >close</i
      >
      </li>`;
  }


  // Create a thumbnail / preview image of custom images
  // the user imports
  // Since there are multiple sizes for the Custom Image Swap
  // the original images are scaled down to fit in the thumbnail default size of 140x135
  // Some cropping of images is expected, typically on the left / right side of image
  //
  // There are a few steps to creating a thumbnail
  //   1) using the original sized base64 encoded string of the image, create a blob
  //   2) using a temporary image, that is part of the DOM, set its source attribute
  //      to the Blob
  //   3) When the temp image has loaded the Blob, use the image demensions to calculate
  //      the a ratio to be used during the resize
  //   4) using a temporary canvas, that is part of the DOM, draw the resized image on the canvas
  //   5) create a new Blob from that canvas, and use it to add an image to DOM
  //      that the user will see
  function generatePreviewThumbnail(base64EncodedData, listingURL) {
    const tempCanvas = document.getElementById('thumbnail-image-swap-canvas');
    const ctx = tempCanvas.getContext('2d');

    const tempImage = document.getElementById('thumbnail-image-swap-image');
    const tempImageClone = tempImage.cloneNode();
    tempImage.parentNode.insertBefore(tempImageClone, tempImage.nextSibling);
    tempCanvas.width = '140';
    tempCanvas.height = '135';

    const imageLoadFN = function () {
      tempImageClone.removeEventListener('load', imageLoadFN);
      URL.revokeObjectURL(this.src);
      // center the image in the thumbnail
      // and determine how much to trim off the right / left edges
      const { width } = tempImageClone;
      const { height } = tempImageClone;
      const ratio = tempCanvas.height / tempImageClone.height;
      const centerShiftX = (tempCanvas.width - width * ratio) / 2;
      const centerShiftY = (tempCanvas.height - height * ratio) / 2;
      ctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
      ctx.drawImage(tempImageClone, 0, 0, tempImageClone.width,
        tempImageClone.height, centerShiftX, centerShiftY,
        tempImageClone.width * ratio, tempImageClone.height * ratio);
      tempCanvas.toBlob((blobData) => {
        const thumbNailBLOBURL = URL.createObjectURL(blobData, { type: customImageSwapMimeType });
        const newItemHTML = generateItemImageHTML(width, height);
        const newItem = $(DOMPurify.sanitize(newItemHTML, { SAFE_FOR_JQUERY: true }));
        newItem.find('img').attr('src', thumbNailBLOBURL);
        newItem.find('img').on('load', () => {
          URL.revokeObjectURL(thumbNailBLOBURL);
          tempImageClone.parentNode.removeChild(tempImageClone);
        });
        newItem.attr('data-listingURL', listingURL);
        newItem.find('i.custom-delete-icon').on('click', () => {
          deleteFileURL = listingURL;
          $('#swap-edit-overlay').css({
            display: 'block',
          });
          $('#swap-delete-overlay-page').fadeIn();
        });
        newItem.appendTo('#custom-channel-options');
      }, customImageSwapMimeType, 1); // end of .toBlob()
    };// end of imageLoadFN
    tempImageClone.addEventListener('load', imageLoadFN);

    const blobData = base64toBlob(base64EncodedData);
    const dataURL = URL.createObjectURL(blobData, { type: customImageSwapMimeType });
    tempImageClone.src = dataURL;
  }

  const updateAddImageIcon = function () {
    if (customChannel.isMaximumAllowedImages()) {
      $('#custom-images').prop('disabled', true);
      $('#custom-channel-options li:first-child').removeClass('custom-channel-upload-enabled');
      $('#custom-channel-options li:first-child').addClass('custom-channel-upload-disabled');
      $('#upload_content_icon').addClass('upload-icon-disabled');
      $('#upload_content_icon').removeClass('upload-icon-enabled');
      $('#custom-channel-options li:first-child label').addClass('upload-icon-disabled');
      $('#custom-channel-options li:first-child label').removeClass('upload-icon-enabled');
    } else {
      $('#custom-images').prop('disabled', false);
      $('#custom-channel-options li:first-child').addClass('custom-channel-upload-enabled');
      $('#custom-channel-options li:first-child').removeClass('custom-channel-upload-disabled');
      $('#upload_content_icon').addClass('upload-icon-enabled');
      $('#upload_content_icon').removeClass('upload-icon-disabled');
      $('#custom-channel-options li:first-child label').removeClass('upload-icon-disabled');
      $('#custom-channel-options li:first-child label').addClass('upload-icon-enabled');
    }
  };

  const updateCustomChannelBox = function () {
    if (channels.isCustomChannelEnabled()) {
      $('#custom-image-upload-section').fadeIn();
      $('#favorite_icon').text('favorite');
      $('#custom-channel-box').removeClass('custom-channel-disable');
      $('#custom-channel-box').addClass('custom-channel-enable');
      $('#favorite_icon').removeClass('favorite_icon_disable');
      $('#favorite_icon').addClass('favorite_icon_enable');
    } else {
      $('#custom-image-upload-section').fadeOut();
      $('#favorite_icon').text('favorite_border');
      $('#custom-channel-box').removeClass('custom-channel-enable');
      $('#custom-channel-box').addClass('custom-channel-disable');
      $('#favorite_icon').removeClass('favorite_icon_enable');
      $('#favorite_icon').addClass('favorite_icon_disable');
    }
    updateAddImageIcon();
  };

  const updateChannelBoxes = function () {
    const $catsBox = $('#cats');
    const $dogsBox = $('#dogs');
    const $landscapesBox = $('#landscapes');
    const $goatsBox = $('#goats');
    const $oceanBox = $('#ocean');
    const $foodBox = $('#food');
    const $birdBox = $('#bird');
    const catsImageSrc = $catsBox.parent('.channel-box').hasClass('selected') ? 'icons/adblock-picreplacement-images-cat.png' : 'icons/adblock-picreplacement-images-cat-grayscale.png';
    const dogsImageSrc = $dogsBox.parent('.channel-box').hasClass('selected') ? 'icons/adblock-picreplacement-images-dog.png' : 'icons/adblock-picreplacement-images-dog-grayscale.png';
    const landscapesImageSrc = $landscapesBox.parent('.channel-box').hasClass('selected') ? 'icons/adblock-picreplacement-images-landscape.png' : 'icons/adblock-picreplacement-images-landscape-grayscale.png';
    const goatsImageSrc = $goatsBox.parent('.channel-box').hasClass('selected') ? 'icons/adblock-picreplacement-images-goat.png' : 'icons/adblock-picreplacement-images-goat-grayscale.png';
    const oceanImageSrc = $oceanBox.parent('.channel-box').hasClass('selected') ? 'icons/adblock-picreplacement-images-ocean.png' : 'icons/adblock-picreplacement-images-ocean-grayscale.png';
    const foodImageSrc = $foodBox.parent('.channel-box').hasClass('selected') ? 'icons/adblock-picreplacement-images-food.png' : 'icons/adblock-picreplacement-images-food-grayscale.png';
    const birdImageSrc = $birdBox.parent('.channel-box').hasClass('selected') ? 'icons/adblock-picreplacement-images-bird.png' : 'icons/adblock-picreplacement-images-bird-grayscale.png';

    $catsBox.attr('src', catsImageSrc);
    $dogsBox.attr('src', dogsImageSrc);
    $landscapesBox.attr('src', landscapesImageSrc);
    $goatsBox.attr('src', goatsImageSrc);
    $oceanBox.attr('src', oceanImageSrc);
    $foodBox.attr('src', foodImageSrc);
    $birdBox.attr('src', birdImageSrc);
    updateCustomChannelBox();
  };

  const loadCurrentSettingsIntoPage = function () {
    const guide = channels.getGuide();
    const $stopFeatureInput = $('input#no-channel');
    let atLeastOneSelected = false;

    for (const id in guide) {
      const $channelInput = $(`#${guide[id].name}`);
      const isEnabled = guide[id].enabled;
      $channelInput.prop('checked', isEnabled);
      $channelInput.data('channel-id', id);
      if (isEnabled) {
        atLeastOneSelected = true;
        $channelInput.parent('.channel-box').addClass('selected');
      } else {
        $channelInput.parent('.channel-box').removeClass('selected');
      }
    }

    if (atLeastOneSelected) {
      setSetting('picreplacement', true);
      $stopFeatureInput.prop('checked', false);
      $stopFeatureInput.parent('.channel-box').removeClass('selected');
    } else {
      setSetting('picreplacement', false);
      $stopFeatureInput.prop('checked', true);
      $stopFeatureInput.parent('.channel-box').addClass('selected');
    }
    updateChannelBoxes();
  };

  const updateChannelSelection = function (event) {
    const $eventTarget = $(event.target);
    const channelId = $eventTarget.data('channel-id');
    const enabled = $eventTarget.is(':checked');

    if (!channelId) {
      return;
    }

    if (channelId === 'none') {
      channels.disableAllChannels();
    } else {
      channels.setEnabled(channelId, enabled);
    }
    loadCurrentSettingsIntoPage();
  };

  const freeUserSetup = function () {
    $('input.invisible-overlay').prop('hidden', true);
    $('.channel-box > a[id^=get-it-now]').closest('li').addClass('locked');
    $('.channel-box').first().closest('li').addClass('selected');
    updateChannelBoxes();
    $('.locked > a[id^=get-it-now]').each((i, linkWithoutUserId) => {
      const link = linkWithoutUserId;
      link.href = License.MAB_CONFIG.payURL;
    });

    // Events
    $('.locked > a[id^=get-it-now]')
      .on('mouseenter', () => $('#get-it-now-image-swap').addClass('shadow'))
      .on('mouseleave', () => $('#get-it-now-image-swap').removeClass('shadow'));
  };

  const showCroppie = function (selectedSizeElement) {
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    let sizeReducer = 1.0;
    if (vw <= 720) {
      sizeReducer = 0.87;
    }
    const width = $(selectedSizeElement).data('viewport-width');
    const height = $(selectedSizeElement).data('viewport-height');
    $('#image-swap-custom-image-upload').croppie({
      viewport: {
        width: width * sizeReducer,
        height: height * sizeReducer,
        type: 'square',
      },
      boundary: {
        width: 547 * sizeReducer,
        height: 300 * sizeReducer,
      },
      useCanvas: false,
    });
  };

  const destroyCroppie = function () {
    $('#image-swap-custom-image-upload').croppie('destroy');
    $('#image-swap-custom-image-upload').empty();
    $('#image-swap-custom-image-upload').append(DOMPurify.sanitize('<img id="image-swap-custom-image-upload" />', { SAFE_FOR_JQUERY: true }));
  };

  const customImagesSelected = () => {
    if (customChannel.isMaximumAllowedImages()) {
      return;
    }

    const imageFiles = document.getElementById('custom-images').files;
    const imageFile = imageFiles.item(0);
    if (['image/svg+xml', 'image/tiff', 'image/png', 'image/webp', 'image/jpeg', 'image/bmp', 'image/gif'].includes(imageFile.type)) {
      const reader = new FileReader();
      reader.onload = function readerOnLoadFN() {
        const crImage = document.getElementById('image-swap-custom-image-upload');
        const dataURL = URL.createObjectURL(new Blob([reader.result], { type: imageFile.type }));
        $('#swap-edit-overlay').css({
          display: 'block',
        });

        crImage.onload = function imageLoadFN() {
          showCroppie($('#sample-size-small'));
          $('.image-swap-sample-selected').removeClass('image-swap-sample-selected').addClass('image-swap-sample');
          $('#sample-size-small').removeClass('image-swap-sample').addClass('image-swap-sample-selected');
          $('#swap-edit-overlay-page').fadeIn(() => {
            $('#image-swap-custom-image-upload').croppie('bind');
          });
        };
        crImage.src = dataURL;
        $('#image-swap-custom-image-upload').data('file-name', imageFile.name);
      };
      reader.readAsArrayBuffer(imageFile);
    } else {
      $('#swap-edit-overlay').css({
        display: 'block',
      });
      $('#swap-unsupported-overlay-page').removeClass('inactive');
    }
  };

  const paidUserSetup = function () {
    $('input.invisible-overlay').removeAttr('hidden');
    $('.channel-box > a[id^=get-it-now]').prop('hidden', true);
    $('.channel-box').removeClass('locked');

    // Events
    $('input.invisible-overlay').on('change', updateChannelSelection);
  };

  const initCustomThumbnails = function () {
    // show any current custom images as thumbnails
    const metaData = customChannel.getListings();
    for (let inx = 0; inx < metaData.length; inx++) {
      const listing = metaData[inx];
      if (listing && listing.url) {
        browser.storage.local.get(listing.url).then((savedImage) => {
          if (
            savedImage[listing.url]
              && savedImage[listing.url].src
          ) {
            generatePreviewThumbnail(savedImage[listing.url].src, listing.url);
          } else {
            customChannel.removeListingByURL(listing.url);
          }
        });
      }
    }
  };

  $(() => {
    localizePage();

    if (!License || $.isEmptyObject(License)) {
      return;
    }

    const payInfo = MABPayment.initialize('image-swap');
    if (License.shouldShowMyAdBlockEnrollment()) {
      MABPayment.freeUserLogic(payInfo);
      freeUserSetup();
    } else if (License.isActiveLicense()) {
      MABPayment.paidUserLogic(payInfo);
      paidUserSetup();
      loadCurrentSettingsIntoPage();
      initCustomThumbnails();
    }

    const onChannelsChanged = function (id, currentValue, previousValue) {
      const guide = BG.channels.getGuide();
      const $channelInput = $(`#${guide[id].name}`);
      if ($channelInput.is(':checked') === previousValue) {
        $channelInput.trigger('click');
      }
    };

    window.addEventListener('unload', () => {
      channelsNotifier.off('channels.changed', onChannelsChanged);
    });

    channelsNotifier.on('channels.changed', onChannelsChanged);
  });

  // click handlers
  //
  $('#image-swap-custom-sizes div').on('click', function imageSizeSelectorClicked() {
    $('.image-swap-sample-selected').removeClass('image-swap-sample-selected').addClass('image-swap-sample');
    $(this).removeClass('image-swap-sample').addClass('image-swap-sample-selected');

    $('#image-swap-custom-image-upload').croppie('destroy');
    $('#image-swap-custom-image-upload').empty();
    $('#image-swap-custom-image-upload').append(DOMPurify.sanitize('<img id="image-swap-custom-image-upload" />', { SAFE_FOR_JQUERY: true }));
    showCroppie($(this));
  });

  $('#custom-images').on('change', customImagesSelected);

  $('#swap-edit-overlay-close-icon-page').on('click', () => {
    $('#swap-edit-overlay-page').fadeOut(() => {
      $('#swap-edit-overlay').css({
        display: 'none',
      });
      destroyCroppie();
    });
    $('#custom-images').prop('value', '');
    const crImage = document.getElementById('image-swap-custom-image-upload');
    URL.revokeObjectURL(crImage.src);
  });


  $('#btnDoneEditAdd').on('click', () => {
    $('#btnDoneEditAdd').prop('disabled', true);
    const width = $('.image-swap-sample-selected').data('image-width');
    const height = $('.image-swap-sample-selected').data('image-height');
    $('#image-swap-custom-image-upload').croppie('result', {
      type: 'base64',
      format: customImageSwapImageFormat,
      circle: false,
      size: { width, height },
      quality: 1,
    }).then((base64Str) => {
      const imageFileName = $('#image-swap-custom-image-upload').data('file-name');
      $('#image-swap-custom-image-upload').removeData('file-name');
      customChannel.addCustomImage({
        width,
        height,
        name: imageFileName,
        imageAsBase64: base64Str,
      }).then((listingURL) => {
        generatePreviewThumbnail(base64Str, listingURL);
        $('#swap-edit-overlay-page').fadeOut(() => {
          $('#swap-edit-overlay').css({
            display: 'none',
          });
          destroyCroppie();
        });
        $('#custom-images').prop('value', '');
        $('#btnDoneEditAdd').prop('disabled', false);
        updateAddImageIcon();
      })
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.log('error', error);
          errorData = error;
          $('#custom-images').prop('value', '');
          $('#swap-edit-overlay-page').fadeOut(() => {
            destroyCroppie();
          });
          $('#btnDoneEditAdd').prop('disabled', false);
          const crImage = document.getElementById('image-swap-custom-image-upload');
          URL.revokeObjectURL(crImage.src);
          $('#swap-error-overlay-page').removeClass('inactive');
        });
    });
  });

  $('#btnSwapDelete').on('click', () => {
    if (deleteFileURL) {
      customChannel.removeListingByURL(deleteFileURL).then(() => {
        $(`li[data-listingURL="${deleteFileURL}"]`).remove();
        deleteFileURL = '';
        $('#swap-edit-overlay').css({
          display: 'none',
        });
        $('#swap-delete-overlay-page').fadeOut();
        updateAddImageIcon();
      });
    }
  });

  $('#btnSwapCancelDelete, #swap-delete-overlay-close-icon-page').on('click', () => {
    deleteFileURL = '';
    $('#swap-edit-overlay').css({
      display: 'none',
    });
    $('#swap-delete-overlay-page').fadeOut();
  });

  $('#btnDontSend, #swap-error-overlay-close-icon-page').on('click', () => {
    $('#swap-edit-overlay').css({
      display: 'none',
    });
    $('#swap-error-overlay-page').addClass('inactive');
  });

  $('#btnSendDebug').on('click', () => {
    if (errorData
      && BG
      && typeof BG.getDebugInfo === 'function'
      && typeof BG.recordAnonymousErrorMessage === 'function') {
      BG.getDebugInfo((debugData) => {
        BG.recordAnonymousErrorMessage('custom_image_swap_error', null, JSON.stringify({ debugData, errorData }));
      });
    }
    $('#swap-edit-overlay').css({
      display: 'none',
    });
    $('#swap-error-overlay-page').addClass('inactive');
  });

  $('#btnUnsupportedOK, #swap-unsupported-overlay-close-icon-page').on('click', () => {
    $('#swap-edit-overlay').css({
      display: 'none',
    });
    $('#swap-unsupported-overlay-page').addClass('inactive');
  });
}());
