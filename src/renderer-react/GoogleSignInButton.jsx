import { useEffect, useRef, useState } from 'react';

/**
 * Google Identity Services, loaded once per window.
 *
 * The script is fetched on demand rather than from index.html so a machine that is
 * offline when Zuri opens still gets the email and password form, instead of the
 * whole page waiting on a blocked third-party request.
 * @returns {Promise<void>}
 */
function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google sign-in could not be loaded.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
    document.head.appendChild(script);
  });
}

/**
 * Google's own "Continue with Google" button.
 *
 * Google draws this button itself and will not let a page style or restyle it, so
 * this component owns the one place the script is initialised and mounted. Both
 * places that offer sign-in (first run and the Cloud page) render it, so the
 * client id, the callback shape and the failure wording cannot drift apart.
 *
 * @param {{
 *   clientId?: string,
 *   onCredential?: (credential: string) => void,
 *   onError?: (message: string) => void,
 *   width?: number,
 * }} props
 */
export default function GoogleSignInButton({ clientId = '', onCredential, onError, width = 320 }) {
  const holder = useRef(null);
  const credentialRef = useRef(onCredential);
  const errorRef = useRef(onError);
  const [failed, setFailed] = useState(false);

  // Callbacks are read from refs so a caller passing an inline arrow does not
  // re-initialise Google's iframe on every render, which would make the button
  // flicker and drop a click that was already in flight.
  credentialRef.current = onCredential;
  errorRef.current = onError;

  useEffect(() => {
    if (clientId === '' || !holder.current) return undefined;
    let active = true;
    void loadGoogleIdentityScript()
      .then(() => {
        if (!active || !holder.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const credential = typeof response?.credential === 'string' ? response.credential : '';
            if (credential !== '') credentialRef.current?.(credential);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        holder.current.replaceChildren();
        window.google.accounts.id.renderButton(holder.current, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          width,
        });
      })
      .catch((error) => {
        if (!active) return;
        setFailed(true);
        errorRef.current?.(error?.message ?? 'Google sign-in could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [clientId, width]);

  if (clientId === '') {
    return <p className="text-sm text-muted">Google sign-in is not set up on this Zuri server. Use your email and password.</p>;
  }
  if (failed) {
    return <p className="text-sm text-muted">Google sign-in could not be loaded. Use your email and password below.</p>;
  }
  return <div ref={holder} className="min-h-10" aria-label="Continue with Google" />;
}
