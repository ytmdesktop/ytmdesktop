import { $, api_version } from "./util";
import { ErrorData } from "./type";

const errorDialog = $("#error-dialog") as HTMLDialogElement;
function error_show(data: ErrorData) {
  if (!data.code && data.message) {
    errorDialog.querySelector("h2").innerText = data.error;
    errorDialog.querySelector("p").innerText = data.message;
    errorDialog.showModal();
    return;
  }

  if (!data.code && !data.message) {
    if (data.error === "UNAUTHORIZED") {
      data.code = data.error;
    } else {
      errorDialog.querySelector("h2").innerText = "Unknown Error";
      errorDialog.querySelector("p").innerText = data.error;
      errorDialog.showModal();
      return;
    }
  }

  errorDialog.querySelector("h2").innerText = "Error - " + data.code;
  switch (data.code) {
    case "NO_IP":
      errorDialog.querySelector("p").innerText = "No IP Address was provided. Please refresh and try again.";
      break;

    case "UNSUPPORTED_API":
      errorDialog.querySelector("p").innerText =
        `No supported API Version in current Application. Required Version ${api_version}. Please update YouTube Music Desktop Player.`;
      break;

    case "UNAUTHENTICATED":
      errorDialog.querySelector("p").innerText = "You are not authenticated. Please try again.";
      localStorage.removeItem("code");
      localStorage.removeItem("token");
      break;

    case "UNAUTHORIZED":
      errorDialog.querySelector("p").innerText = "You are not authorized to access this resource. Please try again.";
      localStorage.removeItem("code");
      localStorage.removeItem("token");
      break;

    case "AUTHORIZATION_TIME_OUT":
      errorDialog.querySelector("p").innerText = "Authorization request timed out. Please try again.";
      break;

    case "AUTHORIZATION_DENIED":
      errorDialog.querySelector("p").innerText = "Authorization request was denied. Please try again.";
      break;

    case "AUTHORIZATION_TOO_MANY":
      errorDialog.querySelector("p").innerText = "Too many authorization requests. Please try removing some other connections and try again.";
      break;

    case "AUTHORIZATION_DISABLED":
      errorDialog.querySelector("p").innerText = "New Authorizations are currently disabled. Please enable it and try again.";
      break;

    case "AUTHORIZATION_INVALID":
      errorDialog.querySelector("p").innerText = "Authorization code is invalid. Please try again.";
      break;

    case "YOUTUBE_MUSIC_UNVAILABLE":
      errorDialog.querySelector("p").innerText = "YouTube Music is currently unavailable. Please try again later.";
      break;

    case "YOUTUBE_MUSIC_TIME_OUT":
      errorDialog.querySelector("p").innerText = "Request to YouTube Music timed out. Please try again.";
      break;
  }

  errorDialog.showModal();
}
errorDialog.querySelector("button").addEventListener("click", function () {
  errorDialog.close();
});

const infoDialog = $("#info-dialog") as HTMLDialogElement;
function info_show(title: string, message: string | string[]) {
  infoDialog.querySelector("h2").innerText = title;
  infoDialog.querySelector("p").innerText = typeof message === "object" ? message.join("\n") : message;
  infoDialog.showModal();
}
infoDialog.querySelector("button").addEventListener("click", function () {
  infoDialog.close();
});

function info_close() {
  infoDialog.close();
}

export { error_show, info_show, info_close };
