async function btns_Assignments(){
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = btn.dataset.id;
      const btnResult = await showMessageModal({
        title: 'Confirm Delete',
        icon: 'warning',
        message: `Are you sure you want to delete operation ${id}?`,
        buttons: [
          { text: 'Cancel', class: 'btn-secondary btn-md' },
          { text: 'Delete', class: 'btn-danger btn-md' }
        ]
      });
      if (btnResult === 'Delete') {
          // navigate to delete route
          try {
            const response = await fetch(`sections/delete/${id}`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-ajax-request': 'true'
              },
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
                ],
              });
              window.location.href = '/sections'
            } else {
              await showMessageModal({
                title: 'Error',
                icon: 'error',
                message: result.message || 'Failed to save section.',
                size: 'md',
                buttons: [
                  { text: 'OK', class: 'btn-danger btn-md' }
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
                { text: 'OK', class: 'btn-danger btn-md' }
              ]
            });
            console.log('Unexpected error modal shown, staying on page');
          }
        }
      });    
  });
}