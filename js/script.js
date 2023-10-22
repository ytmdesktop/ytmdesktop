const disableGitHubRelease = false;

document.addEventListener("DOMContentLoaded", function () {

  // Scroll Spy
  const offsetCheck = window.innerHeight / 3;
  var sectionsIds = document.querySelectorAll('header nav a');
  window.addEventListener('scroll', function () {
    sectionsIds.forEach(function (currentValue, currentIndex, listObj) {
      const container = currentValue.getAttribute('href');
      if (container.indexOf('#') !== 0) {
        return;
      }

      const containerOffset = document.querySelector(container).offsetTop;
      const nextContainer = listObj[currentIndex + 1] ? listObj[currentIndex + 1].getAttribute('href') : null;
      if (nextContainer && nextContainer.indexOf('#') !== 0) {
        return;
      }

      let containerHeight;
      if (nextContainer) {
        containerHeight = document.querySelector(nextContainer).offsetTop;
      } else {
        containerHeight = document.querySelector(container).offsetHeight;
      }

      const containerBottom = containerOffset + containerHeight;

      const scrollPosition = window.pageYOffset;
      if (scrollPosition < containerBottom - offsetCheck && scrollPosition >= containerOffset - offsetCheck) {
        for (var j = currentIndex; j >= 0; j--) {
          listObj[j].classList.remove('fill');
        }
        currentValue.classList.add('fill');
      } else {
        currentValue.classList.remove('fill');
      }
    });
  });

  // Get the latestest releast from GitHub
  (async function() {
    if (disableGitHubRelease) { return; }
    const release = await fetch('https://api.github.com/repos/ytmdesktop/ytmdesktop/releases').then(response => response.json());
    if (release.message.indexOf('API rate limit exceeded') !== -1) {
      return;
    }

    const latestRelease = release[0];
    const latest_NotPreRelease = release.find(release => !release.prerelease);
    if (latestRelease !== latest_NotPreRelease) {
      displayRelease('pre-release', latestRelease);
    }
    else {
      document.querySelector('#download .pre-release').style.display = 'none';
    }

    displayRelease('latest', latest_NotPreRelease);
  })();


  // Detect platform
  (async function() {
    // check if browser supports it
    if (!navigator.userAgentData && !navigator.userAgentData.getHighEntropyValues) {
      // fallback to useragent
      
    }

    else {
      const platformInfo = await navigator.userAgentData.getHighEntropyValues([ "architecture", "bitness" ]);

      if (platformInfo.platform === 'Windows') {
      }
      else if (platformInfo.platform === 'macOS') {
      }
      else if (platformInfo.platform === 'Linux') {
      }
    }
  })();


  async function displayRelease(releaseType, releaseInfo) {
    const release = document.querySelector(`#download .${releaseType}`);
    const releaseTag = release.querySelector('.release-tag');

    releaseTag.innerText = releaseInfo.tag_name + ` (${new Date(releaseInfo.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' })})`;

    const releaseAssets = release.querySelector('.grid');
    const assets = await fetch(releaseInfo.assets_url).then(response => response.json());
    if (assets.message.indexOf('API rate limit exceeded') !== -1) {
      return;
    }

    assets.forEach(asset => {
      if (asset.name.indexOf('Setup.exe') !== -1) {
        releaseAssets.querySelector('.windows-x64').href = asset.browser_download_url;
      }
      else if (asset.name .indexOf('amd64.deb') !== -1) {
        releaseAssets.querySelector('.linux-x64-deb').href = asset.browser_download_url;
      }
      else if (asset.name.indexOf('x86_64.rpm') !== -1) {
        releaseAssets.querySelector('.linux-x64-rpm').href = asset.browser_download_url;
      }
      else if (asset.name.indexOf('arm64.deb') !== -1) {
        // releaseAssets.querySelector('.linux-arm-deb').href = asset.browser_download_url;
      }
      else if (asset.name.indexOf('arm64.rpm') !== -1) {
        // releaseAssets.querySelector('.linux-arm-rpm').href = asset.browser_download_url;
      }
      else if (asset.name.indexOf('darwin-x64') !== -1) {
        releaseAssets.querySelector('.macos-x64').href = asset.browser_download_url;
      }
      else if (asset.name.indexOf('darwin-arm64') !== -1) {
        releaseAssets.querySelector('.macos-arm').href = asset.browser_download_url;
      }
    });
  }
});