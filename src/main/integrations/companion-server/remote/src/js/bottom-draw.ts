import { $ } from "./util";

document.addEventListener("DOMContentLoaded", function () {
  const header = $(".header");
  const bottomDraw = $(".bottom-draw");
  header.addEventListener("click", function () {
    if (bottomDraw.hasAttribute("open")) {
      bottomDraw.removeAttribute("open");
    }
  });

  const materialtabs = bottomDraw.getElementsByClassName("material-tabs");
  for (let i = 0; i < materialtabs.length; i++) {
    const currentMTab = materialtabs[i];
    const links = currentMTab.querySelectorAll("a");

    const active = links[0];
    active.classList.add("active");

    const content = $(active.getAttribute("href"));
    content.style.display = null;

    links.forEach(link => {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        const targetElement = e.target as HTMLElement;

        const active = currentMTab.querySelector(".active");
        active.classList.remove("active");

        const content = $(active.getAttribute("href"));
        content.style.display = "none";

        targetElement.classList.add("active");
        const target = $(targetElement.getAttribute("href"));
        target.style.display = null;

        const bottomDraw = $(".bottom-draw");
        bottomDraw.setAttribute("open", "");
      });

      if (link === active) {
        return;
      }

      const target = $(link.getAttribute("href"));
      target.style.display = "none";
    });
  }
});
