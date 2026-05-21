// public/scripts/sectionForm.js
document.addEventListener('DOMContentLoaded', () => {
  console.log('sectionForm.js loaded');

  // Verify showMessageModal is defined
  if (typeof showMessageModal !== 'function') {
    console.error('showMessageModal is not defined. Ensure modal.js is loaded.');
    return;
  }
  console.log('showMessageModal is defined');

  const form = document.getElementById('sectionForm');
  const nameInput = document.querySelector('.name-input');
  const operationSelect = document.getElementById('operationSelect');
  const addOperationBtn = document.getElementById('addOperationBtn');
  const operationsTable = document.getElementById('operationsTable').querySelector('tbody');
  const selectedOperationsInput = document.getElementById('selectedOperations');
  const operationError = document.getElementById('operationError');

  if (!form || !nameInput || !operationSelect || !addOperationBtn || !operationsTable || !selectedOperationsInput || !operationError) {
    console.error('One or more form elements not found:', {
      form, nameInput, operationSelect, addOperationBtn, operationsTable, selectedOperationsInput, operationError
    });
    return;
  }
  console.log('All form elements found');

  // Enforce uppercase and underscores in name input
  nameInput.addEventListener('input', () => {
    let value = nameInput.value.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z_]/g, '');
    nameInput.value = value;
    console.log('Name input updated:', value);
  });

  // Clear inline error when selecting a new operation
  operationSelect.addEventListener('change', () => {
    operationError.style.display = 'none';
    console.log('Operation select changed, cleared inline error');
  });

  // Add operation to table
  addOperationBtn.addEventListener('click', () => {
    console.log('Add operation button clicked');
    const selectedOption = operationSelect.options[operationSelect.selectedIndex];
    if (!selectedOption.value) {
      console.log('No operation selected');
      return;
    }

    const id = selectedOption.value;
    const name = selectedOption.dataset.name;
    console.log('Selected operation:', { id, name });

    // Check for duplicates
    if (operationsTable.querySelector(`tr[data-id="${id}"]`)) {
      console.log('Duplicate operation detected:', id);
      showMessageModal({
        title: 'Error',
        icon: 'error',
        message: 'Operation already added.',
        size: 'md',
        buttons: [
          { text: 'OK', class: 'btn-primary btn-md' }
        ]
      }).then(result => {
        console.log('Modal closed with result:', result);
        operationError.style.display = 'block';
        console.log('Inline error displayed');
      }).catch(error => {
        console.error('Error in showMessageModal:', error);
      });
      return;
    }

    // Add row to table
    console.log('Adding new operation row:', id);
    const row = document.createElement('tr');
    row.dataset.id = id;
    row.innerHTML = `
      <td>${name}</td>
      <td><input type="number" class="form-control size-md operation-attempts" value="5" min="1"></td>
      <td><input type="number" class="form-control size-md operation-time" value="15" min="1"></td>
      <td><input type="checkbox" class="form-check-input operation-active" checked></td>
      <td>
        <button type="button" class="btn btn-sm btn-filled btn-edit edit-operation">Edit</button>
        <button type="button" class="btn btn-sm btn-filled btn-delete remove-operation">Remove</button>
      </td>
    `;
    operationsTable.appendChild(row);
    operationError.style.display = 'none';
    operationSelect.value = '';
    console.log('Operation added, inline error cleared, dropdown reset');
  });

  // Remove operation
  operationsTable.addEventListener('click', e => {
    if (e.target.classList.contains('remove-operation')) {
      console.log('Remove operation button clicked');
      e.target.closest('tr').remove();
      console.log('Operation row removed');
    }
  });

  // Edit operation (update inputs directly)
  operationsTable.addEventListener('click', e => {
    if (e.target.classList.contains('edit-operation')) {
      console.log('Edit operation button clicked');
      const row = e.target.closest('tr');
      const attemptsInput = row.querySelector('.operation-attempts');
      attemptsInput.focus();
      console.log('Focused on attempts input for editing');
    }
  });

  // Serialize and submit form via AJAX
  form.addEventListener('submit', async e => {
    e.preventDefault();
    console.log('Form submit triggered');
  
    const selectedOperations = [];
    operationsTable.querySelectorAll('tr').forEach(row => {
      const id = row.dataset.id;
      const attempts = row.querySelector('.operation-attempts').value;
      const time = row.querySelector('.operation-time').value;
      const active = row.querySelector('.operation-active').checked;
      selectedOperations.push({
        id,
        sessionAttempts: parseInt(attempts),
        sessionTime: parseInt(time),
        active
      });
    });
    selectedOperationsInput.value = JSON.stringify(selectedOperations);
    console.log('Serialized operations:', selectedOperations);
  
    const formData = new FormData(form);
    console.log('Form data prepared:', Object.fromEntries(formData));
  
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-AJAX-Request': 'true'
        },
        body: new URLSearchParams(formData).toString()
      });
  
      const result = await response.json();
      console.log('Server response:', result);
  
      if (result.status === 'success') {
        await showMessageModal({
          title: 'Success',
          icon: 'success',
          message: result.message || 'Section saved successfully.',
          size: 'md',
          buttons: [
            { text: 'OK', class: 'btn-primary btn-md' }
          ]
        });
        console.log('Success modal shown, redirecting to /sections');
        window.location.href = '/sections';
      } else {
        await showMessageModal({
          title: 'Error',
          icon: 'error',
          message: result.message || 'Failed to save section.',
          size: 'md',
          buttons: [
            { text: 'OK', class: 'btn-primary btn-md' }
          ]
        });
        console.log('Error modal shown, staying on page');
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      await showMessageModal({
        title: 'Error',
        icon: 'error',
        message: 'An unexpected error occurred. Please try again.',
        size: 'md',
        buttons: [
          { text: 'OK', class: 'btn-primary btn-md' }
        ]
      });
      console.log('Unexpected error modal shown, staying on page');
    }
  });});