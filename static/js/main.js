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
