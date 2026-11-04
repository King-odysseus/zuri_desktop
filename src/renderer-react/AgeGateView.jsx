import { useState } from 'react';
import { Button } from './ui.jsx';
import AuthLayout from './AuthLayout.jsx';

/*
 * Zuri is an adult product: the models answer with a grown-up voice, and the
 * supplier terms behind them require users to be 18 or older. This card is asked
 * once per install and the answer is kept in settings, so it does not nag. Anyone
 * who says they are under 18 is not let into the shell at all.
 */
export default function AgeGateView({ onConfirmed, onSignOut }) {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [choice, setChoice] = useState('');
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    if (choice === '' || busy) return;
    if (choice === 'under') {
      // Recorded as false rather than true, so the next launch asks again instead
      // of remembering a yes that was never given.
      await api?.settings?.save?.({ ageConfirmed: false });
      setRefused(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api?.settings?.save?.({ ageConfirmed: true });
      if (!result?.ok) {
        setError(result?.error?.message ?? 'That answer could not be saved. Try again.');
        return;
      }
      onConfirmed?.();
    } catch (failure) {
      setError(failure?.message ?? 'That answer could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const aside = {
    eyebrow: 'Before you start',
    headline: 'Zuri is for grown-ups.',
    copy: 'The agent writes reports, plans trips and answers with an adult voice. It is built for people of 18 and over, so we ask once before the first chat opens.',
  };

  if (refused) {
    return (
      <AuthLayout aside={aside} meta="Your answer stays on this computer." footer>
        <div className="zuri-auth-card" aria-labelledby="age-refused-title">
          <div className="zuri-auth-heading">
            <h2 id="age-refused-title">Zuri is for people 18 and older</h2>
            <p>Thank you for answering honestly.</p>
          </div>
          <p className="zuri-auth-copy">
            Zuri cannot open on this computer until someone 18 or older confirms they are the account holder. A parent
            or guardian can sign in with the account they own.
          </p>
          <div className="zuri-auth-actions">
            <Button variant="primary" fullWidth onPress={() => setRefused(false)}>Change my answer</Button>
            <Button variant="ghost" fullWidth onPress={() => void onSignOut?.()}>Sign out</Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout aside={aside} meta="Your answer stays on this computer." footer>
      <div className="zuri-auth-card" aria-labelledby="age-title">
        <div className="zuri-auth-heading">
          <h2 id="age-title">How old are you?</h2>
          <p>Zuri is meant for people 18 and older. The answer is asked once.</p>
        </div>

        <fieldset className="zuri-choice-stack">
          {/* Native radios, not the shared Radio: that component renders without a role
              or an input under this HeroUI build, so the answer never registered and
              Continue stayed dead. A fieldset also names the group for a screen reader. */}
          <legend className="sr-only">Your age</legend>
          <label className={`zuri-age-choice${choice === 'adult' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="age"
              value="adult"
              className="zuri-age-input"
              checked={choice === 'adult'}
              onChange={() => setChoice('adult')}
            />
            <span className="zuri-choice-copy">
              <span className="zuri-choice-label">18 or older</span>
              <span className="zuri-choice-help">I am an adult and I own this Zuri account.</span>
            </span>
          </label>
          <label className={`zuri-age-choice${choice === 'under' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="age"
              value="under"
              className="zuri-age-input"
              checked={choice === 'under'}
              onChange={() => setChoice('under')}
            />
            <span className="zuri-choice-copy">
              <span className="zuri-choice-label">Under 18</span>
              <span className="zuri-choice-help">Zuri cannot be used by anyone under 18.</span>
            </span>
          </label>
        </fieldset>

        {error !== '' && <p role="alert" className="zuri-notice is-danger zuri-auth-error text-sm text-danger">{error}</p>}

        <div className="zuri-auth-actions">
          <Button variant="primary" fullWidth isDisabled={choice === '' || busy} onPress={() => void confirm()}>
            {busy ? 'Saving...' : 'Continue'}
          </Button>
          <Button variant="ghost" fullWidth onPress={() => void onSignOut?.()}>Use a different account</Button>
        </div>

        <p className="zuri-auth-terms">Your answer is stored with your settings in this installation, never in your chats.</p>
      </div>
    </AuthLayout>
  );
}
