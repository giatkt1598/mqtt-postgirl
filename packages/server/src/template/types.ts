import { CustomFunctionRow } from "../types";

export interface TemplateContext {
  variableCollection: Record<string, unknown>;
  variables: Record<string, unknown>;
  customFunctions: Record<string, CustomFunctionRow>;
  sequenceOffset: number;
}

export type TemplateFunction = (
  args: string[],
  context: TemplateContext,
) => unknown;

export interface BuiltinFunctionDefinition {
  name: string;
  description: string;
  resolve: TemplateFunction;
}

export interface ResolvedTemplate {
  text: string;
  json: unknown | null;
  value: unknown;
}
