document.addEventListener("DOMContentLoaded", () => {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;

  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxCaption = document.getElementById("lightbox-caption");
  const lightboxCounter = document.getElementById("lightbox-counter");
  const contentContainer = lightbox.querySelector(".lightbox-content");
  const closeBtn = lightbox.querySelector(".close-btn");
  const prevBtn = lightbox.querySelector(".nav-btn.prev");
  const nextBtn = lightbox.querySelector(".nav-btn.next");

  let currentGroupImages = [];
  let currentIndex = 0;

  // Variable to store the exact pixel position
  let storedScrollY = 0;

  // --- 1. CLICK HANDLER ---
  document.addEventListener("click", (e) => {
    const img = e.target;
    if (img.tagName === "IMG" && img.closest(".gallery")) {
      const isCatalog =
        img.src.includes("/catalog/") || img.hasAttribute("data-image-count");
      if (isCatalog) {
        setupCatalogGroup(img);
      } else {
        setupInteriorGroup(img);
      }
    }
  });

  // --- 2. SETUP FUNCTIONS ---
  const setupInteriorGroup = (img) => {
    if (window.innerWidth < 768) return;
    const section = img.closest(".gallery");
    const rawImgs = Array.from(section.querySelectorAll("img"));
    const positionedImages = rawImgs.map((image) => {
      const rect = image.getBoundingClientRect();
      return { image, rect };
    });
    positionedImages.sort((a, b) => {
      const tolerance = 15;
      const diffY = a.rect.top - b.rect.top;
      if (Math.abs(diffY) > tolerance) return diffY;
      return a.rect.left - b.rect.left;
    });
    currentGroupImages = positionedImages.map((p) => ({
      src: p.image.src,
      srcset: p.image.srcset,
      alt: p.image.alt,
      isCatalog: false,
    }));
    currentIndex = rawImgs.indexOf(img);
    if (currentIndex !== -1) openLightbox();
  };

  const setupCatalogGroup = (img) => {
    const itemNumber = img.dataset.itemNumber;
    const count = parseInt(img.dataset.imageCount || 1);
    currentGroupImages = [
      {
        src: img.src,
        srcset: img.srcset,
        alt: img.alt,
        isCatalog: true,
      },
    ];

    if (itemNumber && count > 1) {
      for (let i = 1; i < count; i++) {
        const newSrc = img.src.replace(
          `${itemNumber}-1400.webp`,
          `${itemNumber}-${i}-1400.webp`,
        );
        const newSrcset = img.srcset
          .replace(
            new RegExp(`${itemNumber}-480.webp`, "g"),
            `${itemNumber}-${i}-480.webp`,
          )
          .replace(
            new RegExp(`${itemNumber}-800.webp`, "g"),
            `${itemNumber}-${i}-800.webp`,
          )
          .replace(
            new RegExp(`${itemNumber}-1400.webp`, "g"),
            `${itemNumber}-${i}-1400.webp`,
          );

        currentGroupImages.push({
          src: newSrc,
          srcset: newSrcset,
          alt: img.alt,
          isCatalog: true,
        });
      }
    }
    currentIndex = 0;
    openLightbox();
  };

  // --- 3. LAYOUT CALCULATION ---
  const updateLayout = () => {
    if (!lightbox.classList.contains("active")) return;
    lightboxImg.style.maxHeight = "";

    const windowHeight = window.innerHeight;
    const isCatalog = !lightboxCaption.classList.contains("hidden");

    let padding = 0;
    let captionHeight = 0;

    if (isCatalog) {
      padding = 32;
      captionHeight = lightboxCaption.offsetHeight + 12;
    }

    const availableHeight = windowHeight - padding - captionHeight;
    lightboxImg.style.maxHeight = `${availableHeight}px`;
  };

  // --- SCROLL LOCKING FUNCTIONS ---
  const lockBodyScroll = () => {
    // 1. Guard Clause: If body is already fixed, DO NOT update storedScrollY.
    if (document.body.style.position === "fixed") return;

    storedScrollY = window.scrollY;

    // 2. Prevent Layout Shift (calculate scrollbar width)
    const scrollbarWidth = window.innerWidth - document.body.clientWidth;

    document.body.style.position = "fixed";
    document.body.style.top = `-${storedScrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";

    // Add padding to body so content doesn't shift when scrollbar disappears
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  };

  const unlockBodyScroll = () => {
    // 3. FORCE INSTANT SCROLL (Disable smooth scrolling temporarily)
    document.documentElement.style.scrollBehavior = "auto";

    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.width = "";
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";

    // Restore position instantly
    window.scrollTo(0, storedScrollY);

    // 4. Re-enable smooth scrolling after the jump is done
    setTimeout(() => {
      document.documentElement.style.scrollBehavior = "";
    }, 10);
  };

  // --- 4. LIGHTBOX DISPLAY ---
  // Helper: Updates the image and caption without animation logic
  const updateImageContent = () => {
    if (!currentGroupImages[currentIndex]) return;

    const imgData = currentGroupImages[currentIndex];
    const total = currentGroupImages.length;

    lightboxImg.src = imgData.src;
    lightboxImg.srcset = imgData.srcset;
    lightboxImg.alt = imgData.alt;

    // Button visibility
    if (total > 1) {
      prevBtn.classList.remove("hidden");
      nextBtn.classList.remove("hidden");
    } else {
      prevBtn.classList.add("hidden");
      nextBtn.classList.add("hidden");
    }

    // Counter
    if (imgData.isCatalog && total > 1) {
      lightboxCounter.textContent = `${currentIndex + 1} / ${total}`;
      lightboxCounter.classList.remove("hidden");
    } else {
      lightboxCounter.classList.add("hidden");
    }

    // Caption & Styles
    lightboxImg.classList.remove("rounded-md");
    if (imgData.isCatalog) {
      lightboxCaption.textContent = imgData.alt;
      lightboxCaption.classList.remove("hidden");
      contentContainer.classList.add("p-4");
      lightboxImg.classList.add("rounded-md");
    } else {
      lightboxCaption.classList.add("hidden");
      contentContainer.classList.remove("p-4");
    }
  };

  const openLightbox = () => {
    // 1. Prepare data
    updateImageContent();

    // 2. Set initial state to INVISIBLE
    // Add counter to the list
    lightboxImg.classList.add("opacity-0");
    if (lightboxCaption) lightboxCaption.classList.add("opacity-0");
    if (lightboxCounter) lightboxCounter.classList.add("opacity-0"); // <--- NEW

    // 3. Open Modal
    lightbox.classList.add("active");
    lockBodyScroll();

    // Helper: Reveals content
    const revealContent = () => {
      updateLayout();
      requestAnimationFrame(() => {
        lightboxImg.classList.remove("opacity-0");
        if (lightboxCaption) lightboxCaption.classList.remove("opacity-0");
        if (lightboxCounter) lightboxCounter.classList.remove("opacity-0"); // <--- NEW
      });
    };

    // 4. Loading Logic
    if (lightboxImg.complete && lightboxImg.naturalWidth > 0) {
      setTimeout(revealContent, 50);
    } else {
      lightboxImg.onload = () => {
        revealContent();
        lightboxImg.onload = null;
      };
      lightboxImg.onerror = () => {
        revealContent();
        lightboxImg.onload = null;
      };
    }
  };

  let isAnimating = false;

  const animateSlide = (direction) => {
    if (isAnimating) return;
    isAnimating = true;

    const exitClass = direction === 1 ? "-translate-x-20" : "translate-x-20";
    const enterClass = direction === 1 ? "translate-x-20" : "-translate-x-20";

    // 1. Slide OUT (Fade out Image AND Counter)
    lightboxImg.classList.add("opacity-0", exitClass);
    if (lightboxCounter) lightboxCounter.classList.add("opacity-0"); // <--- NEW

    setTimeout(() => {
      if (!lightbox.classList.contains("active")) {
        isAnimating = false;
        lightboxImg.classList.remove("opacity-0", exitClass);
        if (lightboxCounter) lightboxCounter.classList.remove("opacity-0"); // Cleanup
        return;
      }

      if (direction === 1) {
        currentIndex = (currentIndex + 1) % currentGroupImages.length;
      } else {
        currentIndex =
          (currentIndex - 1 + currentGroupImages.length) %
          currentGroupImages.length;
      }

      const showNewImage = () => {
        updateLayout();

        // Teleport
        lightboxImg.style.transition = "none";
        lightboxImg.classList.remove(exitClass);
        lightboxImg.classList.add(enterClass);

        void lightboxImg.offsetWidth;

        // Slide IN (Reveal Image AND Counter)
        lightboxImg.style.transition = "";
        lightboxImg.classList.remove("opacity-0", enterClass);
        if (lightboxCounter) lightboxCounter.classList.remove("opacity-0"); // <--- NEW

        setTimeout(() => {
          isAnimating = false;
        }, 300);
      };

      lightboxImg.onload = () => {
        showNewImage();
        lightboxImg.onload = null;
      };

      lightboxImg.onerror = () => {
        showNewImage();
        lightboxImg.onload = null;
      };

      // The text actually updates HERE, while hidden
      updateImageContent();

      if (lightboxImg.complete && lightboxImg.naturalWidth > 0) {
        lightboxImg.onload();
      }
    }, 300);
  };

  // [UPDATED] CLOSE FUNCTION WITH CLEANUP
  const closeLightbox = () => {
    lightbox.classList.remove("active");
    // Unlock body
    unlockBodyScroll();

    // Clear image after 300ms (matching transition duration)
    // This prevents the "ghost" of the previous image appearing on next open
    setTimeout(() => {
      lightboxImg.src = "";
      lightboxImg.srcset = "";
    }, 300);
  };

  // --- NAVIGATION ---
  const showPrev = () => {
    if (currentGroupImages.length <= 1) return;
    animateSlide(-1); // -1 for previous
  };

  const showNext = () => {
    if (currentGroupImages.length <= 1) return;
    animateSlide(1); // 1 for next
  };

  // --- EVENTS ---
  closeBtn.addEventListener("click", closeLightbox);

  // "Click Outside" Exclusion Logic
  lightbox.addEventListener("click", (e) => {
    const target = e.target;
    const isClickInsideImage = target.closest(".relative.inline-flex");
    const isClickOnCaption = target.closest("#lightbox-caption");
    const isClickOnButton = target.closest("button");

    if (!isClickInsideImage && !isClickOnCaption && !isClickOnButton) {
      closeLightbox();
    }
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
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    }
  });

  window.addEventListener("resize", updateLayout);

  // --- TOUCH GESTURES (SWIPE) ---
  let touchStartX = 0;
  let touchStartY = 0;
  const minSwipeDistance = 50;

  lightbox.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    },
    { passive: true },
  );

  lightbox.addEventListener(
    "touchend",
    (e) => {
      const touchEndX = e.changedTouches[0].screenX;
      const touchEndY = e.changedTouches[0].screenY;

      // Calculate differences
      const diffX = touchStartX - touchEndX;
      const diffY = touchEndY - touchStartY;

      // Check dominant direction
      if (Math.abs(diffY) > Math.abs(diffX)) {
        // VERTICAL SWIPE (Down)
        if (diffY > minSwipeDistance) {
          // --- NEW ANIMATION LOGIC ---
          // 1. Slide down and Fade out
          lightboxImg.classList.add("translate-y-24", "opacity-0");
          if (lightboxCaption) lightboxCaption.classList.add("opacity-0");
          if (lightboxCounter) lightboxCounter.classList.add("opacity-0");

          // 2. Wait for animation, then close
          setTimeout(() => {
            closeLightbox();

            // 3. Cleanup the "slide down" class so it doesn't affect the next open
            setTimeout(() => {
              lightboxImg.classList.remove("translate-y-24");
            }, 300);
          }, 300); // Match CSS duration
          // ---------------------------
        }
      } else {
        // HORIZONTAL SWIPE (Next/Prev)
        if (Math.abs(diffX) > minSwipeDistance) {
          if (diffX > 0) showNext();
          else showPrev();
        }
      }
    },
    { passive: true },
  );
});
