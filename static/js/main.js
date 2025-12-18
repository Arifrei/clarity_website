(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const home = $("#home");
  const heroInner = $(".heroInner", home);
  const heroLeft = $(".heroLeft", home);
  const heroRight = $(".heroRight", home);
  const heroActions = $(".heroActions", home);
  const dockPoint = document.querySelector("#dockPoint");

  const intro = $("#introParagraph");
  const introInner = $(".introParagraphInner", intro);

  const qualifySection = $("#qualify");
  const qualifyCard = qualifySection ? $(".qualifyCard", qualifySection) : null;
  const scenarios = qualifyCard ? qualifyCard.querySelectorAll(".scenario") : [];

  if (
    !home ||
    !heroInner ||
    !heroLeft ||
    !intro ||
    !introInner ||
    !dockPoint
  ) {
    console.warn("Missing required elements for scroll animation.");
    return;
  }

  const GAP_UNDER_HERO = 30;
  const HERO_TOP_PADDING = 22;

  let PHASE1_DIST = 420; // paragraph dock
  let QUALIFY_DELAY_DIST = 240; // delay after paragraph fully docks before qualify begins
  let PHASE2_DIST = 320; // qualify slide-in/pin
  let PHASE3_DIST = 520; // scenario cycling
  let PHASE4_DIST = 520; // lift together
  const SCENARIO_DWELL_DIST = 220; // extra scroll distance between scenario switches for dwell

  let navH = 74;
  let translateMax = 0;
  let startTop = 0;
  let dockOffsetInHero = 0;
  let dockTopStart = 0;

  let qualifyPinEnabled = false;
  let qualifyGeometry = { left: 0, top: 0, width: 0 };

  let ticking = false;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function setScrollSpace() {
    const vh = window.innerHeight;
    home.style.minHeight = `${vh + PHASE1_DIST + QUALIFY_DELAY_DIST + PHASE2_DIST + PHASE3_DIST + PHASE4_DIST + 200}px`;
  }

  function recalc() {
    navH =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--navH")
      ) || 74;

    PHASE1_DIST = Math.max(320, Math.min(520, window.innerHeight * 0.45));
    QUALIFY_DELAY_DIST = Math.max(180, Math.min(320, window.innerHeight * 0.26)); // approx ~2s scroll cushion
    PHASE2_DIST = Math.max(260, Math.min(520, window.innerHeight * 0.35));

    const scenarioCount = Math.max(1, scenarios.length || 1);
    const basePhase3 = Math.max(340, Math.min(620, window.innerHeight * 0.55));
    const dwellTotal = SCENARIO_DWELL_DIST * Math.max(0, scenarioCount - 1);
    PHASE3_DIST = basePhase3 + dwellTotal;

    PHASE4_DIST = Math.max(420, Math.min(720, window.innerHeight * 0.65));

    const vh = window.innerHeight;
    const availableH = vh - navH;
    const heroLeftH = heroLeft.offsetHeight;

    const centeredHeroLeftTop = navH + (availableH - heroLeftH) / 2;
    const targetHeroLeftTop = navH + HERO_TOP_PADDING;
    translateMax = targetHeroLeftTop - centeredHeroLeftTop; // negative

    const heroInnerRect = heroInner.getBoundingClientRect();
    const dockRect = dockPoint.getBoundingClientRect();
    dockOffsetInHero = dockRect.top - heroInnerRect.top;
    dockTopStart = navH + dockOffsetInHero + GAP_UNDER_HERO;

    const spacer = document.getElementById("introSpacer");
    if (spacer) {
      spacer.style.height = `${introInner.offsetHeight}px`;
    }

    startTop = vh + 24;

    const heroRightStyle = heroRight ? getComputedStyle(heroRight) : null;
    const heroRightHidden =
      !heroRight ||
      heroRightStyle.display === "none" ||
      heroRight.getBoundingClientRect().width === 0;
    qualifyPinEnabled = !!qualifyCard && !heroRightHidden && window.innerWidth > 900;

    if (qualifyPinEnabled && heroRight) {
      const cardHeight = qualifyCard.offsetHeight;
      const vh = window.innerHeight;
      const verticalCenter = navH + (vh - navH - cardHeight) / 2;
      const screenWidth = window.innerWidth;
      const leftPosition = screenWidth * 0.55; // 45% from the right = 55% from the left

      qualifyGeometry = {
        left: leftPosition,
        top: verticalCenter,
        width: qualifyCard.offsetWidth,
      };
    } else if (qualifyCard) {
      qualifyGeometry = { left: 0, top: 0, width: 0 };
      qualifyCard.style.position = "relative";
      qualifyCard.style.left = "";
      qualifyCard.style.top = "";
      qualifyCard.style.width = "";
      qualifyCard.style.transform = "none";
      qualifyCard.style.opacity = "1";
      qualifyCard.style.pointerEvents = "auto";
    }

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
      const pos = -y % cycle;
      document.documentElement.style.setProperty("--bgPos", `${pos}px`);
    }

    const phase1End = PHASE1_DIST;
    const delayEnd = phase1End + QUALIFY_DELAY_DIST;
    const phase2Start = delayEnd;
    const phase2End = phase2Start + PHASE2_DIST;
    const phase3Start = phase2End;
    const phase3End = phase3Start + PHASE3_DIST;
    const phase4Start = phase3End;
    const phase4End = phase4Start + PHASE4_DIST;

    const dockP = smoothstep(0, phase1End, y);
    const qualifyP = smoothstep(phase2Start, phase2End, y);
    const liftP = smoothstep(phase4Start, phase4End, y);

    const liftT = lerp(0, translateMax, liftP);
    const postLift = Math.max(0, y - phase4End);

    heroInner.style.position = "fixed";
    heroInner.style.left = "0";
    heroInner.style.right = "0";
    heroInner.style.top = `${navH}px`;
    heroInner.style.transform = `translateY(${liftT - postLift}px)`;

    const dockTopNow = navH + liftT + dockOffsetInHero + GAP_UNDER_HERO;

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

    if (heroActions) {
      const fade = clamp(1 - dockP * 1.25, 0, 1);
      heroActions.style.opacity = `${fade}`;
      heroActions.style.pointerEvents = fade < 0.15 ? "none" : "auto";
    }

    if (qualifyCard) {
      let activeIndex = -1;

      if (qualifyPinEnabled) {
        const slideX = lerp(qualifyGeometry.width * 0.35, 0, qualifyP);
        const opacity = clamp(qualifyP * 1.1, 0, 1);
        const yOffset = liftT - postLift;

        qualifyCard.style.position = "fixed";
        qualifyCard.style.left = `${qualifyGeometry.left}px`;
        qualifyCard.style.top = `${qualifyGeometry.top}px`;
        qualifyCard.style.width = `${qualifyGeometry.width}px`;
        qualifyCard.style.transform = `translate(${slideX}px, ${yOffset}px) scale(${lerp(0.96, 1, qualifyP)})`;
        qualifyCard.style.opacity = `${opacity}`;
        qualifyCard.style.pointerEvents = opacity > 0.2 ? "auto" : "none";

        // Add visible class for glowing border effect
        if (qualifyP > 0.3) {
          qualifyCard.classList.add("visible");
        } else {
          qualifyCard.classList.remove("visible");
        }

        const scenarioProgress = clamp(
          (y - phase3Start) / PHASE3_DIST,
          0,
          1
        );
        if (scenarios.length) {
          activeIndex = Math.min(
            scenarios.length - 1,
            Math.floor(scenarioProgress * scenarios.length)
          );
        }
      } else {
        const rect = qualifySection.getBoundingClientRect();
        const sectionTop = rect.top + y;
        const sectionHeight = qualifySection.offsetHeight || 1;
        const progress = clamp((y - sectionTop) / sectionHeight, 0, 1);

        // Add visible class for mobile
        const vh = window.innerHeight;
        const cardRect = qualifyCard.getBoundingClientRect();
        const cardVisible = cardRect.top < vh * 0.75 && cardRect.bottom > vh * 0.25;
        if (cardVisible) {
          qualifyCard.classList.add("visible");
        }

        if (scenarios.length) {
          activeIndex = Math.min(
            scenarios.length - 1,
            Math.floor(progress * scenarios.length)
          );
        }
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
