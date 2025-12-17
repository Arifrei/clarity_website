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
  let dockTop = 0;        
  let startTop = 0;              

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

    const oneLineEl = heroLeft.querySelector(".oneLine");
    const kickerEl = heroLeft.querySelector(".kicker");
    const megaEl = heroLeft.querySelector(".mega");

    // Calculate dockTop as: centeredHeroLeftTop + (height up to dockPoint)
    const topBlockH =
      (kickerEl ? kickerEl.offsetHeight : 0) +
      (megaEl ? megaEl.offsetHeight : 0) +
      (oneLineEl ? oneLineEl.offsetHeight : 0) +
      8; 

    dockTop = centeredHeroLeftTop + topBlockH + GAP_UNDER_HERO;

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

    // progress for docking (paragraph coming in)
    const dockP = smoothstep(0, PHASE1_DIST, y);

    // progress for lifting (hero + paragraph moving up together)
    const liftStart = PHASE1_DIST;             // start lifting slightly BEFORE full dock
    const liftEnd   = liftStart + PHASE2_DIST;
    const liftP = smoothstep(liftStart, liftEnd, y);

    // keep your body classes if you want, but they’re no longer “behavior switches”
    document.body.classList.toggle("phase1", y < PHASE1_DIST);
    document.body.classList.toggle("phase2", y >= PHASE1_DIST);

    // HERO lift
    const liftT = lerp(0, translateMax, liftP);
    heroInner.style.transform = `translateY(${liftT}px)`;

    // PARAGRAPH: keep top fixed at dockTop, and slide in via transform (no stopping/jump)
    // start offset is "below fold" relative to dockTop
    const startOffset = (startTop - dockTop);
    const dockOffset = lerp(startOffset, 0, dockP);

    intro.style.top = `${dockTop}px`;
    intro.style.transform = `translateY(${dockOffset + liftT}px)`;
    intro.style.opacity = `${clamp(dockP * 1.1, 0, 1)}`;

    // Buttons fade out as dock happens (smooth)
    if (heroActions) {
      const fade = clamp(1 - dockP * 1.25, 0, 1);
      heroActions.style.opacity = `${fade}`;
      heroActions.style.pointerEvents = fade < 0.15 ? "none" : "auto";
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
