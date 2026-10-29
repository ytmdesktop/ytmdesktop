export function createNavigationMenuArrows() {
  // Go back in history
  const historyBackElement = document.createElement("span");
  historyBackElement.classList.add("material-symbols-outlined", "ytmd-history-back", "disabled");
  historyBackElement.innerText = "west";

  historyBackElement.addEventListener("click", function () {
    if (!historyBackElement.classList.contains("disabled")) {
      history.back();
    }
  });

  // Go forward in history
  const historyForwardElement = document.createElement("span");
  historyForwardElement.classList.add("material-symbols-outlined", "ytmd-history-forward", "disabled");
  historyForwardElement.innerText = "east";

  historyForwardElement.addEventListener("click", function () {
    if (!historyForwardElement.classList.contains("disabled")) {
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

  navigation.addEventListener("navigate", () => {
    reconcileNavigationButtons();
  });
  navigation.addEventListener("currententrychange", () => {
    reconcileNavigationButtons();
  });

  const pivotBar = document.querySelector("ytmusic-pivot-bar-renderer");
  if (!pivotBar) {
    // New YTM UI
    const searchBar = document.querySelector("ytmusic-search-box");
    const navBar = searchBar?.parentNode;
    navBar?.insertBefore(historyForwardElement, searchBar);
    navBar?.insertBefore(historyBackElement, historyForwardElement);
  } else {
    historyForwardElement.classList.add("pivotbar");
    historyBackElement.classList.add("pivotbar");
    pivotBar.prepend(historyForwardElement);
    pivotBar.prepend(historyBackElement);
  }
}
