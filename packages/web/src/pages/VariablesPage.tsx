import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "react-toastify";
import { useWorkspaceContext, type VariableDraftRow } from "../contexts";
import type { VariableCollectionRow, VariableRow } from "../models";
import { variableNamePattern } from "../utils/variableTokens";

const emptyVariableRow = (): VariableDraftRow => ({ name: "", value: "" });

function withTrailingRow(rows: VariableDraftRow[]) {
  const lastRow = rows[rows.length - 1];
  if (!lastRow || lastRow.name || lastRow.value) {
    return [...rows, emptyVariableRow()];
  }
  return rows;
}

export function VariablesPage(): ReactNode {
  const {
    variableCollections,
    variables,
    selectedVariableCollectionId,
    variableCollectionDraft,
    setVariableCollectionDraft,
    selectVariableCollection,
    openNewVariableCollection,
    saveVariableCollection,
    saveVariables,
    deleteVariableCollection,
    askDeleteConfirmation,
  } = useWorkspaceContext();
  const [draftRowsByCollection, setDraftRowsByCollection] = useState<
    Record<string, VariableDraftRow[]>
  >({});
  const [modifiedCollectionIds, setModifiedCollectionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [saveError, setSaveError] = useState("");
  const initialized = useRef(false);

  useEffect(() => {
    if (
      !initialized.current &&
      !selectedVariableCollectionId &&
      variableCollections[0]
    ) {
      initialized.current = true;
      selectVariableCollection(variableCollections[0]);
    }
    if (!initialized.current) initialized.current = true;
  }, [selectedVariableCollectionId, variableCollections, selectVariableCollection]);

  useEffect(() => {
    if (!selectedVariableCollectionId) return;
    if (modifiedCollectionIds.has(selectedVariableCollectionId)) return;
    const sourceRows = variables
      .filter((variable) => variable.variableCollectionId === selectedVariableCollectionId)
      .map(({ id, name, value }) => ({ id, name, value }));
    setDraftRowsByCollection((current) => ({
      ...current,
      [selectedVariableCollectionId]: withTrailingRow(sourceRows),
    }));
  }, [selectedVariableCollectionId, variables, modifiedCollectionIds]);

  const selectedRows = draftRowsByCollection[selectedVariableCollectionId] ?? [
    emptyVariableRow(),
  ];
  const isModified = selectedVariableCollectionId
    ? modifiedCollectionIds.has(selectedVariableCollectionId)
    : Boolean(variableCollectionDraft.name.trim());

  const markModified = () => {
    if (!selectedVariableCollectionId) return;
    setModifiedCollectionIds((current) => {
      const next = new Set(current);
      next.add(selectedVariableCollectionId);
      return next;
    });
  };

  const updateRows = (rows: VariableDraftRow[]) => {
    setDraftRowsByCollection((current) => ({
      ...current,
      [selectedVariableCollectionId]: withTrailingRow(rows),
    }));
    markModified();
  };

  const updateRow = (index: number, field: "name" | "value", value: string) => {
    const rows = selectedRows.map((row, rowIndex) =>
      rowIndex === index
        ? {
            ...row,
            [field]: field === "name" ? value.replace(/[^A-Za-z0-9_]/g, "") : value,
          }
        : row,
    );
    updateRows(rows);
  };

  const removeRow = (index: number) => {
    updateRows(selectedRows.filter((_, rowIndex) => rowIndex !== index));
  };

  const handleSelectCollection = (collection: VariableCollectionRow) => {
    selectVariableCollection(collection);
    setSaveError("");
  };

  const handleNewCollection = () => {
    openNewVariableCollection();
    setDraftRowsByCollection((current) => ({ ...current, "": [emptyVariableRow()] }));
    setSaveError("");
  };

  const handleSave = async () => {
    const normalizedName = variableCollectionDraft.name.trim().toLowerCase();
    const duplicateCollection = variableCollections.some(
      (collection) =>
        collection.id !== variableCollectionDraft.id &&
        collection.name.trim().toLowerCase() === normalizedName,
    );
    if (duplicateCollection) {
      setSaveError("Variable Collection name must be unique.");
      return;
    }
    const rows = selectedRows.filter((row) => row.name.trim() || row.value);
    if (rows.some((row) => !row.name.trim())) {
      setSaveError("Variable name is required when a value is entered.");
      return;
    }
    if (rows.some((row) => !variableNamePattern.test(row.name.trim()))) {
      setSaveError("Variable name may only contain letters, numbers, and underscores.");
      return;
    }
    const names = rows.map((row) => row.name.trim());
    if (new Set(names).size !== names.length) {
      setSaveError("Variable names must be unique within a collection.");
      return;
    }
    try {
      setSaveError("");
      const previousCollectionId = selectedVariableCollectionId;
      const savedId = await saveVariableCollection();
      if (!savedId) return;
      const rowsToSave = draftRowsByCollection[previousCollectionId] ?? rows;
      await saveVariables(savedId, rowsToSave);
      setModifiedCollectionIds((current) => {
        const next = new Set(current);
        next.delete(previousCollectionId);
        next.delete(savedId);
        return next;
      });
      toast.success("Variables saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save variables");
    }
  };

  const handleDeleteCollection = () => {
    askDeleteConfirmation(
      "Delete variable collection",
      "Delete this collection and all variables inside it?",
      deleteVariableCollection,
    );
  };

  return (
    <section className="variables-page">
      <div className="variables-collections card">
        <div className="section-head">
          <div>
            <div className="card-title">Variable Collections</div>
            <div className="card-sub">Reusable values for request templates.</div>
          </div>
          <button className="primary" onClick={handleNewCollection}>New</button>
        </div>
        <div className="variables-collection-list">
          {variableCollections.map((collection) => (
            <button
              key={collection.id}
              className={`variables-collection-item ${
                collection.id === selectedVariableCollectionId ? "active" : ""
              }`}
              onClick={() => handleSelectCollection(collection)}
            >
              <span className="variables-collection-name">
                {modifiedCollectionIds.has(collection.id) && (
                  <i className="request-modified-dot" aria-label="Modified" title="Modified" />
                )}
                {collection.name}
              </span>
              <small>
                {variables.filter((item) => item.variableCollectionId === collection.id).length}
              </small>
            </button>
          ))}
          {!variableCollections.length && (
            <div className="empty-state">
              <strong>No Variable Collections</strong>
              <small>Create one to start adding variables.</small>
            </div>
          )}
        </div>
      </div>

      <div className="variables-editor card">
        <div className="section-head">
          <div className="variables-title-field">
            <div className="variables-title-row">
              <input
                aria-label="Variable collection name"
                placeholder="Variable Collection name"
                value={variableCollectionDraft.name}
                onChange={(event) => {
                  setVariableCollectionDraft({
                    ...variableCollectionDraft,
                    name: event.target.value,
                  });
                  markModified();
                }}
              />
              {isModified && <span className="modified-label">(Modified)</span>}
            </div>
            <small>Variables used with $NAME</small>
          </div>
          <div className="button-row">
            <button
              className="primary"
              disabled={!variableCollectionDraft.name.trim()}
              onClick={() => void handleSave()}
            >
              Save
            </button>
            {variableCollectionDraft.id && (
              <button className="danger" onClick={handleDeleteCollection}>Delete</button>
            )}
          </div>
        </div>
        {saveError && <div className="error-banner variables-error">{saveError}</div>}
        <div className="variable-table" role="table">
          <div className="variable-table-row variable-table-head" role="row">
            <span role="columnheader">Variable</span>
            <span role="columnheader">Value</span>
          </div>
          {selectedRows.map((row, index) => {
            const isTrailingRow = index === selectedRows.length - 1 && !row.id;
            return (
              <div className="variable-table-row" role="row" key={row.id ?? `new-${index}`}>
                <input
                  aria-label={`Variable ${index + 1}`}
                  placeholder={isTrailingRow ? "Add Variable" : "Variable"}
                  value={row.name}
                  onChange={(event) => updateRow(index, "name", event.target.value)}
                />
                <div className="variable-value-cell">
                  <input
                    aria-label={`Value ${index + 1}`}
                    placeholder="Value"
                    value={row.value}
                    onChange={(event) => updateRow(index, "value", event.target.value)}
                  />
                  {!isTrailingRow && (
                    <button
                      className="icon-button variable-delete-button"
                      aria-label={`Delete variable ${row.name}`}
                      title="Delete variable"
                      onClick={() => removeRow(index)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 7h14M10 11v6M14 11v6M9 7V4h6v3m-9 0 1 13h8l1-13" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
