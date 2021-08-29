'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global BG, translate, License, MABPayment, settingsNotifier, localizePage */

(function onThemesLoaded() {
  const updateThemeSettings = ($newTheme) => {
    const key = $newTheme.data('key');
    const newTheme = $newTheme.data('theme');
    // get local copy of the Color Themes object
    const colorThemes = JSON.parse(JSON.stringify(BG.getSettings().color_themes));

    colorThemes[key] = newTheme;
    BG.setSetting('color_themes', colorThemes);
    window.location.reload();
  };

  const updateSelection = (changeEvent) => {
    if (!changeEvent || $.isEmptyObject(changeEvent)) {
      return;
    }
    const $selectedTheme = $(changeEvent.target).closest('.theme-box');
    if ($selectedTheme.closest('.theme-wrapper').hasClass('locked')) {
      BG.openTab(License.MAB_CONFIG.payURL);
      return;
    }
    const $otherThemes = $selectedTheme.closest('section').find('.theme-box').not($selectedTheme);

    $otherThemes.removeClass('selected');
    $selectedTheme.addClass('selected');

    updateThemeSettings($selectedTheme);
  };

  const selectCurrentThemes = (currentThemes) => {
    const popupMenuTheme = BG.isValidTheme(currentThemes.popup_menu) ? currentThemes.popup_menu : 'default_theme';
    const optionsPageTheme = BG.isValidTheme(currentThemes.options_page) ? currentThemes.options_page : 'default_theme';

    // reset selected theme
    $('.popup-menu-themes .selected').removeClass('selected');
    $('.options-page-themes .selected').removeClass('selected');

    // Get theme nodes to select
    const $popupTheme = $(`.popup-menu-themes [data-theme=${popupMenuTheme}]`);
    const $optionsTheme = $(`.options-page-themes [data-theme=${optionsPageTheme}]`);
    const $popupInput = $popupTheme.find('input[name=popup-menu-theme]');
    const $optionsInput = $optionsTheme.find('input[name=options-page-theme]');

    // Select theme nodes
    $popupTheme.addClass('selected');
    $optionsTheme.addClass('selected');
    $popupInput.prop('checked', true);
    $optionsInput.prop('checked', true);
  };

  const showHoveredPopupThemePreview = ($themeBox) => {
    const hoveredTheme = $themeBox.data('theme');

    $('.popup-menu-theme-title').text(translate(`${hoveredTheme}`));
    $('.popup-menu-theme-preview').attr('src', `icons/${hoveredTheme}/previewcard.svg`);
    $('.popup-menu-theme-preview').attr('alt', translate('a_theme_preview', translate(`${hoveredTheme}`), translate('popup_menu')));
  };

  const showSelectedPopupThemePreview = () => {
    const popupMenuTheme = $('.popup-menu-themes .selected').data('theme');

    $('.popup-menu-theme-title').text(translate(`${popupMenuTheme}`));
    $('.popup-menu-theme-preview').attr('src', `icons/${popupMenuTheme}/previewcard.svg`);
    $('.popup-menu-theme-preview').attr('alt', translate('a_theme_preview', translate(`${popupMenuTheme}`), translate('popup_menu')));
  };

  const showHoveredOptionsThemePreview = ($themeBox) => {
    const hoveredTheme = $themeBox.data('theme');

    $('.options-page-theme-title').text(translate(`${hoveredTheme}`));
    $('.options-page-theme-preview').attr('src', `icons/${hoveredTheme}/optionscard.svg`);
    $('.options-page-theme-preview').attr('alt', translate('a_theme_preview', translate(`${hoveredTheme}`), translate('options_page')));
  };

  const showSelectedOptionsThemePreview = () => {
    const optionsPageTheme = $('.options-page-themes .selected').data('theme');

    $('.options-page-theme-title').text(translate(`${optionsPageTheme}`));
    $('.options-page-theme-preview').attr('src', `icons/${optionsPageTheme}/optionscard.svg`);
    $('.options-page-theme-preview').attr('alt', translate('a_theme_preview', translate(`${optionsPageTheme}`), translate('options_page')));
  };

  const showShadowOnLockedHover = ($themeBox) => {
    if ($themeBox.parent().hasClass('locked')) {
      $('#get-it-now-themes').addClass('shadow');
    }
  };

  const hideShadowNoHover = () => {
    $('#get-it-now-themes').removeClass('shadow');
  };

  const documentEventsHandling = () => {
    // Hover events
    $('.popup-menu-themes .theme-box:not(.selected)')
      .on('mouseenter', function handleIn() {
        showHoveredPopupThemePreview($(this));
        showShadowOnLockedHover($(this));
      })
      // eslint-disable-next-line prefer-arrow-callback
      .on('mouseleave', function handleOut() {
        showSelectedPopupThemePreview();
        hideShadowNoHover();
      });

    $('.options-page-themes .theme-box:not(.selected)')
      .on('mouseenter', function handleIn() {
        showHoveredOptionsThemePreview($(this));
        showShadowOnLockedHover($(this));
      })
      // eslint-disable-next-line prefer-arrow-callback
      .on('mouseleave', function handleOut() {
        showSelectedOptionsThemePreview();
        hideShadowNoHover();
      });

    // Change events
    $('input.invisible-radio-button').on('change', event => updateSelection(event));
  };

  $(() => {
    let colorThemes = {};
    if (BG && BG.getSettings()) {
      colorThemes = BG.getSettings().color_themes;
    }
    $('.theme-wrapper:not(.locked) .overlay-icon').each(function i18nSupport() {
      const $preview = $(this);
      const theme = $preview.closest('.theme-box').data('theme');
      const component = $preview.closest('.theme-box').data('key');
      $preview.attr('aria-label', translate('preview_a_theme', [
        translate(`${theme}`),
        translate(`${component}`),
      ]));
    });
    selectCurrentThemes(colorThemes);
    showSelectedOptionsThemePreview();
    showSelectedPopupThemePreview();

    if (!License || $.isEmptyObject(License) || !MABPayment) {
      return;
    }

    const payInfo = MABPayment.initialize('themes');
    if (License.shouldShowMyAdBlockEnrollment()) {
      MABPayment.freeUserLogic(payInfo);
    } else if (License.isActiveLicense()) {
      MABPayment.paidUserLogic(payInfo);
    }

    documentEventsHandling();
  });

  const onSettingsChanged = function (name, currentValue) {
    if (name === 'color_themes') {
      selectCurrentThemes(currentValue);
    }
  };

  settingsNotifier.on('settings.changed', onSettingsChanged);

  window.addEventListener('unload', () => {
    settingsNotifier.off('settings.changed', onSettingsChanged);
  });
}());
