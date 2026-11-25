import { shouldBlockHistoryTraversal } from "./listentogether";

function getAdjacentNavigationUrl(
  direction: "back" | "forward",
): string | null {
  try {
    const entries = navigation.entries?.();
    const current = navigation.currentEntry;
    if (!entries || !current) return null;
    const delta = direction === "back" ? -1 : 1;
    return entries[current.index + delta]?.url ?? null;
  } catch {
    return null;
  }
}

export function createNavigationMenuArrows() {
  // Go back in history
  const historyBackElement = document.createElement("span");
  historyBackElement.classList.add(
    "material-symbols-outlined",
    "ytmd-history-back",
    "disabled",
  );
  historyBackElement.innerText = "west";

  historyBackElement.addEventListener("click", function () {
    if (!historyBackElement.classList.contains("disabled")) {
      if (shouldBlockHistoryTraversal(getAdjacentNavigationUrl("back"))) {
        console.warn(
          "[ListenTogether][YTMView] Blocked history.back() traversal during active session",
        );
        return;
      }
      history.back();
    }
  });

  // Go forward in history
  const historyForwardElement = document.createElement("span");
  historyForwardElement.classList.add(
    "material-symbols-outlined",
    "ytmd-history-forward",
    "disabled",
  );
  historyForwardElement.innerText = "east";

  historyForwardElement.addEventListener("click", function () {
    if (!historyForwardElement.classList.contains("disabled")) {
      if (shouldBlockHistoryTraversal(getAdjacentNavigationUrl("forward"))) {
        console.warn(
          "[ListenTogether][YTMView] Blocked history.forward() traversal during active session",
        );
        return;
      }
      history.forward();
    }
  });

  function reconcileNavigationButtons() {
    if (navigation.canGoBack) {
      historyBackElement.classList.remove("disabled");
    } else {
      historyBackElement.classList.add("disabled");
    }

    if (navigation.canGoForward) {
      historyForwardElement.classList.remove("disabled");
    } else {
      historyForwardElement.classList.add("disabled");
    }
  }

  navigation.addEventListener("navigate", (event: any) => {
    if (
      event?.navigationType === "traverse" &&
      shouldBlockHistoryTraversal(event?.destination?.url) &&
      event?.cancelable
    ) {
      console.warn(
        "[ListenTogether][YTMView] Blocked Navigation API traverse event during active session",
      );
      event.preventDefault();
    }
    reconcileNavigationButtons();
  });
  navigation.addEventListener("currententrychange", () => {
    reconcileNavigationButtons();
  });

  const pivotBar = document.querySelector("ytmusic-pivot-bar-renderer");
  if (!pivotBar) {
    // New YTM UI
    const leftContent = document.querySelector("ytmusic-nav-bar ytmusic-logo");
    leftContent?.after(historyBackElement, historyForwardElement);
  } else {
    historyForwardElement.classList.add("pivotbar");
    historyBackElement.classList.add("pivotbar");
    pivotBar.prepend(historyForwardElement);
    pivotBar.prepend(historyBackElement);
  }
}
