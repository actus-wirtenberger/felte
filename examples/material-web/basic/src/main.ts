import './style.css';
import '@material/mwc-textfield';
import '@material/mwc-button';
import { reporter } from '@felte/reporter-element';
import { prepareForm } from '@felte/element';

type Data = {
  email: string;
  password: string;
};

prepareForm<Data>('signin', {
  onSubmit: (values) => {
    const submittedSection = document.getElementById('submitted');
    if (!submittedSection) return;
    submittedSection.innerHTML = `
           <h2>Submitted:</h2>
           <pre>${JSON.stringify(values, null, 2)}</pre>
         `;
  },
  validate(values) {
    const errors: {
      email: string[];
      password: string[];
    } = {
      email: [],
      password: [],
    };
    if (!values.email) errors.email.push('Must not be empty');
    if (!/[a-zA-Z][^@]*@[a-zA-Z][^@.]*\.[a-z]{2,}/.test(values.email))
      errors.email.push('Must be a valid email');
    if (!values.password) errors.password.push('Must not be empty');
    return errors;
  },
  extend: [reporter],
});

// `mwc-button` is not a submit button so we have to manually
// trigger a submit
document
  .querySelector('mwc-button[label="Submit"]')
  ?.addEventListener('click', (e: Event) => {
    const target = e.target as HTMLElement;
    target.closest('form')?.requestSubmit();
  });

document
  .querySelector('mwc-button[label="Reset"]')
  ?.addEventListener('click', (e: Event) => {
    const target = e.target as HTMLElement;
    target.closest('form')?.reset();
  });

const form = document.querySelector('form');
const submitted = document.getElementById('submitted');
form?.addEventListener('reset', function () {
  if (!submitted) return;
  submitted.innerHTML = '';
});
