(function () {
  function resolveComparableSortValue(cell) {
    const explicitRaw = cell?.dataset?.sortValue;
    const cellRaw = String(
      explicitRaw == null || String(explicitRaw).trim() === ''
        ? (cell?.textContent || '')
        : explicitRaw
    ).replace(/\s+/g, ' ').trim();

    if (!cellRaw) return { type: 'string', value: '' };

    const normalizedNumeric = cellRaw.replace(/,/g, '');
    if (/^-?\d+(\.\d+)?$/.test(normalizedNumeric)) {
      return { type: 'number', value: Number(normalizedNumeric) };
    }

    if (/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(cellRaw)) {
      const asTimestamp = Date.parse(cellRaw);
      if (!Number.isNaN(asTimestamp)) return { type: 'number', value: asTimestamp };
    }

    return { type: 'string', value: cellRaw.toLowerCase() };
  }

  function compareSortValues(aValue, bValue) {
    if (aValue.type === 'number' && bValue.type === 'number') {
      return aValue.value - bValue.value;
    }
    return String(aValue.value).localeCompare(String(bValue.value), undefined, {
      sensitivity: 'base',
      numeric: true
    });
  }

  function initDraggableTableSort(table, { enableColumnReorder = true } = {}) {
    if (!table) return;
    const headers = table.querySelectorAll('th.draggable');

    function getColumnIndex(column) {
      const headerArray = Array.from(table.querySelectorAll('thead th'));
      return headerArray.findIndex((h) => h.dataset.column === column);
    }

    function sortTable(column, order) {
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const idx = getColumnIndex(column);
      if (idx < 0) return;

      rows.sort((a, b) => {
        const aVal = resolveComparableSortValue(a.children[idx]);
        const bVal = resolveComparableSortValue(b.children[idx]);
        const comparison = compareSortValues(aVal, bVal);
        return order === 'asc' ? comparison : -comparison;
      });

      tbody.innerHTML = '';
      rows.forEach((r) => tbody.appendChild(r));
    }

    function reorderColumns(sourceColumn, targetColumn) {
      const headerRow = table.querySelector('thead tr');
      const bodyRows = table.querySelectorAll('tbody tr');
      const headersArray = Array.from(headerRow.children);
      const headerElems = Array.from(headerRow.querySelectorAll('th'));
      const sourceIndex = headerElems.findIndex((h) => h.dataset.column === sourceColumn);
      const targetIndex = headerElems.findIndex((h) => h.dataset.column === targetColumn);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;

      headerRow.insertBefore(headersArray[sourceIndex], headersArray[targetIndex > sourceIndex ? targetIndex + 1 : targetIndex]);

      bodyRows.forEach((row) => {
        const cells = Array.from(row.children);
        row.insertBefore(cells[sourceIndex], cells[targetIndex > sourceIndex ? targetIndex + 1 : targetIndex]);
      });
    }

    headers.forEach((header) => {
      header.addEventListener('click', () => {
        const column = header.dataset.column;
        const sortOrder = header.classList.contains('sort-asc') ? 'desc' : 'asc';

        headers.forEach((h) => {
          h.classList.remove('sort-asc', 'sort-desc');
          const sortIcon = h.querySelector('.sort-icon');
          if (sortIcon) sortIcon.innerHTML = '';
        });

        header.classList.add(`sort-${sortOrder}`);
        const activeSortIcon = header.querySelector('.sort-icon');
        if (activeSortIcon) activeSortIcon.innerHTML = sortOrder === 'asc' ? '▲' : '▼';

        sortTable(column, sortOrder);
      });

      if (!enableColumnReorder) return;

      header.draggable = true;
      header.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', header.dataset.column);
        header.style.opacity = '0.5';
      });
      header.addEventListener('dragend', () => {
        header.style.opacity = '1';
      });
      header.addEventListener('dragover', (e) => e.preventDefault());
      header.addEventListener('drop', (e) => {
        e.preventDefault();
        const source = e.dataTransfer.getData('text/plain');
        const target = header.dataset.column;
        reorderColumns(source, target);
      });
    });
  }

  window.initDraggableTableSort = initDraggableTableSort;
})();
