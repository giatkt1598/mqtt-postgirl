export interface QosSelectProps {
  value: number;
  onChange: (value: number) => void;
}

const qosOptions = [
  [0, "At most once"],
  [1, "At least once"],
  [2, "Exactly once"],
] as const;

export function QosSelect({ value, onChange }: QosSelectProps) {
  return (
    <span className="qos-select">
      <span className="qos-select-value" aria-hidden="true">
        {value}
      </span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {qosOptions.map(([optionValue, description]) => (
          <option key={optionValue} value={optionValue}>
            {optionValue} - {description}
          </option>
        ))}
      </select>
    </span>
  );
}
