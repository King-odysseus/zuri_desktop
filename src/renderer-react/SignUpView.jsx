import { Button } from './ui.jsx';
import { UserPlusIcon } from './Icons.jsx';

/**
 * Cloud account entry point. Google Workspace identities are intentionally not
 * restricted to gmail.com, so company, school, and custom domains can join too.
 */
export default function SignUpView({ onNavigate }) {
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden flex items-center justify-center">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8" aria-labelledby="signup-title">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <UserPlusIcon size={22} />
          </div>
          <h1 id="signup-title" className="mt-5 text-3xl font-medium tracking-tight">Create your Zuri Cloud account</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Use any verified Google account to get started. Gmail is supported, along with Google Workspace accounts from your company, school, or another domain.
          </p>
          <Button type="button" variant="primary" fullWidth className="mt-6" onPress={() => onNavigate?.('cloud')}>
            Continue with Google
          </Button>
          <p className="mt-4 text-center text-xs text-muted">
            Zuri does not limit sign-up by email domain.
          </p>
        </section>
      </div>
    </main>
  );
}
