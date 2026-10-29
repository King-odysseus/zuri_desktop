import { useState } from 'react';
import { Button, Input } from './ui.jsx';

// Mirrors PASSWORD_MIN_LENGTH on the cloud server. Checking it here only saves a
// round trip; the server still decides.
const MIN_PASSWORD_LENGTH = 8;

const SUBMIT_LABELS = {
  create: 'Create account',
  'sign-in': 'Sign in',
  forgot: 'Send reset link',
  reset: 'Set new password',
};

/**
 * The one password form, shared by the sign-up screen and the cloud view so the
 * fields, the checks and the wording of an error cannot drift apart. The caller
 * owns the heading; every mode switch is reported outward because the two
 * screens live on their own routes.
 *
 * Modes:
 * - sign-in: email and password
 * - create: name, email and a new password
 * - forgot: email only, asks the server to mail a reset link
 * - reset: the code from that link plus a new password, for a person who would
 *   rather finish in the app than in a browser tab
 *
 * @param {{
 *   mode?: 'sign-in' | 'create' | 'forgot' | 'reset',
 *   onModeChange?: (mode: 'sign-in' | 'create' | 'forgot' | 'reset') => void,
 *   onSignedIn?: (data: object) => void,
 *   api?: object,
 * }} props
 */
export default function CloudAuthForm({ mode = 'sign-in', onModeChange, onSignedIn, api }) {
  const bridge = api ?? (typeof window !== 'undefined' ? window.zuri : undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const creating = mode === 'create';
  const recovering = mode === 'forgot';
  const resetting = mode === 'reset';
  const wantsPassword = !recovering;

  function callForMode() {
    if (recovering) return bridge?.cloud?.forgotPassword;
    if (resetting) return bridge?.cloud?.resetPassword;
    if (creating) return bridge?.cloud?.signUp;
    return bridge?.cloud?.signInPassword;
  }

  function payloadForMode(address) {
    if (recovering) return { email: address };
    if (resetting) return { token: code.trim(), password };
    if (creating) return { email: address, password, displayName: displayName.trim() };
    return { email: address, password };
  }

  function problemWith(address) {
    if (resetting && code.trim() === '') return 'Paste the reset code from the email.';
    if (address === '' && !resetting) return 'Enter your email address.';
    if (wantsPassword && password === '') return 'Enter your password.';
    if ((creating || resetting) && password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
    return '';
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    const problem = problemWith(address);
    if (problem !== '') {
      setError(problem);
      return;
    }
    const call = callForMode();
    if (typeof call !== 'function') {
      setError('Cloud accounts are only available inside the Zuri app.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await call(payloadForMode(address));
      if (!result?.ok) {
        setError(result?.error?.message || 'That did not work. Try again.');
        return;
      }
      if (recovering) {
        // The server answers the same way for an address it does not know, so the
        // wording must not confirm whether an account exists.
        setNotice('If that address has an account, a reset link is on its way. Open it in your browser, or paste its code below.');
        return;
      }
      if (resetting) {
        setPassword('');
        setCode('');
        setNotice('Password changed. Sign in with your new password.');
        return;
      }
      onSignedIn?.(result.data);
    } catch (failure) {
      // The bridge rejects only when the call never reached the main process, so
      // this message explains the app rather than quoting a server answer.
      setError(failure?.message || 'Cloud sign-in could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      {creating && (
        <Input
          label="Name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="How Zuri should address you"
          autoComplete="name"
        />
      )}
      {!resetting && (
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      )}
      {resetting && (
        <Input
          label="Reset code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="The code at the end of the link in your email"
          autoComplete="one-time-code"
          required
        />
      )}
      {wantsPassword && (
        <Input
          label={resetting ? 'New password' : 'Password'}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={creating || resetting ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Your password'}
          autoComplete={creating || resetting ? 'new-password' : 'current-password'}
          required
        />
      )}
      {error !== '' && <p role="alert" className="zuri-notice is-danger text-sm text-danger">{error}</p>}
      {notice !== '' && <p role="status" className="zuri-notice text-sm text-info">{notice}</p>}
      <Button type="submit" variant="primary" fullWidth isDisabled={busy}>
        {busy ? 'Working...' : (SUBMIT_LABELS[mode] ?? SUBMIT_LABELS['sign-in'])}
      </Button>
      <div className="flex flex-wrap gap-2">
        {mode !== 'sign-in' && <Button type="button" variant="ghost" onPress={() => onModeChange?.('sign-in')}>Sign in instead</Button>}
        {mode !== 'create' && <Button type="button" variant="ghost" onPress={() => onModeChange?.('create')}>Create an account</Button>}
        {mode !== 'forgot' && <Button type="button" variant="ghost" onPress={() => onModeChange?.('forgot')}>Forgot password</Button>}
        {mode === 'forgot' && <Button type="button" variant="ghost" onPress={() => onModeChange?.('reset')}>I have a reset code</Button>}
      </div>
    </form>
  );
}
