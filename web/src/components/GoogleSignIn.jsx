import { useEffect, useRef, useState } from 'react';
import { api, loadGoogleScript } from '../lib/api.js';

/**
 * Renders Google's own button into a div. The credential it hands back is the
 * Google ID token, which the server verifies before creating a session.
 *
 * States: checking (fetching the client id), ready, unconfigured (no
 * GOOGLE_CLIENT_ID on the server), failed (script could not load).
 */
export default function GoogleSignIn({ theme, onCredential, onError }) {
  const slot = useRef(null);
  const [status, setStatus] = useState('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const config = await api('/api/public-config');
        if (cancelled) return;
        if (!config?.googleClientId) {
          setStatus('unconfigured');
          return;
        }
        await loadGoogleScript();
        if (cancelled || !slot.current) return;
        window.google.accounts.id.initialize({
          client_id: config.googleClientId,
          callback: (response) => onCredential(response.credential),
        });
        window.google.accounts.id.renderButton(slot.current, {
          theme: theme === 'light' ? 'outline' : 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 300,
        });
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setStatus('failed');
        setMessage(error.message);
        onError?.(error.message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // The Google button is rendered once; theme changes are handled by the page theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* The slot keeps its 44px height only while a button lives in it. Rendering
          it unconditionally left a blank hole in the card on servers without a
          Google client id, which is the state every fresh deployment starts in. */}
      {status !== 'unconfigured' && (
        <div className="google-slot" ref={slot} aria-busy={status === 'checking'} />
      )}
      {status === 'checking' && <p className="google-hint">Preparing Google sign-in...</p>}
      {status === 'unconfigured' && (
        <div className="google-notice" role="status">
          <strong>Google sign-in is not set up on this server yet.</strong>
          <p>
            Add GOOGLE_CLIENT_ID in Railway and redeploy. The Google button appears here as soon as
            that is set. Your email and password work either way.
          </p>
        </div>
      )}
      {status === 'failed' && <p className="google-hint is-error">{message}</p>}
    </>
  );
}
