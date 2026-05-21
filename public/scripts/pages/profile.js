// public/scripts/profile.js
document.addEventListener('DOMContentLoaded', () => {
  const editBtn = document.querySelector('.edit-profile-btn');
  const deleteBtn = document.querySelector('.delete-profile-btn');
  const editModal = new bootstrap.Modal(document.getElementById('editProfileModal'));

  editBtn.addEventListener('click', () => {
    editModal.show();
  });

  deleteBtn.addEventListener('click', () => {
    const id = deleteBtn.dataset.id;
    showMessageModal({
      title: 'Confirm Delete',
      icon: 'warning',
      message: 'Are you sure you want to delete your profile? This cannot be undone.',
      buttons: [
        { text: 'Cancel', class: 'btn-secondary btn-md' },
        { text: 'Delete', class: 'btn-delete btn-md' }
      ]
    }).then(result => {
      if (result === 'Delete') {
        window.location.href = `/profile/delete/${id}`;
      }
    });
  });
});