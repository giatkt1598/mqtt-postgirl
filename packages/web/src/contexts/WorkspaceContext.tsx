import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { CollectionSidebarProps, WorkspaceHeaderProps } from "../components";
import type { ConnectionsPageProps, ConsumersPageProps } from "../pages";
import type { VariableCollectionRow, VariableRow } from "../models";

export interface VariableCollectionDraft {
  id: string;
  name: string;
}

export interface VariableDraftRow {
  id?: string;
  name: string;
  value: string;
}

export type WorkspaceContextValue = CollectionSidebarProps &
  ConsumersPageProps &
  ConnectionsPageProps &
  WorkspaceHeaderProps & {
    variableCollections: VariableCollectionRow[];
    variables: VariableRow[];
    consumerTopicOrder: string[];
    selectedVariableCollectionId: string;
    variableCollectionDraft: VariableCollectionDraft;
    setVariableCollectionDraft: Dispatch<SetStateAction<VariableCollectionDraft>>;
    selectVariableCollection: (collection: VariableCollectionRow) => void;
    openNewVariableCollection: () => void;
    saveVariableCollection: () => string | undefined | Promise<string | undefined>;
    saveVariables: (collectionId: string, rows: VariableDraftRow[]) => void | Promise<void>;
    deleteVariableCollection: () => void | Promise<void>;
  };

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceContextValue;
  children: ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspaceContext must be used inside WorkspaceProvider");
  }
  return context;
}
