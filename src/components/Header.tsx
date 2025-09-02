import nycLogo from '/nyc.png'
import './Header.css'

export default function Header() {
  return (
    <header className="header">
      <div className="header-content">
        <div className="header-left">
          <h1>NYC Eats</h1>
                    <div className="header-dates">
            <div className="header-dates-main">Stay tuned for Spring 2026 Restaurant Week!</div>
          </div>
          <div className="header-credits">
            Built by{' '}
            <a
              href="https://atmikapai.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="author-link"
              style={{ color: 'white', textDecoration: 'none' }}
            >
              Atmika Pai
            </a>
            {' | Sourced from '}
            <a
              href="https://www.nyctourism.com/restaurant-week/"
              target="_blank"
              rel="noopener noreferrer"
              className="nyc-credits-link"
              style={{ color: 'white', textDecoration: 'none' }}
            >
              NYC Tourism
            </a>
          </div>
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