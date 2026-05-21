(function () {
  function sync(container) {
    if (!container) return;

    const active = container.querySelector('.wizard-step-pill.active');
    if (!active) return;

    const margin = 16;
    const itemLeft = active.offsetLeft;
    const itemRight = itemLeft + active.offsetWidth;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;

    let targetLeft = viewLeft;

    if (itemLeft - margin < viewLeft) {
      targetLeft = Math.max(0, itemLeft - margin);
    } else if (itemRight + margin > viewRight) {
      targetLeft = Math.max(0, itemRight - container.clientWidth + margin);
    }

    if (targetLeft !== viewLeft) {
      container.scrollTo({ left: targetLeft, behavior: 'smooth' });
    }
  }

  window.WizardStepRail = { sync: sync };
})();
