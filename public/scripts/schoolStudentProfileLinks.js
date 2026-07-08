(function () {
  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function canOpenStudentProfile() {
    return document.documentElement.dataset.schoolCanOpenStudentProfile === 'true';
  }

  function schoolStudentProfileEditUrl(studentRecordId) {
    const id = String(studentRecordId || '').trim();
    if (!id) return '';
    return '/school/students/edit/' + encodeURIComponent(id);
  }

  function schoolRenderStudentNameHtml(name, studentRecordId, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const label = escapeHtml(name || '');
    const id = String(studentRecordId || '').trim();
    if (!canOpenStudentProfile() || !id) return label;
    const href = schoolStudentProfileEditUrl(id);
    const className = String(opts.className || 'text-decoration-none').trim();
    return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer" class="' + escapeHtml(className) + '">' + label + '</a>';
  }

  window.schoolStudentProfileEditUrl = schoolStudentProfileEditUrl;
  window.schoolRenderStudentNameHtml = schoolRenderStudentNameHtml;
  window.schoolCanOpenStudentProfile = canOpenStudentProfile;
})();
