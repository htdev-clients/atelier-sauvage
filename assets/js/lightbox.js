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

  // --- 1. CLICK HANDLER ---
  document.addEventListener("click", (e) => {
    const img = e.target;
    if (img.tagName === "IMG" && img.closest(".gallery")) {
      const isCatalog = img.src.includes("/catalog/") || img.hasAttribute("data-image-count");
      if (isCatalog) {
        setupCatalogGroup(img);
      } else {
        setupInteriorGroup(img);
      }
    }
  });

  // --- 2. SETUP FUNCTIONS ---
  const setupInteriorGroup = (img) => {
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
      isCatalog: false
    }));
    currentIndex = rawImgs.indexOf(img);
    if (currentIndex !== -1) openLightbox();
  };

  const setupCatalogGroup = (img) => {
    const itemNumber = img.dataset.itemNumber; 
    const count = parseInt(img.dataset.imageCount || 1); 
    currentGroupImages = [{
      src: img.src,
      srcset: img.srcset,
      alt: img.alt,
      isCatalog: true
    }];

    if (itemNumber && count > 1) {
      for (let i = 1; i < count; i++) {
        const newSrc = img.src.replace(`${itemNumber}-2000.jpeg`, `${itemNumber}-${i}-2000.jpeg`);
        const newSrcset = img.srcset
          .replace(new RegExp(`${itemNumber}-480.jpeg`, 'g'), `${itemNumber}-${i}-480.jpeg`)
          .replace(new RegExp(`${itemNumber}-800.jpeg`, 'g'), `${itemNumber}-${i}-800.jpeg`)
          .replace(new RegExp(`${itemNumber}-2000.jpeg`, 'g'), `${itemNumber}-${i}-2000.jpeg`);
        
        currentGroupImages.push({
          src: newSrc,
          srcset: newSrcset,
          alt: img.alt,
          isCatalog: true
        });
      }
    }
    currentIndex = 0; 
    openLightbox();
  };

  // --- 3. LAYOUT CALCULATION ---
  const updateLayout = () => {
    if (!lightbox.classList.contains("active")) return;

    // Reset height to measure natural size
    lightboxImg.style.maxHeight = ''; 

    const windowHeight = window.innerHeight;
    
    // Check mode
    const isCatalog = !lightboxCaption.classList.contains("hidden");
    
    // Logic: 
    // Catalog = 32px padding + Caption Height
    // Interior = 0px padding + 0 Caption Height
    let padding = 0;
    let captionHeight = 0;

    if (isCatalog) {
      padding = 32; // 2rem (p-4 top + bottom)
      captionHeight = lightboxCaption.offsetHeight + 12; // +12 for mt-3
    }

    const availableHeight = windowHeight - padding - captionHeight;
    
    lightboxImg.style.maxHeight = `${availableHeight}px`;
  };

  // --- 4. LIGHTBOX DISPLAY ---
  const openLightbox = () => {
    if (!currentGroupImages[currentIndex]) return;

    const imgData = currentGroupImages[currentIndex];
    const total = currentGroupImages.length;
    
    lightboxImg.src = imgData.src;
    lightboxImg.srcset = imgData.srcset;
    lightboxImg.alt = imgData.alt;

    // A. ARROWS
    if (total > 1) {
      prevBtn.classList.remove("hidden");
      nextBtn.classList.remove("hidden");
    } else {
      prevBtn.classList.add("hidden");
      nextBtn.classList.add("hidden");
    }

    // B. COUNTER
    if (imgData.isCatalog && total > 1) {
      lightboxCounter.textContent = `${currentIndex + 1} / ${total}`;
      lightboxCounter.classList.remove("hidden");
    } else {
      lightboxCounter.classList.add("hidden");
    }

    // C. MODE SETUP
    lightboxImg.classList.remove("rounded-md");

    if (imgData.isCatalog) {
      // CATALOG MODE
      lightboxCaption.textContent = imgData.alt;
      lightboxCaption.classList.remove("hidden");
      
      contentContainer.classList.add("p-4");
      lightboxImg.classList.add("rounded-md");
    } else {
      // INTERIOR MODE
      lightboxCaption.classList.add("hidden");
      contentContainer.classList.remove("p-4");
    }

    lightbox.classList.add("active");
    
    // Wait for DOM update
    requestAnimationFrame(() => {
        updateLayout();
    });
  };

  // --- NAVIGATION ---
  const showPrev = () => {
    if (currentGroupImages.length <= 1) return; 
    currentIndex = (currentIndex - 1 + currentGroupImages.length) % currentGroupImages.length;
    openLightbox();
  };

  const showNext = () => {
    if (currentGroupImages.length <= 1) return; 
    currentIndex = (currentIndex + 1) % currentGroupImages.length;
    openLightbox();
  };

  // --- EVENTS ---
  closeBtn.addEventListener("click", () => lightbox.classList.remove("active"));
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox || e.target.closest(".lightbox-content") === e.target) {
      lightbox.classList.remove("active");
    }
  });
  prevBtn.addEventListener("click", (e) => { e.stopPropagation(); showPrev(); });
  nextBtn.addEventListener("click", (e) => { e.stopPropagation(); showNext(); });

  document.addEventListener("keydown", (e) => {
    if (lightbox.classList.contains("active")) {
      if (e.key === "Escape") lightbox.classList.remove("active");
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    }
  });

  window.addEventListener("resize", () => {
    updateLayout();
  });

  let touchStartX = 0;
  const minSwipeDistance = 50;
  lightbox.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  lightbox.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    if (Math.abs(touchStartX - touchEndX) > minSwipeDistance) {
      if (touchStartX - touchEndX > 0) showNext();
      else showPrev();
    }
  }, { passive: true });
});