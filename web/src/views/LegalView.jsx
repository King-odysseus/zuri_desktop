const UPDATED = '25 October 2026';

// The suppliers behind the Zuri model names are named here on purpose: a privacy
// notice has to say where data goes, even though the product names hide it.
const PRIVACY = {
  title: 'Privacy and data',
  intro:
    'Zuri is an AI assistant. To answer you, your messages are sent to AI companies that run the models. Some of them are outside Nigeria, including in China and the United States. This page says what is sent, where, and what we keep.',
  sections: [
    {
      heading: 'What we keep on Zuri Cloud',
      items: [
        'Your account: email address, display name, and either a password (stored only as a one-way hash) or your Google account identifier.',
        'Usage records: which Zuri model you used, how many tokens each request used, what it cost us, and when. We do not store the text of your messages or the replies on our server.',
        'Payment records: plan, amount, reference and status from Paystack. We never see or store your card number.',
        'Session records, so you stay signed in.',
      ],
    },
    {
      heading: 'Where your messages go',
      items: [
        'When you chat through Zuri Cloud, your conversation is passed to the AI company behind the Zuri model you picked, so it can write a reply. It is sent over an encrypted connection and used only to answer that request.',
        'The AI companies we use may include DeepSeek, Moonshot (Kimi) and Z.ai, which operate in China, and OpenAI, which operates in the United States. Which one answers depends on the model: this is set by us and can change.',
        'These companies have their own privacy policies and legal obligations, including laws that can let authorities in their country ask for data. Once your message reaches them, we cannot control how they handle it.',
        'If you add your own API key in the desktop app, your messages go straight from your computer to that company and do not pass through our servers.',
      ],
    },
    {
      heading: 'What stays on your computer',
      items: [
        'In the desktop app, your chats, tasks, reminders, files and settings are saved on your own computer.',
        'Your own API keys are stored on your computer and are never sent to Zuri Cloud.',
        'When you attach a file or add a folder to a chat, its text is included in that message and goes to the AI company with it.',
        'When web search is on, your search words are sent to a search service, and pages Zuri opens are fetched from your computer.',
      ],
    },
    {
      heading: 'What we ask of you',
      items: [
        'Do not send anything you could not share with an outside company. That includes passwords, card or bank details, national ID numbers, medical records, and confidential information you are not allowed to share.',
        'If you handle other people\'s personal data (clients, patients, staff), make sure you are allowed to send it to these companies before you do.',
      ],
    },
    {
      heading: 'Other services that touch your data',
      items: [
        'Google, if you sign in with Google (we receive your email, name and a unique identifier).',
        'Paystack, which processes payments.',
        'Brevo, which sends password reset emails.',
        'Railway, which hosts the Zuri Cloud server and database.',
      ],
    },
    {
      heading: 'Your choices and rights',
      items: [
        'You can ask to see, correct or delete the account data we hold, and to close your account. Under Nigerian data protection law you may also object to some uses of your data or complain to the Nigeria Data Protection Commission.',
        'Because we do not keep your message text, deleting your account removes your records on our side but cannot recall messages already processed by an AI company.',
        'To make a request, contact the Zuri team using the support details you received when you signed up.',
      ],
    },
  ],
};

const TERMS = {
  title: 'Terms and AI disclaimer',
  intro:
    'By creating an account or using Zuri you agree to these terms. Please read the AI disclaimer in particular.',
  sections: [
    {
      heading: 'AI can be wrong',
      items: [
        'Zuri replies are written by AI models. They can be inaccurate, out of date, incomplete or biased, and they can sound confident when they are wrong.',
        'Zuri is not a lawyer, doctor, accountant, financial adviser or any other licensed professional. Do not rely on it alone for legal, medical, financial, safety or other important decisions. Check anything that matters with a qualified person.',
        'Documents, spreadsheets and files that Zuri creates or edits must be checked by you before you use them.',
      ],
    },
    {
      heading: 'Actions on your computer',
      items: [
        'Zuri can open links, start apps you have allowed, and save files in your workspace. You choose which apps and links it may use in Settings, and some actions ask you first.',
        'You are responsible for what you ask it to do and for reviewing the result.',
      ],
    },
    {
      heading: 'Multiple AI providers',
      items: [
        'Zuri uses different AI providers for different models, some outside Nigeria. Your messages are handled under the privacy page above and under each provider\'s own terms.',
        'We may change which provider stands behind a Zuri model, or replace a model, to keep the service working or to manage cost.',
      ],
    },
    {
      heading: 'Acceptable use',
      items: [
        'Do not use Zuri to break the law, to harm or harass anyone, to make malware, to deceive people, or to create content that is illegal where you live.',
        'Do not try to get around plan limits, share your account, or attack the service.',
        'We may limit or suspend an account that breaks these rules or puts the service at risk.',
      ],
    },
    {
      heading: 'Plans, limits and payment',
      items: [
        'Each plan has a monthly allowance and request limits. More advanced models use the allowance faster and may be limited to higher plans.',
        'Prices are in Naira and are charged through Paystack. Plans renew each month until cancelled.',
        'Unused allowance does not carry over to the next month.',
      ],
    },
    {
      heading: 'Availability and liability',
      items: [
        'Zuri is provided as it is. We do not promise that it will always be available, error free, or suitable for a particular purpose.',
        'To the extent the law allows, we are not liable for losses that come from relying on AI replies, from outages at an AI provider, or from data you chose to send.',
        'Nothing here removes rights you have under Nigerian consumer law.',
      ],
    },
    {
      heading: 'Changes',
      items: [
        'We may update these terms and the privacy page. The date at the top shows the latest version. Continuing to use Zuri after a change means you accept it.',
      ],
    },
  ],
};

const PAGES = { '/privacy': PRIVACY, '/terms': TERMS };

/**
 * Privacy and terms pages. They are plain static copy, so both live in one file
 * and one component: the text is what changes, not the layout.
 *
 * @param {{ path: '/privacy' | '/terms', onNavigate: (path: string) => void }} props
 */
export default function LegalView({ path, onNavigate }) {
  const page = PAGES[path] ?? PRIVACY;
  const other = path === '/terms' ? { href: '/privacy', label: 'Privacy and data' } : { href: '/terms', label: 'Terms and AI disclaimer' };

  return (
    <main className="legal">
      <article className="legal-page">
        <p className="legal-updated">Last updated {UPDATED}</p>
        <h1>{page.title}</h1>
        <p className="legal-intro">{page.intro}</p>
        {page.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            <ul>
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
        <p className="legal-note">
          This page explains how Zuri works in plain language. It is not a substitute for advice from a lawyer.
        </p>
        <div className="legal-links">
          <a
            href={other.href}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(other.href);
            }}
          >
            {other.label}
          </a>
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault();
              onNavigate('/');
            }}
          >
            Back to home
          </a>
        </div>
      </article>
    </main>
  );
}
