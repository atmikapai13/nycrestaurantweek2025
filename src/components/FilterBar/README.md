# FilterBar

**Stack:** React + TypeScript, shadcn/ui (`src/components/ui/`: Button, Toggle, DropdownMenu, Popover, Command), Tailwind, lucide-react icons. Filter state lives in `src/contexts/MapContext.tsx`; colors in `src/styles/tokens.ts`.

| File | What it does / edit it to… |
|---|---|
| `FilterBar.tsx` | Layout and pill order; the Filter button, 500+ Reviews toggle, Reset. Add, remove or reorder pills. |
| `FilterDropdown.tsx` | A dropdown pill and its menu (searchable for Cuisine). Change how menus and option rows look or behave. |
| `FavoritesFilter.tsx` | ♥ pill and the "Share with Friends" link. Change favorites or sharing. |
| `useFilterOptions.ts` | Each dropdown's options, live counts and disabled states. Add options or change how counts are computed. |
| `filterPill.ts` | Shared pill style and active (pink) state, plus menu z-index and radius. Change how all pills look. |
| `FilterBar.css` | Bar position next to the chat panel and the collapse animation. Move the bar or change responsive layout. |

A new filter also needs its matching rule in `MapContext.tsx` (`filterPoolSlugs`), so the map and Remi respect it.
