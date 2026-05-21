async function btns_Assignments(){
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      showMessageModal({
        title: 'Confirm Delete',
        icon: 'warning',
        message: `Are you sure you want to delete operation ${id}?`,
        buttons: [
          { text: 'Cancel', class: 'btn-secondary btn-md' },
          { text: 'Delete', class: 'btn-danger btn-md' }
        ]
      }).then(result => {
        if (result === 'Delete') {
          // navigate to delete route
          window.location.href = `/operations/${id}/delete`;
        }
      });
    });
  });
}
