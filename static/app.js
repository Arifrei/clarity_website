document.addEventListener("DOMContentLoaded", () => {
  // Set current year in footer
  const yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  // Smooth scroll with offset for sticky header
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#' || href === '#top') return;

      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

  // Intersection Observer for scroll animations
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('fade-in');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe all sections
  document.querySelectorAll('section').forEach(section => {
    observer.observe(section);
  });

  // Add parallax effect to hero section
  const hero = document.querySelector('.hero');
  if (hero) {
    window.addEventListener('scroll', () => {
      const scrolled = window.pageYOffset;
      const parallaxSpeed = 0.5;
      if (scrolled < window.innerHeight) {
        hero.style.transform = `translateY(${scrolled * parallaxSpeed}px)`;
        hero.style.opacity = 1 - (scrolled / window.innerHeight) * 0.5;
      }
    });
  }

  // Add hover effect to cards
  const cards = document.querySelectorAll('.card, .testimonial-card, .step');
  cards.forEach(card => {
    card.addEventListener('mouseenter', function() {
      this.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    });
  });

  // Animate numbers/stats if present
  const animateValue = (element, start, end, duration) => {
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const value = Math.floor(progress * (end - start) + start);
      element.textContent = value;
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  };

  // Add mobile menu toggle if nav is hidden on mobile
  const createMobileMenu = () => {
    const nav = document.querySelector('.nav');
    const navList = document.querySelector('nav ul');

    if (window.innerWidth <= 768 && navList) {
      const existingToggle = document.querySelector('.mobile-menu-toggle');
      if (existingToggle) return;

      const mobileToggle = document.createElement('button');
      mobileToggle.className = 'mobile-menu-toggle';
      mobileToggle.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      `;
      mobileToggle.style.cssText = `
        display: none;
        background: none;
        border: none;
        color: var(--text-primary);
        cursor: pointer;
        padding: 0.5rem;
        transition: var(--transition);
      `;

      if (window.innerWidth <= 768) {
        mobileToggle.style.display = 'block';
      }

      mobileToggle.addEventListener('click', () => {
        navList.classList.toggle('mobile-menu-open');
        if (navList.classList.contains('mobile-menu-open')) {
          navList.style.cssText = `
            display: flex;
            flex-direction: column;
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: rgba(10, 14, 26, 0.98);
            backdrop-filter: blur(20px);
            padding: 2rem;
            gap: 1.5rem;
            border-bottom: 1px solid var(--border);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          `;
        } else {
          navList.style.display = 'none';
        }
      });

      const navCta = document.querySelector('.nav-cta');
      if (navCta) {
        nav.insertBefore(mobileToggle, navCta);
      } else {
        nav.appendChild(mobileToggle);
      }
    }
  };

  createMobileMenu();
  window.addEventListener('resize', createMobileMenu);

  // Add floating particles effect (optional, subtle)
  const createParticles = () => {
    const particlesContainer = document.createElement('div');
    particlesContainer.className = 'particles';
    particlesContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
      overflow: hidden;
    `;

    for (let i = 0; i < 20; i++) {
      const particle = document.createElement('div');
      const size = Math.random() * 3 + 1;
      const duration = Math.random() * 20 + 10;
      const delay = Math.random() * 5;
      const left = Math.random() * 100;

      particle.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        background: rgba(59, 130, 246, ${Math.random() * 0.3 + 0.1});
        border-radius: 50%;
        left: ${left}%;
        top: -10%;
        animation: float ${duration}s ${delay}s infinite linear;
        box-shadow: 0 0 ${size * 2}px rgba(59, 130, 246, 0.5);
      `;

      particlesContainer.appendChild(particle);
    }

    const style = document.createElement('style');
    style.textContent = `
      @keyframes float {
        0% {
          transform: translateY(0) translateX(0) rotate(0deg);
          opacity: 0;
        }
        10% {
          opacity: 1;
        }
        90% {
          opacity: 1;
        }
        100% {
          transform: translateY(100vh) translateX(${Math.random() * 100 - 50}px) rotate(360deg);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
    document.body.insertBefore(particlesContainer, document.body.firstChild);
  };

  // Uncomment to enable particles effect
  // createParticles();

  // Add cursor follow effect on hero card
  const heroCard = document.querySelector('.hero-card');
  if (heroCard) {
    heroCard.addEventListener('mousemove', (e) => {
      const rect = heroCard.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = (y - centerY) / 20;
      const rotateY = (centerX - x) / 20;

      heroCard.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });

    heroCard.addEventListener('mouseleave', () => {
      heroCard.style.transform = '';
    });
  }

  // Add subtle animations to buttons
  const buttons = document.querySelectorAll('.btn-primary, .btn-secondary');
  buttons.forEach(button => {
    button.addEventListener('mouseenter', function() {
      this.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    });
  });

  // Lazy load animations for performance
  if ('IntersectionObserver' in window) {
    const lazyAnimateObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
          lazyAnimateObserver.unobserve(entry.target);
        }
      });
    });

    document.querySelectorAll('.card, .step, .testimonial-card').forEach(el => {
      lazyAnimateObserver.observe(el);
    });
  }

  // Add typing effect to hero title (optional)
  const addTypingEffect = () => {
    const highlightSpan = document.querySelector('.hero-title .highlight');
    if (highlightSpan) {
      const text = highlightSpan.textContent;
      highlightSpan.textContent = '';
      let i = 0;

      const typeWriter = () => {
        if (i < text.length) {
          highlightSpan.textContent += text.charAt(i);
          i++;
          setTimeout(typeWriter, 50);
        }
      };

      // Start typing after a short delay
      setTimeout(typeWriter, 500);
    }
  };

  // Uncomment to enable typing effect
  // addTypingEffect();

  console.log('%cClarity Solutions', 'color: #3b82f6; font-size: 24px; font-weight: bold;');
  console.log('%cWebsite loaded successfully! 🚀', 'color: #10b981; font-size: 14px;');
});
