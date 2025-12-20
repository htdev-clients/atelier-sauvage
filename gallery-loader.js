// gallery-loader.js

// 1. CONFIG
const IMG_WIDTH = 2000;
const IMG_HEIGHT = 2667;
const CATALOG_CSV_PATH = 'images/catalog/catalog.csv';

// 2. CSV PARSER
function parseCSV(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
  
  // A. Auto-Detect Delimiter (Check first line/header)
  // If the header has a semicolon, we assume the whole file uses semicolons.
  const header = lines[0];
  const delimiter = header.indexOf(';') !== -1 ? ';' : ',';

  // Remove headers (Row 1)
  const dataLines = lines.slice(1);

  return dataLines.map(line => {
    // B. Dynamic Regex
    // We build the regex using the detected delimiter.
    // Logic: "Split by [delimiter] ONLY if not inside quotes"
    const regex = new RegExp(`\\${delimiter}(?=(?:(?:[^"]*"){2})*[^"]*$)`);
    
    const parts = line.split(regex);

    // CLEAN ID: Remove surrounding quotes if present
    const cleanId = parts[0] ? parts[0].trim().replace(/^"|"$/g, '') : '';

    // CLEAN ALT: 
    let cleanAlt = parts[1] ? parts[1].trim() : '';

    // Step 1: Remove outer surrounding quotes if present
    if (cleanAlt.startsWith('"') && cleanAlt.endsWith('"')) {
        cleanAlt = cleanAlt.slice(1, -1);
    }

    // Step 2: Handle CSV Escaping ("" -> ")
    cleanAlt = cleanAlt.replace(/""/g, '"');

    // Step 3: Handle HTML Safety (" -> &quot;)
    cleanAlt = cleanAlt.replace(/"/g, '&quot;');

    return { id: cleanId, alt: cleanAlt };
  });
}

// 3. LOGIC
document.addEventListener("DOMContentLoaded", async () => {
  
  function generateHTML(image, index) {
    const wrapperClass = "gallery-item-wrapper min-w-full snap-center snap-always sm:min-w-0 shadow-sm rounded-sm overflow-hidden relative";
    const imgClass = "gallery-item w-full h-full object-cover cursor-zoom-in transition-opacity pointer-events-none sm:pointer-events-auto";
    const mainSizes = "(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw";
    const ratioStyle = `style="aspect-ratio: ${IMG_WIDTH} / ${IMG_HEIGHT};"`;

    return `
            <div class="${wrapperClass}" data-index="${index}" ${ratioStyle}>
                <img src="images/catalog/2000/${image.id}-2000.jpeg" 
                     srcset="
                        images/catalog/480/${image.id}-480.jpeg 480w,
                        images/catalog/800/${image.id}-800.jpeg 800w,
                        images/catalog/2000/${image.id}-2000.jpeg 2000w
                     " 
                     sizes="${mainSizes}"
                     loading="lazy" 
                     decoding="async"
                     alt="${image.alt}" 
                     class="${imgClass}" />
            </div>
        `;
  }

  function renderGallery(containerId, images) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const html = images
      .map((img, index) => generateHTML(img, index))
      .join("");
    container.innerHTML = html;
  }

  function setupMobileCounter() {
    const container = document.getElementById("main-gallery");
    const counter = document.getElementById("gallery-counter");

    setTimeout(() => {
        const items = document.querySelectorAll(".gallery-item-wrapper");
        if (!container || !counter || items.length === 0) return;

        if (container) {
          container.scrollLeft = 0;
        }

        const total = items.length;
        counter.textContent = `1 / ${total}`;

        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                const index = parseInt(entry.target.getAttribute("data-index")) + 1;
                counter.textContent = `${index} / ${total}`;
              }
            });
          },
          { root: container, threshold: 0.5 }
        );

        items.forEach((item) => observer.observe(item));
    }, 50); 
  }

  // 4. EXECUTION
  try {
    const response = await fetch(CATALOG_CSV_PATH);
    if (!response.ok) throw new Error("Failed to load catalog CSV");
    
    const csvText = await response.text();
    const mainGalleryImages = parseCSV(csvText);

    renderGallery("main-gallery", mainGalleryImages);
    setupMobileCounter();

  } catch (error) {
    console.error("Error loading gallery:", error);
  }
});