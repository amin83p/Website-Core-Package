/* eslint-disable */
(function (global) {
  'use strict';

  function installMasterScheduleViewerAdmin(deps) {
    const escapeHtml = deps.escapeHtml;
    const scheduleState = deps.scheduleState;
    const persistScheduleViewerPreferencesPartial = deps.persistScheduleViewerPreferencesPartial;
    const renderSchedulePersonTabs = deps.renderSchedulePersonTabs;
    const mapSchedulePersonsForPreferences = deps.mapSchedulePersonsForPreferences;
    const closeOtherPopovers = deps.closeOtherSchedulePopovers || (() => {});

    let popoverEl = null;
    let openPersonId = '';

    function findPerson(personId) {
      const id = String(personId || '').trim();
      return scheduleState.persons.find((row) => row.id === id) || null;
    }

    function personHasCustomChipColors(person) {
      return Boolean(person?.chipBgColor && person?.chipTextColor);
    }

    function borderColorFromBg(hex) {
      const color = String(hex || '').trim();
      if (!/^#[0-9a-f]{6}$/i.test(color)) return '#9ec5fe';
      return color;
    }

    function personTabDecoration(person) {
      if (!personHasCustomChipColors(person)) {
        return { extraClass: '', extraStyle: '' };
      }
      const bg = String(person.chipBgColor || '').trim();
      const text = String(person.chipTextColor || '').trim();
      const border = borderColorFromBg(bg);
      return {
        extraClass: 'has-custom-chip-colors',
        extraStyle: `--schedule-person-tab-bg:${bg};--schedule-person-tab-text:${text};--schedule-person-tab-border:${border}`
      };
    }

    function ensurePopoverEl() {
      if (popoverEl) return popoverEl;
      popoverEl = document.createElement('div');
      popoverEl.className = 'schedule-person-chip-color-popover';
      popoverEl.id = 'schedulePersonChipColorPopover';
      popoverEl.setAttribute('role', 'dialog');
      popoverEl.setAttribute('aria-label', 'Person tab colors');
      popoverEl.hidden = true;
      popoverEl.innerHTML = `
        <div class="schedule-day-size-popover-label">Tab colors</div>
        <div class="schedule-person-chip-color-fields">
          <label class="schedule-person-chip-color-field">
            <span class="schedule-person-chip-color-field-label">Background</span>
            <input type="color" class="form-control form-control-color" data-schedule-person-chip-bg aria-label="Tab background color">
          </label>
          <label class="schedule-person-chip-color-field">
            <span class="schedule-person-chip-color-field-label">Text</span>
            <input type="color" class="form-control form-control-color" data-schedule-person-chip-text aria-label="Tab text color">
          </label>
        </div>
        <div class="schedule-person-chip-color-actions">
          <button type="button" class="btn btn-sm btn-primary" data-schedule-person-chip-apply>Apply</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-schedule-person-chip-reset>Default</button>
        </div>
      `;
      document.body.appendChild(popoverEl);

      popoverEl.addEventListener('click', (event) => {
        if (event.target.closest('[data-schedule-person-chip-apply]')) {
          event.preventDefault();
          void applyPersonChipColors();
          return;
        }
        if (event.target.closest('[data-schedule-person-chip-reset]')) {
          event.preventDefault();
          void resetPersonChipColors();
        }
      });

      popoverEl.addEventListener('input', (event) => {
        if (!openPersonId) return;
        const bgInput = popoverEl.querySelector('[data-schedule-person-chip-bg]');
        const textInput = popoverEl.querySelector('[data-schedule-person-chip-text]');
        if (event.target !== bgInput && event.target !== textInput) return;
        previewPersonChipColors(openPersonId, bgInput?.value, textInput?.value);
      });

      return popoverEl;
    }

    function closePersonChipColorPopover() {
      if (!popoverEl) return;
      popoverEl.hidden = true;
      popoverEl.classList.remove('is-open');
      openPersonId = '';
    }

    function positionPopover(anchorEl) {
      if (!popoverEl || !anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const margin = 6;
      popoverEl.style.position = 'fixed';
      popoverEl.style.zIndex = '1090';
      popoverEl.style.left = `${Math.max(8, rect.left)}px`;
      popoverEl.style.top = `${rect.bottom + margin}px`;
      const popRect = popoverEl.getBoundingClientRect();
      if (popRect.right > window.innerWidth - 8) {
        popoverEl.style.left = `${Math.max(8, window.innerWidth - popRect.width - 8)}px`;
      }
    }

    function previewPersonChipColors(personId, bg, text) {
      const tab = document.querySelector(`[data-schedule-person-tab="${CSS.escape(personId)}"]`);
      if (!tab) return;
      const bgColor = String(bg || '').trim();
      const textColor = String(text || '').trim();
      if (!bgColor || !textColor) return;
      tab.classList.add('has-custom-chip-colors');
      tab.style.setProperty('--schedule-person-tab-bg', bgColor);
      tab.style.setProperty('--schedule-person-tab-text', textColor);
      tab.style.setProperty('--schedule-person-tab-border', borderColorFromBg(bgColor));
    }

    function openPersonChipColorPopover(personId, anchorEl) {
      const person = findPerson(personId);
      if (!person || !anchorEl) return;
      closeOtherPopovers();
      const host = ensurePopoverEl();
      openPersonId = person.id;
      const defaultBg = '#eef6ff';
      const defaultText = '#4a6fa5';
      const bgInput = host.querySelector('[data-schedule-person-chip-bg]');
      const textInput = host.querySelector('[data-schedule-person-chip-text]');
      if (bgInput) bgInput.value = person.chipBgColor || defaultBg;
      if (textInput) textInput.value = person.chipTextColor || defaultText;
      host.hidden = false;
      host.classList.add('is-open');
      positionPopover(anchorEl);
    }

    async function persistPersonChipColors() {
      if (typeof persistScheduleViewerPreferencesPartial !== 'function') return false;
      if (typeof mapSchedulePersonsForPreferences !== 'function') return false;
      return persistScheduleViewerPreferencesPartial({
        persons: mapSchedulePersonsForPreferences()
      });
    }

    async function applyPersonChipColors() {
      if (!openPersonId || !popoverEl) return;
      const person = findPerson(openPersonId);
      if (!person) return;
      const bg = popoverEl.querySelector('[data-schedule-person-chip-bg]')?.value;
      const text = popoverEl.querySelector('[data-schedule-person-chip-text]')?.value;
      if (!bg || !text) return;
      person.chipBgColor = bg;
      person.chipTextColor = text;
      closePersonChipColorPopover();
      renderSchedulePersonTabs();
      await persistPersonChipColors();
    }

    async function resetPersonChipColors() {
      if (!openPersonId) return;
      const person = findPerson(openPersonId);
      if (!person) return;
      delete person.chipBgColor;
      delete person.chipTextColor;
      closePersonChipColorPopover();
      renderSchedulePersonTabs();
      await persistPersonChipColors();
    }

    function handlePersonTabClick({ tab, personId, isActive }) {
      if (!isActive || !tab) return false;
      openPersonChipColorPopover(personId, tab);
      return true;
    }

    function bindPersonChipColorPopoverDismiss() {
      if (bindPersonChipColorPopoverDismiss.bound) return;
      bindPersonChipColorPopoverDismiss.bound = true;
      document.addEventListener('click', (event) => {
        if (!popoverEl || popoverEl.hidden) return;
        const anchorTab = openPersonId
          ? document.querySelector(`[data-schedule-person-tab="${CSS.escape(openPersonId)}"]`)
          : null;
        if (popoverEl.contains(event.target)) return;
        if (anchorTab && anchorTab.contains(event.target)) return;
        closePersonChipColorPopover();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        closePersonChipColorPopover();
      });
      window.addEventListener('resize', () => {
        if (!openPersonId || popoverEl?.hidden) return;
        const tab = document.querySelector(`[data-schedule-person-tab="${CSS.escape(openPersonId)}"]`);
        if (tab) positionPopover(tab);
      });
      window.addEventListener('scroll', () => {
        if (!openPersonId || popoverEl?.hidden) return;
        const tab = document.querySelector(`[data-schedule-person-tab="${CSS.escape(openPersonId)}"]`);
        if (tab) positionPopover(tab);
      }, true);
    }

    bindPersonChipColorPopoverDismiss();

    return {
      personTabDecoration,
      handlePersonTabClick,
      closePersonChipColorPopover
    };
  }

  global.MasterScheduleViewerAdmin = { install: installMasterScheduleViewerAdmin };
})(typeof window !== 'undefined' ? window : globalThis);
