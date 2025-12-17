const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

/* -------- EASED smooth scroll with header offset (not "jump") -------- */
function smoothScrollToId(id){
  const el = document.getElementById(id);
  if(!el) return;

  const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--navH')) || 74;
  const startY = window.scrollY;
  const targetY = el.getBoundingClientRect().top + window.scrollY - navH + 1;
  const dist = targetY - startY;

  const dur = Math.min(1100, Math.max(520, Math.abs(dist) * 0.75));
  const t0 = performance.now();
  const ease = (t) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;

  function step(now){
    const p = Math.min(1, (now - t0) / dur);
    window.scrollTo(0, startY + dist * ease(p));
    if(p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

$$('[data-target]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    smoothScrollToId(btn.dataset.target);
  });
});

/* -------- Top progress bar -------- */
const bar = $('#topProgress');
function updateProgress(){
  const h = document.documentElement;
  const sc = h.scrollTop || document.body.scrollTop;
  const max = (h.scrollHeight - h.clientHeight) || 1;
  bar.style.width = (sc / max) * 100 + '%';
}
window.addEventListener('scroll', updateProgress, { passive:true });
updateProgress();

/* -------- Active nav highlight by section -------- */
const sections = ['home','about','services','contact'].map(id => document.getElementById(id));
const navBtns = $$('.navBtn');

const activeObs = new IntersectionObserver((entries) => {
  const best = entries
    .filter(e => e.isIntersecting)
    .sort((a,b)=> b.intersectionRatio - a.intersectionRatio)[0];
  if(!best) return;
  const id = best.target.id;
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.target === id));
}, { threshold: [0.18, 0.3, 0.42, 0.55] });

sections.forEach(s => s && activeObs.observe(s));

/* -------- Magnetic CTA (subtle) -------- */
const cta = $('#ctaBtn');
cta.addEventListener('mousemove', (e) => {
  const r = cta.getBoundingClientRect();
  const dx = (e.clientX - (r.left + r.width/2)) / r.width;
  const dy = (e.clientY - (r.top + r.height/2)) / r.height;
  cta.style.transform = `translate(${dx*6}px, ${dy*6}px)`;
});
cta.addEventListener('mouseleave', () => cta.style.transform = 'none');

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

/* -------- Services stepper (1/5..5/5 + prev/next) -------- */
const panels = $$('.stepPanel');
const stepCount = $('#stepCount');
const stepTitle = $('#stepTitle');
const dotsWrap = $('#stepDots');

const titles = [
  'Stop the scramble',
  'Make handoffs clean',
  'Choose tools that fit',
  'Make it one system',
  'Automate the repeat work'
];

dotsWrap.innerHTML = panels.map((_,i)=> `<span class="dot ${i===0?'on':''}"></span>`).join('');
const dots = $$('.dot', dotsWrap);

let stepIndex = 0;
function setStep(i){
  stepIndex = clamp(i, 0, panels.length-1);
  stepCount.textContent = `${stepIndex+1}/${panels.length}`;
  stepTitle.textContent = titles[stepIndex] || 'Services';
  dots.forEach((d,idx)=> d.classList.toggle('on', idx===stepIndex));
  panels[stepIndex].scrollIntoView({ behavior:'smooth', block:'nearest' });
}

$('#prevStep').addEventListener('click', ()=> setStep(stepIndex-1));
$('#nextStep').addEventListener('click', ()=> setStep(stepIndex+1));

const panelObs = new IntersectionObserver((entries) => {
  const best = entries
    .filter(e=> e.isIntersecting)
    .sort((a,b)=> b.intersectionRatio - a.intersectionRatio)[0];
  if(!best) return;
  const idx = panels.indexOf(best.target);
  if(idx >= 0 && idx !== stepIndex) {
    stepIndex = idx;
    stepCount.textContent = `${stepIndex+1}/${panels.length}`;
    stepTitle.textContent = titles[stepIndex] || 'Services';
    dots.forEach((d,di)=> d.classList.toggle('on', di===stepIndex));
  }
}, { threshold: [0.35, 0.5, 0.65] });

panels.forEach(p => panelObs.observe(p));

/* -------- Tilt work cards -------- */
$$('.tilt').forEach(card => {
  card.addEventListener('mousemove', (e) => {
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const rx = (py - 0.5) * -7;
    const ry = (px - 0.5) * 9;
    card.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = 'none';
  });
});

/* -------- Quote carousel -------- */
const quotes = [
  { t: "“Everything stopped living in ten places.”", w: "Owner, SMB" },
  { t: "“Handoffs became calm. Nothing slipped.”", w: "Ops lead" },
  { t: "“Less chasing. More doing.”", w: "Manager" },
];
let qi = 0;
function renderQuote(){
  $('#quoteText').textContent = quotes[qi].t;
  $('#quoteWho').textContent = quotes[qi].w;
}
$('#qPrev').addEventListener('click', ()=> { qi = (qi - 1 + quotes.length) % quotes.length; renderQuote(); });
$('#qNext').addEventListener('click', ()=> { qi = (qi + 1) % quotes.length; renderQuote(); });
renderQuote();

/* -------- Contact form (front-end only) -------- */
$('#contactForm').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#formNote').textContent = 'Received. Wire this to email/CRM next.';
});

/* ---------- SCROLL ENGINE ---------- */
let lastY = 0;
let ticking = false;

function onScroll() {
  lastY = window.scrollY;
  if (!ticking) {
    window.requestAnimationFrame(() => {
      scrollEffects(lastY);
      ticking = false;
    });
    ticking = true;
  }
}

window.addEventListener('scroll', onScroll, { passive: true });

/* Year */
$('#year').textContent = new Date().getFullYear();

/* -------- Pills cloud: chaos → order on scroll -------- */
const pillsCloud = $('#pillsCloud');
const pillsCloudWrap = $('#pillsCloudWrap');

if (pillsCloud && pillsCloudWrap) {
  let hasSnapped = false;

  // Seed initial chaos positions
  function seedPillsChaos(){
    $$('.platformPill', pillsCloud).forEach(pill => {
      const tx = (Math.random() - .5) * 100;
      const ty = (Math.random() - .5) * 80;
      const tr = (Math.random() - .5) * 25;
      pill.style.setProperty('--tx', tx.toFixed(1) + 'px');
      pill.style.setProperty('--ty', ty.toFixed(1) + 'px');
      pill.style.setProperty('--tr', tr.toFixed(1) + 'deg');

      // Start in chaotic state
      pill.style.transform = `translate(${tx}px, ${ty}px) rotate(${tr}deg)`;
      pill.style.transition = 'transform 0.8s cubic-bezier(.2,.8,.2,1)';
    });
  }

  seedPillsChaos();

  // Drive the chaos-to-order effect based on scroll
  function drivePillsOrder(){
    if(!pillsCloudWrap || hasSnapped) return;

    const r = pillsCloudWrap.getBoundingClientRect();
    const vh = window.innerHeight || 800;

    // Calculate progress: 0 = far away, 1 = centered/visible
    // Using a wider range (vh*0.9) so it takes more scrolling to reach full visibility
    const center = r.top + r.height/2;
    const p = 1 - clamp(Math.abs(center - vh*0.4) / (vh*0.9), 0, 1);

    // If we've scrolled enough, snap to order permanently
    // Lower threshold (0.85) means you need to scroll further before it snaps
    if (p > 0.85) {
      hasSnapped = true;
      $$('.platformPill', pillsCloud).forEach(pill => {
        pill.style.transform = 'translate(0, 0) rotate(0)';
      });
    } else {
      // Progressively reduce chaos based on scroll position
      $$('.platformPill', pillsCloud).forEach(pill => {
        const tx = parseFloat(pill.style.getPropertyValue('--tx')) || 0;
        const ty = parseFloat(pill.style.getPropertyValue('--ty')) || 0;
        const tr = parseFloat(pill.style.getPropertyValue('--tr')) || 0;
        pill.style.transform = `translate(${tx*(1-p)}px, ${ty*(1-p)}px) rotate(${tr*(1-p)}deg)`;
      });
    }
  }

  window.addEventListener('scroll', drivePillsOrder, { passive:true });
  window.addEventListener('resize', drivePillsOrder);
  drivePillsOrder();
}

/* -------- COMPREHENSIVE SCROLL EFFECTS SYSTEM -------- */

// Intersection Observer for all scroll-triggered animations
const scrollObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');

      // For one-time animations, unobserve after triggering
      if (!entry.target.classList.contains('repeat-animation')) {
        scrollObserver.unobserve(entry.target);
      }
    } else {
      // Remove class if you want repeating animations
      if (entry.target.classList.contains('repeat-animation')) {
        entry.target.classList.remove('in-view');
      }
    }
  });
}, {
  threshold: 0.15,
  rootMargin: '0px 0px -50px 0px'
});

// Observe all elements with scroll animation classes
const scrollAnimateClasses = [
  '.scroll-fade-up',
  '.scroll-fade-down',
  '.scroll-fade-left',
  '.scroll-fade-right',
  '.scroll-scale',
  '.scroll-rotate',
  '.scroll-flip',
  '.scroll-blur',
  '.reveal-text',
  '.progressive-reveal',
  '.zoom-reveal',
  '.slide-edge-left',
  '.slide-edge-right',
  '.glow-reveal',
  '.counter-animate',
  '.ripple-trigger',
  '.card-flip-3d',
  '.bounce-in',
  '.border-expand',
  '.typewriter'
];

scrollAnimateClasses.forEach(className => {
  $$(className).forEach(el => scrollObserver.observe(el));
});

/* -------- PARALLAX EFFECTS -------- */
const parallaxElements = {
  slow: $$('.parallax-slow'),
  medium: $$('.parallax-medium'),
  fast: $$('.parallax-fast')
};

function updateParallax() {
  const scrolled = window.scrollY;

  // Slow parallax (moves 0.3x scroll speed)
  parallaxElements.slow.forEach(el => {
    const offset = (scrolled - el.offsetTop) * 0.3;
    el.style.transform = `translateY(${offset}px)`;
  });

  // Medium parallax (moves 0.5x scroll speed)
  parallaxElements.medium.forEach(el => {
    const offset = (scrolled - el.offsetTop) * 0.5;
    el.style.transform = `translateY(${offset}px)`;
  });

  // Fast parallax (moves 0.8x scroll speed)
  parallaxElements.fast.forEach(el => {
    const offset = (scrolled - el.offsetTop) * 0.8;
    el.style.transform = `translateY(${offset}px)`;
  });
}

/* -------- SCROLL-BASED OPACITY -------- */
function updateScrollOpacity() {
  const vh = window.innerHeight;

  $$('.scroll-opacity').forEach(el => {
    const rect = el.getBoundingClientRect();
    const elementCenter = rect.top + rect.height / 2;
    const viewportCenter = vh / 2;

    // Calculate distance from viewport center (0 = center, 1 = edge)
    const distance = Math.abs(elementCenter - viewportCenter) / viewportCenter;

    // Fade out as element moves away from center
    const opacity = Math.max(0.3, 1 - (distance * 0.7));
    el.style.opacity = opacity;
  });
}

/* -------- 3D TILT ON SCROLL -------- */
function update3DTilt() {
  $$('.scroll-3d-tilt').forEach(el => {
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;

    // Calculate element position in viewport (0 = top, 1 = bottom)
    const position = (rect.top + rect.height / 2) / vh;

    // Create tilt based on position
    const rotateX = (position - 0.5) * 15;
    el.style.transform = `perspective(1000px) rotateX(${rotateX}deg)`;
  });
}

/* -------- SMOOTH SCALE ON SCROLL -------- */
function updateScrollScale() {
  $$('.scroll-scale-dynamic').forEach(el => {
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;

    // Element is in view
    if (rect.top < vh && rect.bottom > 0) {
      // Calculate how centered the element is
      const center = rect.top + rect.height / 2;
      const viewportCenter = vh / 2;
      const distance = Math.abs(center - viewportCenter);
      const maxDistance = vh / 2;

      // Scale from 0.85 to 1 based on proximity to center
      const scale = 0.85 + (1 - Math.min(distance / maxDistance, 1)) * 0.15;
      el.style.transform = `scale(${scale})`;
    }
  });
}

/* -------- BACKGROUND ORB PARALLAX -------- */
function updateOrbParallax() {
  const scrolled = window.scrollY;

  // Hero orbs
  const heroOrbs = $$('.bgOrbs .orb');
  heroOrbs.forEach((orb, index) => {
    const speed = 0.2 + (index * 0.15);
    const offset = scrolled * speed;
    orb.style.transform = `translateY(${offset}px)`;
  });

  // Pills section orbs
  const pillsOrbs = $$('.pillsOrb');
  pillsOrbs.forEach((orb, index) => {
    const speed = 0.15 + (index * 0.1);
    const offset = scrolled * speed;
    const currentTransform = orb.style.transform || '';
    // Preserve existing animations while adding parallax
    if (!currentTransform.includes('translate')) {
      orb.style.transform = `translateY(${offset}px)`;
    }
  });
}

/* -------- PROGRESSIVE NUMBER COUNT -------- */
function animateCounter(el) {
  const target = parseFloat(el.getAttribute('data-count') || el.textContent);
  const duration = 2000;
  const start = 0;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Easing function
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * easeOut;

    // Format number
    if (el.textContent.includes('$')) {
      el.textContent = '$' + Math.floor(current).toLocaleString();
    } else if (el.textContent.includes('%')) {
      el.textContent = Math.floor(current) + '%';
    } else {
      el.textContent = Math.floor(current).toLocaleString();
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// Trigger counters when they come into view
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
      entry.target.classList.add('counted');
      animateCounter(entry.target);
      counterObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

$$('.counter-animate').forEach(el => {
  const countEl = el.querySelector('[data-count]');
  if (countEl) {
    counterObserver.observe(countEl);
  }
});

/* -------- SCROLL VELOCITY EFFECTS -------- */
let lastScrollY = window.scrollY;
let scrollVelocity = 0;

function updateScrollVelocity() {
  const currentScrollY = window.scrollY;
  scrollVelocity = currentScrollY - lastScrollY;
  lastScrollY = currentScrollY;

  // Apply velocity-based effects
  $$('.velocity-scale').forEach(el => {
    const scale = 1 + Math.abs(scrollVelocity) * 0.001;
    el.style.transform = `scale(${Math.min(scale, 1.05)})`;
  });
}

/* -------- STAGGER ANIMATIONS FOR GRIDS -------- */
const gridObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const items = Array.from(entry.target.children);
      items.forEach((item, index) => {
        setTimeout(() => {
          item.classList.add('in-view');
        }, index * 100); // 100ms delay between each item
      });
      gridObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.2 });

$$('.stagger-grid').forEach(grid => gridObserver.observe(grid));

/* -------- SCROLL DIRECTION DETECTION -------- */
let lastScrollTop = 0;
let scrollDirection = 'down';

function detectScrollDirection() {
  const st = window.scrollY || document.documentElement.scrollTop;

  if (st > lastScrollTop) {
    scrollDirection = 'down';
    document.body.classList.add('scrolling-down');
    document.body.classList.remove('scrolling-up');
  } else if (st < lastScrollTop) {
    scrollDirection = 'up';
    document.body.classList.add('scrolling-up');
    document.body.classList.remove('scrolling-down');
  }

  lastScrollTop = st <= 0 ? 0 : st;
}

/* -------- SMOOTH SCALE ON SECTION ENTRY -------- */
function updateSectionScale() {
  $$('.scene').forEach(section => {
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;

    if (rect.top < vh && rect.bottom > 0) {
      // Calculate visibility percentage
      const visibleHeight = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
      const percentage = visibleHeight / vh;

      // Apply subtle scale based on visibility
      const scale = 0.98 + (percentage * 0.02);

      // Only apply to sections with the class
      if (section.classList.contains('scale-on-view')) {
        section.style.transform = `scale(${scale})`;
      }
    }
  });
}

/* -------- MAGNETIC SCROLL EFFECT FOR CARDS -------- */
$$('.magnetic-scroll').forEach(card => {
  let isHovering = false;

  card.addEventListener('mouseenter', () => isHovering = true);
  card.addEventListener('mouseleave', () => {
    isHovering = false;
    card.style.transform = '';
  });

  window.addEventListener('scroll', () => {
    if (isHovering) {
      const rect = card.getBoundingClientRect();
      const vh = window.innerHeight;
      const cardCenter = rect.top + rect.height / 2;
      const viewportCenter = vh / 2;
      const offset = (viewportCenter - cardCenter) * 0.1;

      card.style.transform = `translateY(${offset}px)`;
    }
  }, { passive: true });
});

/* -------- ENHANCED SCROLL ENGINE -------- */
let rafId = null;

function scrollEffects() {
  updateParallax();
  updateScrollOpacity();
  update3DTilt();
  updateScrollScale();
  updateOrbParallax();
  updateScrollVelocity();
  detectScrollDirection();
  updateSectionScale();
}

// Throttled scroll listener
window.addEventListener('scroll', () => {
  if (rafId) {
    cancelAnimationFrame(rafId);
  }

  rafId = requestAnimationFrame(() => {
    scrollEffects();
  });
}, { passive: true });

// Initial call
scrollEffects();

// Resize handler
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    scrollEffects();
  }, 100);
});

/* ========== PARAGRAPH SLIDE-IN ANIMATION ========== */
(() => {
  const home = $("#home");
  const heroInner = $(".heroInner", home);
  const heroLeft = $(".heroLeft", home);
  const heroActions = $(".heroActions", home);
  const dockPoint = document.querySelector("#dockPoint");

  const intro = $("#introParagraph");
  const introInner = $(".introParagraphInner", intro);

  if (!home || !heroInner || !heroLeft || !intro || !introInner || !dockPoint) {
    console.warn("Missing required elements for paragraph scroll animation.");
    return;
  }

  const GAP_UNDER_HERO = -20;
  const HERO_TOP_PADDING = 22;
  let PHASE1_DIST = 420;
  let PHASE2_DIST = 520;

  let navH = 74;
  let translateMax = 0;
  let dockTop = 0;
  let startTop = 0;

  let paragraphTicking = false;

  const clampPara = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerpPara = (a, b, t) => a + (b - a) * t;

  function setScrollSpace() {
    const vh = window.innerHeight;
    home.style.minHeight = `${vh + PHASE1_DIST + PHASE2_DIST + 200}px`;
  }

  function recalcParagraph() {
    navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navH")) || 74;

    PHASE1_DIST = Math.max(320, Math.min(520, window.innerHeight * 0.45));
    PHASE2_DIST = Math.max(420, Math.min(720, window.innerHeight * 0.65));

    const vh = window.innerHeight;
    const availableH = vh - navH;

    const heroLeftH = heroLeft.offsetHeight;

    const centeredHeroLeftTop = navH + (availableH - heroLeftH) / 2;

    const targetHeroLeftTop = navH + HERO_TOP_PADDING;

    translateMax = targetHeroLeftTop - centeredHeroLeftTop;

    const oneLineEl = heroLeft.querySelector(".oneLine");
    const kickerEl = heroLeft.querySelector(".kicker");
    const megaEl = heroLeft.querySelector(".mega");

    const topBlockH =
      (kickerEl ? kickerEl.offsetHeight : 0) +
      (megaEl ? megaEl.offsetHeight : 0) +
      (oneLineEl ? oneLineEl.offsetHeight : 0);

    dockTop = centeredHeroLeftTop + topBlockH + GAP_UNDER_HERO;

    startTop = vh + 24;

    setScrollSpace();
    updateParagraph();
  }

  function smoothstepPara(edge0, edge1, x) {
    const t = clampPara((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function updateParagraph() {
    const y = window.scrollY;

    const dockP = smoothstepPara(0, PHASE1_DIST, y);

    const liftStart = PHASE1_DIST;
    const liftEnd   = liftStart + PHASE2_DIST;
    const liftP = smoothstepPara(liftStart, liftEnd, y);

    document.body.classList.toggle("phase1", y < PHASE1_DIST);
    document.body.classList.toggle("phase2", y >= PHASE1_DIST);

    const liftT = lerpPara(0, translateMax, liftP);
    heroInner.style.transform = `translateY(${liftT}px)`;

    const startOffset = (startTop - dockTop);
    const dockOffset = lerpPara(startOffset, 0, dockP);

    // After animation completes, convert to absolute positioning relative to home section
    const animationThreshold = liftEnd + 50;
    if (y > animationThreshold) {
      // Animation complete - make it absolute and positioned relative to home
      intro.style.position = 'absolute';
      intro.style.top = `${dockTop + translateMax}px`;
      intro.style.transform = 'none';
      intro.style.opacity = '1';
    } else {
      // Animation in progress - keep it fixed
      intro.style.position = 'fixed';
      intro.style.top = `${dockTop}px`;
      intro.style.transform = `translateY(${dockOffset + liftT}px)`;
      intro.style.opacity = `${clampPara(dockP * 1.1, 0, 1)}`;
    }

    if (heroActions) {
      const fade = clampPara(1 - dockP * 1.25, 0, 1);
      heroActions.style.opacity = `${fade}`;
      heroActions.style.pointerEvents = fade < 0.15 ? "none" : "auto";
    }
  }

  function onParagraphScroll() {
    if (paragraphTicking) return;
    paragraphTicking = true;
    requestAnimationFrame(() => {
      paragraphTicking = false;
      updateParagraph();
    });
  }

  window.addEventListener("scroll", onParagraphScroll, { passive: true });
  window.addEventListener("resize", recalcParagraph);

  recalcParagraph();
})();
