export interface VariableTokenSource {
  name: string;
}

export interface VariableTokenMatch {
  start: number;
  end: number;
}

export const variableNamePattern = /^[A-Za-z0-9_]+$/;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findVariableTokens(
  value: string,
  variables: VariableTokenSource[],
): VariableTokenMatch[] {
  const names = [...new Set(variables.map((variable) => variable.name))]
    .filter((name) => variableNamePattern.test(name))
    .sort((left, right) => right.length - left.length);
  if (names.length === 0) return [];

  const pattern = new RegExp(`\\$(${names.map(escapeRegex).join("|")})`, "g");
  const matches: VariableTokenMatch[] = [];
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) continue;
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return matches;
}
