(function () {
  if (
    typeof window.HTMLMediaElement_volume !== "undefined" &&
    typeof window.HTMLMediaElement_volume.get !== "undefined" &&
    typeof window.HTMLMediaElement_volume.set !== "undefined"
  ) {
    // Restore the original volume property
    Object.defineProperty(HTMLMediaElement.prototype, "volume", {
      get: window.HTMLMediaElement_volume.get,
      set: window.HTMLMediaElement_volume.set
    });
  }
});
