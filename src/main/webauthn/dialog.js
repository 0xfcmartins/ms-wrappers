const form = document.getElementById('form');
const pin = document.getElementById('pin');
const submit = document.getElementById('submit');
const cancel = document.getElementById('cancel');
const message = document.getElementById('message');

form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pin.value) {
        window.keyDialog.submitPin(pin.value);
        pin.value = '';
    }
});
cancel.addEventListener('click', () => window.keyDialog.cancel());
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        window.keyDialog.cancel();
    }
});

// States: 'pin' (ask, optional error), 'working' / 'touch' (wait for the key),
// 'fatal' (show the error, only closing is possible).
window.keyDialog.onState(({state, message: text}) => {
    const asking = state === 'pin';
    pin.hidden = !asking;
    submit.hidden = !asking;
    // The key cannot be interrupted once it is waiting; its own timeout ends the wait.
    cancel.hidden = state === 'working' || state === 'touch';
    cancel.textContent = state === 'fatal' ? 'Close' : 'Cancel';
    message.classList.toggle('error', state === 'fatal' || (asking && !!text));
    message.textContent = text || 'Enter your security key PIN.';
    if (asking) {
        pin.focus();
    }
});
