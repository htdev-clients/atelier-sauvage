// scripts.js

/* --- LIGHTBOX LOGIC --- */
document.addEventListener('DOMContentLoaded', () => {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return;

    const lightboxImg = lightbox.querySelector("img");
    const closeBtn = lightbox.querySelector(".close-btn");
    const prevBtn = lightbox.querySelector(".prev");
    const nextBtn = lightbox.querySelector(".next");
    const images = Array.from(document.querySelectorAll(".gallery img"));
    let currentIndex = 0;

    const openLightbox = (index) => {
        currentIndex = index;
        lightboxImg.src = images[currentIndex].src;
        lightbox.style.display = "flex";
    };

    const showPrev = () => {
        currentIndex = (currentIndex - 1 + images.length) % images.length;
        lightboxImg.src = images[currentIndex].src;
    };

    const showNext = () => {
        currentIndex = (currentIndex + 1) % images.length;
        lightboxImg.src = images[currentIndex].src;
    };

    images.forEach((img, index) => {
        img.addEventListener("click", () => openLightbox(index));
    });

    closeBtn.addEventListener("click", () => {
        lightbox.style.display = "none";
    });

    lightbox.addEventListener("click", (e) => {
        if (e.target === lightbox) lightbox.style.display = "none";
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
        if (lightbox.style.display === "flex") {
            if (e.key === "Escape") lightbox.style.display = "none";
            if (e.key === "ArrowLeft") showPrev();
            if (e.key === "ArrowRight") showNext();
        }
    });
});

/* --- INSTAGRAM INTEGRATION --- */
(function() {
    // 1. Define these at the top so ALL functions can see them
    const instaCard = document.getElementById('insta-card');
    let currentAlbum = [];
    let currentIndex = 0;

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
        // User Info
        // Note: We removed the code that overwrites 'user-pic' here.
        // The image is now controlled entirely by your index.html
        
        const userNameLink = document.getElementById('user-name');
        if(userNameLink) {
            userNameLink.innerText = user.username;
            userNameLink.href = `https://instagram.com/${user.username}`;
        }

        const captionUser = document.getElementById('caption-username');
        if(captionUser) captionUser.innerText = user.username;

        // Album Logic
        currentAlbum = [];
        if (post.media_type === 'CAROUSEL_ALBUM' && post.children) {
            post.children.data.forEach(child => {
                currentAlbum.push(child.media_type === 'VIDEO' ? child.thumbnail_url : child.media_url);
            });
        } else {
            currentAlbum.push(post.media_type === 'VIDEO' ? post.thumbnail_url : post.media_url);
        }

        // Reset index and render
        currentIndex = 0;
        updateImageDisplay(false);

        // Footer Info
        const postLink = document.getElementById('post-link');
        if(postLink) postLink.href = post.permalink;

        const captionText = document.getElementById('caption-text');
        if(captionText) captionText.innerText = post.caption || "";

        // Timestamp
        const timestampEl = document.getElementById('timestamp');
        if(timestampEl) {
            const date = new Date(post.timestamp);
            const now = new Date();
            const diffDays = Math.floor(Math.abs(now - date) / (1000 * 60 * 60 * 24));
            timestampEl.innerText = diffDays > 0 ? `${diffDays} DAYS AGO` : "TODAY";
        }
        
        instaCard.style.display = 'block';
    }

    function updateImageDisplay(useTransition = true) {
        const imgElement = document.getElementById('current-img');
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const dotsContainer = document.getElementById('dots-container');

        if(!imgElement) return;

        const performUpdate = () => {
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
        };

        if (useTransition) {
            imgElement.classList.add('hidden');
            setTimeout(() => {
                imgElement.src = currentAlbum[currentIndex];
                performUpdate();
                imgElement.onload = () => {
                    imgElement.classList.remove('hidden');
                };
                setTimeout(() => { imgElement.classList.remove('hidden'); }, 50);
            }, 300);
        } else {
            imgElement.src = currentAlbum[currentIndex];
            imgElement.classList.remove('hidden');
            performUpdate();
        }
    }

    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');

    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            if (currentIndex > 0) { 
                currentIndex--; 
                updateImageDisplay(true); 
            }
        });
    }

    if (btnNext) {
        btnNext.addEventListener('click', () => {
            if (currentIndex < currentAlbum.length - 1) { 
                currentIndex++; 
                updateImageDisplay(true); 
            }
        });
    }

    // Initialize
    loadLatestPost();
})();