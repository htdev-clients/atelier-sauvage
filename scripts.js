// scripts.js

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

/* --- INSTAGRAM INTEGRATION --- */
(function() {
    const instaCard = document.getElementById('insta-card');
    let currentAlbum = [];
    let currentIndex = 0;
    let isAnimating = false;

    async function loadLatestPost() {
        if (!instaCard) return;

        try {
            const response = await fetch('/instagram'); 
            if (!response.ok) throw new Error("API Error");
            const data = await response.json();
            if (data.user && data.post) {
                renderCard(data.user, data.post);
            }
        } catch (err) {
            console.error("Insta Feed Error:", err);
            instaCard.style.display = 'none';
        }
    }

    function renderCard(user, post) {
        // SECURITY: Add rel="noopener noreferrer"
        const userNameLink = document.getElementById('user-name');
        if(userNameLink) {
            userNameLink.innerText = user.username;
            userNameLink.href = `https://instagram.com/${user.username}`;
            userNameLink.rel = "noopener noreferrer"; 
        }

        const captionUser = document.getElementById('caption-username');
        if(captionUser) captionUser.innerText = user.username;

        currentAlbum = [];
        if (post.media_type === 'CAROUSEL_ALBUM' && post.children) {
            post.children.data.forEach(child => {
                currentAlbum.push(child.media_type === 'VIDEO' ? child.thumbnail_url : child.media_url);
            });
        } else {
            currentAlbum.push(post.media_type === 'VIDEO' ? post.thumbnail_url : post.media_url);
        }

        currentIndex = 0;
        updateUIControls();
        
        const imgElement = document.getElementById('current-img');
        if(imgElement && currentAlbum.length > 0) {
            imgElement.src = currentAlbum[0];
            // PERFORMANCE: Add async decoding
            imgElement.decoding = "async"; 
            imgElement.classList.remove('hidden');
        }

        const postLink = document.getElementById('post-link');
        if(postLink) {
            postLink.href = post.permalink;
            postLink.rel = "noopener noreferrer";
        }

        const captionText = document.getElementById('caption-text');
        if(captionText) captionText.innerText = post.caption || "";

        const timestampEl = document.getElementById('timestamp');
        if(timestampEl) {
            const date = new Date(post.timestamp);
            const now = new Date();
            const diffDays = Math.floor(Math.abs(now - date) / (1000 * 60 * 60 * 24));
            timestampEl.innerText = diffDays > 0 ? `${diffDays} DAYS AGO` : "TODAY";
        }
        
        instaCard.style.display = 'block';
    }

    function updateUIControls() {
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const dotsContainer = document.getElementById('dots-container');

        if (currentAlbum.length > 1) {
            btnPrev.style.opacity = currentIndex > 0 ? '1' : '0';
            btnPrev.style.pointerEvents = currentIndex > 0 ? 'auto' : 'none';

            btnNext.style.opacity = currentIndex < currentAlbum.length - 1 ? '1' : '0';
            btnNext.style.pointerEvents = currentIndex < currentAlbum.length - 1 ? 'auto' : 'none';

            let dotsHtml = '';
            for (let i = 0; i < currentAlbum.length; i++) {
                dotsHtml += `<div class="dot ${i === currentIndex ? 'active' : ''}"></div>`;
            }
            dotsContainer.innerHTML = dotsHtml;
        } else {
            btnPrev.style.opacity = '0';
            btnNext.style.opacity = '0';
            dotsContainer.innerHTML = '';
        }
    }

    function switchImage(direction) {
        if(isAnimating) return;
        const imgElement = document.getElementById('current-img');
        if(!imgElement) return;

        const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
        if(nextIndex < 0 || nextIndex >= currentAlbum.length) return;

        isAnimating = true;

        const loader = new Image();
        loader.src = currentAlbum[nextIndex];
        
        loader.onload = () => {
            imgElement.classList.add('hidden');
            setTimeout(() => {
                imgElement.src = currentAlbum[nextIndex];
                currentIndex = nextIndex;
                updateUIControls();
                imgElement.classList.remove('hidden');
                setTimeout(() => { isAnimating = false; }, 200); 
            }, 200);
        };
    }

    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');

    if (btnPrev) { btnPrev.addEventListener('click', () => switchImage('prev')); }
    if (btnNext) { btnNext.addEventListener('click', () => switchImage('next')); }

    loadLatestPost();
})();