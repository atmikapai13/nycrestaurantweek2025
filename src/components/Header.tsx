import nycLogo from '/nyc.png'
import './Header.css'

export default function Header() {
  return (
    <header className="header">
      <div className="header-content">
        <div className="header-left">
          <h1>NYC Eats</h1>
          <span className="header-dates">
            NYC Restaurant Week: Jul 21 - Aug 17, 2025
            <a
              href="https://www.nyctourism.com/restaurant-week/"
              target="_blank"
              rel="noopener noreferrer"
              className="nyc-credits-link"
              style={{ color: ' white', textDecoration: 'none', marginLeft: '0.25em' }}
            >
              (Credits to NYC Tourism)
            </a>
          </span>
        </div>
        <div className="header-right">
          <a 
            href="https://www.nyctourism.com/restaurant-week/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="nyc-logo-link"
          >
            <img src={nycLogo} alt="NEW YORK CITY" className="nyc-logo" />
          </a>
        </div>
      </div>
    </header>
  )
} 