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

  // Returns srcset entries sorted largest-first: [{ url, w }, ...]
  const parseSrcset = (srcset) => {
    if (!srcset) return [];
    return srcset.split(',')
      .map((s) => {
        const [url, descriptor] = s.trim().split(/\s+/);
        return { url, w: parseInt(descriptor) || 0 };
      })
      .sort((a, b) => b.w - a.w);
  };

  const sortGalleryImgs = (section) =>
    Array.from(section.querySelectorAll('img'))
      .map((image) => ({ image, rect: image.getBoundingClientRect() }))
      .sort((a, b) => {
        const diffY = a.rect.top - b.rect.top;
        return Math.abs(diffY) > 15 ? diffY : a.rect.left - b.rect.left;
      })
      .map((p) => p.image);

  // Builds a slide from a DOM img, scaling dimensions up to the largest srcset entry.
  const imgToSlide = (image) => {
    const entries = parseSrcset(image.srcset);
    const largest = entries[0];
    const src = largest ? largest.url : image.src;

    let width, height;
    if (image.naturalWidth > 0 && largest) {
      width = largest.w;
      height = Math.round(image.naturalHeight * (largest.w / image.naturalWidth));
    } else if (image.naturalWidth > 0) {
      width = image.naturalWidth;
      height = image.naturalHeight;
    }

    return {
      src,
      srcset: image.srcset || undefined,
      alt: image.alt,
      ...(width && height ? { width, height } : {}),
      msrc: image.src,
    };
  };

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

    const makeSrcset = (suffix) =>
      [
        `/assets/img/catalog/480/${itemNumber}${suffix}-480.webp 480w`,
        `/assets/img/catalog/800/${itemNumber}${suffix}-800.webp 800w`,
        `/assets/img/catalog/1400/${itemNumber}${suffix}-1400.webp 1400w`,
      ].join(', ');

    // First slide: dimensions derived from the thumbnail's aspect ratio at 1400px width.
    const firstSlide = {
      src: `/assets/img/catalog/1400/${itemNumber}-1400.webp`,
      srcset: makeSrcset(''),
      alt: img.alt,
      description: img.alt,
      msrc: img.src,
      ...(img.naturalWidth > 0
        ? {
            width: 1400,
            height: Math.round(1400 * (img.naturalHeight / img.naturalWidth)),
          }
        : {}),
    };

    // Subsequent slides: no dimensions — handled via contentLoad.
    const slides = [firstSlide];
    for (let i = 1; i < count; i++) {
      slides.push({
        src: `/assets/img/catalog/1400/${itemNumber}-${i}-1400.webp`,
        srcset: makeSrcset(`-${i}`),
        alt: img.alt,
        description: img.alt,
      });
    }

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

    // For slides without known dimensions, load the image to determine them.
    pswp.on('contentLoad', (e) => {
      const { content } = e;
      if (content.data.width && content.data.height) return;

      e.preventDefault();
      const img = document.createElement('img');
      img.className = 'pswp__img';
      img.onload = () => {
        content.data.width = img.naturalWidth;
        content.data.height = img.naturalHeight;
        content.element = img;
        content.onLoaded();
      };
      img.onerror = () => content.onError();
      if (content.data.srcset) img.srcset = content.data.srcset;
      img.src = content.data.src;
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
