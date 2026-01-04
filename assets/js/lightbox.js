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
  
  // [NEW] Variable to store where the user was on the page
  let storedScrollY = 0;

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
    lightboxImg.style.maxHeight = ''; 

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

  // --- [NEW] SCROLL LOCKING FUNCTIONS ---
  // This is the "Nuclear Option" that physically pins the body
  const lockBodyScroll = () => {
    storedScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${storedScrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  };

  const unlockBodyScroll = () => {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    window.scrollTo(0, storedScrollY);
  };

  // --- 4. LIGHTBOX DISPLAY ---
  const openLightbox = () => {
    if (!currentGroupImages[currentIndex]) return;

    const imgData = currentGroupImages[currentIndex];
    const total = currentGroupImages.length;
    
    lightboxImg.src = imgData.src;
    lightboxImg.srcset = imgData.srcset;
    lightboxImg.alt = imgData.alt;

    if (total > 1) {
      prevBtn.classList.remove("hidden");
      nextBtn.classList.remove("hidden");
    } else {
      prevBtn.classList.add("hidden");
      nextBtn.classList.add("hidden");
    }

    if (imgData.isCatalog && total > 1) {
      lightboxCounter.textContent = `${currentIndex + 1} / ${total}`;
      lightboxCounter.classList.remove("hidden");
    } else {
      lightboxCounter.classList.add("hidden");
    }

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

    lightbox.classList.add("active");
    
    // Lock the body immediately
    lockBodyScroll();

    requestAnimationFrame(() => {
        updateLayout();
    });
  };

  const closeLightbox = () => {
    lightbox.classList.remove("active");
    // Unlock the body and restore position
    unlockBodyScroll();
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
  closeBtn.addEventListener("click", closeLightbox);
  
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox || e.target.closest(".lightbox-content") === e.target) {
      closeLightbox();
    }
  });
  
  prevBtn.addEventListener("click", (e) => { e.stopPropagation(); showPrev(); });
  nextBtn.addEventListener("click", (e) => { e.stopPropagation(); showNext(); });

  document.addEventListener("keydown", (e) => {
    if (lightbox.classList.contains("active")) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    }
  });

  window.addEventListener("resize", updateLayout);

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