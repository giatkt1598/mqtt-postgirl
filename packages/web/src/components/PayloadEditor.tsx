import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import { useEffect, useRef } from "react";
import { findVariableTokens, variableNamePattern } from "../utils/variableTokens";

type MonacoWorkerEnvironment = {
  getWorker: (_workerId: string, label: string) => Worker;
};

const workerEnvironment: MonacoWorkerEnvironment = {
  getWorker: (_workerId, label) => {
    switch (label) {
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "typescript":
      case "javascript":
        return new TypeScriptWorker();
      default:
        return new EditorWorker();
    }
  },
};

(globalThis as typeof globalThis & {
  MonacoEnvironment: MonacoWorkerEnvironment;
}).MonacoEnvironment = workerEnvironment;

loader.config({ monaco });

export type PayloadEditorLanguage = "json" | "xml" | "plaintext";

export interface PayloadEditorVariable {
  name: string;
  value: string;
}

export interface PayloadEditorCustomFunction {
  name: string;
  description: string | null;
  value: string;
}

export interface PayloadEditorProps {
  requestId: string;
  value: string;
  language: PayloadEditorLanguage;
  variables: PayloadEditorVariable[];
  customFunctions?: PayloadEditorCustomFunction[];
  onChange: (value: string) => void;
}

const builtinSuggestions = [
  {
    label: "{{now}}",
    detail: "Current time",
    insertText: "{{now}}",
  },
  {
    label: "{{now:yyyy-MM-dd}}",
    detail: "Current time with Day.js format",
    insertText: "{{now:${1:yyyy-MM-dd}}}",
  },
  {
    label: "{{uuid}}",
    detail: "Generate a UUID",
    insertText: "{{uuid}}",
  },
  {
    label: "{{sequence:1:6}}",
    detail: "Padded sequence",
    insertText: "{{sequence:${1:1}:${2:6}}}",
  },
] as const;

type TemplateCompletionRegistry = {
  provider: monaco.IDisposable | null;
  version: number;
  contexts: Map<
    string,
    {
      variablesRef: { current: PayloadEditorVariable[] };
      customFunctionsRef: { current: PayloadEditorCustomFunction[] };
    }
  >;
};

const completionRegistryKey = "__mqttPostgirlTemplateCompletionRegistry";
const completionRegistryVersion = 2;

function getCompletionRegistry(): TemplateCompletionRegistry {
  const existing = Reflect.get(
    globalThis,
    completionRegistryKey,
  ) as TemplateCompletionRegistry | undefined;
  if (existing) {
    if (existing.version !== completionRegistryVersion) {
      existing.provider?.dispose();
      existing.provider = null;
      existing.contexts = new Map();
      existing.version = completionRegistryVersion;
    }
    if (!existing.contexts) existing.contexts = new Map();
    return existing;
  }

  const registry: TemplateCompletionRegistry = {
    provider: null,
    version: completionRegistryVersion,
    contexts: new Map(),
  };
  Reflect.set(globalThis, completionRegistryKey, registry);
  return registry;
}

type CompletionContext =
  | { kind: "builtin"; token: string; range: monaco.Range }
  | { kind: "variable"; token: string; range: monaco.Range };

function completionContext(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): CompletionContext | null {
  const lineBeforeCursor = model
    .getLineContent(position.lineNumber)
    .slice(0, position.column - 1);
  const variableMatch = /\$([A-Za-z0-9_]*)$/.exec(lineBeforeCursor);
  if (variableMatch && variableMatch.index !== undefined) {
    return {
      kind: "variable",
      token: variableMatch[1] ?? "",
      range: new monaco.Range(
        position.lineNumber,
        variableMatch.index + 1,
        position.lineNumber,
        position.column,
      ),
    };
  }

  const openingIndex = lineBeforeCursor.lastIndexOf("{{");
  if (openingIndex < 0) return null;
  const token = lineBeforeCursor.slice(openingIndex + 2);
  if (!/^[A-Za-z0-9_.:-]*$/.test(token)) return null;
  return {
    kind: "builtin",
    token,
    range: new monaco.Range(
      position.lineNumber,
      openingIndex + 1,
      position.lineNumber,
      position.column,
    ),
  };
}

export function PayloadEditor({
  requestId,
  value,
  language,
  variables,
  customFunctions = [],
  onChange,
}: PayloadEditorProps) {
  const variablesRef = useRef(variables);
  const customFunctionsRef = useRef(customFunctions);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const latestEditorValueRef = useRef(value);
  const pendingLocalEditRef = useRef(false);
  const previousRequestIdRef = useRef(requestId);
  const previousLanguageRef = useRef(language);
  const updateDecorationsRef = useRef<() => void>(() => undefined);
  variablesRef.current = variables;
  customFunctionsRef.current = customFunctions;

  useEffect(() => {
    updateDecorationsRef.current();
  }, [variables, customFunctions]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (previousRequestIdRef.current !== requestId) {
      previousRequestIdRef.current = requestId;
      previousLanguageRef.current = language;
      latestEditorValueRef.current = value;
      pendingLocalEditRef.current = false;
      if (editor.getValue() !== value) editor.setValue(value);
      return;
    }

    // A format conversion changes both the content and language. Apply it even
    // while a local typing update is pending so Monaco cannot retain stale text.
    if (previousLanguageRef.current !== language) {
      previousLanguageRef.current = language;
      latestEditorValueRef.current = value;
      pendingLocalEditRef.current = false;
      if (editor.getValue() !== value) editor.setValue(value);
      return;
    }

    if (value === latestEditorValueRef.current) {
      pendingLocalEditRef.current = false;
      return;
    }

    if (pendingLocalEditRef.current) return;

    latestEditorValueRef.current = value;
    editor.setValue(value);
  }, [language, requestId, value]);

  const handleChange = (nextValue: string | undefined) => {
    const nextPayload = nextValue ?? "";
    latestEditorValueRef.current = nextPayload;
    pendingLocalEditRef.current = true;
    onChange(nextPayload);
  };

  const handleMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;
    const completionRegistry = getCompletionRegistry();
    const modelKey = editor.getModel()?.uri.toString();
    if (modelKey) {
      completionRegistry.contexts.set(modelKey, { variablesRef, customFunctionsRef });
    }
    monacoInstance.editor.defineTheme("mqtt-postgirl-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "string", foreground: "9CDCFE" },
        { token: "number", foreground: "B5CEA8" },
        { token: "delimiter.bracket", foreground: "D4D4D4" },
      ],
      colors: {
        "editor.background": "#171b24",
        "editorGutter.background": "#171b24",
        "editorLineNumber.foreground": "#667085",
        "editorLineNumber.activeForeground": "#d6deeb",
        "editor.selectionBackground": "#264f78",
        "editorSuggestWidget.background": "#202735",
        "editorSuggestWidget.border": "#3a455a",
      },
    });

    if (!completionRegistry.provider) {
      completionRegistry.provider = monacoInstance.languages.registerCompletionItemProvider(
        ["json", "xml", "plaintext"],
        {
        triggerCharacters: ["{", "$"],
        provideCompletionItems(
          model: monaco.editor.ITextModel,
          position: monaco.Position,
        ) {
          const context = completionContext(model, position);
          if (!context) return { suggestions: [] };
          const { token, range } = context;
          const lineAfterCursor = model
            .getLineContent(position.lineNumber)
            .slice(position.column - 1);
          const completionRange = context.kind === "builtin" && lineAfterCursor.startsWith("}}")
            ? new monacoInstance.Range(
                range.startLineNumber,
                range.startColumn,
                range.endLineNumber,
                range.endColumn + 2,
              )
            : range;
          const suggestions: monaco.languages.CompletionItem[] = [];

          if (context.kind === "builtin") {
            const normalizedToken = token.toLowerCase();
            for (const suggestion of builtinSuggestions) {
              if (suggestion.label.toLowerCase().includes(normalizedToken)) {
                suggestions.push({
                  label: suggestion.label,
                  filterText: suggestion.label,
                  kind: monacoInstance.languages.CompletionItemKind.Function,
                  detail: suggestion.detail,
                  insertText: suggestion.insertText,
                  insertTextRules:
                    monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range: completionRange,
                });
              }
            }
            const editorContext = completionRegistry.contexts.get(model.uri.toString());
            for (const customFunction of editorContext?.customFunctionsRef.current ?? []) {
              if (!customFunction.name.toLowerCase().startsWith(normalizedToken)) continue;
              const label = `{{${customFunction.name}}}`;
              if (suggestions.some((suggestion) => suggestion.label === label)) continue;
              suggestions.push({
                label,
                filterText: label,
                kind: monacoInstance.languages.CompletionItemKind.Function,
                detail: customFunction.description || customFunction.value || "Custom function",
                insertText: label,
                range: completionRange,
              });
            }
          }

          if (context.kind === "variable") {
            const variablePrefix = token.toLowerCase();
            const editorContext = completionRegistry.contexts.get(model.uri.toString());
            for (const variable of editorContext?.variablesRef.current ?? []) {
              if (!variableNamePattern.test(variable.name)) continue;
              if (!variable.name.toLowerCase().startsWith(variablePrefix)) continue;
              suggestions.push({
                label: `$${variable.name}`,
                filterText: `$${variable.name}`,
                kind: monacoInstance.languages.CompletionItemKind.Variable,
                detail: variable.value || "Empty value",
                insertText: `$${variable.name}`,
                range: completionRange,
              });
            }
          }

          // Re-query this provider as the template token changes instead of
          // filtering the initial built-in list from the {{ trigger.
          return { suggestions, incomplete: true };
        },
        },
      );
    }
    monacoInstance.editor.setTheme("mqtt-postgirl-dark");
    let decorationIds: string[] = [];
    const triggerTemplateSuggestions = () => {
      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position) return;
      const lineBeforeCursor = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1);
      const shouldTriggerSuggestions =
        lineBeforeCursor.endsWith("{{") ||
        /\$[A-Za-z0-9_]*$/.test(lineBeforeCursor) ||
        lineBeforeCursor.endsWith("$");
      if (shouldTriggerSuggestions) {
        editor.trigger("mqtt-postgirl", "editor.action.triggerSuggest", {});
      }
    };
    const updateTemplateDecorations = () => {
      const model = editor.getModel();
      if (!model) return;
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];
      const templatePattern = /\{\{[^{}\r\n]*(?:\}\}|(?=\r?\n|$))/g;
      for (const match of model.getValue().matchAll(templatePattern)) {
        if (match.index === undefined) continue;
        decorations.push({
          range: monacoInstance.Range.fromPositions(
            model.getPositionAt(match.index),
            model.getPositionAt(match.index + match[0].length),
          ),
          options: { inlineClassName: "template-token" },
        });
      }
      for (const token of findVariableTokens(model.getValue(), variablesRef.current)) {
        decorations.push({
          range: monacoInstance.Range.fromPositions(
            model.getPositionAt(token.start),
            model.getPositionAt(token.end),
          ),
          options: { inlineClassName: "variable-token" },
        });
      }
      decorationIds = editor.deltaDecorations(decorationIds, decorations);
    };
    updateDecorationsRef.current = updateTemplateDecorations;
    updateTemplateDecorations();
    const contentDisposable = editor.onDidChangeModelContent(
      updateTemplateDecorations,
    );
    const cursorDisposable = editor.onDidChangeCursorPosition(
      triggerTemplateSuggestions,
    );
    return () => {
      contentDisposable.dispose();
      cursorDisposable.dispose();
      if (modelKey) completionRegistry.contexts.delete(modelKey);
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
      if (updateDecorationsRef.current === updateTemplateDecorations) {
        updateDecorationsRef.current = () => undefined;
      }
      editor.deltaDecorations(decorationIds, []);
    };
  };

  return (
    <div className="payload-editor-shell">
      <Editor
        height="100%"
        language={language}
        theme="mqtt-postgirl-dark"
        defaultValue={value}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          cursorBlinking: "smooth",
          fontSize: 13,
          folding: true,
          lineNumbers: "on",
          minimap: { enabled: false },
          padding: { top: 12, bottom: 12 },
          scrollBeyondLastLine: false,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          tabSize: 2,
          wordWrap: "on",
        }}
      />
    </div>
  );
}
