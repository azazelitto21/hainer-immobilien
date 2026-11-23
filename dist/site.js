const appDialog = document.querySelector('#app-dialog');

document.querySelector('#search')?.addEventListener('submit', event => {
  event.preventDefault();
  appDialog.showModal();
});

document.querySelectorAll('[data-open-app]').forEach(button => {
  button.addEventListener('click', () => appDialog.showModal());
});
