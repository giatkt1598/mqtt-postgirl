import { type ReactNode, useEffect, useRef, useState } from "react";
import { findVariableTokens, type VariableTokenSource } from "../utils/variableTokens";

export interface TopicAutocompleteProps {
  value: string;
  topics: string[];
  label: string;
  variables?: VariableTokenSource[];
  onChange: (value: string) => void;
}

export function TopicAutocomplete({
  value,
  topics,
  label,
  variables = [],
  onChange,
}: TopicAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentPart = value.split(",").pop()?.trim() ?? "";
  const suggestions = topics.filter((topic) =>
    topic.toLowerCase().includes(currentPart.toLowerCase()),
  );
  const variableTokens = findVariableTokens(value, variables);

  const renderTopicValue = (): ReactNode => {
    if (variableTokens.length === 0) return value;
    const nodes: ReactNode[] = [];
    let offset = 0;
    for (const token of variableTokens) {
      if (token.start > offset) nodes.push(value.slice(offset, token.start));
      nodes.push(
        <span className="variable-token" key={`${token.start}-${token.end}`}>
          {value.slice(token.start, token.end)}
        </span>,
      );
      offset = token.end;
    }
    if (offset < value.length) nodes.push(value.slice(offset));
    return nodes;
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const selectTopic = (topic: string) => {
    const parts = value.split(",");
    parts[parts.length - 1] = ` ${topic}`;
    onChange(parts.join(",").replace(/^\s+/, ""));
    setOpen(false);
  };

  return (
    <div
      className={`topic-autocomplete ${value.trim() ? "has-value" : ""}`}
      ref={rootRef}
    >
      <span className="topic-floating-label">{label}</span>
      <div className="topic-input-shell">
        {variableTokens.length > 0 && (
          <div className="topic-value-highlight" aria-hidden="true">
            {renderTopicValue()}
          </div>
        )}
        <input
          aria-label={label}
          className={variableTokens.length > 0 ? "has-variable-tokens" : ""}
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="topic-suggestion-list" role="listbox">
          {suggestions.map((topic) => (
            <button
              key={topic}
              type="button"
              role="option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectTopic(topic)}
            >
              {topic}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
