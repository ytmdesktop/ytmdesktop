(function () {
  const telegramSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" focusable="false" aria-hidden="true" style="pointer-events: none; display: inherit; width: 100%; height: 100%;"><circle cx="30" cy="30" r="30" fill="#229ED9"/><path fill="#fff" d="M44.426 16.95L39.303 41.1c-.386 1.708-1.39 2.126-2.816 1.324l-7.78-5.732-3.755 3.614c-.414.415-.763.764-1.562.764l.556-7.881 14.354-12.97c.625-.555-.136-.866-.965-.31L19.6 29.073l-7.65-2.393c-1.663-.52-1.696-1.663.347-2.463l29.894-11.52c1.386-.513 2.6.312 2.236 2.252z"/></svg>`;

  function createTelegramTarget(template) {
    const telegramTarget = template.cloneNode(true);

    const btn = telegramTarget.querySelector("button#target");
    btn.setAttribute("title", "Telegram");
    btn.setAttribute("aria-label", "Telegram");

    const titleDiv = telegramTarget.querySelector("#title");
    if (titleDiv) titleDiv.textContent = "Telegram";

    const iconDiv = telegramTarget.querySelector(".yt-icon-shape > div");
    if (iconDiv) iconDiv.innerHTML = telegramSvg;

    const handleShare = e => {
      e.preventDefault();
      e.stopImmediatePropagation();

      const dialog = document.querySelector("ytmusic-unified-share-panel-renderer");
      const urlInput = dialog ? dialog.querySelector("input#share-url") : null;
      const shareUrl = urlInput ? urlInput.value : null;
      if (shareUrl) {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}`);
      }
    };

    telegramTarget.addEventListener("click", handleShare, { capture: true });
    btn.addEventListener("click", handleShare, { capture: true });

    return telegramTarget;
  }

  function injectTelegramIntoPanel(panel) {
    const toolbar = panel.querySelector('#contents[role="toolbar"]');
    if (!toolbar) return false;
    if (toolbar.querySelector('[title="Telegram"]')) return true;

    const existing = toolbar.querySelector("yt-share-target-renderer");
    if (!existing) return false;

    toolbar.appendChild(createTelegramTarget(existing));
    return true;
  }

  function tryInjectWithRetries(panel, attemptsLeft) {
    if (injectTelegramIntoPanel(panel)) return;
    if (attemptsLeft <= 0) return;
    setTimeout(() => tryInjectWithRetries(panel, attemptsLeft - 1), 50);
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const panel =
          node.matches && node.matches("ytmusic-unified-share-panel-renderer")
            ? node
            : node.querySelector && node.querySelector("ytmusic-unified-share-panel-renderer");
        if (panel) {
          tryInjectWithRetries(panel, 20);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
});
