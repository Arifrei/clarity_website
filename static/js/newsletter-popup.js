(() => {
  const modal = document.getElementById("newsletterModal");
  if (!modal) return;

  const dialog = modal.querySelector(".newsletterModalDialog");
  const closeButtons = modal.querySelectorAll("[data-newsletter-modal-close]");
  const triggerSelector = ".newsletter-subscribe-trigger";
  const storageKey = "clarity-integrated-popup-last-shown-v1";
  const delay = Number.parseInt(modal.dataset.showDelay || "10000", 10);
  const cooldownDays = Number.parseFloat(modal.dataset.cooldownDays || "7");
  const cooldownMilliseconds =
    (Number.isFinite(cooldownDays) ? cooldownDays : 7) * 24 * 60 * 60 * 1000;
  let previousFocus = null;
  let showTimer = null;

  const hasBeenSeen = () => {
    try {
      const lastShown = Number.parseInt(window.localStorage.getItem(storageKey) || "", 10);
      return Number.isFinite(lastShown) && Date.now() - lastShown < cooldownMilliseconds;
    } catch (_) {
      return false;
    }
  };

  const markSeen = () => {
    try {
      window.localStorage.setItem(storageKey, String(Date.now()));
    } catch (_) {
      // Storage can be unavailable in strict privacy modes; the modal still works.
    }
  };

  const getFocusableElements = () =>
    Array.from(
      dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hasAttribute("hidden"));

  const openModal = () => {
    if (modal.classList.contains("is-open")) return;
    markSeen();
    previousFocus = document.activeElement;
    modal.inert = false;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    document.body.classList.add("newsletterModalOpen");
    window.requestAnimationFrame(() => dialog.focus());
  };

  const closeModal = () => {
    if (!modal.classList.contains("is-open")) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    modal.inert = true;
    document.body.classList.remove("newsletterModalOpen");
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus({ preventScroll: true });
    }
  };

  const scheduleModal = () => {
    if (hasBeenSeen()) return;
    showTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        openModal();
        return;
      }
      document.addEventListener(
        "visibilitychange",
        () => {
          if (document.visibilityState === "visible" && !hasBeenSeen()) openModal();
        },
        { once: true }
      );
    }, Number.isFinite(delay) ? delay : 10000);
  };

  closeButtons.forEach((button) => button.addEventListener("click", closeModal));

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest(triggerSelector);
    if (!trigger) return;
    if (showTimer !== null) window.clearTimeout(showTimer);
    markSeen();
    closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (!modal.classList.contains("is-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = getFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  modal.inert = true;
  scheduleModal();
})();
