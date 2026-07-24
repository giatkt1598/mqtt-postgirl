import { createCustomFunctionMap, resolveCustomFunction } from "./template/custom-functions";
import { resolveBuiltinFunction } from "./template/functions";
import { ResolvedTemplate, TemplateContext } from "./template/types";
import { safeJsonParse } from "./utils";

export type { ResolvedTemplate, TemplateContext } from "./template/types";

function valueToText(value: unknown) {
  if (value === undefined || value === null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function resolveVariableToken(token: string, context: TemplateContext) {
  const names = [...new Set([
    ...Object.keys(context.variableCollection),
    ...Object.keys(context.variables),
  ])]
    .filter((name) => /^[A-Za-z0-9_]+$/.test(name) && token.startsWith(name))
    .sort((left, right) => right.length - left.length);
  const name = names[0];
  if (!name) return `$${token}`;

  const resolved = context.variableCollection[name] ?? context.variables[name] ?? "";
  return `${valueToText(resolved)}${token.slice(name.length)}`;
}

function replaceInString(
  value: string,
  context: TemplateContext,
  stack: string[] = [],
  depth = 0,
) {
  const withVariables = value.replace(
    /\$([A-Za-z0-9_]+)/g,
    (_match: string, token: string) => resolveVariableToken(token, context),
  );

  return withVariables.replace(/\{\{\s*([^}]+?)\s*}}/g, (match: string, token: string) => {
    const builtin = resolveBuiltinFunction(token, context);
    if (builtin.matched) return valueToText(builtin.value);

    const custom = resolveCustomFunction(token, context);
    if (!custom.matched || depth >= 32 || stack.includes(token)) return match;
    return replaceInString(valueToText(custom.value), context, [...stack, token], depth + 1);
  });
}

function resolveDeep(value: unknown, context: TemplateContext): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const maybeJson = trimmed.startsWith("{") || trimmed.startsWith("[") ? safeJsonParse(trimmed) : null;
    return maybeJson !== null ? resolveDeep(maybeJson, context) : replaceInString(value, context);
  }
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, context));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveDeep(item, context)]));
  return value;
}

export function resolveTemplatePayload(template: string, context?: Partial<TemplateContext>): ResolvedTemplate {
  const fullContext: TemplateContext = {
    variableCollection: context?.variableCollection ?? {},
    variables: context?.variables ?? {},
    customFunctions: context?.customFunctions ?? {},
    sequenceOffset: context?.sequenceOffset ?? 0,
  };
  const parsed = safeJsonParse(template);
  const resolved = resolveDeep(parsed ?? template, fullContext);
  if (typeof resolved === "string") {
    const json = safeJsonParse(resolved);
    return { text: resolved, json, value: json ?? resolved };
  }
  return { text: JSON.stringify(resolved, null, 2), json: resolved, value: resolved };
}

export { createCustomFunctionMap };
