'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global browser, browser, getSettings, translate, determineUserLanguage */

const BG = browser.extension.getBackgroundPage();
let debugInfo;
let textDebugInfo = '';
let extInfo = '';

const bugReportLogic = function () {
  const $name = $('#name');
  const $email = $('#email');
  const $title = $('#summary');
  const $repro = $('#repro-steps');
  const $expect = $('#expected-result');
  const $actual = $('#actual-result');
  const $comments = $('#other-comments');

  const continueProcessing = function () {
    $('#debug-info').val(textDebugInfo);
    $('#step2-back').prop('disabled', false);
    $('#step_final_questions').fadeIn();

    // Auto-scroll to bottom of the page
    $('html, body').animate({
      scrollTop: 15000,
    }, 50);
    if ($('#rememberDetails').is(':checked')) {
      browser.storage.local.set({
        userName: $name.val(),
      });
      browser.storage.local.set({
        userEmail: $email.val(),
      });
    }
  };

  // Retrieve extension info
  const askUserToGatherExtensionInfo = function () {
    if (
      browser
      && browser.runtime.getManifest().optional_permissions
      && browser.runtime.getManifest().optional_permissions.includes('management')
      && browser.permissions
      && browser.permissions.request
    ) {
      browser.permissions.request({
        permissions: ['management'],
      }).then((granted) => {
        // The callback argument will be true if
        // the user granted the permissions.
        if (granted) {
          // since the management.getAll function is not available when the page is loaded
          // the function is not wrapped by the polyfil Promise wrapper
          // so we create, and load a temporary iFrame after the permission is granted
          // so the polyfil will correctly wrap the now available API
          const iframe = document.createElement('iframe');
          iframe.onload = () => {
            const proxy = iframe.contentWindow.browser;
            proxy.management.getAll().then((result) => {
              const tempExtInfo = [];
              for (let i = 0; i < result.length; i++) {
                tempExtInfo.push(`Number ${i + 1}`);
                tempExtInfo.push(`  name: ${result[i].name}`);
                tempExtInfo.push(`  id: ${result[i].id}`);
                tempExtInfo.push(`  version: ${result[i].version}`);
                tempExtInfo.push(`  enabled: ${result[i].enabled}`);
                tempExtInfo.push(`  type: ${result[i].type}`);
                tempExtInfo.push('');
              }
              extInfo = `\nExtensions:\n${tempExtInfo.join('\n')}`;
              browser.permissions.remove({ permissions: ['management'] });
              document.body.removeChild(iframe);
              continueProcessing();
            });
          };
          iframe.src = browser.runtime.getURL('proxy.html');
          iframe.style.visibility = 'hidden';
          document.body.appendChild(iframe);
        } else {
          // user didn't grant us permission
          extInfo = 'Permission not granted';
          continueProcessing();
        }
      }); // end of permission request
    } else {
      // not supported in this browser
      extInfo = 'no extension information';
      continueProcessing();
    }
  };

  // Get debug info
  BG.getDebugInfo((theDebugInfo) => {
    debugInfo = {};
    debugInfo.filterLists = JSON.stringify(theDebugInfo.subscriptions, null, '\t');
    debugInfo.otherInfo = JSON.stringify(theDebugInfo.otherInfo, null, '\t');
    debugInfo.customFilters = theDebugInfo.customFilters;
    debugInfo.settings = JSON.stringify(theDebugInfo.settings, null, '\t');
    debugInfo.language = determineUserLanguage();

    const content = [];
    if (theDebugInfo.subscriptions) {
      content.push('=== Filter Lists ===');
      for (const sub in theDebugInfo.subscriptions) {
        content.push(`Id: ${sub}`);
        content.push(`  Download Count: ${theDebugInfo.subscriptions[sub].downloadCount}`);
        content.push(`  Download Status: ${theDebugInfo.subscriptions[sub].downloadStatus}`);
        content.push(`  Last Download: ${theDebugInfo.subscriptions[sub].lastDownload}`);
        content.push(`  Last Success: ${theDebugInfo.subscriptions[sub].lastSuccess}`);
      }
    }

    content.push('');

    // Custom & Excluded filters might not always be in the object
    if (theDebugInfo.customFilters) {
      content.push('=== Custom Filters ===');
      for (const filter in theDebugInfo.customFilters) {
        content.push(theDebugInfo.customFilters[filter]);
      }

      content.push('');
    }

    if (theDebugInfo.exclude_filters) {
      content.push('=== Exclude Filters ===');
      content.push(JSON.stringify(theDebugInfo.exclude_filters));
    }

    content.push('=== Settings ===');
    for (const setting in theDebugInfo.settings) {
      content.push(`${setting} : ${theDebugInfo.settings[setting]}`);
    }

    content.push('');
    content.push('=== Other Info ===');
    content.push(JSON.stringify(theDebugInfo.otherInfo, null, '\t'));

    // Put it together to put into the textbox
    textDebugInfo = content.join('\n');
  });

  // Cache access to input boxes
  browser.storage.local.get('userName').then((response) => {
    $name.val(response.userName);
  });

  browser.storage.local.get('userEmail').then((response) => {
    $email.val(response.userEmail);
  });

  const handleResponseError = function (respObj) {
    if (respObj && Object.prototype.hasOwnProperty.call(respObj, 'error_msg')) {
      $('#step_response_error_msg').text(translate(respObj.error_msg));
    }

    $('#manual_report_DIV').show();
    $('#step_response_error').fadeIn();
    $('html, body').animate({
      scrollTop: $('#step_response_error').offset().top,
    }, 2000);
  };

  // Preparation for manual report in case of error.
  const prepareManualReport = function (data, status, HTTPerror, respObj) {
    const body = [];
    body.push('This bug report failed to send.');
    body.push('');
    body.push('* Repro Steps *');
    body.push(data.repro);
    body.push('');
    body.push('* Expected Result *');
    body.push(data.expect);
    body.push('');
    body.push('* Actual Result *');
    body.push(data.actual);
    body.push('');
    body.push('* Other comments *');
    body.push(data.comments);
    body.push('');
    body.push('');
    body.push('');
    body.push('===== Debug Info =====');
    body.push(textDebugInfo);
    if (status) {
      body.push(`Status: ${status}`);
    }

    if (HTTPerror) {
      body.push(`HTTP error code: ${HTTPerror}`);
    }

    if (respObj) {
      body.push(`Server error information: ${JSON.stringify(respObj)}`);
    }

    $('#manual_submission').val(body.join('\n'));
  };

  const sendReport = function () {
    const reportData = {
      title: $title.val(),
      repro: $repro.val(),
      expect: $expect.val(),
      actual: $actual.val(),
      debug: debugInfo,
      name: $name.val(),
      email: $email.val(),
      comments: $comments.val(),
    };

    if (extInfo) {
      reportData.debug.extensions = extInfo;
    }

    $.ajax({
      url: 'https://getadblock.com/freshdesk/bugReportV2.php',
      data: {
        bug_report: JSON.stringify(reportData),
      },
      success(text) {
        // if a ticket was created, the response should contain a ticket id #
        if (text) {
          try {
            const respObj = JSON.parse(text);
            if (respObj && Object.prototype.hasOwnProperty.call(respObj, 'id')) {
              $('#step_response_success').fadeIn();
              $('html, body').animate({
                scrollTop: $('#step_response_success').offset().top,
              }, 2000);
            } else {
              prepareManualReport(reportData, null, null, respObj);
              handleResponseError(respObj);
            }
          } catch (e) {
            prepareManualReport(reportData);
            handleResponseError();
          }
        } else {
          prepareManualReport(reportData);
          handleResponseError();
        }
      },

      error(xhrInfo, status, HTTPerror) {
        prepareManualReport(reportData, status, HTTPerror);
        handleResponseError();
      },

      type: 'POST',
    });
  };

  // Step 1: Name & Email
  $('#step1-next').on('click', () => {
    // Check for errors
    let problems = 0;
    if ($name.val() === '') {
      problems += 1;
      $name.addClass('input-error');
    } else {
      $name.removeClass('input-error');
    }

    if ($email.val() === '' || $email.val().search(/^.+@.+\..+$/) === -1) {
      problems += 1;
      $email.addClass('input-error');
    } else {
      $email.removeClass('input-error');
    }

    if ($title.val() === '') {
      problems += 1;
      $title.addClass('input-error');
    } else {
      $title.removeClass('input-error');
    }

    if ($repro.val() === '1. \n2. \n3. ') {
      problems += 1;
      $repro.addClass('input-error');
    } else {
      $repro.removeClass('input-error');
    }

    if ($expect.val() === '') {
      problems += 1;
      $expect.addClass('input-error');
    } else {
      $expect.removeClass('input-error');
    }

    if ($actual.val() === '') {
      problems += 1;
      $actual.addClass('input-error');
    } else {
      $actual.removeClass('input-error');
    }

    if (problems === 0) {
      // Success - go to next step
      $(this).prop('disabled', true);
      $('#email, #name, #rememberDetails').prop('disabled', true);
      $('#summary, #repro-steps, #expected-result, #actual-result').prop('disabled', true);
      $('.missingInfoMessage').hide();
      askUserToGatherExtensionInfo();
    } else {
      // Failure - let them know there's an issue
      $('#step_name_email > .missingInfoMessage').show();
    }
  });

  $('#step2-back').on('click', () => {
    $('#email, #name, #rememberDetails').prop('disabled', false);
    $('#summary, #repro-steps, #expected-result, #actual-result').prop('disabled', false);
    $('#step_repro_info').fadeOut();
    $('#step_final_questions').fadeOut();
    $('html, body').animate({
      scrollTop: $('#step_name_email').parent().parent().offset().top,
    }, 2000);
    $('#step2-back').prop('disabled', true);
    $('#step1-next').prop('disabled', false);
  });

  $('#submit').on('click', () => {
    sendReport();
    $('#submit').prop('disabled', true);
    $('#step2-back').prop('disabled', true);
  });
};

$(() => {
  let optionsTheme = 'default_theme';
  if (BG && BG.getSettings()) {
    const settings = BG.getSettings();
    optionsTheme = settings.color_themes.options_page;
  }
  $('body').attr('id', optionsTheme).data('theme', optionsTheme);
  $('#sidebar-adblock-logo').attr('src', `icons/${optionsTheme}/logo.svg`);
  bugReportLogic();
});
