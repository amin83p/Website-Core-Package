(function (global) {
  'use strict';

  function installMasterScheduleCreateClassFromTemplate(deps) {
    if (!deps || typeof deps !== 'object') return;

    function clean(value) {
      return String(value || '').trim();
    }

    function resolveTeacherPersonIdForOpen() {
      const role = clean(typeof deps.selectedScheduleRole === 'function' ? deps.selectedScheduleRole() : '');
      if (role.toLowerCase() !== 'teacher') return '';
      const person = typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null;
      return clean(person?.id);
    }

    function openCreateClassFromTemplateModal() {
      const modalApi = global.ClassCreateFromTemplateModal;
      if (!modalApi || typeof modalApi.open !== 'function') {
        void deps.uiAlert?.(
          'Create class from template is not available on this page.',
          'Create class from template',
          { icon: 'warning' }
        );
        return;
      }
      void modalApi.open({
        teacherPersonId: resolveTeacherPersonIdForOpen(),
        redirectOnSuccess: false
      });
    }

    deps.bindCreateClassFromTemplateRail?.(openCreateClassFromTemplateModal);
  }

  global.installMasterScheduleCreateClassFromTemplate = installMasterScheduleCreateClassFromTemplate;
})(typeof window !== 'undefined' ? window : globalThis);
