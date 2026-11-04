import { useState } from 'react';
import { Button, Radio, RadioGroup } from './ui.jsx';

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

  if (refused) {
    return (
      <main className="zuri-signin flex h-dvh w-full flex-col bg-background text-foreground">
        <div className="zuri-page-content zuri-scrollbar-hidden">
          <section className="zuri-age-card" aria-labelledby="age-refused-title">
            <h1 id="age-refused-title" className="text-2xl font-medium tracking-tight">Zuri is for people 18 and older</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              Thank you for answering honestly. Zuri cannot open on this computer until someone 18 or older confirms they
              are the account holder. A parent or guardian can sign in with the account they own.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onPress={() => setRefused(false)}>Change my answer</Button>
              <Button size="sm" variant="ghost" onPress={() => void onSignOut?.()}>Sign out</Button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="zuri-signin flex h-dvh w-full flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <section className="zuri-age-card" aria-labelledby="age-title">
          <p className="zuri-age-kicker">Before you start</p>
          <h1 id="age-title" className="mt-2 text-2xl font-medium tracking-tight">How old are you?</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Zuri answers with a grown-up voice and is meant for people 18 and older. The answer is kept on this computer
            and asked only once.
          </p>

          <RadioGroup className="zuri-choice-stack mt-5" aria-label="Age" value={choice} onChange={setChoice}>
            <Radio value="adult" className={`zuri-age-choice${choice === 'adult' ? ' is-selected' : ''}`}>
              <span className="zuri-choice-copy">
                <span className="zuri-choice-label">18 or older</span>
                <span className="zuri-choice-help">I am an adult and I own this Zuri account.</span>
              </span>
            </Radio>
            <Radio value="under" className={`zuri-age-choice${choice === 'under' ? ' is-selected' : ''}`}>
              <span className="zuri-choice-copy">
                <span className="zuri-choice-label">Under 18</span>
                <span className="zuri-choice-help">Zuri cannot be used by anyone under 18.</span>
              </span>
            </Radio>
          </RadioGroup>

          {error !== '' && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" isDisabled={choice === '' || busy} onPress={() => void confirm()}>
              {busy ? 'Saving...' : 'Continue'}
            </Button>
            <Button size="sm" variant="ghost" onPress={() => void onSignOut?.()}>Sign out</Button>
          </div>
        </section>
      </div>
    </main>
  );
}
