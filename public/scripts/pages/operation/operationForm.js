// // public/scripts/operationForm.js
// document.addEventListener('DOMContentLoaded', () => {
//   const form = document.getElementById('operationForm');
//   if (!form) return;

//   const nameInput = form.querySelector('.name-input');

//   // Enforce uppercase and underscores in name input
//   nameInput.addEventListener('input', () => {
//     let v = nameInput.value.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z_]/g, '');
//     nameInput.value = v;
//   });

//   // Submit via AJAX (backend expected to assign ID automatically)
//   form.addEventListener('submit', async (e) => {
//     e.preventDefault();

//     const formData = new FormData(form);
//     // Ensure active value converted to boolean-ish string (server can parse)
//     // (keeping same encoding as sectionForm.js for consistency)
//     try {
//       const response = await fetch(form.action, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/x-www-form-urlencoded',
//           'X-AJAX-Request': 'true'
//         },
//         body: new URLSearchParams(formData).toString()
//       });

//       const result = await response.json();
//       if (result.status === 'success') {
//         await showMessageModal({
//           title: 'Success',
//           icon: 'success',
//           message: result.message || 'Operation saved successfully.',
//           size: 'md',
//           buttons: [{ text: 'OK', class: 'btn-primary btn-md' }]
//         });
//         window.location.href = '/operations';
//       } else {
//         await showMessageModal({
//           title: 'Error',
//           icon: 'error',
//           message: result.message || 'Failed to save operation.',
//           size: 'md',
//           buttons: [{ text: 'OK', class: 'btn-danger btn-filled btn-md' }]
//         });
//       }
//     } catch (err) {
//       console.error('Error saving operation', err);
//       await showMessageModal({
//         title: 'Error',
//         icon: 'error',
//         message: 'An unexpected error occurred. Please try again.',
//         size: 'md',
//         buttons: [{ text: 'OK', class: 'btn-primary btn-md' }]
//       });
//     }
//   });
// });
