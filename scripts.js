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
        // Tailwind/Custom class toggle for display
        lightbox.classList.add('active'); 
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
        lightbox.classList.remove('active');
    });

    lightbox.addEventListener("click", (e) => {
        if (e.target === lightbox) lightbox.classList.remove('active');
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
        // Check if lightbox is active using the class we defined in CSS
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
    let isAnimating = false; // Prevent double clicks during transition

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
        // User Info logic
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

        // Reset index and render initial state
        currentIndex = 0;
        updateUIControls();
        
        // Initial Image Load (No transition)
        const imgElement = document.getElementById('current-img');
        if(imgElement && currentAlbum.length > 0) {
            imgElement.src = currentAlbum[0];
            imgElement.classList.remove('hidden');
        }

        // Footer Info
        const postLink = document.getElementById('post-link');
        if(postLink) postLink.href = post.permalink;

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
        if(isAnimating) return; // Prevent spam clicking

        const imgElement = document.getElementById('current-img');
        if(!imgElement) return;

        // Calculate next index
        const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
        
        // Boundary check
        if(nextIndex < 0 || nextIndex >= currentAlbum.length) return;

        isAnimating = true;

        // 1. PRELOAD the next image
        const loader = new Image();
        loader.src = currentAlbum[nextIndex];
        
        loader.onload = () => {
            // 2. Only fade out once the new image is ready in browser cache
            imgElement.classList.add('hidden'); // This matches CSS .fade-element.hidden { opacity: 0 }

            setTimeout(() => {
                // 3. Swap src instantly while invisible
                imgElement.src = currentAlbum[nextIndex];
                currentIndex = nextIndex;
                updateUIControls();

                // 4. Fade back in
                imgElement.classList.remove('hidden');
                
                // Reset lock after transition is done
                setTimeout(() => { isAnimating = false; }, 200); 
            }, 200); // 200ms matches the CSS transition time
        };
    }

    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');

    if (btnPrev) {
        btnPrev.addEventListener('click', () => switchImage('prev'));
    }

    if (btnNext) {
        btnNext.addEventListener('click', () => switchImage('next'));
    }

    // Initialize
    loadLatestPost();
})();