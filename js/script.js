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
      if (nextContainer.indexOf('#') !== 0) {
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
});