document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('fileImportModal');
    const form = document.getElementById('fileImportForm');
    const startImportBtn = document.getElementById('startImportBtn'); 
    const closeModalBtn = document.getElementById('closeModalBtn'); 
    const importFile = document.getElementById('importFile');
    const importProgressBar = document.getElementById('importProgressBar');
    const detailedStatus = document.getElementById('detailedStatus');
    const setupContent = document.getElementById('setupContent');
    const progressContent = document.getElementById('progressContent');
    const closeHeaderBtn = document.querySelector('.btn-close.close-on-complete');

    const downloadReportBtn = document.getElementById('downloadReportBtn'); // <-- ADD THIS SELECTOR
    const urlRef = document.getElementById('urlRef').dataset.id;

    let currentJobId = null;
    let eventSource = null;
    let isAbortRequested = false;
    
    const openBatchModalBtn = document.getElementById('openBatchModalBtn');
    const tableNameElement = document.getElementById('tableName');
    if (tableNameElement) {
        document.getElementById('importTableName').value = tableNameElement.dataset.id;
    }

    const bootstrapModal = new bootstrap.Modal(modal);

    // --- UI Helper Functions ---
    const setButtonState = (state) => {
        if (state === 'start') {
            startImportBtn.innerHTML = 'Start Import';
            startImportBtn.className = 'btn btn-primary btn-md';
            startImportBtn.disabled = false;
            startImportBtn.style.display = 'block';
            closeModalBtn.style.display = 'none';
            closeHeaderBtn.style.display = 'block';
        } else if (state === 'running') {
            startImportBtn.innerHTML = 'Abort Import';
            startImportBtn.className = 'btn btn-danger btn-md';
            startImportBtn.disabled = false;
            closeModalBtn.style.display = 'none';
            closeHeaderBtn.style.display = 'none';
        } else if (state === 'aborting') {
            startImportBtn.innerHTML = 'Stopping...';
            startImportBtn.className = 'btn btn-warning btn-md';
            startImportBtn.disabled = true;
        } else if (state === 'complete') {
            startImportBtn.style.display = 'none';
            closeModalBtn.style.display = 'block';
            closeHeaderBtn.style.display = 'block';
        }
    };

    const resetModalUI = () => {
        form.reset();
        setupContent.style.display = 'block';
        progressContent.style.display = 'none';
        detailedStatus.innerHTML = '';
        currentJobId = null;
        if (eventSource) eventSource.close();
        
        // Hide download button and reset link
        downloadReportBtn.style.display = 'none';
        downloadReportBtn.href = '#';
        
        setButtonState('start');
    };

    const addStatusUpdate = (message, status = 'info') => {
        const icon = status === 'success' ? '✅' : status === 'error' ? '❌' : status === 'abort' ? '🛑' : '⏳';
        const className = status === 'success' ? 'text-success' : status === 'error' ? 'text-danger' : status === 'abort' ? 'text-warning' : 'text-primary';
        const update = document.createElement('div');
        update.className = `status-update ${className}`;
        update.innerHTML = `<strong>${icon}</strong> ${message}`;
        detailedStatus.appendChild(update);
        detailedStatus.scrollTop = detailedStatus.scrollHeight;
    };

    if (openBatchModalBtn) {
        openBatchModalBtn.addEventListener('click', () => {
            resetModalUI();
            bootstrapModal.show();
        });
    }

    // --- Abort Handler ---
    startImportBtn.addEventListener('click', async (e) => {
        if (currentJobId && !startImportBtn.disabled && startImportBtn.classList.contains('btn-danger')) {
            e.preventDefault();
            isAbortRequested = true;
            setButtonState('aborting');
            addStatusUpdate('Sending abort signal...', 'abort');
            try {
                await fetch(`/${urlRef}/import/abort/${currentJobId}`, { method: 'POST' });
            } catch (error) {
                addStatusUpdate('Failed to reach server to abort.', 'error');
                cleanupStream();
                setButtonState('complete');
            }
        }
    });

    // --- Main Form Submit ---
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!importFile.files.length) {
            alert('Please select a file.');
            return;
        }

        setButtonState('running');
        setupContent.style.display = 'none';
        progressContent.style.display = 'block';
        importProgressBar.style.width = '0%';
        importProgressBar.innerHTML = '0%';
        addStatusUpdate('Uploading file...', 'info');

        const formData = new FormData(form);

        try {
            const response = await fetch(`/${urlRef}/import`, {
                method: 'POST',
                body: formData
            });
            // 1. Parse JSON regardless of success/failure to check for specific flags
            const result = await response.json();
            // 2. Check for Admin Requirement (Status 403)
            if (response.status === 403 && result.status === "admin_required") {
                
                // 3. Call the global function from main.js
                // We pass a generic arrow function that re-trigger the submit event
                if (typeof window.requestProtectedAction === 'function') {
                    window.requestProtectedAction(() => {
                        // Recursively trigger the submit again, 
                        // or extract the upload logic to a separate function and call it here.
                        // Simplest way: Click the button again programmatically
                        startImportBtn.click(); 
                    });
                } else {
                    console.error("Admin modal function not loaded");
                }
                
                // Stop execution here, wait for user to verify and retry
                setButtonState('start'); // Reset button so they can try again
                return; 
            } else if (response.status === 404 || response.status === 500){
                addStatusUpdate(result.message, 'error');
                setButtonState('complete');
                return;
            }

            // 3. Standard Success Handling
            if (response.ok) { 
                currentJobId = result.jobId;
                if(!currentJobId) throw new Error('No Job ID returned from server');
                startStream(currentJobId);
            } else {
                // Standard Error Handling (e.g., Validation error)
                throw new Error(result.message || `Server returned status ${response.status}`);
            }

        } catch (error) {
            console.error('Upload error:', error);
            addStatusUpdate(`Upload failed: ${error.message}`, 'error');
            setButtonState('complete');
        }
    });

    function startStream(jobId) {
        addStatusUpdate('File uploaded successfully.', 'success');
        addStatusUpdate('Connecting to live feed...', 'info');
        // Connect to the SSE endpoint
        eventSource = new EventSource(`/${urlRef}/import/stream/${jobId}`);

        // 1. Handle Incoming Messages
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.progress) {
                importProgressBar.style.width = `${data.progress}%`;
                importProgressBar.innerHTML = `${data.progress}%`;
            }
            if (data.message) {
                addStatusUpdate(data.message, data.status);
            }
            if (data.isComplete || data.status === 'abort') {
                cleanupStream();
                setButtonState('complete');

                // --- NEW CODE: HANDLE DOWNLOAD LINK ---
                if (data.downloadUrl) {
                    // 1. Set the URL sent by the server
                    downloadReportBtn.href = data.downloadUrl; 
                    // 2. Make the button visible
                    downloadReportBtn.style.display = 'inline-block'; 
                    
                    addStatusUpdate('Report generated. Click the green button to download.', 'success');
                }
                // --------------------------------------

                if (data.status === 'success' && data.isComplete) {
                     addStatusUpdate('Process Finished Successfully.', 'success');
                }
            }
        };

        // 2. Handle Connection Open
        eventSource.onopen = () => {
            console.log("Stream connection opened.");
        };

        // 3. Handle Errors (This is where your issue likely is)
        eventSource.onerror = (err) => {
            console.error('Stream error details:', err);
            
            // If error happens immediately, it's likely a 404 or Auth failure
            if (importProgressBar.style.width === '0%') {
                 addStatusUpdate('Failed to connect to live stream. (Check console for 404/401)', 'error');
                 cleanupStream();
                 setButtonState('complete');
            } else {
                // If we were already running, it might just be a temporary network blip
                // But if the server restarted, the stream dies.
                eventSource.close();
                addStatusUpdate('Connection to server lost.', 'error');
                setButtonState('complete');
            }
        };
    }

    function cleanupStream() {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        currentJobId = null;
        isAbortRequested = false;
    }
});
