import { Thumbnail } from "./type";

const $ = (selector: string) => {
  return document.querySelector(selector) as HTMLElement;
};

const api_version = "v1";
const getPrefix = (withVer: boolean = true) => {
  return `http://${localStorage.getItem("ip") || "localhost"}:9863` + (withVer ? `/api/${api_version}` : "");
};

function getThumbnail(thumbnails: Thumbnail[], maxSize: number = 1024) {
  let maxHeight = 0;
  let selectedThumbnail: Thumbnail = null;
  thumbnails.forEach(thumbnail => {
    if (thumbnail.height > maxHeight && thumbnail.height <= maxSize) {
      maxHeight = thumbnail.height;
      selectedThumbnail = thumbnail;
    }
  });

  return selectedThumbnail?.url || thumbnails[thumbnails.length - 1].url;
}

function humanReadableSeconds(seconds: number) {
  seconds = Math.floor(seconds);
  // Have to convert to MM:SS but also HH:MM:SS
  if (seconds < 60) {
    return `00:${seconds < 10 ? "0" : ""}${seconds}`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes < 10 ? "0" : ""}${minutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`;
  }

  const hours = Math.floor(seconds / 3600);
  const remainingMinutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours < 10 ? "0" : ""}${hours}:${remainingMinutes < 10 ? "0" : ""}${remainingMinutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`;
}

export { api_version, $, getPrefix, getThumbnail, humanReadableSeconds };
