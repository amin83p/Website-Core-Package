(function (global) {
  'use strict';

  const RAISED_Z_DATA = 'schoolModalRaisedZ';

  function mountModalToBody(modalEl) {
    if (!modalEl || modalEl.parentElement === document.body) return modalEl;
    document.body.appendChild(modalEl);
    return modalEl;
  }

  function raiseAboveOpenModals(modalEl) {
    if (!modalEl || !(modalEl instanceof Element)) return null;
    mountModalToBody(modalEl);
    let maxZ = 1050;
    document.querySelectorAll('.modal.show').forEach((openModal) => {
      if (openModal === modalEl) return;
      const z = Number.parseInt(window.getComputedStyle(openModal).zIndex, 10);
      if (Number.isFinite(z) && z > maxZ) maxZ = z;
    });
    const loadingEl = document.getElementById('globalLoadingModal');
    if (loadingEl?.classList.contains('is-visible')) {
      const loadingZ = Number.parseInt(window.getComputedStyle(loadingEl).zIndex, 10);
      if (Number.isFinite(loadingZ) && loadingZ > maxZ) maxZ = loadingZ;
    }
    const modalZ = Math.max(maxZ + 10, 1055);
    modalEl.style.setProperty('z-index', String(modalZ), 'important');
    modalEl.dataset[RAISED_Z_DATA] = String(modalZ);
    const backdrops = document.querySelectorAll('.modal-backdrop.show');
    const backdrop = backdrops[backdrops.length - 1];
    if (backdrop) backdrop.style.setProperty('z-index', String(modalZ - 5), 'important');
    return modalZ;
  }

  function clearRaise(modalEl) {
    if (!modalEl) return;
    modalEl.style.removeProperty('z-index');
    delete modalEl.dataset[RAISED_Z_DATA];
  }

  global.SchoolModalStack = {
    mountModalToBody,
    raiseAboveOpenModals,
    clearRaise
  };
})(typeof window !== 'undefined' ? window : global);