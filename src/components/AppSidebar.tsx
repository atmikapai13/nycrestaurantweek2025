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
        <div className="flex items-center justify-center gap-1">
          <img
            src={asset('/remi_tall.png')}
            alt="Remi"
            className="h-[13rem] w-auto shrink-0 object-contain -mb-3"
          />
          <div className="flex flex-col">
            <h1 className="mt-2 whitespace-nowrap text-5xl font-extrabold leading-none tracking-tight text-neutral-800">
              NYC <br></br>Eats
            </h1>

            <p
              className="mt-2 font-['Righteous'] text-xl uppercase tracking-wider"
              style={{ WebkitTextStroke: '1.25px #ef4893', paintOrder: 'stroke' }}
            >
              <span style={{ color: '#ef4893' }}>2026</span>{' '}
              <span style={{ color: '#ef4893' }}>Summer</span>{' '}
              <span style={{ color: '#ef4893' }}>Restaurant<br></br> Week <br></br>Edition</span>
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
