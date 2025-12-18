import './FloatingHeader.css'

export default function FloatingHeader() {
  return (
    <div className="floating-header">
      <img
        src="/remi_transparent.png"
        alt="Remi"
        className="floating-header-chatbot"
      />
      <h1 className="floating-header-title">
        NYCEATS<span className="live">.LIVE</span>
      </h1>
    </div>
  )
}
