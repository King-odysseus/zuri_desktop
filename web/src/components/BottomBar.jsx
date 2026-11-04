// Phone-only primary navigation: fixed so it never scrolls away, hidden from 900px up where the sidebar takes over.
// Add BOTTOM_BAR_SPACE to the scrolling content container so the last item is never covered.
import { Button } from './ui.jsx'

export const BOTTOM_BAR_SPACE = 'pb-[calc(4rem+env(safe-area-inset-bottom))] min-[900px]:pb-0'

export default function BottomBar({ items, view, onViewChange }) {
  return (
    <nav
      aria-label="Primary"
      // The inset shadow draws the thin soft-blue divider without adding a border to the box.
      className="fixed inset-x-0 bottom-0 z-40 w-full bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_0_#e8effc] min-[900px]:hidden"
    >
      <ul className="m-0 flex h-16 list-none p-0">
        {items.map((item) => {
          const selected = item.id === view
          return (
            <li key={item.id} className="flex min-w-[44px] flex-1">
              <Button variant="ghost"
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => onViewChange(item.id)}
                className={
                  'm-1 flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl border-0 text-[11px] font-medium leading-none ' +
                  (selected ? 'bg-[#e8effc] text-[#1b47b8]' : 'bg-transparent text-[#55627f]')
                }
              >
                <span className="flex h-6 w-6 items-center justify-center" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </Button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
