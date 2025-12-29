(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const home = $("#home");
  const heroInner = $(".heroInner", home);
  const heroLeft = $(".heroLeft", home);
  const heroRight = $(".heroRight", home);
  const heroActions = $(".heroActions", home);
  const dockPoint = document.querySelector("#dockPoint");
  const heroBg = home ? home.querySelector(".heroBg") : null;

  const intro = $("#introParagraph");
  const introInner = $(".introParagraphInner", intro);

  const qualifySection = $("#qualify");
  const qualifyCard = qualifySection ? $(".qualifyCard", qualifySection) : null;
  const finalScenario = qualifyCard ? qualifyCard.querySelector(".scenarioFinal") : null;
  const scenarios = qualifyCard
    ? qualifyCard.querySelectorAll(".scenario:not(.scenarioFinal)")
    : [];

  // Mobile qualify variables
  let qualifyMobilePinEnabled = false;
  let qualifyMobilePinStart = 0;
  let qualifyMobilePinEnd = 0;
  let qualifyMobileScrollDist = 0;
  let qualifyMobilePinnedHeight = 0;
  let qualifyMobilePinTop = 0;
  const testimonialsSection = document.getElementById("testimonials");
  const testimonialsContainer = testimonialsSection
    ? testimonialsSection.querySelector(".testimonialsContainer")
    : null;
  const testimonialsTrack = testimonialsSection
    ? testimonialsSection.querySelector(".testimonialsTrack")
    : null;
  const testimonialsSpacer = document.getElementById("testimonialsSpacer");

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Detect low-end devices
  const isLowEndDevice = () => {
    const memory = navigator.deviceMemory;
    const cores = navigator.hardwareConcurrency;
    const connection = navigator.connection;

    if (memory && memory < 4) return true;
    if (cores && cores < 4) return true;
    if (connection && connection.saveData) return true;
    return prefersReducedMotion.matches;
  };

  const shouldSimplifyAnimations = isLowEndDevice();

  // Stabilize viewport height on mobile to avoid jumps when browser chrome shows/hides
  let stableVh = window.innerHeight;
  const getViewportHeight = () =>
    window.innerWidth <= 900 ? stableVh : window.innerHeight;
  const refreshStableVh = () => {
    const current =
      (window.visualViewport && window.visualViewport.height) ||
      window.innerHeight;
    // Only grow or update on significant changes (e.g., orientation)
    if (current > stableVh || Math.abs(current - stableVh) > 140) {
      stableVh = current;
    }
  };

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
  const FINAL_HOLD_DIST = 2400; // extra dwell to keep final state visible longer (doubled for better UX)

  // WORKFLOW (Phase 5) - tweak points
  let WORKFLOW_DIST = 520; // scroll distance for workflow animation
  let WORKFLOW_DELAY_DIST = 0; // optional delay before workflow starts
  let WORKFLOW_HOLD_DIST = 220; // extra scroll distance to hold the pin after last card
  let workflowBaseOffset = 0; // vertical offset adjustment
  let workflowPinEnabled = false; // desktop pinning flag
  let workflowScrollStart = 0; // scrollY where workflow animation begins
  let workflowPinTop = 0; // pinned top position for workflow
  let workflowPinOffset = 0; // distance below nav for pin
  let workflowSpacerHeight = 0;

  // TESTIMONIALS (Phase 6)
  let testimonialsTrackWidth = 0;
  let testimonialsTrackTravel = 0;
  let testimonialsPinEnabled = false;
  let testimonialsPinOffset = 0;
  let testimonialsPinTop = 0;
  let testimonialsScrollStart = 0;
  let testimonialsScrollEnd = 0;
  let TESTIMONIALS_PIN_DIST = 0;
  let testimonialsContainerWidth = 0;
  let testimonialsContainerHeight = 0;
  let testimonialsVisibleWidth = 0;
  let testimonialsSpacerHeight = 0;

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
    const vh = getViewportHeight();
    const extraPad = window.innerWidth <= 900 ? 200 : 40; // keep mobile roomy, tighten desktop
    // Workflow section is in normal flow, so don't include WORKFLOW_DIST in hero height
    home.style.minHeight = `${vh + PHASE1_DIST + QUALIFY_DELAY_DIST + PHASE2_DIST + PHASE3_DIST + PHASE4_DIST + extraPad}px`;
  }

  function recalc() {
    navH =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--navH")
      ) || 74;

    // Mobile-optimized scroll distances for smoother animations
    const isMobile = window.innerWidth <= 900;
    const vh = getViewportHeight();

    if (isMobile) {
      // Mobile: tighter, more responsive distances
      PHASE1_DIST = vh * 0.6;  // Paragraph dock
      QUALIFY_DELAY_DIST = vh * 0.08;  // Delay before qualify (small lock-in)
      PHASE2_DIST = 0;  // No qualify slide on mobile in hero phase
    } else {
      // Desktop distances
      PHASE1_DIST = Math.max(320, Math.min(520, vh * 0.45));
      QUALIFY_DELAY_DIST = Math.max(180, Math.min(320, vh * 0.26));
      PHASE2_DIST = Math.max(260, Math.min(520, vh * 0.35));
    }

    const scenarioCount = Math.max(1, scenarios.length || 1);
    const basePhase3 = isMobile
      ? 0  // No scenario cycling in hero phase on mobile
      : Math.max(340, Math.min(620, vh * 0.55));
    const dwellTotal = isMobile
      ? 0  // No dwell on mobile, qualify is separate
      : SCENARIO_DWELL_DIST * Math.max(0, scenarioCount - 1);
    const holdDist = isMobile
      ? 0  // No hold on mobile hero, qualify is separate
      : FINAL_HOLD_DIST;
    PHASE3_DIST = basePhase3 + dwellTotal + holdDist;

    PHASE4_DIST = isMobile
      ? vh * 0.15  // Quick lift on mobile
      : Math.max(420, Math.min(720, vh * 0.65));

    // Workflow (Phase 5) responsive distance - tweak point
    WORKFLOW_DIST = Math.max(420, Math.min(720, vh * 0.65));
    WORKFLOW_HOLD_DIST = Math.max(160, Math.min(320, vh * 0.22)); // about ~2s scroll dwell
    workflowBaseOffset = 0; // tweak point
    workflowPinEnabled = !isMobile; // Disable pinning on mobile for seamless scrolling

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
      // Spacer at final post-pin height for consistent measurements
      workflowSpacerHeight = WORKFLOW_DIST + WORKFLOW_HOLD_DIST;
      workflowSpacer.style.height = `${workflowSpacerHeight}px`;
    } else if (workflowSpacer) {
      workflowSpacer.style.height = "0px";
      workflowSpacerHeight = 0;
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
      workflowPinOffset = getViewportHeight() * 0.14; // pin higher (~14% down) on desktop
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
    // Expose a stable workflow scroll target for external triggers
    if (typeof window !== "undefined") {
      if (workflow && workflowPinEnabled) {
        const start =
          workflowScrollStart + WORKFLOW_DELAY_DIST + workflowBaseOffset;
        const endHold = start + WORKFLOW_DIST + WORKFLOW_HOLD_DIST;
        window.__workflowScrollTarget = endHold;
      } else if (workflow) {
        // Fallback: place just above the workflow section accounting for nav
        const top =
          workflow.getBoundingClientRect().top + window.scrollY - navH - 8;
        window.__workflowScrollTarget = top;
      } else {
        window.__workflowScrollTarget = null;
      }
    }

    // Testimonials (Phase 6) - Enable on all screen sizes for horizontal scroll effect
    testimonialsPinEnabled =
      !!testimonialsContainer &&
      !!testimonialsTrack &&
      !prefersReducedMotion.matches;

    if (testimonialsContainer && testimonialsTrack) {
      // Reset workflow to post-pin state for accurate testimonials measurement
      const workflowPrevPosition = workflow ? workflow.style.position : null;
      const workflowPrevTransform = workflow ? workflow.style.transform : null;

      if (workflow) {
        workflow.style.position = "relative";
        workflow.style.transform = `translateY(${workflowSpacerHeight}px)`;
      }

      const prevPosition = testimonialsContainer.style.position;
      const prevLeft = testimonialsContainer.style.left;
      const prevRight = testimonialsContainer.style.right;
      const prevTop = testimonialsContainer.style.top;
      const prevTransform = testimonialsContainer.style.transform;
      const prevOverflow = testimonialsContainer.style.overflow;
      const prevWidth = testimonialsContainer.style.width;
      const prevZ = testimonialsContainer.style.zIndex;

      testimonialsContainer.style.position = "relative";
      testimonialsContainer.style.left = "";
      testimonialsContainer.style.right = "";
      testimonialsContainer.style.top = "";
      testimonialsContainer.style.transform = "";
      testimonialsContainer.style.overflow = "visible";
      testimonialsContainer.style.width = "";
      testimonialsContainer.style.zIndex = "";

      const rect = testimonialsContainer.getBoundingClientRect();
      const currentScrollY = window.scrollY;

      // Calculate where the container currently is in the document
      // We need the top edge of the container relative to the document
      const containerDocTop = rect.top + currentScrollY;

      testimonialsContainerWidth = rect.width;
      testimonialsContainerHeight = testimonialsContainer.offsetHeight;

      const containerStyles = getComputedStyle(testimonialsContainer);
      const padL =
        parseFloat(containerStyles.paddingLeft.replace("px", "")) || 0;
      const padR =
        parseFloat(containerStyles.paddingRight.replace("px", "")) || 0;
      testimonialsVisibleWidth = testimonialsContainer.clientWidth - padL - padR;

      testimonialsTrackWidth = testimonialsTrack.scrollWidth;
      // Calculate exact scroll distance without extra padding
      testimonialsTrackTravel = Math.max(
        0,
        testimonialsTrackWidth - testimonialsVisibleWidth
      );

      if (testimonialsTrackTravel <= 0) {
        testimonialsPinEnabled = false;
      }

      TESTIMONIALS_PIN_DIST = Math.max(
        820,
        Math.min(1400, getViewportHeight() * 1.1)
      );

      testimonialsPinOffset = getViewportHeight() * 0.17;
      testimonialsPinTop = navH + testimonialsPinOffset;

      // Calculate the scroll position where the container's top edge
      // will naturally align with testimonialsPinTop
      testimonialsScrollStart = testimonialsPinEnabled
        ? containerDocTop - testimonialsPinTop
        : 0;
      testimonialsScrollEnd = testimonialsScrollStart + TESTIMONIALS_PIN_DIST;

      if (testimonialsSpacer) {
        // Spacer must compensate for container leaving flow when it goes fixed
        // Plus provide scroll room for animation and unpinning
        const containerHeight = testimonialsContainerHeight || 0;
        const unpinBuffer = 0; // No buffer for very tight spacing
        testimonialsSpacerHeight = testimonialsPinEnabled
          ? containerHeight + TESTIMONIALS_PIN_DIST + unpinBuffer
          : 0;
        testimonialsSpacer.style.height = `${testimonialsSpacerHeight}px`;
      }

      testimonialsContainer.style.position = prevPosition;
      testimonialsContainer.style.left = prevLeft;
      testimonialsContainer.style.right = prevRight;
      testimonialsContainer.style.top = prevTop;
      testimonialsContainer.style.transform = prevTransform;
      testimonialsContainer.style.overflow = prevOverflow;
      testimonialsContainer.style.width = prevWidth;
      testimonialsContainer.style.zIndex = prevZ;

      // Restore workflow state
      if (workflow) {
        workflow.style.position = workflowPrevPosition || "";
        workflow.style.transform = workflowPrevTransform || "";
      }
    } else if (testimonialsSpacer) {
      testimonialsSpacer.style.height = "0px";
      testimonialsSpacerHeight = 0;
    }

    // Mobile-optimized startTop calculation
    startTop = isMobile ? vh : vh + 24;

    const heroRightStyle = heroRight ? getComputedStyle(heroRight) : null;
    const heroRightHidden =
      !heroRight ||
      heroRightStyle.display === "none" ||
      heroRight.getBoundingClientRect().width === 0;

    // On desktop: pin qualify during hero phase
    // On mobile: separate phase with independent pinning
    qualifyPinEnabled = !!qualifyCard && !heroRightHidden && window.innerWidth > 900;

    if (qualifyPinEnabled && heroRight) {
      // Desktop: qualify appears in the exact position of heroRight
      const heroRightRect = heroRight.getBoundingClientRect();
      const maxCardWidth = Math.min(
        560,
        Math.max(420, qualifyCard.offsetWidth || 0),
        window.innerWidth - 120
      );
      // Nudge the pinned qualify card further right and slightly higher to clear the headline
      const rightNudge = Math.max(90, heroRightRect.width * 0.32);
      const topLift = Math.max(20, heroRightRect.height * 0.08);

      qualifyGeometry = {
        left: heroRightRect.left + rightNudge,
        top: heroRightRect.top - topLift,
        width: maxCardWidth,
      };
      qualifyMobilePinEnabled = false;
    } else if (qualifyCard && qualifySection) {
      // Mobile: qualify is separate phase with independent pinning
      qualifyGeometry = { left: 0, top: 0, width: 0 };
      qualifyMobilePinEnabled = true;

      // Calculate mobile pinning positions
      // Start qualify after hero section is completely scrolled out of view
      const heroPhaseEnd = PHASE1_DIST + QUALIFY_DELAY_DIST + PHASE2_DIST + PHASE3_DIST + PHASE4_DIST;

      // Buffer to ensure paragraph is fully out of view before qualify starts
      const bufferDist = 250; // Gap to prevent overlap when scrolling up
      const slideInDist = 200;

      // Qualify starts sliding in shortly after hero phase completes
      qualifyMobilePinStart = heroPhaseEnd + bufferDist + slideInDist;

      // Scroll distance for scenario cycling (based on number of scenarios)
      const scenarioCount = scenarios.length || 1;
      const mobileHoldDist = 200; // Minimal hold on mobile
      const scenarioDist = Math.max(200, scenarioCount * 140) + mobileHoldDist; // Per-scenario scroll duration

      qualifyMobileScrollDist = scenarioDist;
      qualifyMobilePinEnd = qualifyMobilePinStart + qualifyMobileScrollDist;

      // Lock in a stable height/top for the mobile pin state to avoid mid-cycle jumps
      const scenarioHeights = scenarios.length
        ? Array.from(scenarios).map((el) => el.offsetHeight || 0)
        : [qualifyCard.offsetHeight || 0];
      const maxScenarioHeight = scenarioHeights.length
        ? Math.max(...scenarioHeights)
        : qualifyCard.offsetHeight || 0;
      qualifyMobilePinnedHeight = Math.max(qualifyCard.offsetHeight || 0, maxScenarioHeight);
      qualifyMobilePinTop =
        navH + (getViewportHeight() - navH - qualifyMobilePinnedHeight) / 2;

      // Set spacer height to account for slide-in + scenario cycling + final hold
      const qualifySpacer = document.getElementById("qualifySpacer");
      if (qualifySpacer) {
        const finalHoldDist = 1300; // Spacer height (smaller than hold for tighter gap)
        const totalScrollDist = slideInDist + qualifyMobileScrollDist + finalHoldDist;
        qualifySpacer.style.height = `${totalScrollDist}px`;
      }
    } else {
      qualifyGeometry = { left: 0, top: 0, width: 0 };
      qualifyMobilePinEnabled = false;
      qualifyMobilePinnedHeight = 0;
      qualifyMobilePinTop = 0;

      // Reset spacer on desktop
      const qualifySpacer = document.getElementById("qualifySpacer");
      const workflowSection = document.getElementById("workflow");
      if (qualifySpacer) {
        qualifySpacer.style.height = "0px";
      }
      if (workflowSection) {
        workflowSection.style.marginTop = "0px";
      }
    }

    setScrollSpace();
    equalizeWorkflowCards();
    update();
  }

  function smoothstep(edge0, edge1, x) {
    if (edge1 === edge0) {
      return x >= edge1 ? 1 : 0;
    }
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function update() {
    const y = window.scrollY;

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

    // Add/remove will-change class dynamically
    const heroInnerAnimating = liftP > 0 && liftP < 1;
    heroInner.classList.toggle('animating', heroInnerAnimating);

    if (qualifyCard && qualifyPinEnabled) {
      const qualifyAnimating = qualifyP > 0 && qualifyP < 1;
      qualifyCard.classList.toggle('animating', qualifyAnimating);
    }

    const liftT = lerp(0, translateMax, liftP);
    const postLift = Math.max(0, y - phase4End);

    const heroTranslate = liftT - postLift;

    heroInner.style.position = "fixed";
    heroInner.style.left = "0";
    heroInner.style.right = "0";
    heroInner.style.top = `${navH}px`;
    heroInner.style.transform = `translateY(${heroTranslate}px)`;

    if (heroBg) {
      heroBg.style.setProperty("--hero-bg-translate", `${heroTranslate}px`);
    }

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

    // Fade out hero image conditionally based on screen size
    if (heroRight) {
      const isMobile = window.innerWidth <= 900;
      let imageFade;

      if (isMobile) {
        // Mobile: fade when paragraph docks
        imageFade = clamp(1 - dockP * 1.5, 0, 1);
      } else {
        // Desktop: fade when qualify section starts to come in
        imageFade = clamp(1 - qualifyP * 1.5, 0, 1);
      }

      heroRight.style.opacity = `${imageFade}`;
      heroRight.style.pointerEvents = imageFade < 0.15 ? "none" : "auto";
    }

    let finalTakeover = false;
    let finalTakeoverProgress = 0;

    if (qualifyCard) {
      let activeIndex = -1;

      if (qualifyPinEnabled) {
        const slideX = lerp(qualifyGeometry.width * 0.35, 0, qualifyP);
        const opacity = clamp(qualifyP * 1.1, 0, 1);
        const yOffset = liftT - postLift;
        const scenarioCount = Math.max(1, scenarios.length || 1);

        qualifyCard.style.position = "fixed";
        qualifyCard.style.left = `${qualifyGeometry.left}px`;
        qualifyCard.style.top = `${qualifyGeometry.top}px`;
        qualifyCard.style.width = `${qualifyGeometry.width}px`;
        qualifyCard.style.maxWidth = `${qualifyGeometry.width}px`;
        qualifyCard.style.transform = `translate(${slideX}px, ${yOffset}px) scale(${lerp(0.96, 1, qualifyP)})`;
        qualifyCard.style.opacity = `${opacity}`;
        qualifyCard.style.pointerEvents = opacity > 0.2 ? "auto" : "none";
        qualifyCard.style.right = "";
        qualifyCard.style.maxWidth = `${qualifyGeometry.width}px`;

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

        const finalRevealStart = scenarioCount > 1 ? (scenarioCount - 0.5) / scenarioCount : 0.65;
        const finalRevealEnd = 0.995;
        const finalReveal =
          qualifyP > 0.6 && scenarioProgress >= finalRevealStart;
        qualifyCard.classList.toggle("final-reveal", finalReveal);
        if (finalReveal) {
          finalTakeover = true;
          finalTakeoverProgress = smoothstep(
            finalRevealStart,
            finalRevealEnd,
            scenarioProgress
          );
          qualifyCard.style.left = "0";
          qualifyCard.style.right = "0";
          qualifyCard.style.top = `${navH}px`;
          qualifyCard.style.width = "100%";
          qualifyCard.style.maxWidth = "100vw";
          qualifyCard.style.transform = `translate(0px, ${yOffset}px) scale(1)`;
          qualifyCard.style.opacity = "1";

          activeIndex = scenarios.length ? scenarios.length - 1 : activeIndex;
        } else {
          // Not in final reveal - hide the card if we're past the phase
          if (postLift > 0) {
            qualifyCard.style.opacity = "0";
            qualifyCard.style.pointerEvents = "none";
          }
        }
      } else if (qualifyMobilePinEnabled) {
        // Mobile: independent pinning phase with slide-in animation
        const slideInDist = 200; // Distance for slide-in animation
        const slideInStart = qualifyMobilePinStart - slideInDist;

        // Add buffer distance to hold final reveal before scrolling up
        // Provides time for stats animation to complete (1.6s delay + 1.2s duration = 2.8s total)
        const finalHoldDist = 1600; // Hold final reveal in place before scrolling up
        const scrollUpStart = qualifyMobilePinEnd + finalHoldDist;

        const beforeSlide = y < slideInStart;
        const duringSlide = y >= slideInStart && y < qualifyMobilePinStart;
        const duringPin = y >= qualifyMobilePinStart && y < scrollUpStart;
        const afterPin = y >= scrollUpStart;

        const vh = getViewportHeight();
        const cardHeight =
          qualifyMobilePinnedHeight || qualifyCard.offsetHeight || 0;
        const pinTop =
          qualifyMobilePinTop ||
          navH + (vh - navH - cardHeight) / 2;

        // Calculate post-qualify offset for smooth unpinning (starts after hold period)
        const postQualify = Math.max(0, y - scrollUpStart);

        if (beforeSlide) {
          // Before slide: card hidden, positioned off-screen right
          qualifyCard.style.position = "fixed";
          qualifyCard.style.left = "50%";
          qualifyCard.style.top = `${pinTop}px`;
          qualifyCard.style.width = `${qualifyCard.offsetWidth}px`;
          qualifyCard.style.transform = "translateX(100vw)";
          qualifyCard.style.opacity = "0";
          qualifyCard.style.pointerEvents = "none";
          qualifyCard.classList.remove("visible");
        } else if (duringSlide) {
          // During slide: animate in from right
          const slideProgress = (y - slideInStart) / slideInDist;
          const slideX = lerp(100, -50, smoothstep(0, 1, slideProgress)); // From 100vw to -50% (centered)
          const opacity = clamp(slideProgress * 1.5, 0, 1);

          qualifyCard.style.position = "fixed";
          qualifyCard.style.left = "50%";
          qualifyCard.style.top = `${pinTop}px`;
          qualifyCard.style.width = `${qualifyCard.offsetWidth}px`;
          qualifyCard.style.transform = `translateX(${slideX}%)`;
          qualifyCard.style.opacity = `${opacity}`;
          qualifyCard.style.pointerEvents = opacity > 0.5 ? "auto" : "none";

          if (slideProgress > 0.5) {
            qualifyCard.classList.add("visible");
          }
        } else if (duringPin) {
          // During pinning: fixed at center, cycle scenarios
          qualifyCard.style.position = "fixed";
          qualifyCard.style.left = "50%";
          qualifyCard.style.top = `${pinTop}px`;
          qualifyCard.style.width = `${qualifyCard.offsetWidth}px`;
          qualifyCard.style.transform = "translateX(-50%)";
          qualifyCard.style.opacity = "1";
          qualifyCard.style.pointerEvents = "auto";
          qualifyCard.classList.add("visible");

          // Cycle through scenarios
          const progress = (y - qualifyMobilePinStart) / qualifyMobileScrollDist;
          if (scenarios.length) {
            activeIndex = Math.min(
              scenarios.length - 1,
              Math.floor(progress * scenarios.length)
            );
          }

          // Trigger final reveal at end of scenario cycling - delayed to give time to read last scenario
          // Delay the final takeover on mobile so the last scenario stays visible longer
          const finalRevealStart = 1.2;
          const finalReveal = progress >= finalRevealStart;
          qualifyCard.classList.toggle("final-reveal", finalReveal);

          if (finalReveal) {
            finalTakeover = true;
            finalTakeoverProgress = 1;

            // Snap to full-width immediately - CSS transition will smooth it
            qualifyCard.style.position = "fixed";
            qualifyCard.style.left = "0";
            qualifyCard.style.top = `${navH}px`;
            qualifyCard.style.width = "100%";
            qualifyCard.style.maxWidth = "100vw";
            qualifyCard.style.transform = "translate(0, 0)";
            qualifyCard.style.opacity = "1";
            qualifyCard.style.pointerEvents = "auto";
            activeIndex = scenarios.length ? scenarios.length - 1 : activeIndex;
          }
        } else if (afterPin) {
          // After pinning: keep full-width and scroll up smoothly
          const finalReveal = true;
          qualifyCard.classList.toggle("final-reveal", finalReveal);
          finalTakeover = true;
          finalTakeoverProgress = 1; // Already at full expansion

          qualifyCard.style.position = "fixed";
          qualifyCard.style.left = "0";
          qualifyCard.style.width = `${window.innerWidth}px`;
          qualifyCard.style.maxWidth = "100vw";
          qualifyCard.style.top = `${navH}px`;
          qualifyCard.style.transform = `translate(0, ${-postQualify}px)`;
          qualifyCard.style.opacity = "1"; // Keep visible during scroll-out
          qualifyCard.style.pointerEvents = "auto";
          qualifyCard.classList.add("visible");

          // Show last scenario
          if (scenarios.length) {
            activeIndex = scenarios.length - 1;
          }
        }
      } else {
        // Fallback: normal flow
        const rect = qualifySection.getBoundingClientRect();
        const sectionTop = rect.top + y;
        const sectionHeight = qualifySection.offsetHeight || 1;
        const progress = clamp((y - sectionTop) / sectionHeight, 0, 1);

        if (scenarios.length) {
          activeIndex = Math.min(
            scenarios.length - 1,
            Math.floor(progress * scenarios.length)
          );
        }
        qualifyCard.classList.remove("final-reveal");
        qualifyCard.style.maxWidth = "";
        qualifyCard.style.right = "";
        // Ensure card is visible in normal flow
        qualifyCard.style.position = "relative";
        qualifyCard.style.left = "";
        qualifyCard.style.top = "";
        qualifyCard.style.transform = "none";
        qualifyCard.style.opacity = "1";
        qualifyCard.style.pointerEvents = "auto";
      }

      scenarios.forEach((el, i) => {
        el.classList.toggle("active", i === activeIndex);
      });

      if (finalScenario) {
        finalScenario.classList.toggle("active", finalTakeover);
      }
    }

    if (heroBg) {
      const bgFade = finalTakeover ? smoothstep(0, 1, finalTakeoverProgress) : 0;
      heroBg.style.opacity = `${1 - bgFade}`;
    }

    // PHASE 5: Workflow section
    const workflow = document.getElementById("workflow");
    if (workflow && workflowScrollStart >= 0) {
      const workflowSpacer = document.getElementById("workflowSpacer");
      let workflowP = 0;
      let before = false;
      let during = false;
      let hold = false;
      let start, endAnim, endHold;

      if (!workflowPinEnabled) {
        // Mobile: individual card animation based on viewport position
        before = false;
        during = false;
        hold = false;

        // Call renderWorkflow with mobile individual mode
        renderWorkflow(0, true);
      } else {
        // Desktop: existing pinning logic
        start = workflowScrollStart + WORKFLOW_DELAY_DIST + workflowBaseOffset;
        endAnim = start + WORKFLOW_DIST;
        endHold = endAnim + WORKFLOW_HOLD_DIST;

        before = y < start;
        during = y >= start && y < endAnim;
        hold = y >= endAnim && y < endHold;

        const scrollProgress = before ? 0 : y - start;
        workflowP = clamp(scrollProgress / WORKFLOW_DIST, 0, 1);

        renderWorkflow(workflowP, false);
      }

      const workflowIsPinned = workflowPinEnabled && (during || hold);
      workflow.classList.toggle("workflow-pinned", workflowIsPinned);

      // Pin during animation, then return to flow with offset
      if (workflowPinEnabled && (during || hold)) {
        // During pin: increase spacer to prevent jump
        if (workflowSpacer) {
          workflowSpacer.style.height = `${workflow.offsetHeight + WORKFLOW_DIST + WORKFLOW_HOLD_DIST}px`;
        }
        workflow.style.position = "fixed";
        workflow.style.left = "0";
        workflow.style.right = "0";
        workflow.style.top = `${workflowPinTop}px`;
        workflow.style.transform = "none";
      } else if (workflowPinEnabled && !before) {
        // After pin: reduce spacer and translate workflow
        if (workflowSpacer) {
          workflowSpacer.style.height = `${workflowSpacerHeight}px`;
        }
        workflow.style.position = "relative";
        workflow.style.left = "";
        workflow.style.right = "";
        workflow.style.top = "";
        workflow.style.transform = `translateY(${workflowSpacerHeight}px)`;
      } else {
        // Before pin: keep spacer at final height
        if (workflowSpacer) {
          workflowSpacer.style.height = `${workflowSpacerHeight}px`;
        }
        workflow.style.position = "relative";
        workflow.style.left = "";
        workflow.style.right = "";
        workflow.style.top = "";
        workflow.style.transform = "";
      }
    }

    // PHASE 6: Testimonials section
    if (testimonialsContainer && testimonialsTrack) {
      const start = testimonialsScrollStart;
      const dist = TESTIMONIALS_PIN_DIST || 1;
      const pinEnd = start + dist;

      // Calculate post-testimonials offset for smooth unpinning
      const postTestimonials = Math.max(0, y - pinEnd);

      if (!testimonialsPinEnabled) {
        testimonialsContainer.style.position = "relative";
        testimonialsContainer.style.left = "";
        testimonialsContainer.style.right = "";
        testimonialsContainer.style.top = "";
        testimonialsContainer.style.transform = "";
        testimonialsContainer.style.overflow = "";
        testimonialsContainer.style.width = "";
        testimonialsContainer.style.zIndex = "";
        testimonialsTrack.style.transform = "";
        return;
      }

      // Before pinning: keep in normal flow
      if (y < start) {
        testimonialsContainer.style.position = "";
        testimonialsContainer.style.left = "";
        testimonialsContainer.style.right = "";
        testimonialsContainer.style.top = "";
        testimonialsContainer.style.transform = "";
        testimonialsContainer.style.overflow = "";
        testimonialsContainer.style.width = "";
        testimonialsContainer.style.zIndex = "";
        testimonialsContainer.style.transition = "";
        testimonialsTrack.style.transform = "";
        testimonialsSection.classList.remove("pinned");
        return;
      }

      if (y >= start && y < pinEnd) {
        // During pinning: horizontal scroll effect
        const p = clamp((y - start) / dist, 0, 1);
        const translateX = -p * testimonialsTrackTravel;

        // Calculate exact left position to match centered position
        const leftPos = (window.innerWidth - testimonialsContainerWidth) / 2;

        // Check if we're just entering the pinned state
        const wasPinned = testimonialsSection.classList.contains("pinned");

        if (!wasPinned) {
          // At the moment of pinning, capture the exact current position to prevent jump
          const currentRect = testimonialsContainer.getBoundingClientRect();
          const exactTop = currentRect.top;

          testimonialsContainer.style.position = "fixed";
          testimonialsContainer.style.left = `${leftPos}px`;
          testimonialsContainer.style.right = "";
          testimonialsContainer.style.top = `${exactTop}px`;
          testimonialsContainer.style.transform = "";
          testimonialsContainer.style.overflow = "hidden";
          testimonialsContainer.style.width = `${testimonialsContainerWidth}px`;
          testimonialsContainer.style.zIndex = "60";
          testimonialsSection.classList.add("pinned");
          testimonialsTrack.style.transform = `translateX(${translateX}px)`;

          // Smoothly transition to the target pin position
          if (Math.abs(exactTop - testimonialsPinTop) > 2) {
            requestAnimationFrame(() => {
              if (testimonialsContainer && testimonialsSection.classList.contains("pinned")) {
                testimonialsContainer.style.transition = "top 0.2s ease-out";
                testimonialsContainer.style.top = `${testimonialsPinTop}px`;
                setTimeout(() => {
                  if (testimonialsContainer) {
                    testimonialsContainer.style.transition = "";
                  }
                }, 200);
              }
            });
          }
        } else {
          testimonialsContainer.style.position = "fixed";
          testimonialsContainer.style.left = `${leftPos}px`;
          testimonialsContainer.style.right = "";
          testimonialsContainer.style.top = `${testimonialsPinTop}px`;
          testimonialsContainer.style.transform = "";
          testimonialsContainer.style.overflow = "hidden";
          testimonialsContainer.style.width = `${testimonialsContainerWidth}px`;
          testimonialsContainer.style.zIndex = "60";
          testimonialsTrack.style.transform = `translateX(${translateX}px)`;
        }
      } else {
        // After pin ends: smooth unpinning (like hero and qualify sections)
        const leftPos = (window.innerWidth - testimonialsContainerWidth) / 2;

        testimonialsContainer.style.position = "fixed";
        testimonialsContainer.style.left = `${leftPos}px`;
        testimonialsContainer.style.right = "";
        testimonialsContainer.style.top = `${testimonialsPinTop}px`;
        testimonialsContainer.style.transform = `translateY(${-postTestimonials}px)`;
        testimonialsContainer.style.overflow = "hidden";
        testimonialsContainer.style.width = `${testimonialsContainerWidth}px`;
        testimonialsContainer.style.zIndex = "60";
        testimonialsSection.classList.add("pinned");
        testimonialsTrack.style.transform = `translateX(-${testimonialsTrackTravel}px)`;
      }
    }
  }

  // Workflow animation render function
  // Phase breakpoints (tweak points)
  const WORKFLOW_PHASE_A = 0.33;
  const WORKFLOW_PHASE_B = 0.66;

  function renderWorkflow(p, useMobileIndividual = false) {
    const cards = document.querySelectorAll(".workflowCard");
    const connectors = document.querySelectorAll(".workflowCard .connector");

    if (!cards.length) return;

    if (useMobileIndividual) {
      // Mobile: Animate each card individually when top reaches 70% from top
      const vh = getViewportHeight();
      const triggerPoint = vh * 0.7; // Trigger when card top reaches 70% from top
      const animationRange = vh * 0.3; // Animation happens over 30% of viewport

      cards.forEach((card, index) => {
        const rect = card.getBoundingClientRect();
        const cardTop = rect.top;
        const scrollIntoView = triggerPoint - cardTop;
        const cardProgress = clamp(scrollIntoView / animationRange, 0, 1);

        card.style.setProperty("--card-opacity", cardProgress);
        card.style.setProperty("--card-offset", `${lerp(30, 0, cardProgress)}px`);

        if (connectors[index]) {
          connectors[index].style.setProperty("--connector-scale", cardProgress);
          connectors[index].style.setProperty("--connector-opacity", cardProgress);
        }
      });
    } else {
      // Desktop: Original phased animation
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
  }

  // Adaptive throttling based on device - reduced throttling on mobile for smoother animations
  const getThrottleDelay = () => {
    if (window.innerWidth < 768) return 8;   // ~120fps on mobile (reduced from 32ms)
    if (window.innerWidth < 1024) return 8;  // ~120fps on tablet (reduced from 16ms)
    return 0;  // No delay on desktop
  };

  let lastScrollTime = 0;

  function onScroll() {
    if (ticking) return;

    const now = Date.now();
    const throttleDelay = getThrottleDelay();

    if (now - lastScrollTime < throttleDelay) return;
    lastScrollTime = now;

    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      update();
    });
  }

  // Debounced resize handler for mobile
  let resizeTimeout;
  const handleResize = () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      refreshStableVh();
      recalc();
      update();
    }, 150);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", () => {
    refreshStableVh();
    // Mobile orientation change - recalc after a delay
    setTimeout(() => {
      recalc();
      update();
    }, 300);
  });
  window.addEventListener("load", () => {
    refreshStableVh();
    recalc();
    // Extra recalc after load for mobile browsers
    setTimeout(recalc, 100);
  });

  // Add touch events for mobile devices
  window.addEventListener("touchmove", onScroll, { passive: true });
  window.addEventListener("touchend", () => {
    // Force update after touch ends to ensure final position
    setTimeout(update, 50);
  }, { passive: true });

  if (prefersReducedMotion && prefersReducedMotion.addEventListener) {
    prefersReducedMotion.addEventListener("change", recalc);
  }

  // Initial calculations
  recalc();

  // Force initial update to ensure elements are positioned correctly
  requestAnimationFrame(() => {
    update();
    // Mark body as JS-ready after initialization
    document.body.classList.add('js-ready');
  });
})();

// Smooth scroll for data-target buttons (hero/nav)
(() => {
  const prefersReducedMotionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  const easeInOutQuad = (t) =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (!el) return;

    const navHeight =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--navH")
      ) || 72;

    // Special-case workflow: jump to end of its pinned animation/hold
    let targetY =
      el.getBoundingClientRect().top + window.scrollY - navHeight - 10;
    if (id === "workflow" && typeof window !== "undefined") {
      const stored = window.__workflowScrollTarget;
      if (typeof stored === "number" && !Number.isNaN(stored)) {
        targetY = stored;
      }
    }
    const startY = window.scrollY;
    const dist = targetY - startY;
    const duration = 650; // balanced: not too fast, not too slow
    const startTime = performance.now();

    if (prefersReducedMotionQuery.matches) {
      window.scrollTo(0, targetY);
      return;
    }

    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeInOutQuad(t);
      window.scrollTo(0, startY + dist * eased);
      if (t < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  };

  document.querySelectorAll("[data-target]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const target = btn.getAttribute("data-target");
      if (!target) return;
      event.preventDefault();
      scrollToSection(target);
    });
  });
})();

// Mobile navigation toggle
(() => {
  const hamburger = document.getElementById('hamburgerBtn');
  const navLinks = document.querySelector('.navLinks');

  if (!hamburger || !navLinks) return;

  const toggleNav = () => {
    const isOpen = navLinks.classList.toggle('open');
    hamburger.classList.toggle('active');
    hamburger.setAttribute('aria-expanded', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  };

  hamburger.addEventListener('click', toggleNav);

  // Close on link click
  navLinks.querySelectorAll('.navBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (navLinks.classList.contains('open')) {
        toggleNav();
      }
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (navLinks.classList.contains('open') &&
        !navLinks.contains(e.target) &&
        !hamburger.contains(e.target)) {
      toggleNav();
    }
  });
})();

// Nav active state on scroll + clicks (sections + page links)
(() => {
  const allNavButtons = Array.from(
    document.querySelectorAll(".navLinks .navBtn")
  );
  if (!allNavButtons.length) return;

  const sectionButtons = allNavButtons.filter((btn) =>
    btn.hasAttribute("data-target")
  );
  const pageButtons = allNavButtons.filter(
    (btn) => !btn.hasAttribute("data-target") && btn.getAttribute("href")
  );

  const sections = sectionButtons
    .map((btn) => {
      const id = btn.getAttribute("data-target");
      const el = id ? document.getElementById(id) : null;
      return el ? { id, el, btn } : null;
    })
    .filter(Boolean);

  const getNavHeight = () =>
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--navH")
    ) || 72;

  const setActiveBtn = (btn) => {
    allNavButtons.forEach((b) => b.classList.toggle("active", b === btn));
  };

  const updateSectionActive = () => {
    if (!sections.length) return false;
    const marker = getNavHeight() + Math.min(200, window.innerHeight * 0.28);
    let activeEntry = null;
    let closestEntry = sections[0];
    let closestDelta = Infinity;

    sections.forEach((entry) => {
      const rect = entry.el.getBoundingClientRect();
      const top = rect.top;
      const bottom = rect.bottom;

      if (top <= marker && bottom >= marker) {
        activeEntry = entry;
      }

      const delta = Math.abs(top - marker);
      if (delta < closestDelta) {
        closestDelta = delta;
        closestEntry = entry;
      }
    });

    setActiveBtn((activeEntry || closestEntry).btn);
    return true;
  };

  const normalizePath = (p) => {
    if (!p) return "/";
    let path = p.split("?")[0].split("#")[0] || "/";
    if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);
    if (path.endsWith("/index")) path = path.slice(0, -6) || "/";
    if (path.endsWith("/index.html")) path = path.slice(0, -11) || "/";
    if (path.endsWith(".html")) path = path.slice(0, -5) || "/";
    return path || "/";
  };

  const updatePathActive = () => {
    if (!pageButtons.length) return;
    const current = normalizePath(window.location.pathname);
    let matchedBtn = null;
    pageButtons.forEach((btn) => {
      const href = btn.getAttribute("href") || "";
      try {
        const url = new URL(href, window.location.origin);
        const path = normalizePath(url.pathname);
        // Special case: article pages belong to Why Clarity section
        const isArticlePage = current.startsWith("/articles/");
        const isWhyClarityBtn = path === "/why-clarity";
        if ((isArticlePage && isWhyClarityBtn) || path === current || (path !== "/" && current.startsWith(path))) {
          matchedBtn = btn;
        }
      } catch (err) {
        /* ignore malformed href */
      }
    });
    if (matchedBtn) {
      setActiveBtn(matchedBtn);
    }
  };

  const updateActive = () => {
    // If we're on a different page (pathname not "/") prefer page match
    const path = normalizePath(window.location.pathname);
    if (path !== "/") {
      updatePathActive();
      return;
    }
    const handled = sections.length ? updateSectionActive() : false;
    if (!handled) {
      updatePathActive();
    }
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      updateActive();
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", updateActive);
  allNavButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      // For same-page anchors, section scroll will update active; for full-page links, set immediately
      if (!btn.hasAttribute("data-target")) {
        setActiveBtn(btn);
      }
    });
  });

  updateActive();
})();

// Contact form animation + submission
(() => {
  const contactSection = document.getElementById("contact");
  if (!contactSection) return;

  const revealEls = contactSection.querySelectorAll(".contactReveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            entry.target.classList.add("in-view");
          } else {
            entry.target.classList.remove("in-view");
          }
        });
      },
      { threshold: [0, 0.35, 0.5], rootMargin: "0px 0px 5% 0px" }
    );
    revealEls.forEach((el) => observer.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in-view"));
  }

  const form = document.getElementById("contactForm");
  const statusEl = document.getElementById("contactStatus");
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

  const setStatus = (message, type = "") => {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.remove("error", "success");
    if (type) statusEl.classList.add(type);
  };

  const isValidEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const payload = {
        name: (formData.get("name") || "").trim(),
        email: (formData.get("email") || "").trim(),
        company: (formData.get("company") || "").trim(),
        message: (formData.get("message") || "").trim(),
        website: (formData.get("website") || "").trim(),
      };

      if (!payload.name || !payload.email || !payload.message) {
        setStatus("Please fill out required fields.", "error");
        return;
      }

      if (!isValidEmail(payload.email)) {
        setStatus("Add a valid email so we can reach you.", "error");
        return;
      }

      setStatus("Sending...");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.textContent = "Sending...";
      }

      try {
        const res = await fetch("/contact", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.message || "Something went wrong. Please try again.");
        }
        setStatus("Thanks - your note is on the way.", "success");
        form.reset();
      } catch (err) {
        setStatus(err.message || "Could not send message right now.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent =
            submitBtn.dataset.originalText || "Start the conversation";
          delete submitBtn.dataset.originalText;
        }
      }
    });
  }
})();
