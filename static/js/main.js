(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const home = $("#home");
  const heroInner = $(".heroInner", home);
  const heroLeft = $(".heroLeft", home);
  const heroActions = $(".heroActions", home);
  const dockPoint = document.querySelector("#dockPoint");

  const intro = $("#introParagraph");
  const introInner = $(".introParagraphInner", intro);

  if (!home || !heroInner || !heroLeft || !intro || !introInner || !dockPoint) {
    console.warn("Missing required elements for scroll animation.");
    return;
  }

  const GAP_UNDER_HERO = 30; 
  const HERO_TOP_PADDING = 22;   
  let PHASE1_DIST = 420;
  let PHASE2_DIST = 520;         

  let navH = 74;
  let translateMax = 0;
  let startTop = 0;              
  let dockOffsetInHero = 0;
  let dockTopStart = 0;

  let ticking = false;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function setScrollSpace() {
    const vh = window.innerHeight;
    // Make home tall enough to allow the two phases of scroll
    home.style.minHeight = `${vh + PHASE1_DIST + PHASE2_DIST + 200}px`;
  }

  function recalc() {
    navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navH")) || 74;

    PHASE1_DIST = Math.max(320, Math.min(520, window.innerHeight * 0.45));
    PHASE2_DIST = Math.max(420, Math.min(720, window.innerHeight * 0.65));

    // Compute stable geometry based on actual element sizes
    const vh = window.innerHeight;
    const availableH = vh - navH;

    const heroLeftH = heroLeft.offsetHeight;

    // Where the heroLeft block sits when vertically centered inside heroInner
    const centeredHeroLeftTop = navH + (availableH - heroLeftH) / 2;

    // Where we want heroLeft top to end up when it reaches the top
    const targetHeroLeftTop = navH + HERO_TOP_PADDING;

    // Amount we must shift upward in phase2
    translateMax = targetHeroLeftTop - centeredHeroLeftTop; // negative number

    const heroInnerRect = heroInner.getBoundingClientRect();
    const dockRect = dockPoint.getBoundingClientRect();
    dockOffsetInHero = dockRect.top - heroInnerRect.top;
    dockTopStart = navH + dockOffsetInHero + GAP_UNDER_HERO;

    const spacer = document.getElementById("introSpacer");
    if (spacer) {
      spacer.style.height = `${introInner.offsetHeight}px`;
    }

    // Offscreen start
    startTop = vh + 24;

    setScrollSpace();
    update();
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function update() {
    const y = window.scrollY;

    const bg = document.getElementById("bgTrack");
    if (bg) {
      const cycle = window.innerHeight;
      const pos = -((y) % cycle);
      document.documentElement.style.setProperty("--bgPos", `${pos}px`);
    }

    const dockP = smoothstep(0, PHASE1_DIST, y);

    const liftStart = PHASE1_DIST;
    const liftEnd = liftStart + PHASE2_DIST;
    const liftP = smoothstep(liftStart, liftEnd, y);

    const liftT = lerp(0, translateMax, liftP);
    const postLift = Math.max(0, y - liftEnd);

    // HERO (fixed throughout; translate out after lift to avoid handoff jump)
    heroInner.style.position = "fixed";
    heroInner.style.left = "0";
    heroInner.style.right = "0";
    heroInner.style.top = `${navH}px`;
    heroInner.style.transform = `translateY(${liftT - postLift}px)`;

    const dockTopNow = navH + liftT + dockOffsetInHero + GAP_UNDER_HERO;

    // PARAGRAPH (fixed throughout to avoid handoff jitter)
    const startOffset = startTop - dockTopStart;
    const dockOffset = lerp(startOffset, 0, dockP);
    const releaseOffset = -postLift;

    intro.style.position = "fixed";
    intro.style.left = "0";
    intro.style.width = "100%";
    intro.style.top = `${dockTopNow}px`;
    intro.style.transform = `translateY(${dockOffset + releaseOffset}px)`;
    intro.style.opacity = `${clamp(dockP * 1.1, 0, 1)}`;
    intro.style.pointerEvents = dockP > 0.05 ? "auto" : "none";

    // Buttons fade
    if (heroActions) {
      const fade = clamp(1 - dockP * 1.25, 0, 1);
      heroActions.style.opacity = `${fade}`;
      heroActions.style.pointerEvents = fade < 0.15 ? "none" : "auto";
    }

    const qualify = document.getElementById("qualify");
    if (qualify) {
      const scenarios = qualify.querySelectorAll(".scenario");
      const rect = qualify.getBoundingClientRect();
      const sectionTop = rect.top + y;
      const sectionHeight = qualify.offsetHeight;

      const progress = (y - sectionTop) / sectionHeight;

      let activeIndex = -1;
      if (progress > 0 && progress < 1) {
        activeIndex = Math.min(
          scenarios.length - 1,
          Math.floor(progress * scenarios.length)
        );
      }

      scenarios.forEach((el, i) => {
        el.classList.toggle("active", i === activeIndex);
      });
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      update();
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", recalc);

  recalc();
})();
