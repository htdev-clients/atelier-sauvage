document.addEventListener("DOMContentLoaded", () => {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;

  const lightboxImg = lightbox.querySelector("img");
  const closeBtn = lightbox.querySelector(".close-btn");
  const prevBtn = lightbox.querySelector(".nav-btn.prev"); // specific selector
  const nextBtn = lightbox.querySelector(".nav-btn.next"); // specific selector

  let currentGroupImages = [];
  let currentIndex = 0;

  // EVENT DELEGATION:
  // Listen for clicks on the whole document, but only react if it's a gallery image.
  // This solves the issue where images injected by JS weren't detected.
  document.addEventListener("click", (e) => {
    const img = e.target;

    // Check if the clicked element is an image inside a gallery section
    if (img.tagName === "IMG" && img.closest(".gallery")) {
      const section = img.closest(".gallery");
      const rawImgs = Array.from(section.querySelectorAll("img"));

      // 1. Calculate visual positions (Logic preserved)
      const positionedImages = rawImgs.map((image) => {
        const rect = image.getBoundingClientRect();
        return { image, rect };
      });

      // 2. Sort visually: Top-to-bottom, then Left-to-right
      positionedImages.sort((a, b) => {
        const tolerance = 15;
        const diffY = a.rect.top - b.rect.top;
        if (Math.abs(diffY) > tolerance) return diffY;
        return a.rect.left - b.rect.left;
      });

      // 3. Update group and index
      currentGroupImages = positionedImages.map((p) => p.image);
      currentIndex = currentGroupImages.indexOf(img);

      if (currentIndex !== -1) {
        openLightbox();
      }
    }
  });

  const openLightbox = () => {
    // Prevent opening if the image array is empty
    if (!currentGroupImages[currentIndex]) return;

    const sourceImg = currentGroupImages[currentIndex];
    
    lightboxImg.src = sourceImg.src;
    lightboxImg.srcset = sourceImg.srcset;
    lightboxImg.sizes = "80vw"; // Matches CSS max-width

    lightboxImg.alt = sourceImg.alt;
    lightbox.classList.add("active");
  };

  const showPrev = () => {
    if (currentGroupImages.length === 0) return;
    currentIndex =
      (currentIndex - 1 + currentGroupImages.length) %
      currentGroupImages.length;
    openLightbox(); // Re-use openLightbox to handle src updates
  };

  const showNext = () => {
    if (currentGroupImages.length === 0) return;
    currentIndex = (currentIndex + 1) % currentGroupImages.length;
    openLightbox();
  };

  // Event Listeners for UI
  closeBtn.addEventListener("click", () => lightbox.classList.remove("active"));

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) lightbox.classList.remove("active");
  });

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showPrev();
  });
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showNext();
  });

  document.addEventListener("keydown", (e) => {
    if (lightbox.classList.contains("active")) {
      if (e.key === "Escape") lightbox.classList.remove("active");
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    }
  });

  // --- SWIPE SUPPORT ---
  
  let touchStartX = 0;
  let touchEndX = 0;
  const minSwipeDistance = 50; // Minimum pixel distance to count as a swipe

  lightbox.addEventListener('touchstart', (e) => {
    // Record where the touch started
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  lightbox.addEventListener('touchend', (e) => {
    // Record where the touch ended
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }, { passive: true });

  function handleSwipe() {
    // Calculate the difference
    const diff = touchStartX - touchEndX;

    // If swipe distance is too small, ignore it (it was likely a tap or scroll attempt)
    if (Math.abs(diff) < minSwipeDistance) return;

    if (diff > 0) {
      // Swiped Left -> Go to Next Image
      showNext();
    } else {
      // Swiped Right -> Go to Previous Image
      showPrev();
    }
  }
});
