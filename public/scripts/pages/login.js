// public/scripts/login.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const username = form.querySelector('input[name="username"]').value;
    const password = form.querySelector('input[name="password"]').value;

    try {
      const response = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const result = await response.json();
      if (response.ok) {
        // window.location.href = '/dashboard';
        showMessageModal({
          title: 'Success',
          icon: 'success',
          message: '<b>Login successful!</b><br>We are preparing your dashboard.<br><br>Redirecting...',
          size: 'md',
          buttons: [{ text: 'OK', class: 'btn-success' }],
          redirecting: '/dashboard'
        }).then(() => {
          window.location.href = '/dashboard';
        });
      } else {
        showMessageModal({
          title: 'Error',
          icon: 'error',
          message: result.message || 'Login failed. Please try again.',
          size: 'md',
          buttons: [{ text: "OK", class: "btn-danger" }]
        });
      }
    } catch (error) {
      showMessageModal({
        title: 'Error',
        icon: 'danger',
        message: 'An error occurred. Please try again.',
        buttons: [{ text: 'OK', class: 'btn-secondary btn-md' }]
      });
    }
  });
});
