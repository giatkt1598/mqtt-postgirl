import { DragEvent } from "react";
import { CollectionRow, DraftRequest, RequestRow } from "../models";
import { isRequestModified } from "../utilities";
import { useWorkspaceContext } from "../contexts";
import { ScrollArea } from "./ScrollArea";

export interface CollectionSidebarProps {
  collections: CollectionRow[];
  requests: RequestRow[];
  selectedCollectionId: string;
  selectedRequestId: string;
  expandedCollectionIds: string[];
  favoriteCollectionIds: string[];
  requestDrafts: Record<string, DraftRequest>;
  draggedRequestId: string | null;
  draggedCollectionId: string | null;
  dragOverRequestId: string | null;
  dragOverCollectionId: string | null;
  onCreateCollection: () => void;
  onImportCollection: () => void;
  onSelectCollection: (collection: CollectionRow) => void;
  onSelectRequest: (request: RequestRow) => void;
  onToggleCollection: (collectionId: string) => void;
  onAddRequest: (collection: CollectionRow) => void;
  onToggleFavorite: (collectionId: string) => void;
  onCollectionMenuToggle: (collectionId: string, anchor: HTMLElement) => void;
  onRequestMenuToggle: (requestId: string, anchor: HTMLElement) => void;
  onDropRequestOnCollection: (
    collectionId: string,
    event: DragEvent<HTMLDivElement>,
  ) => void;
  onCollectionDragOver: (collectionId: string) => void;
  onDropRequest: (
    collectionId: string,
    requestId: string,
    event: DragEvent<HTMLButtonElement>,
  ) => void;
  onCollectionDragStart: (collectionId: string) => void;
  onCollectionDragEnd: () => void;
  onRequestDragStart: (requestId: string) => void;
  onRequestDragOver: (requestId: string) => void;
  onRequestDragEnd: () => void;
}

export function CollectionSidebar() {
  const {
    collections,
    requests,
    selectedCollectionId,
    selectedRequestId,
    expandedCollectionIds,
    favoriteCollectionIds,
    requestDrafts,
    draggedRequestId,
    draggedCollectionId,
    dragOverRequestId,
    dragOverCollectionId,
    onCreateCollection,
    onImportCollection,
    onSelectCollection,
    onSelectRequest,
    onToggleCollection,
    onAddRequest,
    onToggleFavorite,
    onCollectionMenuToggle,
    onRequestMenuToggle,
    onDropRequestOnCollection,
    onCollectionDragOver,
    onDropRequest,
    onCollectionDragStart,
    onCollectionDragEnd,
    onRequestDragStart,
    onRequestDragOver,
    onRequestDragEnd,
  } = useWorkspaceContext();
  return (
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Go to MQTT - PostGirl home">
        <div className="brand-mark">
          <img src="/favicon.png" />
        </div>
        <div>
          <div className="brand-title">MQTT - PostGirl</div>
          <div className="brand-sub">Local-first MQTT control room</div>
        </div>
      </a>
      <div className="sidebar-panel">
        <ScrollArea className="collection-scroll-area">
          <div className="panel-header">
            <span>Collections</span>
            <span className="flex-1" />
            <button
              className="icon-button"
              aria-label="Import collection"
              title="Import collection"
              onClick={onImportCollection}
            >
              ⇧
            </button>
            <button
              className="icon-button"
              aria-label="Create collection"
              title="Create collection"
              onClick={onCreateCollection}
            >
              +
            </button>
          </div>
          <div className="collection-list mt-2">
            {collections.map((collection) => {
              const collectionRequests = requests.filter(
                (request) => request.collectionId === collection.id,
              );
              const isExpanded = expandedCollectionIds.includes(collection.id);
              return (
                <div key={collection.id} className="collection-node">
                  <div
                    className={`collection-item ${collection.id === selectedCollectionId ? "active" : ""} ${collection.id === dragOverCollectionId ? "drag-over" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      onCollectionDragOver(collection.id);
                    }}
                    onDrop={(event) =>
                      onDropRequestOnCollection(collection.id, event)
                    }
                  >
                    <button
                      className="collection-toggle"
                      aria-label={
                        isExpanded ? "Collapse collection" : "Expand collection"
                      }
                      title={
                        isExpanded ? "Collapse collection" : "Expand collection"
                      }
                      onClick={() => onToggleCollection(collection.id)}
                    >
                      {isExpanded ? "⌄" : "›"}
                    </button>
                    <button
                      className="collection-main"
                      draggable
                      onDragStart={(event) => {
                        event.stopPropagation();
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", collection.id);
                        onCollectionDragStart(collection.id);
                      }}
                      onDragEnd={onCollectionDragEnd}
                      onClick={() => onSelectCollection(collection)}
                    >
                      <span className="collection-label">
                        <span>{collection.name}</span>
                        {favoriteCollectionIds.includes(collection.id) && (
                          <span className="favorite-mark">★</span>
                        )}
                      </span>
                      <small>{collectionRequests.length} requests</small>
                    </button>
                    <div className="collection-actions">
                      <button
                        className="icon-button"
                        aria-label="Add request"
                        title="Add request"
                        onClick={() => onAddRequest(collection)}
                      >
                        +
                      </button>
                      <button
                        className={`icon-button ${favoriteCollectionIds.includes(collection.id) ? "is-favorite" : ""}`}
                        aria-label="Add to favorites"
                        title="Add to favorites"
                        onClick={() => onToggleFavorite(collection.id)}
                      >
                        ★
                      </button>
                      <button
                        className="icon-button"
                        aria-label="More collection actions"
                        title="More collection actions"
                        onClick={(event) =>
                          onCollectionMenuToggle(
                            collection.id,
                            event.currentTarget,
                          )
                        }
                      >
                        ⋯
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="request-tree">
                      {collectionRequests.map((request) => (
                        <div
                          key={request.id}
                          className={`request-tree-row ${request.id === selectedRequestId ? "active" : ""}`}
                        >
                          <button
                            className={`request-tree-item ${request.id === selectedRequestId ? "active" : ""} ${request.id === draggedRequestId ? "dragging" : ""} ${request.id === dragOverRequestId ? "drag-over" : ""}`}
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                "text/plain",
                                request.id,
                              );
                              onRequestDragStart(request.id);
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              onRequestDragOver(request.id);
                            }}
                            onDrop={(event) =>
                              onDropRequest(collection.id, request.id, event)
                            }
                            onDragEnd={onRequestDragEnd}
                            onClick={() => onSelectRequest(request)}
                          >
                            <span className="request-method">MQTT</span>
                            {isRequestModified(
                              request,
                              requestDrafts[request.id],
                            ) && (
                              <span
                                className="request-modified-dot"
                                aria-label="Modified"
                                title="Modified"
                              />
                            )}
                            <span className="request-tree-name">
                              {request.name}
                            </span>
                          </button>
                          <button
                            className="icon-button request-more-button"
                            aria-label="More request actions"
                            title="More request actions"
                            onClick={(event) => {
                              event.stopPropagation();
                              onRequestMenuToggle(
                                request.id,
                                event.currentTarget,
                              );
                            }}
                          >
                            ⋯
                          </button>
                        </div>
                      ))}
                      {collectionRequests.length === 0 && (
                        <small className="request-tree-empty">
                          No requests yet
                        </small>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}
