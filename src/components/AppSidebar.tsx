import type { Restaurant } from '../types/restaurant'
import { asset } from '../utils/asset'
import DealsPanel from './DealsPanel'
import { Sidebar, SidebarContent, SidebarHeader } from '@/components/ui/sidebar'

export function AppSidebar({ onSelect }: { onSelect: (r: Restaurant) => void }) {
  return (
    <Sidebar
      collapsible="none"
      className="border-r border-neutral-200 bg-white"
      style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
    >
      <SidebarHeader className="pl-1 pr-5 pt-2 pb-2">
        <div className="flex items-center gap-1">
          <img
            src={asset('/remi_tall2.png')}
            alt="Remi"
            className="h-[17rem] w-auto shrink-0 object-contain -mb-3"
          />
          <div className="flex flex-col">
            <h1 className="mt-2 whitespace-nowrap text-7xl font-extrabold leading-none tracking-tight text-neutral-800">
              NYC<br></br><span className="text-pink-500">Eats</span>
            </h1>

            <p
              className="mt-2 font-['Righteous'] text-2xl uppercase tracking-wide"
              style={{ WebkitTextStroke: '1.5px #1a1a1a', paintOrder: 'stroke' }}
            >
              <span style={{ color: '#ED2939' }}>2026</span>{' '}
              <span style={{ color: '#ED2939' }}>Summer</span>{' '}
              <span style={{ color: '#2660E6' }}>Restaurant Week</span>
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="no-scrollbar px-5">
        <DealsPanel onSelect={onSelect} />
      </SidebarContent>
    </Sidebar>
  )
}
