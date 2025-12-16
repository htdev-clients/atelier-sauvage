/* --- LIGHTBOX LOGIC --- */
document.addEventListener('DOMContentLoaded', () => {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return;

    const lightboxImg = lightbox.querySelector("img");
    const closeBtn = lightbox.querySelector(".close-btn");
    const prevBtn = lightbox.querySelector(".prev");
    const nextBtn = lightbox.querySelector(".next");
    
    let currentGroupImages = []; 
    let currentIndex = 0;

    // Helper: Find all gallery sections
    const gallerySections = document.querySelectorAll('.gallery');
    
    gallerySections.forEach(section => {
        const rawImgs = Array.from(section.querySelectorAll('img'));
        
        rawImgs.forEach((img) => {
            img.addEventListener("click", (e) => {
                // 1. Calculate visual positions
                const positionedImages = rawImgs.map(image => {
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
                currentGroupImages = positionedImages.map(p => p.image);
                currentIndex = currentGroupImages.indexOf(img);

                openLightbox();
            });
        });
    });

    const openLightbox = () => {
        if (currentIndex < 0 || currentIndex >= currentGroupImages.length) return;
        lightboxImg.src = currentGroupImages[currentIndex].src;
        lightbox.classList.add('active'); 
    };

    const showPrev = () => {
        if (currentGroupImages.length === 0) return;
        currentIndex = (currentIndex - 1 + currentGroupImages.length) % currentGroupImages.length;
        lightboxImg.src = currentGroupImages[currentIndex].src;
    };

    const showNext = () => {
        if (currentGroupImages.length === 0) return;
        currentIndex = (currentIndex + 1) % currentGroupImages.length;
        lightboxImg.src = currentGroupImages[currentIndex].src;
    };

    closeBtn.addEventListener("click", () => lightbox.classList.remove('active'));
    lightbox.addEventListener("click", (e) => {
        if (e.target === lightbox) lightbox.classList.remove('active');
    });
    prevBtn.addEventListener("click", (e) => { e.stopPropagation(); showPrev(); });
    nextBtn.addEventListener("click", (e) => { e.stopPropagation(); showNext(); });

    document.addEventListener("keydown", (e) => {
        if (lightbox.classList.contains('active')) {
            if (e.key === "Escape") lightbox.classList.remove('active');
            if (e.key === "ArrowLeft") showPrev();
            if (e.key === "ArrowRight") showNext();
        }
    });
});
