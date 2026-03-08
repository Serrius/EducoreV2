function showError(message) {
  const msg = document.getElementById('errorDialogue');
  msg.textContent = message || 'Something went wrong.';

  const modal = new bootstrap.Modal(
    document.getElementById('statusErrorsModal')
  );
  modal.show();
}

function showSuccess(message) {
  const msg = document.getElementById('successDialogue');
  msg.textContent = message || 'Operation successful.';

  const modal = new bootstrap.Modal(
    document.getElementById('statusSuccessModal')
  );
  modal.show();
}
