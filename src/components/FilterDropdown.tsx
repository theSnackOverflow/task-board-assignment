interface Props {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (value: string) => void
}

export function FilterDropdown({ label, options, selected, onToggle }: Props) {
  return (
    <details className="filter-dropdown">
      <summary className={`filter-chip${selected.length > 0 ? ' active' : ''}`}>
        {label}
        {selected.length > 0 && ` ${selected.length}`}
      </summary>
      <div className="filter-menu">
        {options.map((option) => (
          <label key={option.value} className="filter-option">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </details>
  )
}
