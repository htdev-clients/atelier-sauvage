// gallery-loader.js

// 1. DATA
const interiorImages = [
  {
    id: "interior-3",
    alt: "Intérieur de la boutique avec objets et meubles vintage",
  },
  { id: "interior-1", alt: "Endroit où il fait bon s'arrêter" },
  { id: "interior-2", alt: "Plantes, livres et mobilier vintage" },
];

const mainGalleryImages = [
  { id: "img-3", alt: "" },
  { id: "img-4", alt: "" },
  { id: "img-5", alt: "" },
  { id: "img-6", alt: "" },
  { id: "img-7", alt: "" },
  { id: "img-8", alt: "" },
  { id: "img-9", alt: "" },
  { id: "img-10", alt: "" },
  { id: "img-11", alt: "" },
  { id: "img-12", alt: "" },
  { id: "img-13", alt: "" },
  { id: "img-14", alt: "" },
  { id: "img-15", alt: "" },
  { id: "img-16", alt: "" },
  { id: "img-17", alt: "" },
  { id: "img-18", alt: "" },
  { id: "img-19", alt: "" },
  { id: "img-20", alt: "" },
  { id: "img-21", alt: "" },
  { id: "img-22", alt: "" },
  { id: "img-23", alt: "" },
  { id: "img-24", alt: "" },
  { id: "img-25", alt: "" },
  { id: "img-26", alt: "" },
  { id: "img-27", alt: "" },
  { id: "img-28", alt: "" },
  { id: "img-29", alt: "" },
  { id: "img-30", alt: "" },
];

// 2. LOGIC
document.addEventListener("DOMContentLoaded", () => {
  // Helper: Generate HTML for a single image
  function generateHTML(image, type, index) {
    const isInterior = type === "interior";

    const wrapperClass = isInterior
      ? "relative overflow-hidden rounded-sm shadow-sm aspect-[4/3] md:aspect-auto md:h-96"
      : "gallery-item-wrapper min-w-full snap-center snap-always md:min-w-0 break-inside-avoid shadow-sm rounded-sm overflow-hidden md:mb-6";

    const imgClass = isInterior
      ? "interior-item w-full h-full object-cover cursor-zoom-in transition-transform duration-300 pointer-events-none md:pointer-events-auto"
      : "gallery-item w-full h-auto cursor-zoom-in transition-opacity pointer-events-none md:pointer-events-auto";

    const interiorSizes = "(max-width: 768px) 100vw, 33vw";
    const mainSizes = "(max-width: 768px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw";

    return `
            <div class="${wrapperClass}" data-index="${index}">
                <img src="images/2000/${image.id}-2000.jpeg" 
                     srcset="
                        images/480/${image.id}-480.jpeg 480w,
                        images/800/${image.id}-800.jpeg 800w,
                        images/2000/${image.id}-2000.jpeg 2000w
                     " 
                     sizes="${isInterior ? interiorSizes : mainSizes}"
                     loading="lazy" 
                     decoding="async"
                     alt="${image.alt}" 
                     class="${imgClass}" />
            </div>
        `;
  }

  // Helper: Inject images
  function renderGallery(containerId, images, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const html = images
      .map((img, index) => generateHTML(img, type, index))
      .join("");
    container.innerHTML = html;
  }

  // Helper: Handle Counter Logic (e.g. "1 / 30")
  function setupMobileCounter() {
    const container = document.getElementById("main-gallery");
    const counter = document.getElementById("gallery-counter");
    const items = document.querySelectorAll(".gallery-item-wrapper");

    if (!container || !counter || items.length === 0) return;

    if (container) {
      container.scrollLeft = 0;
    }

    // Initialize counter
    const total = items.length;
    counter.textContent = `1 / ${total}`;

    // Setup Intersection Observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // +1 because index starts at 0
            const index = parseInt(entry.target.getAttribute("data-index")) + 1;
            counter.textContent = `${index} / ${total}`;
          }
        });
      },
      { root: container, threshold: 0.5 }
    );

    items.forEach((item) => observer.observe(item));
  }

  // 3. EXECUTION
  renderGallery("interior-gallery", interiorImages, "interior");
  renderGallery("main-gallery", mainGalleryImages, "gallery");

  // Initialize counter
  setupMobileCounter();
});
