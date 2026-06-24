import './FloatingHeader.css'
import { asset } from '../utils/asset'

export default function FloatingHeader() {
  return (
    <div className="floating-header">
      <span className="header-football" aria-hidden="true">⚽</span>
      <h1 className="floating-header-title">
        NYC <span className="live">EATS</span>
      </h1>
      <h2 className="floating-header-subtitle">
        | World Cup Edition
      </h2>
    </div>
  )
}
