import { Input } from './ui.jsx';
import { SearchIcon } from './Icons.jsx';

export default function SearchView() {
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <div className="w-full">
          <header className="mb-8">
            <h1 className="text-3xl font-medium tracking-tight">Search</h1>
            <p className="mt-2 text-sm text-muted">Find conversations and shared work in one place.</p>
          </header>
          <Input
            aria-label="Search conversations"
            placeholder="Search conversations"
            startContent={<SearchIcon size={18} />}
            fullWidth
            autoFocus
          />
          <p className="mt-10 text-sm text-muted">No conversations to search yet.</p>
        </div>
      </div>
    </main>
  );
}
