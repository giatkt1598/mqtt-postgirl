import { CustomFunctionRow } from "../types";
import { TemplateContext } from "./types";

export const customFunctionNamePattern = /^[A-Za-z0-9_]+$/;
const customFunctionTokenPattern = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function createCustomFunctionMap(rows: CustomFunctionRow[]) {
  return rows.reduce<Record<string, CustomFunctionRow>>((functions, row) => {
    functions[row.name] = row;
    return functions;
  }, {});
}

export function extractCustomFunctionReferences(value: string) {
  return [...value.matchAll(customFunctionTokenPattern)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

export function resolveCustomFunction(name: string, context: TemplateContext) {
  const customFunction = context.customFunctions[name];
  return customFunction
    ? { matched: true, value: customFunction.value }
    : { matched: false, value: undefined };
}
