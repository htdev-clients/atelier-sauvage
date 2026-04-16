import PhotoSwipe from '/assets/js/photoswipe.esm.min.js';

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.closest('.gallery')) return;

    const isCatalog = img.src.includes('/catalog/') || img.hasAttribute('data-image-count');
    const isEvent = img.src.includes('/events/');

    if (isCatalog) {
      openCatalogLightbox(img);
    } else if (isEvent) {
      openGroupLightbox(img, img.closest('.gallery'));
    } else {
      openInteriorLightbox(img);
    }
  });

  // --- HELPERS ---

  const sortGalleryImgs = (section) =>
    Array.from(section.querySelectorAll('img'))
      .map((image) => ({ image, rect: image.getBoundingClientRect() }))
      .sort((a, b) => {
        const diffY = a.rect.top - b.rect.top;
        return Math.abs(diffY) > 15 ? diffY : a.rect.left - b.rect.left;
      })
      .map((p) => p.image);

  const imgToSlide = (image) => ({
    src: image.src,
    srcset: image.srcset || undefined,
    alt: image.alt,
    ...(image.naturalWidth > 0
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : {}),
    msrc: image.src,
  });

  // --- OPENERS ---

  const openInteriorLightbox = (img) => {
    if (window.innerWidth < 768) return;
    const imgs = sortGalleryImgs(img.closest('.gallery'));
    openPswp(imgs.map(imgToSlide), Math.max(0, imgs.indexOf(img)));
  };

  const openGroupLightbox = (img, section) => {
    const imgs = sortGalleryImgs(section);
    openPswp(imgs.map(imgToSlide), Math.max(0, imgs.indexOf(img)));
  };

  const openCatalogLightbox = (img) => {
    const itemNumber = img.dataset.itemNumber;
    const count = parseInt(img.dataset.imageCount || 1);

    const makeSlide = (suffix, sourceImg = null) => {
      const slide = {
        src: `/assets/img/catalog/1400/${itemNumber}${suffix}-1400.webp`,
        srcset: [
          `/assets/img/catalog/480/${itemNumber}${suffix}-480.webp 480w`,
          `/assets/img/catalog/800/${itemNumber}${suffix}-800.webp 800w`,
          `/assets/img/catalog/1400/${itemNumber}${suffix}-1400.webp 1400w`,
        ].join(', '),
        alt: img.alt,
        description: img.alt,
      };
      if (sourceImg && sourceImg.naturalWidth > 0) {
        slide.width = sourceImg.naturalWidth;
        slide.height = sourceImg.naturalHeight;
        slide.msrc = sourceImg.src;
      }
      return slide;
    };

    const slides = [makeSlide('', img)];
    for (let i = 1; i < count; i++) slides.push(makeSlide(`-${i}`));

    openPswp(slides, 0, true);
  };

  // --- PHOTOSWIPE ---

  const openPswp = (slides, index, hasCaption = false) => {
    const pswp = new PhotoSwipe({
      dataSource: slides,
      index,
      bgOpacity: 0.95,
      spacing: 0.12,
      pinchToClose: false,
      padding: { top: 30, bottom: hasCaption ? 70 : 30, left: 15, right: 15 },
    });

    if (hasCaption) {
      pswp.on('uiRegister', () => {
        pswp.ui.registerElement({
          name: 'caption',
          order: 9,
          isButton: false,
          appendTo: 'root',
          onInit: (el) => {
            el.className = 'pswp__custom-caption';
            pswp.on('change', () => {
              el.textContent = pswp.currSlide.data.description || '';
            });
          },
        });
      });
    }

    pswp.init();
  };
});
