import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import { useRef } from "react";

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

export interface PayloadEditorProps {
  value: string;
  language: PayloadEditorLanguage;
  variables: PayloadEditorVariable[];
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
};

const completionRegistryKey = "__mqttPostgirlTemplateCompletionRegistry";

function getCompletionRegistry(): TemplateCompletionRegistry {
  const existing = Reflect.get(
    globalThis,
    completionRegistryKey,
  ) as TemplateCompletionRegistry | undefined;
  if (existing) return existing;

  const registry: TemplateCompletionRegistry = { provider: null };
  Reflect.set(globalThis, completionRegistryKey, registry);
  return registry;
}

function templateRange(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
) {
  const lineBeforeCursor = model
    .getLineContent(position.lineNumber)
    .slice(0, position.column - 1);
  const openingIndex = lineBeforeCursor.lastIndexOf("{{");
  if (openingIndex < 0) return null;
  const token = lineBeforeCursor.slice(openingIndex + 2);
  if (!/^[A-Za-z0-9_.:-]*$/.test(token)) return null;
  return {
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
  value,
  language,
  variables,
  onChange,
}: PayloadEditorProps) {
  const variablesRef = useRef(variables);
  variablesRef.current = variables;

  const handleMount: OnMount = (editor, monacoInstance) => {
    const completionRegistry = getCompletionRegistry();
    completionRegistry.provider?.dispose();
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

    const provider = monacoInstance.languages.registerCompletionItemProvider(
      ["json", "xml", "plaintext"],
      {
        triggerCharacters: ["{", ".", ":"],
        provideCompletionItems(
          model: monaco.editor.ITextModel,
          position: monaco.Position,
        ) {
          const context = templateRange(model, position);
          if (!context) return { suggestions: [] };
          const { token, range } = context;
          const lineAfterCursor = model
            .getLineContent(position.lineNumber)
            .slice(position.column - 1);
          const completionRange = lineAfterCursor.startsWith("}}")
            ? new monacoInstance.Range(
                range.startLineNumber,
                range.startColumn,
                range.endLineNumber,
                range.endColumn + 2,
              )
            : range;
          const suggestions: monaco.languages.CompletionItem[] = [];

          const normalizedToken = token.toLowerCase();
          const variablePrefix =
            normalizedToken === "var"
              ? ""
              : normalizedToken.startsWith("var.")
                ? token.slice("var.".length).toLowerCase()
                : null;

          if (variablePrefix === null) {
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
          }

          if (variablePrefix !== null) {
            for (const variable of variablesRef.current) {
              if (!variable.name.toLowerCase().startsWith(variablePrefix)) continue;
              suggestions.push({
                label: `var.${variable.name}`,
                filterText: `{{var.${variable.name}}}`,
                kind: monacoInstance.languages.CompletionItemKind.Variable,
                detail: variable.value || "Empty value",
                insertText: `{{var.${variable.name}}}`,
                insertTextRules:
                  monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range: completionRange,
              });
            }
          }

          return { suggestions };
        },
      },
    );
    completionRegistry.provider = provider;
    monacoInstance.editor.setTheme("mqtt-postgirl-dark");
    let decorationIds: string[] = [];
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
      decorationIds = editor.deltaDecorations(decorationIds, decorations);

      const position = editor.getPosition();
      if (!position) return;
      const lineBeforeCursor = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1);
      const shouldTriggerSuggestions =
        lineBeforeCursor.endsWith("{{") ||
        lineBeforeCursor.endsWith("{{var") ||
        lineBeforeCursor.endsWith("{{var.");
      if (shouldTriggerSuggestions) {
        editor.trigger("mqtt-postgirl", "editor.action.triggerSuggest", {});
      }
    };
    updateTemplateDecorations();
    const contentDisposable = editor.onDidChangeModelContent(
      updateTemplateDecorations,
    );
    return () => {
      contentDisposable.dispose();
      provider.dispose();
      if (completionRegistry.provider === provider) {
        completionRegistry.provider = null;
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
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? "")}
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
          quickSuggestions: { comments: false, other: true, strings: true },
          suggestOnTriggerCharacters: true,
          tabSize: 2,
          wordWrap: "on",
        }}
      />
    </div>
  );
}
