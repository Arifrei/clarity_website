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

  // WORKFLOW (Phase 5) - tweak points
  let WORKFLOW_DIST = 520; // scroll distance for workflow animation
  let WORKFLOW_DELAY_DIST = 0; // optional delay before workflow starts
  let WORKFLOW_HOLD_DIST = 220; // extra scroll distance to hold the pin after last card
  let workflowBaseOffset = 0; // vertical offset adjustment
  let workflowPinEnabled = false; // desktop pinning flag
  let workflowScrollStart = 0; // scrollY where workflow animation begins
  let workflowPinTop = 0; // pinned top position for workflow
  let workflowPinOffset = 0; // distance below nav for pin

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

  function equalizeWorkflowCards() {
    const contents = document.querySelectorAll(".workflowCard .cardContent");
    if (!contents.length) return;
    contents.forEach((c) => {
      c.style.minHeight = "";
    });
    let maxH = 0;
    contents.forEach((c) => {
      maxH = Math.max(maxH, c.offsetHeight);
    });
    contents.forEach((c) => {
      c.style.minHeight = `${maxH}px`;
    });
  }

  function setScrollSpace() {
    const vh = window.innerHeight;
    // Workflow section is in normal flow, so don't include WORKFLOW_DIST in hero height
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

    // Workflow (Phase 5) responsive distance - tweak point
    WORKFLOW_DIST = Math.max(420, Math.min(720, window.innerHeight * 0.65));
    WORKFLOW_HOLD_DIST = Math.max(160, Math.min(320, window.innerHeight * 0.22)); // about ~2s scroll dwell
    workflowBaseOffset = 0; // tweak point
    workflowPinEnabled = window.innerWidth > 900; // mirrors qualify pin behavior

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

    const workflow = document.getElementById("workflow");
    const workflowSpacer = document.getElementById("workflowSpacer");
    if (workflowSpacer && workflowPinEnabled && workflow) {
      // Provide extra scroll room equal to the animation distance + hold + the section's own height
      const spacerH = workflow.offsetHeight + WORKFLOW_DIST + WORKFLOW_HOLD_DIST;
      workflowSpacer.style.height = `${spacerH}px`;
    } else if (workflowSpacer) {
      workflowSpacer.style.height = "0px";
    }

    if (workflow) {
      const prevPosition = workflow.style.position;
      const prevLeft = workflow.style.left;
      const prevRight = workflow.style.right;
      const prevTop = workflow.style.top;
      const prevTransform = workflow.style.transform;

      // Measure in normal flow to avoid pin-induced shifts
      workflow.style.position = "relative";
      workflow.style.left = "";
      workflow.style.right = "";
      workflow.style.top = "";
      workflow.style.transform = "";

      const rect = workflow.getBoundingClientRect();
      const docTop = rect.top + window.scrollY;
      workflowPinOffset = window.innerHeight * 0.17;
      workflowPinTop = navH + workflowPinOffset;
      workflowScrollStart = Math.max(0, docTop - workflowPinTop);

      // Restore previous positioning
      workflow.style.position = prevPosition;
      workflow.style.left = prevLeft;
      workflow.style.right = prevRight;
      workflow.style.top = prevTop;
      workflow.style.transform = prevTransform;
    } else {
      workflowScrollStart = 0;
      workflowPinTop = navH;
      workflowPinOffset = 0;
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
    equalizeWorkflowCards();
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

    // PHASE 5: Workflow section
    const workflow = document.getElementById("workflow");
    if (workflow && workflowScrollStart >= 0) {
      const start = workflowScrollStart + WORKFLOW_DELAY_DIST + workflowBaseOffset;
      const endAnim = start + WORKFLOW_DIST;
      const endHold = endAnim + WORKFLOW_HOLD_DIST;

      const before = y < start;
      const during = y >= start && y < endAnim;
      const hold = y >= endAnim && y < endHold;

      const scrollProgress = before ? 0 : y - start;
      const workflowP = clamp(scrollProgress / WORKFLOW_DIST, 0, 1);

      renderWorkflow(workflowP);

      if (workflowPinEnabled && (during || hold)) {
        workflow.style.position = "fixed";
        workflow.style.left = "0";
        workflow.style.right = "0";
        workflow.style.top = `${workflowPinTop}px`;
        workflow.style.transform = "none";
      } else if (workflowPinEnabled && !before) {
        // After animation: place the section at the end of the spacer so it remains visible
        workflow.style.position = "relative";
        workflow.style.left = "";
        workflow.style.right = "";
        workflow.style.top = "";
        workflow.style.transform = `translateY(${WORKFLOW_DIST + WORKFLOW_HOLD_DIST}px)`;
      } else {
        workflow.style.position = "relative";
        workflow.style.left = "";
        workflow.style.right = "";
        workflow.style.top = "";
        workflow.style.transform = "";
      }
    }
  }

  // Workflow animation render function
  // Phase breakpoints (tweak points)
  const WORKFLOW_PHASE_A = 0.33;
  const WORKFLOW_PHASE_B = 0.66;

  function renderWorkflow(p) {
    const cards = document.querySelectorAll(".workflowCard");
    const connectors = document.querySelectorAll(".workflowCard .connector");

    if (!cards.length) return;

    // Phase A: 0 → 0.33 (connector 1, card 1)
    const p1 = smoothstep(0, WORKFLOW_PHASE_A, p);

    // Phase B: 0.33 → 0.66 (connector 2, card 2)
    const p2 = smoothstep(WORKFLOW_PHASE_A, WORKFLOW_PHASE_B, p);

    // Phase C: 0.66 → 1 (connector 3, all cards finalize)
    const p3 = smoothstep(WORKFLOW_PHASE_B, 1, p);

    // Card 1 (Clarify)
    cards[0].style.setProperty("--card-opacity", p1);
    cards[0].style.setProperty("--card-offset", `${lerp(30, 0, p1)}px`);
    connectors[0].style.setProperty("--connector-scale", p1);
    connectors[0].style.setProperty("--connector-opacity", p1);

    // Card 2 (Design)
    cards[1].style.setProperty("--card-opacity", p2);
    cards[1].style.setProperty("--card-offset", `${lerp(30, 0, p2)}px`);
    connectors[1].style.setProperty("--connector-scale", p2);
    connectors[1].style.setProperty("--connector-opacity", p2);

    // Card 3 (Implement)
    cards[2].style.setProperty("--card-opacity", p3);
    cards[2].style.setProperty("--card-offset", `${lerp(30, 0, p3)}px`);
    connectors[2].style.setProperty("--connector-scale", p3);
    connectors[2].style.setProperty("--connector-opacity", p3);
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
  window.addEventListener("load", recalc);

  recalc();
})();
