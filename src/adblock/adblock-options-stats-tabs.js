'use strict';

/* For ESLint: List any global identifiers used in this file below */
/* global Chart, browser, License, localizePage, BG
   DOMPurify,translate, filterNotifier, subscription, synchronizer,
   filterStorage, Subscription, activateTab */

Chart.defaults.global.defaultFontFamily = 'Lato';

const mainTextFontColor = getComputedStyle(document.body).getPropertyValue('--main-text-color').trim();
const helpIconColor = getComputedStyle(document.body).getPropertyValue('--help-icon-color').trim();
const adsBlockedColor = getComputedStyle(document.body).getPropertyValue('--ads-blocked-color').trim();
const trackersBlockedColor = getComputedStyle(document.body).getPropertyValue('--trackers-blocked-color').trim();
const adsReplacedColor = getComputedStyle(document.body).getPropertyValue('--ads-replaced-color').trim();

const { channels } = BG;
let subs = BG.getSubscriptionsMinusText();
window.theChart = undefined; // needs to be in the global name space.
let labelData = [];
let adChartData = [];
let trackerChartData = [];
let replacedChartData = [];
let earliestDate = new Date(); // default to today

let rawData = {};

let showAdsData = true;
let showTrackerData = true;
let showReplacedData = true;

const { EXT_STATS_KEY } = BG.LocalDataCollection;

const addResizeHandler = function () {
  if (window.resizeHandler) {
    return;
  }
  window.resizeHandler = true;
  let resizeTimer;
  $(window).on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // eslint-disable-next-line no-use-before-define
      placeBlockStatsHeaderIcons();
      // eslint-disable-next-line no-use-before-define
      showOrHideNoDataMsgIfNeeded();
    }, 250);
  });
};

const showOrHideNoDataMsgIfNeeded = function () {
  if (BG.getSettings().local_data_collection) {
    if ($.isEmptyObject(rawData)) {
      $('#no-data-overlay').show();
    } else {
      $('#no-data-overlay').hide();
    }
    addResizeHandler();
  }
};

const showOrHideAdPanelCountNeeded = function () {
  if (BG.getSettings().local_data_collection && showAdsData) {
    showAdsData = false;
    $('#adsblocked_value').hide();
    $('#adsblocked_panel').css({ background: '#dadada' });
    $('#adblocked_off_icon').show();
    $('#adsblocked_header span[i18n="stats_hide_data"]').text(translate('stats_show_data'));
    $('#adsblocked_header i').text('remove_red_eye');
  } else if (BG.getSettings().local_data_collection && !showAdsData) {
    showAdsData = true;
    $('#adsblocked_panel').css({ background: '#ffffff' });
    $('#adblocked_off_icon').hide();
    $('#adsblocked_value').show();
    $('#adsblocked_header span[i18n="stats_hide_data"]').text(translate('stats_hide_data'));
    $('#adsblocked_header i').text('visibility_off');
  }
};

const showOrHideTrackerPanelCountNeeded = function () {
  if (
    BG.getSettings().local_data_collection
    && subs.easyprivacy
    && subs.easyprivacy.subscribed
  ) {
    if (showTrackerData) {
      showTrackerData = false;
      $('#trackers_blocked_panel').css({ background: '#dadada' });
      $('#trackers_blocked_value').hide();
      $('#trackers_off_icon').show();
      $('#trackers_blocked_header span[i18n="stats_hide_data"]').text(translate('stats_show_data'));
      $('#trackers_blocked_header i').text('remove_red_eye');
    } else {
      showTrackerData = true;
      $('#trackers_blocked_panel').css({ background: '#ffffff' });
      $('#trackers_off_icon').hide();
      $('#trackers_blocked_value').show();
      $('#trackers_blocked_header span[i18n="stats_hide_data"]').text(translate('stats_hide_data'));
      $('#trackers_blocked_header i').text('visibility_off');
    }
  }
};

const showOrHideReplacedPanelCountNeeded = function () {
  if (
    BG.getSettings().local_data_collection
        && License.isActiveLicense()
        && channels
        && channels.isAnyEnabled()
  ) {
    if (showReplacedData) {
      showReplacedData = false;
      $('#ads_replaced_panel').css({ background: '#dadada' });
      $('#ads_replaced_value').hide();
      $('#ads_replaced_off_icon').show();
      $('#ads_replaced_header span[i18n="stats_hide_data"]').text(translate('stats_show_data'));
      $('#ads_replaced_header i').text('remove_red_eye');
    } else {
      showReplacedData = true;
      $('#ads_replaced_panel').css({ background: '#ffffff' });
      $('#ads_replaced_off_icon').hide();
      $('#ads_replaced_value').show();
      $('#ads_replaced_header span[i18n="stats_hide_data"]').text(translate('stats_hide_data'));
      $('#ads_replaced_header i').text('visibility_off');
    }
  }
};

const hidePageProgressCircleIfNeeded = function () {
  return new Promise((resolve) => {
    if ($('#loadingDiv').is(':visible')) {
      $('#loadingDiv').fadeOut(400, () => {
        $('#myChart').show();
        resolve();
      });
      return;
    }
    resolve();
  });
};

const placeBlockStatsHeaderIcons = function () {
  const headers = document.getElementById('domainTableHeader');
  // check if the domain table header is visibile
  if (headers.offsetHeight || headers.offsetWidth || headers.getClientRects().length) {
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    if (vw >= 1250) { // the static value should match the media query in the stats-tabs CSS file
      // where the domain table header is removed
      $('#adHeader').show();
      $('#trackerHeader').show();
      $('#replacedHeader').show();
      $('#adHeader').offset({
        top: $('#adHeader').offset().top,
        left: $('#adColumn-1').offset().left,
      });
      $('#trackerHeader').offset({
        top: $('#trackerHeader').offset().top,
        left: $('#trackerColumn-1').offset().left,
      });
      $('#replacedHeader').offset({
        top: $('#adHeader').offset().top,
        left: $('#replacedColumn-1').offset().left,
      });
    } else {
      $('#adHeader').hide();
      $('#trackerHeader').hide();
      $('#replacedHeader').hide();
    }
  }
};

// Chart js data helper functions

// reverse order comparater
function compareDomainCount(domainA, domainB) {
  let comparison = 0;
  if (domainA.total > domainB.total) {
    comparison = -1;
  } else if (domainA.total < domainB.total) {
    comparison = 1;
  }
  return comparison;
}

// null values are not shown on the chart, where as zero values are
// so we set all initial, default values to null
function setZerosToNull(chartDataArray) {
  const localChartDataArray = chartDataArray;
  for (let j = 0; j < chartDataArray.length; j++) {
    if (!localChartDataArray[j]) {
      localChartDataArray[j] = null;
    }
  }
  return localChartDataArray;
}

function sumChartData(chartDataArray) {
  let returnVal = 0;
  for (let i = 0; i < chartDataArray.length; i++) {
    returnVal += chartDataArray[i];
  }
  return returnVal;
}

// Chart JS Date data functions
function calculateMonthDiff(dateFrom, dateTo) {
  return dateTo.getMonth() - dateFrom.getMonth()
    + (12 * (dateTo.getFullYear() - dateFrom.getFullYear())) + 1;
}

// Midnight will be the 0 index, 1 AM is the 1 index, etc.
// returned array will also include midnight tomorrow
const hoursOfThisDay = (function getHoursOfThisDay() {
  const hours = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  hours.push(new Date(today.getTime()));
  for (let i = 1; i < 25; i++) {
    today.setHours(i, 0, 0, 0);
    hours.push(new Date(today.getTime()));
  }
  return hours;
}());

function createDailyLabelData() {
  labelData = [];
  for (let i = 0; i < hoursOfThisDay.length; i++) {
    labelData.push(hoursOfThisDay[i].toLocaleTimeString(undefined, { hour: '2-digit' }));
  }
  return labelData;
}

function filterTodaysData(chartDataArray) {
  const hourBuckets = [null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null];
  for (let i = 0; i < chartDataArray.length; i++) {
    for (let j = 0; j < hoursOfThisDay.length; j++) {
      if (chartDataArray[i].x >= hoursOfThisDay[j] && chartDataArray[i].x < hoursOfThisDay[j + 1]) {
        hourBuckets[j] += chartDataArray[i].y;
      }
    }
  }
  return hourBuckets;
}

const firstMondayOfThisWeek = (function getFirstMondayOfThisWeek() {
  const dayOfWeek = new Date().getDay();
  const firstDayOfWeek = new Date();
  let diff = 0;
  if (dayOfWeek >= 1) { // if Monday through Saturday
    diff = dayOfWeek - 1;
  } else {
    diff = 6 - dayOfWeek;
  }
  firstDayOfWeek.setDate(new Date().getDate() - diff);
  firstDayOfWeek.setHours(0, 0, 0, 0);
  return firstDayOfWeek;
}());

function getDatesOfThisWeek() {
  const dates = [];
  const dayOfWeek = new Date(firstMondayOfThisWeek.getTime());
  dates.push(new Date(dayOfWeek.getTime()));
  for (let i = 1; i < 7; i++) {
    dayOfWeek.setHours(24);
    dates.push(new Date(dayOfWeek.getTime()));
  }
  return dates;
}

function filterThisWeeksData(chartDataArray) {
  const dates = getDatesOfThisWeek(); // Monday is the 0 index, Tuesday is the 1 index, etc.
  const dayBuckets = [null, null, null, null, null, null, null];
  const followingMonday = new Date(dates[6].getTime());
  followingMonday.setHours(24);

  for (let i = 0; i < chartDataArray.length; i++) {
    for (let j = 0; (j < dates.length - 1); j++) {
      if (chartDataArray[i].x >= dates[j] && chartDataArray[i].x < dates[j + 1]) {
        dayBuckets[j] += chartDataArray[i].y;
      }
    }
    if (chartDataArray[i].x >= dates[dates - 1] && chartDataArray[i].x < followingMonday) {
      dayBuckets[7] += chartDataArray[i].y;
    }
  }
  return dayBuckets;
}

const firstDayOfThisMonth = (function firstDayOfThisMonthFN() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  firstDay.setHours(0, 0, 0, 0);
  return firstDay;
}());

const numberOfDaysThisMonth = (function numberOfDaysThisMonthFN() {
  const aDate = new Date(firstDayOfThisMonth.getFullYear(), firstDayOfThisMonth.getMonth() + 1, 0);
  return aDate.getDate();
}());

function getDatesOfThisMonth() {
  const dates = [];
  const dayOfWeek = new Date(firstDayOfThisMonth.getTime());
  dates.push(new Date(dayOfWeek.getTime()));
  for (let i = 1; i < numberOfDaysThisMonth; i++) {
    dayOfWeek.setHours(24);
    dates.push(new Date(dayOfWeek.getTime()));
  }
  return dates;
}

function filterThisMonthsData(chartDataArray) {
  const dates = getDatesOfThisMonth();
  const dayBuckets = [];
  const firstDayOfNextMonth = new Date(dates[numberOfDaysThisMonth - 1].getTime());
  firstDayOfNextMonth.setHours(24);
  for (let j = 0; (j < dates.length - 1); j++) {
    dayBuckets[j] = null;
  }

  for (let i = 0; i < chartDataArray.length; i++) {
    for (let j = 0; (j < dates.length - 1); j++) {
      if (chartDataArray[i].x >= dates[j] && chartDataArray[i].x < dates[j + 1]) {
        dayBuckets[j] += chartDataArray[i].y;
      }
    }
    if (chartDataArray[i].x >= dates[dates - 1] && chartDataArray[i].x < firstDayOfNextMonth) {
      dayBuckets[numberOfDaysThisMonth - 1] += chartDataArray[i].y;
    }
  }
  return dayBuckets;
}

function createThisMonthsLabels() {
  const dates = getDatesOfThisMonth();
  const firstDayOfNextMonth = new Date(dates[numberOfDaysThisMonth - 1].getTime());
  firstDayOfNextMonth.setHours(24);
  const monthNameBuckets = [];
  for (let i = 0; i < numberOfDaysThisMonth; i++) {
    monthNameBuckets.push(dates[i].toLocaleDateString());
  }
  return monthNameBuckets;
}

const firstDayOfThisYear = (function getFirstDayOfThisYear() {
  const firstOfYear = new Date(new Date().getFullYear(), 0, 1);
  firstOfYear.setHours(0, 0, 0, 0);
  return firstOfYear;
}());

function getMonthsOfThisYear() {
  const dates = [];
  const firstdayOfYear = new Date(firstDayOfThisYear.getTime());
  dates.push(new Date(firstdayOfYear.getTime()));
  for (let i = 1; i < 12; i++) {
    firstdayOfYear.setMonth(i);
    dates.push(new Date(firstdayOfYear.getTime()));
  }
  return dates;
}

function filterThisYearsData(chartDataArray) {
  const dates = getMonthsOfThisYear(); // January is the 0 index, February is the 1 index, etc.
  const monthBuckets = [null, null, null, null, null, null, null, null, null, null, null, null];
  const firstDayOfYear = new Date(firstDayOfThisYear.getTime());
  const nextYearFirstDate = new Date(firstDayOfYear.setFullYear(firstDayOfYear.getFullYear() + 1));

  for (let i = 0; i < chartDataArray.length; i++) {
    for (let j = 0; (j < dates.length - 1); j++) {
      if (chartDataArray[i].x >= dates[j] && chartDataArray[i].x < dates[j + 1]) {
        monthBuckets[j] += chartDataArray[i].y;
      }
    }
    if (
      chartDataArray[i].x >= dates[dates.length - 1]
      && chartDataArray[i].x < nextYearFirstDate) {
      monthBuckets[dates.length - 1] += chartDataArray[i].y;
    }
  }

  return monthBuckets;
}

// assumes the |earliestDate| variable is set during initial data processing
//
function filterForAllData(chartDataArray) {
  const monthDateBuckets = [];
  const monthBuckets = [];
  const numBuckets = calculateMonthDiff(earliestDate, new Date());
  // first day of the month
  const myDate = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1);
  myDate.setHours(0, 0, 0, 0);
  monthBuckets.push(0);
  monthDateBuckets.push(new Date(myDate.getTime()));

  for (let i = 1; i < numBuckets; i++) {
    myDate.setMonth(myDate.getMonth() + 1);
    monthDateBuckets.push(new Date(myDate.getTime()));
    monthBuckets.push(0);
  }
  myDate.setMonth(myDate.getMonth() + 1); // add one more month get the first of next month.
  const nextMonth = new Date(myDate.getTime());

  for (let i = 0; i < chartDataArray.length; i++) {
    for (let j = 0; (j < numBuckets - 1); j++) {
      if (
        chartDataArray[i].x >= monthDateBuckets[j]
        && chartDataArray[i].x < monthDateBuckets[j + 1]
      ) {
        monthBuckets[j] += chartDataArray[i].y;
      }
    }
    if (
      chartDataArray[i].x >= monthDateBuckets[numBuckets - 1]
      && chartDataArray[i].x < nextMonth
    ) {
      monthBuckets[numBuckets - 1] += chartDataArray[i].y;
    }
  }
  return monthBuckets;
}

function createAllDataLabels() {
  const monthNameBuckets = [];
  const numBuckets = calculateMonthDiff(earliestDate, new Date());
  const myDate = new Date(earliestDate.getTime());
  myDate.setHours(0, 0, 0, 0);
  monthNameBuckets.push(myDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

  for (let i = 1; i < numBuckets; i++) {
    myDate.setMonth(myDate.getMonth() + 1);
    if ((numBuckets <= 24) || ((numBuckets > 24) && (i % 3 === 0))) {
      monthNameBuckets.push(myDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
    } else {
      monthNameBuckets.push('');
    }
  }
  return monthNameBuckets;
}

// instead of hard coding the name of days, we have the browser tell us
function getNamesOfDays() {
  const names = [];
  const dayOfWeek = new Date(firstMondayOfThisWeek.getTime());
  names.push(dayOfWeek.toLocaleDateString(undefined, { weekday: 'long' }));
  for (let i = 1; i < 7; i++) {
    dayOfWeek.setHours(24);
    names.push(dayOfWeek.toLocaleDateString(undefined, { weekday: 'long' }));
  }
  return names;
}

// instead of hard coding the name of the Months, we have the browser tell us
function getNamesOfMonths() {
  const names = [];
  const firstDayOfMonth = new Date(firstDayOfThisYear.getTime());
  names.push(firstDayOfMonth.toLocaleDateString(undefined, { month: 'long' }));
  for (let i = 1; i < 12; i++) {
    firstDayOfMonth.setMonth(i);
    names.push(firstDayOfMonth.toLocaleDateString(undefined, { month: 'long' }));
  }
  return names;
}


// Hard coded sample Chart JS data to be shown to users when they don't have the feature enabled

const sampleAdData = [];
const sampleTrackerData = [];
const sampleReplaceData = [];

sampleAdData.push({ y: 7, x: 0 });
sampleAdData.push({ y: 5, x: 1 });
sampleAdData.push({ y: 8, x: 2 });
sampleAdData.push({ y: 7, x: 3 });
sampleAdData.push({ y: 8, x: 4 });
sampleAdData.push({ y: 5, x: 5 });
sampleAdData.push({ y: 7, x: 6 });

sampleTrackerData.push({ y: 4, x: 0 });
sampleTrackerData.push({ y: 3, x: 1 });
sampleTrackerData.push({ y: 4, x: 2 });
sampleTrackerData.push({ y: 5, x: 3 });
sampleTrackerData.push({ y: 4, x: 4 });
sampleTrackerData.push({ y: 3, x: 5 });
sampleTrackerData.push({ y: 4, x: 6 });

sampleReplaceData.push({ y: 1, x: 0 });
sampleReplaceData.push({ y: 1, x: 1 });
sampleReplaceData.push({ y: 2, x: 2 });
sampleReplaceData.push({ y: 1, x: 3 });
sampleReplaceData.push({ y: 2, x: 4 });
sampleReplaceData.push({ y: 1, x: 5 });
sampleReplaceData.push({ y: 1, x: 6 });

const sampleLabelData = createDailyLabelData();

const sampleAdChartDataSet = {
  fill: false,
  backgroundColor: helpIconColor,
  borderColor: helpIconColor,
  data: sampleAdData,
};
const sampleTrackerChartDataSet = {
  fill: false,
  backgroundColor: helpIconColor,
  borderColor: helpIconColor,
  data: sampleTrackerData,
};
const sampleReplacedChartDataSet = {
  fill: false,
  backgroundColor: helpIconColor,
  borderColor: helpIconColor,
  data: sampleReplaceData,
};
const sampleChartConfig = {
  tooltips: {
    enabled: false,
  },
  type: 'line',
  data: {
    labels: sampleLabelData,
    datasets: [sampleAdChartDataSet, sampleTrackerChartDataSet, sampleReplacedChartDataSet],
  },
  options: {
    events: [],
    legend: {
      display: false,
      labels: {
        display: false,
      },
    },
    responsive: true,
    maintainAspectRatio: false,
    title: {
      display: false,
    },
    scales: {
      xAxes: [{
        display: true,
        ticks: {
          tickMarkLength: 0,
          stepSize: 1,
          // only show every forth
          callback(value, index) {
            if (!(index % 4)) {
              return value;
            }
            return ' ';
          },
          fontColor: mainTextFontColor,
        },
      }],
      yAxes: [{
        display: true,
        scaleLabel: {
          display: false,
        },
        ticks: {
          suggestedMax: 10,
          tickMarkLength: 0,
          fontColor: mainTextFontColor,
        },
      }],
    },
  },
};

// produces the row HTML for the domain table on the 'Blocks by site' tab
const getDomainTableRow = function (rowNum, filteredDomainData, processedDoms) {
  const rowValue = rowNum + 1;
  return `<div id="domainRow-${rowValue}"class="domainTableRow">
    <div class="siteColumn ellipsis">${rowValue} ${processedDoms[rowNum].domain}</div>
    <div id="adColumn-${rowValue}" class="adColumn">
      <i class="material-icons md-18 accent-text inactive" role="img" i18n-aria-label="stats_ads_blocked_aria_label">block</i>
      ${filteredDomainData[processedDoms[rowNum].domain].ads.toLocaleString()}
    </div>
    <div id="trackerColumn-${rowValue}" class="trackerColumn">
      <i class="material-icons md-18 accent-text inactive" role="img" i18n-aria-label="stats_trackers_blocked_aria_label">gps_fixed</i>
      ${filteredDomainData[processedDoms[rowNum].domain].trackers.toLocaleString()}
    </div>
    <div id="replacedColumn-${rowValue}" class="replacedColumn">
      <i class="material-icons md-18 accent-text inactive" role="img" i18n-aria-label="stats_replaced_blocked_aria_label">photo</i>
      ${filteredDomainData[processedDoms[rowNum].domain].adsReplaced.toLocaleString()}
    </div>
    <div class="totalColumn">
      <i class="material-icons md-18 accent-text inactive" role="img" aria-hidden="true">photo</i>
      <span>${filteredDomainData[processedDoms[rowNum].domain].total.toLocaleString()}</span>
    </div>
  </div>`;
};

// set the same font size of the count value in all three panels
const setFontSize = function (totalAdsBlocked, totalAdsSelector, totalTrackersBlocked,
  totalTrackersselector, totalReplaced, totalReplacedSelector) {
  const count = Math.max(totalAdsBlocked, totalTrackersBlocked, totalReplaced);
  let fontSize = '60px';
  if ((count >= 1000) && (count < 10000)) {
    fontSize = '48px';
  } else if ((count >= 10000) && (count < 100000)) {
    fontSize = '42px';
  } else if (count >= 100000) {
    fontSize = '36px';
  }
  $(totalAdsSelector).css({ 'font-size': fontSize });
  $(totalTrackersselector).css({ 'font-size': fontSize });
  $(totalReplacedSelector).css({ 'font-size': fontSize });
};

// returns a promise that is resolved when all of the raw data is loaded from storage
const loadUserDataFromStorage = function () {
  return new Promise((resolve) => {
    rawData = {};
    browser.storage.local.get(EXT_STATS_KEY).then((storedData) => {
      rawData = storedData[EXT_STATS_KEY] || {};
      if (!$.isEmptyObject(rawData)) {
        $('#stats-page-delete-icon').show();
      }
      adChartData = [];
      trackerChartData = [];
      replacedChartData = [];
      earliestDate = new Date();
      for (const timestamp in rawData) {
        if (!Number.isNaN(timestamp) && (rawData[timestamp].v === '1')) {
          let totalAds = 0;
          let totalTrackers = 0;
          let totalReplaced = 0;
          const theDate = new Date(Number(timestamp));
          if (theDate < earliestDate) {
            earliestDate = new Date(Number(timestamp));
          }
          for (const domain in rawData[timestamp].doms) {
            if (rawData[timestamp].doms[domain]) {
              totalAds += rawData[timestamp].doms[domain].ads;
              totalTrackers += rawData[timestamp].doms[domain].trackers;
              totalReplaced += rawData[timestamp].doms[domain].adsReplaced;
            }
          }
          adChartData.push({ x: theDate, y: totalAds });
          trackerChartData.push({ x: theDate, y: totalTrackers });
          replacedChartData.push({ x: theDate, y: totalReplaced });
        }
      }
      resolve();
    });
  });
};

const getLineChartConfig = function (chartType, filterName, labelName) {
  let filterFunction = filterTodaysData;
  let createLabelFunction = createDailyLabelData;
  if (filterName === 'week') {
    filterFunction = filterThisWeeksData;
  } else if (filterName === 'months') {
    filterFunction = filterThisMonthsData;
  } else if (filterName === 'year') {
    filterFunction = filterThisYearsData;
  } else if (filterName === 'all') {
    filterFunction = filterForAllData;
  }

  if (labelName === 'days') {
    createLabelFunction = getNamesOfDays;
  } else if (labelName === 'months') {
    createLabelFunction = createThisMonthsLabels;
  } else if (labelName === 'year') {
    createLabelFunction = getNamesOfMonths;
  } else if (labelName === 'all') {
    createLabelFunction = createAllDataLabels;
  }
  const chartDataSets = [];
  let totalAdsBlocked = 0;
  let totalTrackersBlocked = 0;
  let totalReplaced = 0;
  if (showAdsData) {
    const theAdChartData = filterFunction(adChartData);
    totalAdsBlocked = sumChartData(theAdChartData);
    $('#adsblocked_value').text(totalAdsBlocked.toLocaleString());
    const adChartDataSet = {
      label: translate('stats_ads_blocked'),
      fill: false,
      backgroundColor: adsBlockedColor,
      borderColor: adsBlockedColor,
      data: theAdChartData,
      spanGaps: true,
      pointHoverRadius: 6,
      pointRadius: 5,
    };
    chartDataSets.push(adChartDataSet);
  }
  if (showTrackerData && subs && subs.easyprivacy && subs.easyprivacy.subscribed) {
    const theTrackerChartData = filterFunction(trackerChartData);
    totalTrackersBlocked = sumChartData(theTrackerChartData);
    $('#trackers_blocked_value').text(totalTrackersBlocked.toLocaleString());

    const trackerChartDataSet = {
      label: translate('stats_trackers_blocked'),
      fill: false,
      backgroundColor: trackersBlockedColor,
      borderColor: trackersBlockedColor,
      data: theTrackerChartData,
      spanGaps: true,
      pointHoverRadius: 6,
      pointRadius: 5,
    };
    chartDataSets.push(trackerChartDataSet);
  }

  if (
    showReplacedData
      && License.isActiveLicense()
      && channels
      && channels.isAnyEnabled()
  ) {
    const theReplacedChartData = filterFunction(replacedChartData);
    totalReplaced = sumChartData(theReplacedChartData);
    $('#ads_replaced_value').text(totalReplaced.toLocaleString());
    const replacedChartDataSet = {
      label: translate('stats_replaced_blocked'),
      fill: false,
      backgroundColor: adsReplacedColor,
      borderColor: adsReplacedColor,
      data: theReplacedChartData,
      spanGaps: true,
      pointHoverRadius: 6,
      pointRadius: 5,
    };
    chartDataSets.push(replacedChartDataSet);
  }

  setFontSize(totalAdsBlocked, '#adsblocked_value', totalTrackersBlocked,
    '#trackers_blocked_value', totalReplaced, '#ads_replaced_value');

  const theLabelData = createLabelFunction();

  return {
    filterName, // for use in the tick callback
    type: 'line',
    events: [],
    data: {
      labels: theLabelData,
      datasets: chartDataSets,
    },
    options: {
      spanGaps: true,
      responsive: true,
      maintainAspectRatio: false,
      tooltips: {
        mode: 'x',
      },
      legend: {
        display: false,
        labels: {
          display: false,
        },
      },
      title: {
        display: false,
      },
      scales: {
        xAxes: [{
          display: true,
          gridLines: {
            zeroLineColor: mainTextFontColor,
          },
          ticks: {
            callback(value, index) {
              const filter = this.chart.config.filterName;
              if (!filter || filter === 'today') {
                if (!(index % 4)) {
                  return value;
                }
                return ' ';
              }
              if (filter === 'week') {
                return value;
              }
              if (filter === 'months') {
                // since the index is zero based, 1 needs to added to get the date
                if (index === 0 || !((index + 1) % 7)) {
                  return value;
                }
                return ' ';
              }
              if (filter === 'year') {
                return value;
              }
              if (filter === 'all') {
                return value;
              }
              return value;
            },
            fontColor: mainTextFontColor,
          },
        }],
        yAxes: [{
          display: true,
          scaleLabel: {
            display: false,
          },
          ticks: {
            beginAtZero: true,
            min: 0,
            // only show Integers
            callback(value) {
              if (Number.isInteger(value)) {
                return value;
              }
              return ' ';
            },
            fontColor: mainTextFontColor,
          },
          gridLines: {
            zeroLineColor: mainTextFontColor,
          },
        }],
      },
    },
  };
};

const filterBarChartDataForDateRange = function (startTime, endTime) {
  const domainData = {};
  for (const timestamp in rawData) {
    if (!Number.isNaN(timestamp)) {
      const theDate = new Date(Number(timestamp));
      if (theDate > startTime && theDate < endTime) {
        for (const domain in rawData[timestamp].doms) {
          const cleanDomain = domain.replace(/^www\./, ''); // remove lead 'www.'
          if (cleanDomain && cleanDomain.length > 1) { // check if domain is not blank
            if (!domainData[cleanDomain]) {
              domainData[cleanDomain] = {};
              domainData[cleanDomain].ads = 0;
              domainData[cleanDomain].trackers = 0;
              domainData[cleanDomain].adsReplaced = 0;
              domainData[cleanDomain].total = 0;
            }
            domainData[cleanDomain].ads += rawData[timestamp].doms[domain].ads;
            if (subs && subs.easyprivacy && subs.easyprivacy.subscribed) {
              domainData[cleanDomain].trackers += rawData[timestamp].doms[domain].trackers;
            }
            if (License.isActiveLicense() && channels && channels.isAnyEnabled()) {
              domainData[cleanDomain].adsReplaced
                += rawData[timestamp].doms[domain].adsReplaced;
            }
            domainData[cleanDomain].total = domainData[cleanDomain].ads
                                          + domainData[cleanDomain].trackers
                                          + domainData[cleanDomain].adsReplaced;
          }
        }
      }
    }
  }
  return domainData;
};

const getBarChartConfig = function (chartType, filterName) {
  if (chartType !== 'bar') {
    return {};
  }
  const endTime = new Date();
  let startTime = new Date();
  if (filterName === 'week') {
    startTime = new Date(firstMondayOfThisWeek.getTime());
  } else if (filterName === 'months') {
    startTime = new Date(firstDayOfThisMonth.getTime());
  } else if (filterName === 'year') {
    startTime = new Date(firstDayOfThisYear.getTime());
  } else if (filterName === 'all') {
    startTime = earliestDate;
  }
  startTime.setHours(0, 0, 0, 0);
  const filteredDomainData = filterBarChartDataForDateRange(startTime, endTime);
  const topNineDomainArray = [];
  const barChartAdsDS = [];
  const barChartTrackersDS = [];
  const barChartImageReplsDS = [];
  const processedBarDoms = [];
  for (const domain in filteredDomainData) {
    processedBarDoms.push({ domain, total: filteredDomainData[domain].total });
  }
  processedBarDoms.sort(compareDomainCount);

  for (let inx = 0; (inx < processedBarDoms.length && inx < 10); inx++) {
    topNineDomainArray.push(processedBarDoms[inx].domain);
    barChartAdsDS.push(filteredDomainData[processedBarDoms[inx].domain].ads);
    barChartTrackersDS.push(filteredDomainData[processedBarDoms[inx].domain].trackers);
    barChartImageReplsDS.push(filteredDomainData[processedBarDoms[inx].domain].adsReplaced);
  }

  // fill in any empty positions
  // these arrays should always have exactly 10 items in them
  if (topNineDomainArray.length < 10) {
    for (let inx = topNineDomainArray.length; (inx < 10); inx++) {
      topNineDomainArray.push('');
      barChartAdsDS.push(0);
      barChartTrackersDS.push(0);
      barChartImageReplsDS.push(0);
    }
  }
  const barChartData = {
    labels: topNineDomainArray,
    datasets: [{
      label: translate('stats_ads_blocked'),
      backgroundColor: adsBlockedColor,
      borderColor: adsBlockedColor,
      borderWidth: 0,
      data: barChartAdsDS,
    }, {
      label: translate('stats_trackers_blocked'),
      backgroundColor: trackersBlockedColor,
      borderColor: trackersBlockedColor,
      borderWidth: 0,
      data: barChartTrackersDS,
    }, {
      label: translate('stats_replaced_blocked'),
      backgroundColor: adsReplacedColor,
      borderColor: adsReplacedColor,
      borderWidth: 0,
      data: barChartImageReplsDS,
    }],
  };
  const barChartConfig = {
    type: 'bar',
    data: barChartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      tooltips: {
        mode: 'x',
        intersect: true,
      },
      legend: {
        display: false,
        labels: {
          display: false,
        },
      },
      title: {
        display: false,
      },
      scales: {
        xAxes: [{
          stacked: true,
          radius: 25,
          ticks: {
            callback(value, index) {
              return index + 1;
            },
            fontColor: mainTextFontColor,
          },
          gridLines: {
            color: '#ffffff',
            lineWidth: 0,
            zeroLineColor: mainTextFontColor,
          },
        }],
        yAxes: [{
          stacked: true,
          beginAtZero: true,
          min: 0,
          ticks: {
            fontColor: mainTextFontColor,
            min: 0,
            // only show Integers
            callback(value) {
              if (Number.isInteger(value)) {
                return value;
              }
              return ' ';
            },
            color: mainTextFontColor,
          },
          gridLines: {
            zeroLineColor: mainTextFontColor,
          },
        }],
      },
    },
  };
  return {
    theChartConfig: barChartConfig,
    filteredDomainData,
    processedDoms: processedBarDoms,
  };
};

// process or reprocess the raw chart data for initial display
// or after the user clicks a menu item
const updateChart = function (chartType = 'line', filterName, labelName) {
  showOrHideNoDataMsgIfNeeded();
  let theChartConfig = {};
  let filteredDomainData = {};
  let processedDoms = [];
  if (chartType === 'line') {
    theChartConfig = getLineChartConfig(chartType, filterName, labelName);
  } else if (chartType === 'bar') {
    // eslint-disable-next-line max-len
    ({ theChartConfig, filteredDomainData, processedDoms } = getBarChartConfig(chartType, filterName, labelName));
  } else {
    $('#adsblocked_progress_div').fadeOut(500, () => {
      $('#adsblocked_value').fadeIn(500);
    });
    return;
  }

  hidePageProgressCircleIfNeeded().then(() => {
    if (typeof window.theChart === 'undefined') {
      const myChartCTX = document.getElementById('myChart').getContext('2d');
      window.theChart = new Chart(myChartCTX, theChartConfig);
    } else if (window.theChart.config.type === chartType) {
      window.theChart.config = theChartConfig;
      window.theChart.update(0);
    } else {
      window.theChart.destroy();
      const myChartCTX = document.getElementById('myChart').getContext('2d');
      window.theChart = new Chart(myChartCTX, theChartConfig);
    }
    if (chartType === 'line') {
      $('#siteBlocks-stats').hide();
      $('#timeBlocks-stats').css({ display: 'flex' });
      if (showAdsData && $('#adsblocked_progress_div').is(':visible')) {
        $('#adsblocked_progress_div').fadeOut(500, () => {
          $('#adsblocked_value').fadeIn(500);
        });
      }
    } else {
      $('.domainTableRow').remove();
      const table = $('#domainTable');
      for (let inx = 0; (inx < processedDoms.length && inx < 10); inx++) {
        const row = getDomainTableRow(inx, filteredDomainData, processedDoms);
        table.append(DOMPurify.sanitize(row, { SAFE_FOR_JQUERY: true }));
      }
      $('.siteBlocks-stats').css('background', '#ffffff');
      $('.siteBlocks-stats').css('padding', '0');
      $('.siteBlocks-stats').css('border', '0');
      $('#timeBlocks-stats').hide();
      $('#siteBlocks-stats').css({ display: 'grid' });
      if (processedDoms.length) {
        placeBlockStatsHeaderIcons();
      } else {
        $('#adHeader').hide();
        $('#trackerHeader').hide();
        $('#replacedHeader').hide();
      }
    }
    $('#no-click-overlay').hide();
  });
};

const initializeStatsTabContent = function () {
  if (!BG.getSettings().local_data_collection) {
    $('#opt-in-panel').css('display', 'flex').hide().fadeIn();
    $('li a').css({ cursor: 'default' });
    $('#stats_enable_data_collection').prop('checked', false);
    const myChartCTX = document.getElementById('myChart').getContext('2d');
    window.theChart = new Chart(myChartCTX, sampleChartConfig);
    if (BG.getSettings().data_collection_v2) {
      $('#opt_in_data_collection').hide();
      $('#stats_opt_in_msg').hide();
      $('#already_opt_in_msg').show();
      $('#btnStatsOptIn').html(DOMPurify.sanitize(translate('stats_opt_in_local_text_button')));
    } else if (!BG.getSettings().data_collection_v2) {
      $('#opt_in_data_collection').css('display', 'inline');
      $('#stats_opt_in_msg').show();
      $('#already_opt_in_msg').hide();
      $('#btnStatsOptIn').html(DOMPurify.sanitize(translate('stats_opt_in_text_button')));
    }
    hidePageProgressCircleIfNeeded();
    $('#stats-menu-parent-panel').fadeIn();
  } else {
    $('#opt-in-panel').hide();
    $('.stats-menu-content-panel').css('background', '#ffffff');
    $('.stats-menu-content-panel').css('padding', '0');
    $('.stats-menu-content-panel').css('border', '0');
    if (subs && subs.easyprivacy && subs.easyprivacy.subscribed) {
      $('#trackers_cta_panel').hide();
      $('#trackers_blocked_panel').css('display', 'flex').hide().fadeIn();
    } else {
      $('#trackers_blocked_panel').hide();
      $('#trackers_cta_panel').fadeIn();
    }
    if (License.isActiveLicense()) {
      if (channels && channels.isAnyEnabled()) {
        $('#premium_cta_panel').hide();
        $('#ads_replaced_panel').css('display', 'flex').hide().fadeIn();
      } else {
        $('#ads_replaced_panel').hide();
        $('#premium_cta_panel .cta_panel_content').text(translate('premium_cta_msg_not_enabled'));
        $('#btnGetPremium').hide();
        $('#btnImageSwapEnable').show();
        $('#premium_cta_panel').fadeIn();
      }
    } else {
      $('#premium_cta_panel').fadeIn();
      $('#ads_replaced_panel').hide();
    }

    loadUserDataFromStorage().then(() => {
      updateChart();
      $('#stats-menu-parent-panel').fadeIn();
    });
  }
};

const resetPageToInitialState = function () {
  // reset menu selections to initial state
  $('.active-stats-menu-item').removeClass('active-stats-menu-item');
  $('#stats-menu-level1 [data-chart-type="line"]').parent().addClass('active-stats-menu-item');
  $('.active-stats-sub-menu-item').removeClass('active-stats-sub-menu-item');
  $('#timeBlocks [data-filter-function-name="today"]').parent().addClass('active-stats-sub-menu-item');
  // reset global vars
  subs = BG.getSubscriptionsMinusText();
  showAdsData = false;
  showTrackerData = false;
  showReplacedData = false;
  // reset UI elements
  showOrHideAdPanelCountNeeded(true);
  showOrHideTrackerPanelCountNeeded(true);
  showOrHideReplacedPanelCountNeeded(true);
  // show the chart
  initializeStatsTabContent();
};

$(() => {
  BG.LocalDataCollection.saveCacheData(() => {
    initializeStatsTabContent();
  });
  localizePage();
  // use a MutationObserver to watch if the stats tab is redisplayed.
  // the settings may have changed on another tab, which may require
  // the page to be updated.
  const observer = new MutationObserver(((mutations) => {
    for (const mutation of mutations) {
      if ($('#stats-tabs').is(':visible') && mutation.attributeName === 'style') {
        resetPageToInitialState();
      }
    }
  }));
  const target = document.querySelector('#stats-tabs');
  observer.observe(target, {
    attributes: true,
  });
});

// button click handlers

$('#btnStatsOptIn').on('click', () => {
  BG.LocalDataCollection.start(() => {
    // this check is nested in a callback to prevent data loss when
    // the setSetting function is called quickly in succession
    if ($('#stats_enable_data_collection').is(':checked')) {
      BG.setSetting('data_collection_v2', true);
    }
    window.location.reload();
  });
});

// menu item click handlers

$('#stats-menu-level2 a').on('click', function statsOptionLinkClicked() {
  if (!BG.getSettings().local_data_collection) {
    return;
  }
  $('#no-click-overlay').show();
  $('#loadingDiv').show();
  $('.active-stats-sub-menu-item').removeClass('active-stats-sub-menu-item');
  $(this).parent().addClass('active-stats-sub-menu-item');

  const filterFunctionName = $(this).data('filter-function-name');
  if (filterFunctionName === 'today') {
    $('#timeBlocks-stats').css({ 'border-top-left-radius': '0' });
    $('#siteBlocks-stats').css({ 'border-top-left-radius': '0' });
  } else {
    $('#timeBlocks-stats').css({ 'border-top-left-radius': '6px' });
    $('#siteBlocks-stats').css({ 'border-top-left-radius': '6px' });
  }

  updateChart($('.active-stats-menu-item a').data('chart-type'),
    $(this).data('filter-function-name'), $(this).data('label-function-name'));
});

$('.chart-parent-tab-link').on('click', function statsOptionLinkClicked() {
  if (!BG.getSettings().local_data_collection) {
    return;
  }
  $('#no-click-overlay').show();
  $('#loadingDiv').show();
  $('.active-stats-menu-item').removeClass('active-stats-menu-item');
  const chartType = $(this).children('a').data('chart-type');
  if (chartType === 'line') {
    $('#stats-menu-level2').css({ 'border-top-left-radius': '0' });
  } else {
    $('#stats-menu-level2').css({ 'border-top-left-radius': '6px' });
  }

  $(this).addClass('active-stats-menu-item');
  updateChart(chartType,
    $('.active-stats-sub-menu-item a').data('filter-function-name'),
    $('.active-stats-sub-menu-item a').data('label-function-name'));
});

// buttons on CTA panels click handlers

$('#aTrackersEnable, #btnTrackersEnable').on('click', () => {
  if (!BG.getSettings().local_data_collection) {
    return;
  }
  $('#no-click-overlay').show();
  $('#btnTrackersEnable').prop('disabled', true);
  $('#btnTrackersEnable').css({ color: '#e6e6e6' });
  $('#trackers_cta_msg_link').parent().parent().fadeOut(100, () => {
    $('#trackers_cta_progress_div').css('display', 'flex').hide().fadeIn();
  });
  const { easyPrivacyURL } = BG.LocalDataCollection;
  const onStatsSubUpdated = function (item) {
    if (
      item
        && item.url === easyPrivacyURL
        && item._downloadStatus === 'synchronize_ok'
    ) {
      filterNotifier.off('subscription.added', onStatsSubUpdated);
      // eslint-disable-next-line no-use-before-define
      filterNotifier.off('subscription.errors', onError);
      window.location.reload();
    }
  };
  const onError = function () {
    filterNotifier.off('subscription.added', onStatsSubUpdated);
    filterNotifier.off('subscription.errors', onError);
    window.location.reload();
  };
  filterNotifier.on('subscription.updated', onStatsSubUpdated);
  filterNotifier.on('subscription.errors', onError);
  const subscription = Subscription.fromURL(easyPrivacyURL);
  filterStorage.addSubscription(subscription);
  synchronizer.execute(subscription);
});

$('#btnGetPremium').on('click', () => {
  BG.openTab(License.MAB_CONFIG.payURL);
});

$('#btnImageSwapEnable').on('click', () => {
  activateTab('#mab-image-swap');
});

// click handlers for the panels on the "Blocks over Time"

$('#adsblocked_panel').on('click', () => {
  $('#no-click-overlay').show();
  $('#loadingDiv').show();
  showOrHideAdPanelCountNeeded();
  updateChart($('.active-stats-menu-item a').data('chart-type'),
    $('.active-stats-sub-menu-item a').data('filter-function-name'),
    $('.active-stats-sub-menu-item a').data('label-function-name'));
});

$('#trackers_blocked_panel').on('click', () => {
  $('#no-click-overlay').show();
  $('#loadingDiv').show();
  showOrHideTrackerPanelCountNeeded();
  updateChart($('.active-stats-menu-item a').data('chart-type'),
    $('.active-stats-sub-menu-item a').data('filter-function-name'),
    $('.active-stats-sub-menu-item a').data('label-function-name'));
});

$('#ads_replaced_panel').on('click', () => {
  $('#no-click-overlay').show();
  $('#loadingDiv').show();
  showOrHideReplacedPanelCountNeeded();
  updateChart($('.active-stats-menu-item a').data('chart-type'),
    $('.active-stats-sub-menu-item a').data('filter-function-name'),
    $('.active-stats-sub-menu-item a').data('label-function-name'));
});

// Delete data overlay click handlers

$('#stats-page-delete-icon').on('click', () => {
  $('#no-data-overlay').hide();
  $('#overlay').css({
    display: 'block',
  });
  $('#delete_all_stats_data').prop('checked', true);
  $('#local_data_collection_opt_out').prop('checked', false);
  $('#btnDelete').css({ background: 'var(--options-button-bg)' });
  $('#delete-overlay-page1').fadeIn();
});

$('#btnCancelDelete, #delete-overlay-close-icon-page1, #delete-overlay-close-icon-page2').on('click', () => {
  $('#delete-overlay-page1').hide();
  $('#delete-overlay-page2').hide();
  $('#overlay').css({
    display: 'none',
  });
  $('body').css({
    overflow: '',
  });
});

$('#btnDelete').on('click', () => {
  if (!$('#local_data_collection_opt_out').is(':checked')
      && !$('#delete_all_stats_data').is(':checked')) {
    return;
  }
  $('#delete-overlay-page1').fadeOut(400, () => {
    $('#delete-overlay-page2').fadeIn();
  });
});

$('#btnGoBack').on('click', () => {
  $('#delete-overlay-page2').fadeOut(400, () => {
    $('#delete-overlay-page1').fadeIn();
  });
});

$('#delete_all_stats_data, #local_data_collection_opt_out').on('change', () => {
  if (!$('#local_data_collection_opt_out').is(':checked')
      && !$('#delete_all_stats_data').is(':checked')) {
    $('#btnDelete').css({ background: '#E6E6E6' });
    return;
  }
  $('#btnDelete').css({ background: 'var(--options-button-bg)' });
});


$('#btnSureDelete').on('click', () => {
  const checkOtherCheckBox = function () {
    if ($('#local_data_collection_opt_out').is(':checked')) {
      BG.LocalDataCollection.end(() => {
        BG.DataCollectionV2.end(() => {
          window.location.reload();
        });
      });
    } else {
      window.location.reload();
    }
  };
  if ($('#delete_all_stats_data').is(':checked')) {
    browser.storage.local.remove(EXT_STATS_KEY).then(() => {
      BG.LocalDataCollection.clearCache();
      checkOtherCheckBox();
    });
  } else {
    checkOtherCheckBox();
  }
});
