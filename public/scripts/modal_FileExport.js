document.addEventListener('DOMContentLoaded', () => {
  // 1. Select Elements (Safely)
  const exportModalEl = document.getElementById('fileExportModal');
  const exportForm = document.getElementById('fileExportForm');
  const startBtn = document.getElementById('startExportBtn');
  const closeBtn = document.getElementById('closeExportModalBtn');
  const downloadLinkBtn = document.getElementById('downloadExportBtn');
  
  // Content Sections
  const setupContent = document.getElementById('exportSetupContent');
  const progressContent = document.getElementById('exportProgressContent');
  const detailedStatus = document.getElementById('exportDetailedStatus');
  const filterInput = document.getElementById('exportFilters');
  const progressBar = document.getElementById('exportProgressBar');

  // Initialize Bootstrap Modal
  if (!exportModalEl) return; // Exit if modal isn't on page
  const modal = new bootstrap.Modal(exportModalEl);

  // 2. Open Modal Listener
  document.addEventListener('click', (e) => {
    if (e.target.closest('.open-export-modal')) {
      const triggerBtn = e.target.closest('.open-export-modal');
      const baseUrl = triggerBtn.dataset.baseUrl || window.location.pathname;
      
      // Capture Filters
      const currentParams = new URLSearchParams(window.location.search).toString();
      if (filterInput) filterInput.value = currentParams;
      
      // Save Context
      exportForm.dataset.url = baseUrl;

      // Reset UI State
      resetUI();
      
      modal.show();
    }
  });

  // 3. Handle "Start Export" Click
  exportForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const formData = new FormData(exportForm);
    const source = formData.get('exportSource'); // 'page' or 'db'
    const format = formData.get('exportFormat'); // 'csv' or 'json'

    if (source === 'page') {
      handlePageExport(format);
    } else {
      // For Database export, require Admin Verification first
      if (typeof window.requestProtectedAction === 'function') {
        window.requestProtectedAction(() => {
          handleDatabaseExport(format, formData);
        });
      } else {
        // Fallback if admin system missing
        handleDatabaseExport(format, formData);
      }
    }
  });

  // --- Logic: Export Visible Page Table ---
  function handlePageExport(format) {
    try {
      updateStatus('Reading table data...', 20);
      
      const table = document.getElementById('first-table');
      if (!table) throw new Error('Table not found on this page.');

      let data = [];
      let filename = `export_${new Date().toISOString().slice(0,10)}`;

      // Extract Data
      const headers = Array.from(table.querySelectorAll('th'))
        .filter(th => !th.textContent.includes('Actions')) // Skip Action column
        .map(th => th.textContent.trim());

      const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => {
        return Array.from(tr.querySelectorAll('td'))
          .slice(0, headers.length) // Match header count
          .map(td => td.innerText.trim()); // Use innerText to strip HTML tags
      });

      // Generate File
      if (format === 'json') {
        const jsonData = rows.map(row => {
          let obj = {};
          headers.forEach((h, i) => obj[h] = row[i]);
          return obj;
        });
        downloadFile(JSON.stringify(jsonData, null, 2), filename + '.json', 'application/json');
      } else {
        // CSV
        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
        ].join('\n');
        downloadFile(csvContent, filename + '.csv', 'text/csv');
      }

      finishSuccess();

    } catch (err) {
      showError(err.message);
    }
  }

  // --- Logic: Export Full Database (Server) ---
  async function handleDatabaseExport(format, formData) {
    try {
      updateStatus('Connecting to server...', 10);
      
      // Prepare Request
      const baseURL =  document.getElementById('urlRef').dataset.id;
      if(!baseURL) throw new Error('The main/base URL not found.');
      const targetUrl = `/${baseURL}/export`;

      // Convert FormData to JSON object including hidden filters
      const bodyData = Object.fromEntries(formData.entries());
      // Merge URL filters (stored in hidden input) into body
      if (bodyData.filters) {
        const params = new URLSearchParams(bodyData.filters);
        for (const [key, value] of params) {
          bodyData[key] = value;
        }
      }
      // Ensure format is set explicitly
      bodyData.format = format; 

      updateStatus('Generating file on server... (This may take a moment)', 50);
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AJAX-Request': 'true'
        },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Server export failed.');
      }

      updateStatus('Downloading file...', 90);

      // Get Filename
      const disposition = response.headers.get('Content-Disposition');
      let filename = `server_export.${format}`;
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      
      // Trigger Download
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      finishSuccess();

    } catch (err) {
      console.error(err);
      showError(err.message);
    }
  }

  // --- Helper Functions ---

  function updateStatus(msg, percent) {
    // Switch to progress view if not already
    setupContent.style.display = 'none';
    progressContent.style.display = 'block';
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processing...';

    if (percent) {
      progressBar.style.width = `${percent}%`;
      progressBar.textContent = `${percent}%`;
    }
    
    const div = document.createElement('div');
    div.className = 'status-update text-muted';
    div.innerHTML = `Target: ${msg}`;
    detailedStatus.appendChild(div);
    detailedStatus.scrollTop = detailedStatus.scrollHeight;
  }

  function finishSuccess() {
    progressBar.style.width = '100%';
    progressBar.textContent = '100%';
    progressBar.classList.add('bg-success');
    
    const div = document.createElement('div');
    div.className = 'status-update text-success fw-bold';
    div.innerHTML = '✅ Export Complete';
    detailedStatus.appendChild(div);

    // Update Buttons
    startBtn.style.display = 'none';
    closeBtn.style.display = 'inline-block';
    
    // Optional: Show success modal
    if (typeof showMessageModal === 'function') {
      showMessageModal({
        title: 'Success', icon: 'success', 
        message: 'Data exported successfully.',
        size: 'md', buttons: [{ text: 'OK', class: 'btn-success' }]
      });
    }
  }

  function showError(msg) {
    const div = document.createElement('div');
    div.className = 'status-update text-danger fw-bold';
    div.innerHTML = `❌ Error: ${msg}`;
    detailedStatus.appendChild(div);
    
    startBtn.innerHTML = 'Retry';
    startBtn.disabled = false;
  }

  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  function resetUI() {
    exportForm.reset();
    setupContent.style.display = 'block';
    progressContent.style.display = 'none';
    detailedStatus.innerHTML = '';
    progressBar.style.width = '0%';
    progressBar.textContent = '0%';
    progressBar.classList.remove('bg-success');
    
    startBtn.style.display = 'inline-block';
    startBtn.disabled = false;
    startBtn.textContent = 'Start Export';
    closeBtn.style.display = 'none';
    downloadLinkBtn.style.display = 'none';
  }
});