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
            
            // FIX: Use opacity-0 instead of hidden to prevent layout collapse
            imgElement.classList.remove('opacity-0', 'hidden'); 
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
            // FIX: Use 'opacity-0' to fade out without removing element from DOM flow
            imgElement.classList.add('opacity-0');
            
            setTimeout(() => {
                imgElement.src = currentAlbum[nextIndex];
                currentIndex = nextIndex;
                updateUIControls();
                
                // Fade back in
                imgElement.classList.remove('opacity-0');
                
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