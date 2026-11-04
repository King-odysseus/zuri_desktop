import { useState } from 'react';
import { Button } from './ui.jsx';
import CloudAuthForm from './CloudAuthForm.jsx';
import AuthLayout from './AuthLayout.jsx';

/**
 * Cloud account entry point reached from inside the app. An email and password is
 * the primary route, and Google stays available because Workspace identities are
 * intentionally not restricted to gmail.com: company, school and custom domains
 * can join too.
 *
 * It wears the same bright card as the sign-in screen; only the photograph panel
 * is left out, because the app's own rail already sits beside it.
 */
export default function SignUpView({ onNavigate }) {
  // 'sign-in' is not a mode here: that screen is the cloud route, so the form's
  // sign-in link navigates instead of switching.
  const [mode, setMode] = useState('create');
  const resetting = mode === 'forgot' || mode === 'reset';

  function changeMode(next) {
    if (next === 'sign-in') {
      onNavigate?.('cloud');
      return;
    }
    setMode(next);
  }

  return (
    <AuthLayout className="is-embedded min-w-0 flex-1">
      <div className="zuri-auth-card" aria-labelledby="signup-title">
        {!resetting && (
          <div className="zuri-auth-switch" role="tablist" aria-label="Account action">
            <button type="button" role="tab" aria-selected={false} onClick={() => changeMode('sign-in')}>Sign in</button>
            <button type="button" role="tab" aria-selected className="is-active" onClick={() => setMode('create')}>Create account</button>
          </div>
        )}
        <div className="zuri-auth-heading">
          <h2 id="signup-title">{resetting ? 'Reset your password' : 'Create your account'}</h2>
          <p>
            {resetting
              ? 'Use the code from the email we sent you.'
              : 'Any email address and a password of 8 characters or more.'}
          </p>
        </div>

        <CloudAuthForm
          mode={mode}
          onModeChange={changeMode}
          onSignedIn={() => onNavigate?.('cloud')}
        />

        {!resetting && (
          <>
            <div className="zuri-auth-divider" role="separator">or</div>
            <Button type="button" variant="secondary" fullWidth onPress={() => onNavigate?.('cloud')}>
              Continue with Google
            </Button>
          </>
        )}

        <p className="zuri-auth-terms">By continuing you accept the <a href="https://zuri.tijha.com/terms">terms</a> and <a href="https://zuri.tijha.com/privacy">privacy notice</a>. AI can be wrong.</p>
      </div>
    </AuthLayout>
  );
}
