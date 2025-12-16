// gallery-loader.js

// 1. DATA: Simply add or remove lines here to update your site
const interiorImages = [
    { id: 'IMG_7248', alt: "Intérieur de la boutique avec objets et meubles vintage" },
    { id: 'IMG_7242', alt: "Endroit où il fait bon s'arrêter" },
    { id: 'IMG_7244', alt: "Plantes, livres et mobilier vintage" }
];

const mainGalleryImages = [
    { id: 'IMG_7245', alt: "Vase Murano et lampe design 70s" },
    { id: 'IMG_7247', alt: "Coin lecture avec ses bouquins" },
    { id: 'IMG_7258', alt: "Console fer forgé italienne" },
    { id: 'IMG_7259', alt: "Portrait huile sur toile" },
    { id: 'IMG_7252', alt: "Peinture gouache sur enfilade" },
    { id: 'IMG_7253', alt: "Faience de Rouen" },
    { id: 'IMG_7260', alt: "Table guéridon bois" },
    { id: 'IMG_7254', alt: "Applique lumineuse années 50s" },
    { id: 'IMG_7257', alt: "Bibelots et objets déco kitsch" }
];

// 2. LOGIC: Generates the HTML
document.addEventListener('DOMContentLoaded', () => {
    
    // Function to generate HTML for a single image
    function generateHTML(image, type) {
        // Define specific classes based on the type (Interior vs Main Gallery)
        const isInterior = type === 'interior';
        
        const wrapperClass = isInterior 
            ? "relative overflow-hidden rounded-sm shadow-sm aspect-[4/3] md:aspect-auto md:h-96" 
            : "break-inside-avoid shadow-sm rounded-sm overflow-hidden";
            
        const imgClass = isInterior
            ? "interior-item w-full h-full object-cover cursor-zoom-in transition-transform duration-300 pointer-events-none md:pointer-events-auto"
            : "gallery-item w-full h-auto cursor-zoom-in transition-opacity pointer-events-none md:pointer-events-auto";

        return `
            <div class="${wrapperClass}">
                <img src="images/2000/${image.id}-2000.jpeg" 
                     srcset="
                        images/480/${image.id}-480.jpeg 480w,
                        images/800/${image.id}-800.jpeg 800w,
                        images/2000/${image.id}-2000.jpeg 2000w
                     " 
                     sizes="${isInterior ? '(max-width: 768px) 100vw, 33vw' : '(max-width: 768px) 100vw, 33vw'}"
                     loading="lazy" 
                     decoding="async"
                     alt="${image.alt}" 
                     class="${imgClass}" />
            </div>
        `;
    }

    // Function to inject images into a specific container
    function renderGallery(containerId, images, type) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const html = images.map(img => generateHTML(img, type)).join('');
        container.innerHTML = html;
    }

    // 3. EXECUTION: Run the render functions
    renderGallery('interior-gallery', interiorImages, 'interior');
    renderGallery('main-gallery', mainGalleryImages, 'gallery');
});