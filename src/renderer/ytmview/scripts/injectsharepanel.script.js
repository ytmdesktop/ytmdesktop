(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const processedPanels = new WeakSet();

  function createTelegramSvg() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 60 60");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("aria-hidden", "true");

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "30");
    circle.setAttribute("cy", "30");
    circle.setAttribute("r", "30");
    circle.setAttribute("fill", "#229ED9");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "#fff");
    path.setAttribute(
      "d",
      "M44.426 16.95L39.303 41.1c-.386 1.708-1.39 2.126-2.816 1.324l-7.78-5.732-3.755 3.614c-.414.415-.763.764-1.562.764l.556-7.881 14.354-12.97c.625-.555-.136-.866-.965-.31L19.6 29.073l-7.65-2.393c-1.663-.52-1.696-1.663.347-2.463l29.894-11.52c1.386-.513 2.6.312 2.236 2.252z"
    );

    svg.appendChild(circle);
    svg.appendChild(path);
    return svg;
  }

  function buildTelegramInner(iconSize) {
    const btn = document.createElement("button");
    btn.className = "ytmd-share-target-button";
    btn.setAttribute("title", "Telegram");
    btn.setAttribute("aria-label", "Telegram");

    const iconSpan = document.createElement("span");
    iconSpan.className = "ytmd-share-target-icon";
    iconSpan.style.width = iconSize.width + "px";
    iconSpan.style.height = iconSize.height + "px";
    iconSpan.appendChild(createTelegramSvg());

    const labelDiv = document.createElement("div");
    labelDiv.className = "ytmd-share-target-label";
    labelDiv.textContent = "Telegram";

    btn.appendChild(iconSpan);
    btn.appendChild(labelDiv);
    return btn;
  }

  function injectTelegram(panel, toolbar, template) {
    const clone = template.cloneNode(true);
    toolbar.appendChild(clone);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const siblingIcon = template.querySelector("yt-icon, .yt-icon-shape");
        const iconSize = siblingIcon
          ? siblingIcon.getBoundingClientRect()
          : { width: 60, height: 60 };

        while (clone.firstChild) clone.removeChild(clone.firstChild);

        const inner = buildTelegramInner(iconSize);
        clone.appendChild(inner);

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

        clone.addEventListener("click", handleShare, { capture: true });
        inner.addEventListener("click", handleShare, { capture: true });
      });
    });
  }

  function tryInject(panel) {
    if (processedPanels.has(panel)) return true;

    const toolbar = panel.querySelector('#contents[role="toolbar"]');
    if (!toolbar) return false;

    const template = toolbar.querySelector("yt-share-target-renderer");
    if (!template) return false;

    processedPanels.add(panel);
    injectTelegram(panel, toolbar, template);
    return true;
  }

  function waitForPanelReady(panel) {
    if (tryInject(panel)) return;

    const innerObserver = new MutationObserver(() => {
      if (tryInject(panel)) {
        innerObserver.disconnect();
      }
    });
    innerObserver.observe(panel, { childList: true, subtree: true });

    setTimeout(() => innerObserver.disconnect(), 5000);
  }

  function checkExistingPanel() {
    const panel = document.querySelector("ytmusic-unified-share-panel-renderer");
    if (panel && !processedPanels.has(panel)) {
      waitForPanelReady(panel);
    }
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;

        let panel = null;
        if (node.matches && node.matches("ytmusic-unified-share-panel-renderer")) {
          panel = node;
        } else if (node.querySelector) {
          panel = node.querySelector("ytmusic-unified-share-panel-renderer");
        }

        if (panel && !processedPanels.has(panel)) {
          waitForPanelReady(panel);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  checkExistingPanel();
  setInterval(checkExistingPanel, 1000);
})
