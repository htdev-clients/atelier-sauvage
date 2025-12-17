document.addEventListener("DOMContentLoaded", () => {
  // --- PART 1: SCROLL COLOR LOGIC ---
  const navbar = document.getElementById("navbar");
  const navLogo = document.getElementById("nav-logo");

  const TOP_STATE = ["bg-transparent", "text-white", "shadow-none"];
  const SCROLLED_STATE = [
    "bg-stone-50/95",
    "backdrop-blur-md",
    "text-stone-900",
    "shadow-sm",
  ];

  function handleScroll() {
    if (window.scrollY > 50) {
      navbar.classList.remove(...TOP_STATE);
      navbar.classList.add(...SCROLLED_STATE);
      if (navLogo) navLogo.classList.remove("brightness-0", "invert");
    } else {
      navbar.classList.add(...TOP_STATE);
      navbar.classList.remove(...SCROLLED_STATE);
      if (navLogo) navLogo.classList.add("brightness-0", "invert");
    }
  }

  handleScroll();
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        handleScroll();
        ticking = false;
      });
      ticking = true;
    }
  });

  // --- PART 2: MOBILE MENU LOGIC ---
  const menuBtn = document.getElementById("mobile-menu-btn");
  const closeBtn = document.getElementById("close-menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");
  const mobileLinks = document.querySelectorAll(".mobile-link");

  function openMenu() {
    // Show menu (slide in)
    mobileMenu.classList.remove("translate-x-full");
    mobileMenu.classList.add("translate-x-0");
    // Disable scrolling on the background
    document.body.classList.add("overflow-hidden");
  }

  function closeMenu() {
    // Hide menu (slide out)
    mobileMenu.classList.remove("translate-x-0");
    mobileMenu.classList.add("translate-x-full");
    // Re-enable scrolling
    document.body.classList.remove("overflow-hidden");
  }

  // Event Listeners
  if (menuBtn) menuBtn.addEventListener("click", openMenu);
  if (closeBtn) closeBtn.addEventListener("click", closeMenu);

  // Close menu automatically when clicking a link
  mobileLinks.forEach((link) => {
    link.addEventListener("click", closeMenu);
  });
});
