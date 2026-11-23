const listingPhoto = document.querySelector('#listing-photo');
const photoButtons = [...document.querySelectorAll('.photo-picker button')];
let selectedPhoto = photoButtons.find(button => button.getAttribute('aria-pressed') === 'true');

photoButtons.forEach(button => {
  button.addEventListener('click', () => {
    selectedPhoto.setAttribute('aria-pressed', 'false');
    listingPhoto.src = button.querySelector('img').src;
    listingPhoto.alt = button.getAttribute('aria-label');
    button.setAttribute('aria-pressed', 'true');
    selectedPhoto = button;
  });
});
