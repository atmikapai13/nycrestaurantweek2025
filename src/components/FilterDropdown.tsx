import { useState, useEffect, useRef } from 'react'

export interface FilterOption {
  value: string
  label: string | React.ReactNode
  disabled?: boolean
  icon?: string
}

interface FilterDropdownProps {
  label: string | React.ReactNode
  icon: string
  options: FilterOption[]
  selectedValues: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}

export default function FilterDropdown({
  label,
  icon,
  options,
  selectedValues,
  onChange,
  placeholder
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Auto-scroll into view when dropdown opens on mobile
  useEffect(() => {
    if (isOpen && menuRef.current && window.innerWidth <= 768) {
      // Small delay to ensure dropdown is rendered
      setTimeout(() => {
        const menu = menuRef.current
        const dropdown = dropdownRef.current
        if (!menu || !dropdown) return

        // Find the scrollable parent (.filter-bar)
        const scrollParent = dropdown.closest('.filter-bar') as HTMLElement
        if (!scrollParent) return

        const menuRect = menu.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const padding = 20 // Extra padding for comfort

        // Only scroll if dropdown is cut off (extends beyond right edge OR left edge)
        const isCutOffRight = menuRect.right > viewportWidth - padding
        const isCutOffLeft = menuRect.left < padding

        if (isCutOffRight || isCutOffLeft) {
          const dropdownRect = dropdown.getBoundingClientRect()
          const scrollParentRect = scrollParent.getBoundingClientRect()

          // Calculate target scroll position to center the dropdown
          const dropdownCenter = dropdownRect.left - scrollParentRect.left + scrollParent.scrollLeft + dropdownRect.width / 2
          const viewportCenter = viewportWidth / 2
          const targetScroll = dropdownCenter - viewportCenter

          // Set absolute scroll position
          scrollParent.scrollTo({
            left: Math.max(0, targetScroll),
            behavior: 'smooth'
          })
        }
      }, 100)
    }
  }, [isOpen])

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    // Small delay prevents immediate close on same click that opened dropdown
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close dropdown on parent scroll for smoother experience
  useEffect(() => {
    if (!isOpen) return

    const handleScroll = () => {
      setIsOpen(false)
    }

    // Find the scrollable parent (.filter-bar)
    const scrollParent = dropdownRef.current?.closest('.filter-bar')
    if (scrollParent) {
      scrollParent.addEventListener('scroll', handleScroll)
      return () => {
        scrollParent.removeEventListener('scroll', handleScroll)
      }
    }
  }, [isOpen])

  // Keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'Escape':
        setIsOpen(false)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        setIsOpen(!isOpen)
        break
    }
  }

  // Handle checkbox change (live filtering)
  const handleCheckboxChange = (value: string) => {
    const newValues = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value]

    onChange(newValues)
  }

  // Clear all selections for this filter
  const handleClearAll = (event: React.MouseEvent) => {
    event.stopPropagation()
    onChange([])
  }

  const hasSelections = selectedValues.length > 0

  return (
    <div
      className="filter-dropdown"
      ref={dropdownRef}
      role="combobox"
      aria-label={`${label} filter`}
      aria-expanded={isOpen}
    >
      {/* STANDARD PATTERN: Apply 'active' class when selections exist
          This triggers pink active state styling (see FilterBar.css) */}
      <button
        className={`filter-pill-base filter-pill-button ${hasSelections ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-controls={`${label}-dropdown-menu`}
      >
        {icon && <span className="filter-pill-icon">{icon}</span>}
        <span className="filter-pill-label">{label}</span>
        <span className="filter-pill-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          id={`${label}-dropdown-menu`}
          className="filter-dropdown-menu"
          role="listbox"
          aria-label={`${label} options`}
        >
          {/* Reset button - always visible, only enabled when selections exist */}
          <div className="filter-dropdown-header">
            <button
              className="filter-reset-icon"
              onClick={handleClearAll}
              disabled={!hasSelections}
              aria-label="Reset filter"
              title={hasSelections ? "Reset filter" : "No selections to reset"}
            >
              ↻
            </button>
          </div>

          {/* Options list */}
          <div className="filter-options-list">
            {options.length === 0 ? (
              <div className="filter-dropdown-empty">
                No options available
              </div>
            ) : (
              options.map(option => (
                <label
                  key={option.value}
                  className={`filter-option ${option.disabled ? 'disabled' : ''}`}
                  role="option"
                  aria-selected={selectedValues.includes(option.value)}
                >
                  <input
                    type="checkbox"
                    className="filter-option-checkbox"
                    checked={selectedValues.includes(option.value)}
                    onChange={() => handleCheckboxChange(option.value)}
                    disabled={option.disabled}
                    aria-label={option.label}
                  />
                  {option.icon && (
                    <img
                      src={option.icon}
                      alt=""
                      className="filter-option-icon"
                    />
                  )}
                  <span className="filter-option-label">{option.label}</span>
                </label>
              ))
            )}
          </div>

          {/* Placeholder text */}
          {placeholder && options.length === 0 && (
            <div className="filter-dropdown-warning">
              {placeholder}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
