import nycLogo from '/nyc.png'
import './Header.css'

export default function Header() {
  return (
    <header className="header">
      {/* Left side - Text content */}
      <div className="header-text">
        <h1 className="header-title">
          New York Restaurant Week
        </h1>
        <p className="header-dates">
          Jul 21 - Aug 17, 2025
        </p>
      </div>

      {/* Right side - NYC Logo */}
      <div className="header-logo">
        <a 
          href="https://www.nyctourism.com/restaurant-week/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="logo-link"
        >
          <img 
            src={nycLogo} 
            alt="NEW YORK CITY" 
            className="logo-image"
          />
        </a>
      </div>
    </header>
  )
} 