import { useEffect, useMemo, useRef, useState } from "react";
import { strFromU8, unzipSync } from "fflate";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { apiClient as client, createRealtimeSocket } from "./apis";
import {
  CollectionSidebar,
  PayloadEditor,
  QosSelect,
  ScrollArea,
  TopicAutocomplete,
  WorkspaceHeader,
} from "./components";
import {
  ConnectionsPage,
  ConsumersPage,
  PublishersPage,
  VariablesPage,
} from "./pages";
import {
  beautifyXml,
  emptyBrokerDraft,
  emptyDraft,
  formatTime,
  isRequestModified,
  joinTopics,
  mergeLogs,
  randomTopicColor,
  requestToDraft,
  toPrettyJson,
  topicMatches,
  jsonToXml,
  xmlToJson,
} from "./utilities";
import {
  BootstrapState,
  BrokerProfileRow,
  CollectionRow,
  ConsumerMessageEvent,
  ConsumerSessionRow,
  DraftRequest,
  VariableCollectionRow,
  MessageLogRow,
  RequestRow,
  CustomFunctionRow,
  PayloadFormat,
} from "./models";
import { useWorkspaceNavigation } from "./hooks";
import {
  WorkspaceProvider,
  type VariableDraftRow,
  type WorkspaceContextValue,
} from "./contexts";

type CollectionModal = "create" | "edit" | "import" | null;
type InactiveConsumerTopic = {
  key: string;
  topic: string;
  brokerProfileId: string;
  qos: number;
};
type DeleteConfirmation = {
  title: string;
  message: string;
  onConfirm: () => void | Promise<void>;
};
type CustomFunctionDraft = {
  id: string;
  name: string;
  description: string;
  value: string;
};

const builtinFunctionPreviewTokens = [
  { id: "now", template: '{"publishDate":"{{now:yyyy-MM-dd}}"}' },
  { id: "uuid", template: '{"requestId":"{{uuid}}"}' },
  { id: "sequence", template: '{"sequence":"{{sequence:1:6}}"}' },
] as const;

function inlinePreview(result: { text: string; json: unknown }) {
  if (result.json === null) return result.text;
  return JSON.stringify(result.json) ?? result.text;
}

function mergeConsumerSession(
  state: BootstrapState | null,
  session: ConsumerSessionRow,
) {
  if (!state) return state;
  const current = state.consumerSessions.find((item) => item.id === session.id);
  if (
    current &&
    current.topicsJson === session.topicsJson &&
    current.active === session.active &&
    current.qos === session.qos &&
    current.brokerProfileId === session.brokerProfileId
  ) {
    return state;
  }
  return {
    ...state,
    consumerSessions: [
      session,
      ...state.consumerSessions.filter((item) => item.id !== session.id),
    ],
  };
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [brokerStatuses, setBrokerStatuses] = useState<
    Array<{
      profileId: string;
      connected: boolean;
      refCount: number;
      lastError: string | null;
    }>
  >([]);
  const {
    mainTab,
    setMainTab,
    mainTabRef,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedRequestId,
    setSelectedRequestId,
    selectedVariableCollectionId,
    setSelectedVariableCollectionId,
    rightTab,
    setRightTab,
    connectionView,
    setConnectionView,
    connectionId,
    setConnectionId,
  } = useWorkspaceNavigation();
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<string[]>(
    () => {
      try {
        return JSON.parse(
          localStorage.getItem("mqtt.expandedCollections") ?? "[]",
        ) as string[];
      } catch {
        return [];
      }
    },
  );
  const [collectionModal, setCollectionModal] = useState<CollectionModal>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPending, setImportPending] = useState(false);
  const [importError, setImportError] = useState("");
  const [collectionMenuId, setCollectionMenuId] = useState<string | null>(null);
  const [requestMenuId, setRequestMenuId] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const discardControlRef = useRef<HTMLDivElement | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [favoriteCollectionIds, setFavoriteCollectionIds] = useState<string[]>(
    () => {
      try {
        return JSON.parse(
          localStorage.getItem("mqtt.favoriteCollections") ?? "[]",
        ) as string[];
      } catch {
        return [];
      }
    },
  );
  const [activeConnectionId, setActiveConnectionId] = useState<string>(
    () => localStorage.getItem("mqtt.activeConnectionId") ?? "",
  );
  const [draft, setDraft] = useState<DraftRequest>(emptyDraft());
  const [requestDrafts, setRequestDrafts] = useState<
    Record<string, DraftRequest>
  >({});
  const [batchCount, setBatchCount] = useState(1);
  const [batchDelayMs, setBatchDelayMs] = useState(0);
  const [consumerTopics, setConsumerTopics] = useState("device/+/status");
  const [consumerTopicColor, setConsumerTopicColor] = useState(
    () =>
      localStorage.getItem("mqtt.consumerTopicColor") ?? "#4fd1c5",
  );
  const [inactiveConsumerTopics, setInactiveConsumerTopics] = useState<
    InactiveConsumerTopic[]
  >(() => {
    try {
      return JSON.parse(
        localStorage.getItem("mqtt.inactiveConsumerTopics") ?? "[]",
      ) as InactiveConsumerTopic[];
    } catch {
      return [];
    }
  });
  const [consumerTopicOrder, setConsumerTopicOrder] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("mqtt.consumerTopicOrder") ?? "[]",
      ) as string[];
    } catch {
      return [];
    }
  });
  const [topicColors, setTopicColors] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("mqtt.topicColors") ?? "{}",
      ) as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [consumerQos, setConsumerQos] = useState(0);
  const [collectionDraft, setCollectionDraft] = useState({
    id: "",
    name: "",
    description: "",
  });
  const [draggedRequestId, setDraggedRequestId] = useState<string | null>(null);
  const [draggedCollectionId, setDraggedCollectionId] = useState<string | null>(null);
  const [dragOverRequestId, setDragOverRequestId] = useState<string | null>(null);
  const [dragOverCollectionId, setDragOverCollectionId] = useState<string | null>(null);
  const [variableCollectionDraft, setVariableCollectionDraft] = useState({
    id: "",
    name: "",
  });
  const [brokerDraft, setBrokerDraft] = useState(emptyBrokerDraft());
  const [connectionTestMessage, setConnectionTestMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [connectionTestPending, setConnectionTestPending] = useState(false);
  const [connectingBrokerId, setConnectingBrokerId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [customFunctionModal, setCustomFunctionModal] = useState(false);
  const [customFunctionDraft, setCustomFunctionDraft] = useState<CustomFunctionDraft>({
    id: "",
    name: "",
    description: "",
    value: "",
  });
  const [customFunctionError, setCustomFunctionError] = useState("");
  const [customFunctionPreviews, setCustomFunctionPreviews] = useState<
    Record<string, string>
  >({});
  const [builtinFunctionPreviews, setBuiltinFunctionPreviews] = useState<
    Record<string, string>
  >({});
  const [liveMessages, setLiveMessages] = useState<ConsumerMessageEvent[]>([]);
  const [visibleLiveMessageCount, setVisibleLiveMessageCount] = useState(25);
  const [unreadConsumerMessages, setUnreadConsumerMessages] = useState(0);
  const [historyLogs, setHistoryLogs] = useState<MessageLogRow[]>([]);
  const [watchConsumerLogs, setWatchConsumerLogs] = useState(
    () => localStorage.getItem("mqtt.watchConsumerLogs") !== "false",
  );
  const watchConsumerLogsRef = useRef(watchConsumerLogs);
  const consumerLogResumeAfterRef = useRef<number | null>(null);
  const pendingRealtimeLogsRef = useRef<MessageLogRow[]>([]);
  const pendingConsumerMessagesRef = useRef<ConsumerMessageEvent[]>([]);
  const realtimeFlushTimerRef = useRef<number | null>(null);
  const [error, setError] = useState<string>("");
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmation | null>(null);
  const [topicValidationError, setTopicValidationError] = useState(false);

  const mergeWatchedLogs = (
    current: MessageLogRow[],
    incoming: MessageLogRow[],
  ) => {
    const resumeAfter = consumerLogResumeAfterRef.current;
    const visibleIncoming = incoming.filter((log) => {
      if (log.direction !== "consume") return true;
      if (!watchConsumerLogsRef.current) return false;
      if (resumeAfter === null) return true;
      const createdAt = Date.parse(log.createdAt);
      return Number.isNaN(createdAt) || createdAt > resumeAfter;
    });
    return mergeLogs(current, visibleIncoming);
  };

  const flushRealtimeUpdates = () => {
    realtimeFlushTimerRef.current = null;

    const logs = pendingRealtimeLogsRef.current.splice(0);
    if (logs.length) {
      setHistoryLogs((current) => mergeWatchedLogs(current, logs));
    }

    const messages = pendingConsumerMessagesRef.current.splice(0);
    if (!messages.length) return;

    setLiveMessages((current) => {
      const next = [...messages.reverse(), ...current];
      const seenLogIds = new Set<string>();
      return next
        .filter((item) => {
          if (seenLogIds.has(item.log.id)) return false;
          seenLogIds.add(item.log.id);
          return true;
        })
        .slice(0, 999);
    });
    if (mainTabRef.current !== "consumers") {
      setUnreadConsumerMessages((current) => current + messages.length);
    }
  };

  const scheduleRealtimeFlush = () => {
    if (realtimeFlushTimerRef.current !== null) return;
    realtimeFlushTimerRef.current = window.setTimeout(
      flushRealtimeUpdates,
      100,
    );
  };

  const closeActionPopover = () => {
    setCollectionMenuId(null);
    setRequestMenuId(null);
    setPopoverPosition(null);
  };

  const getPopoverPosition = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const width = 150;
    return {
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    };
  };

  const refresh = async () => {
    const [data, statuses, fetchedLogs] = await Promise.all([
      client.bootstrap(),
      client.brokers.statuses(),
      client.logs.list(),
    ]);
    setBootstrap(data);
    setBrokerStatuses(statuses);
    setHistoryLogs((current) => mergeWatchedLogs(current, fetchedLogs));
    if (!selectedCollectionId && data.collections[0]) {
      setSelectedCollectionId(data.collections[0].id);
    }
    const connectedConnectionId =
      statuses.find(
        (status) =>
          status.connected &&
          data.brokers.some((broker) => broker.id === status.profileId),
      )?.profileId ?? "";
    const availableConnectionId = statuses.some(
      (status) => status.profileId === activeConnectionId && status.connected,
    )
      ? activeConnectionId
      : connectedConnectionId;
    if (!activeConnectionId || availableConnectionId !== activeConnectionId) {
      setActiveConnectionId(availableConnectionId);
    }
  };

  useEffect(() => {
    void refresh().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (rightTab !== "history") return;
    void client.logs
      .list()
      .then((fetchedLogs) =>
        setHistoryLogs((current) => mergeWatchedLogs(current, fetchedLogs)),
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Unable to load history"),
      );
  }, [rightTab]);

  useEffect(() => {
    mainTabRef.current = mainTab;
    if (mainTab === "consumers") setUnreadConsumerMessages(0);
  }, [mainTab]);

  useEffect(() => {
    localStorage.setItem(
      "mqtt.activeConnectionId",
      activeConnectionId,
    );
  }, [activeConnectionId]);

  useEffect(() => {
    localStorage.setItem(
      "mqtt.watchConsumerLogs",
      String(watchConsumerLogs),
    );
  }, [watchConsumerLogs]);

  useEffect(() => {
    if (!discardConfirmOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !discardControlRef.current?.contains(target)
      ) {
        setDiscardConfirmOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [discardConfirmOpen]);

  useEffect(() => {
    setDiscardConfirmOpen(false);
  }, [selectedRequestId]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    const timer = window.setTimeout(() => {
      ws = createRealtimeSocket();
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as
          | { type: "bootstrap"; payload: BootstrapState }
          | { type: "log.created"; payload: MessageLogRow }
          | { type: "consumer.updated"; payload: ConsumerSessionRow | null }
          | { type: "consumer.message"; payload: ConsumerMessageEvent }
          | { type: "broker.status"; payload: unknown };
        if (message.type === "bootstrap") {
          setBootstrap(message.payload);
          setHistoryLogs((current) => mergeWatchedLogs(current, message.payload.logs));
        }
        if (message.type === "log.created") {
          pendingRealtimeLogsRef.current.push(message.payload);
          scheduleRealtimeFlush();
        }
        if (message.type === "consumer.updated") {
          const current = message.payload;
          if (!current) return;
          setBootstrap((state) => mergeConsumerSession(state, current));
        }
        if (message.type === "consumer.message") {
          pendingConsumerMessagesRef.current.push(message.payload);
          scheduleRealtimeFlush();
        }
        if (message.type === "broker.status") {
          const status = message.payload as {
            profileId?: string;
            status?: string;
            error?: string;
          };
          const profileId = status.profileId;
          if (!profileId) return;
          setBrokerStatuses((current) =>
            current.some((item) => item.profileId === profileId)
              ? current.map((item) =>
                  item.profileId === profileId
                    ? {
                        ...item,
                        connected:
                          status.status === "connected"
                            ? true
                            : status.status === "closed" ||
                                status.status === "error"
                              ? false
                              : item.connected,
                        lastError:
                          status.status === "error"
                            ? status.error?.trim() || "Connection failed"
                            : status.status === "connected"
                              ? null
                              : item.lastError,
                      }
                    : item,
                )
              : [
                  {
                    profileId,
                    connected: status.status === "connected",
                    refCount: 0,
                    lastError:
                      status.status === "error"
                        ? status.error?.trim() || "Connection failed"
                        : null,
                  },
                ],
          );
        }
      };
      ws.onerror = () => setError("WebSocket connection failed");
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (realtimeFlushTimerRef.current !== null) {
        window.clearTimeout(realtimeFlushTimerRef.current);
      }
      ws?.close();
    };
  }, []);

  const collections = bootstrap?.collections ?? [];
  const variableCollections = bootstrap?.variableCollections ?? [];
  const variables = bootstrap?.variables ?? [];
  const brokers = bootstrap?.brokers ?? [];
  const customFunctions = bootstrap?.customFunctions ?? [];
  const consumerSessions = bootstrap?.consumerSessions ?? [];
  const logs = historyLogs;
  const publishLogCount = logs.filter(
    (log) => log.direction === "publish",
  ).length;
  const consumeLogCount = logs.filter(
    (log) => log.direction === "consume",
  ).length;
  const allTopics = useMemo(
    () =>
      [
        ...new Set(
          (bootstrap?.requests ?? [])
            .map((request) => request.topic.trim())
            .filter(Boolean),
        ),
      ].sort(),
    [bootstrap?.requests],
  );
  const getTopicColor = (topic: string) =>
    Object.entries(topicColors).find(([filter]) =>
      topicMatches(filter, topic),
    )?.[1] ?? "rgba(79, 209, 197, 0.5)";
  const activeTopicKeys = new Set(
    consumerSessions.flatMap((session) =>
      (JSON.parse(session.topicsJson) as string[]).map(
        (topic) => `${session.brokerProfileId}:${topic}`,
      ),
    ),
  );
  const activeConnection =
    brokers.find((broker) => broker.id === activeConnectionId) ?? null;
  const activeConnectionStatus = brokerStatuses.find(
    (status) => status.profileId === activeConnectionId,
  );
  const selectedRequestRecord = bootstrap?.requests.find(
    (request) => request.id === selectedRequestId,
  );
  const selectedRequestModified = isRequestModified(
    selectedRequestRecord,
    draft,
  );
  const fallbackConnectionId = activeConnectionId || brokers[0]?.id || "";
  const sortedCollections = useMemo(
    () =>
      [...collections].sort(
        (left, right) =>
          Number(favoriteCollectionIds.includes(right.id)) -
          Number(favoriteCollectionIds.includes(left.id)),
      ),
    [collections, favoriteCollectionIds],
  );

  useEffect(() => {
    const draftId = draft.id;
    if (draftId) {
      setRequestDrafts((current) =>
        current[draftId] === draft
          ? current
          : { ...current, [draftId]: draft },
      );
    }
  }, [draft]);

  useEffect(() => {
    if (!bootstrap || !selectedRequestId) return;
    const request = bootstrap.requests.find(
      (item) => item.id === selectedRequestId,
    );
    if (!request) return;
    if (selectedCollectionId !== request.collectionId) {
      setSelectedCollectionId(request.collectionId);
    }
    if (draft.id !== request.id) {
      setDraft(requestDrafts[request.id] ?? requestToDraft(request));
    }
  }, [
    bootstrap,
    draft.id,
    requestDrafts,
    selectedCollectionId,
    selectedRequestId,
  ]);

  const selectedCollection = collections.find(
    (collection) => collection.id === selectedCollectionId,
  );
  const payloadEditorLanguage =
    draft.payloadFormat === "raw" ? "plaintext" : draft.payloadFormat;

  const changePayloadFormat = (format: PayloadFormat) => {
    setDraft((current) => {
      if (current.payloadFormat === format) return current;
      try {
        const payloadTemplate = format === "xml" && current.payloadFormat !== "xml"
          ? jsonToXml(current.payloadTemplate)
          : format === "json" && current.payloadFormat !== "json"
            ? xmlToJson(current.payloadTemplate)
            : current.payloadTemplate;
        return { ...current, payloadFormat: format, payloadTemplate };
      } catch (error) {
        toast.error(
          `Cannot convert ${current.payloadFormat.toUpperCase()} to ${format.toUpperCase()}: ${error instanceof Error ? error.message : "invalid payload"}`,
        );
        return current;
      }
    });
  };
  const payloadEditorVariables = selectedCollection?.variableCollectionId
    ? variables
        .filter(
          (variable) =>
            String(variable.variableCollectionId) ===
            String(selectedCollection.variableCollectionId),
        )
        .map((variable) => ({ name: variable.name, value: variable.value }))
    : [];
  const payloadEditorCustomFunctions = customFunctions.map((customFunction) => ({
    name: customFunction.name,
    description: customFunction.description,
    value: customFunction.value,
  }));

  useEffect(() => {
    let cancelled = false;
    if (!bootstrap) return () => {
      cancelled = true;
    };
    if (customFunctions.length === 0) {
      setCustomFunctionPreviews({});
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      customFunctions.map(async (customFunction) => {
        try {
          const resolved = await client.resolveTemplate({
            template: JSON.stringify({ custom: `{{${customFunction.name}}}` }),
            variableCollectionId: selectedCollection?.variableCollectionId ?? null,
            variables: {},
          });
          return [customFunction.id, inlinePreview(resolved)] as const;
        } catch (err) {
          return [
            customFunction.id,
            err instanceof Error ? err.message : "Unable to render preview",
          ] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setCustomFunctionPreviews(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [bootstrap?.customFunctions, selectedCollection?.variableCollectionId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      builtinFunctionPreviewTokens.map(async ({ id, template }) => {
        try {
          const resolved = await client.resolveTemplate({
            template,
            variableCollectionId: selectedCollection?.variableCollectionId ?? null,
            variables: {},
          });
          return [id, inlinePreview(resolved)] as const;
        } catch (err) {
          return [
            id,
            err instanceof Error ? err.message : "Unable to render preview",
          ] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setBuiltinFunctionPreviews(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCollection?.variableCollectionId]);

  const updateCollectionVariables = async (variableCollectionId: string) => {
    if (!selectedCollection) return;
    setBootstrap((current) =>
      current
        ? {
            ...current,
            collections: current.collections.map((collection) =>
              collection.id === selectedCollection.id
                ? { ...collection, variableCollectionId: variableCollectionId || null }
                : collection,
            ),
          }
        : current,
    );
    try {
      await client.collections.update(selectedCollection.id, {
        name: selectedCollection.name,
        description: selectedCollection.description,
        variableCollectionId: variableCollectionId || null,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update Variables");
      await refresh();
    }
  };

  useEffect(() => {
    if (selectedCollection) {
      setCollectionDraft({
        id: selectedCollection.id,
        name: selectedCollection.name,
        description: selectedCollection.description ?? "",
      });
    } else {
      setCollectionDraft({ id: "", name: "", description: "" });
    }
  }, [selectedCollection]);

  const selectCollection = (collection: CollectionRow) => {
    setSelectedCollectionId(collection.id);
    setExpandedCollectionIds((current) => {
      if (current.includes(collection.id)) return current;
      const next = [...current, collection.id];
      localStorage.setItem(
        "mqtt.expandedCollections",
        JSON.stringify(next),
      );
      return next;
    });
    setSelectedRequestId("");
    setDraft(
      emptyDraft(
        collection.id,
        fallbackConnectionId,
      ),
    );
  };

  const toggleCollection = (collectionId: string) => {
    setExpandedCollectionIds((current) => {
      const next = current.includes(collectionId)
        ? current.filter((id) => id !== collectionId)
        : [...current, collectionId];
      localStorage.setItem(
        "mqtt.expandedCollections",
        JSON.stringify(next),
      );
      return next;
    });
  };

  const selectRequest = (request: RequestRow) => {
    const draftId = draft.id;
    if (draftId) {
      setRequestDrafts((current) => ({ ...current, [draftId]: draft }));
    }
    setSelectedCollectionId(request.collectionId);
    setSelectedRequestId(request.id);
    setTopicValidationError(false);
    setDraft(requestDrafts[request.id] ?? requestToDraft(request));
    setMainTab("publishers");
  };

  const saveCollection = async () => {
    if (!collectionDraft.name.trim()) return;
    const saved = collectionDraft.id
      ? await client.collections.update(collectionDraft.id, {
          name: collectionDraft.name,
          description: collectionDraft.description,
        })
      : await client.collections.create({
          name: collectionDraft.name,
          description: collectionDraft.description,
        });
    await refresh();
    setSelectedCollectionId(saved.id);
    setCollectionModal(null);
  };

  const openImportCollection = () => {
    setImportFile(null);
    setImportError("");
    setCollectionDraft({ id: "", name: "", description: "" });
    setCollectionModal("import");
  };

  const closeCollectionModal = () => {
    if (importPending) return;
    setCollectionModal(null);
    setImportFile(null);
    setImportError("");
  };

  const readImportFile = async (file: File) => {
    setImportFile(file);
    setImportError("");
    const fallbackName = file.name.replace(/\.zip$/i, "").trim() || "Imported collection";
    setCollectionDraft({ id: "", name: fallbackName, description: "" });
    try {
      const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const manifest = files["collection.json"];
      if (!manifest) return;
      const value: unknown = JSON.parse(strFromU8(manifest));
      if (typeof value !== "object" || value === null || Array.isArray(value)) return;
      const record = value as Record<string, unknown>;
      setCollectionDraft({
        id: "",
        name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : fallbackName,
        description: typeof record.description === "string" ? record.description : "",
      });
    } catch {
      setImportError("Unable to read ZIP metadata. The server will validate the selected file.");
    }
  };

  const importCollection = async () => {
    if (!importFile || !collectionDraft.name.trim()) return;
    setImportPending(true);
    setImportError("");
    try {
      const result = await client.collections.import(
        importFile,
        collectionDraft.name.trim(),
        collectionDraft.description,
      );
      await refresh();
      setSelectedCollectionId(result.collection.id);
      setSelectedRequestId("");
      setExpandedCollectionIds((current) => {
        const next = current.includes(result.collection.id)
          ? current
          : [...current, result.collection.id];
        localStorage.setItem("mqtt.expandedCollections", JSON.stringify(next));
        return next;
      });
      setCollectionModal(null);
      setImportFile(null);
      toast.success(`Imported collection "${result.collection.name}".`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Unable to import collection");
    } finally {
      setImportPending(false);
    }
  };

  const exportCollection = async (collection: CollectionRow) => {
    try {
      const blob = await client.collections.export(collection.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${collection.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-") || "collection"}.mqtt-postgirl.zip`;
      link.click();
      URL.revokeObjectURL(url);
      closeActionPopover();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to export collection");
    }
  };

  const deleteCollection = async (collection?: CollectionRow) => {
    const collectionId = collection?.id ?? collectionDraft.id;
    if (!collectionId) return;
    await client.collections.remove(collectionId);
    setFavoriteCollectionIds((current) => {
      const next = current.filter((id) => id !== collectionId);
      localStorage.setItem(
        "mqtt.favoriteCollections",
        JSON.stringify(next),
      );
      return next;
    });
    if (selectedCollectionId === collectionId) {
      setSelectedCollectionId("");
      setSelectedRequestId("");
    }
    setExpandedCollectionIds((current) => {
      const next = current.filter((id) => id !== collectionId);
      localStorage.setItem(
        "mqtt.expandedCollections",
        JSON.stringify(next),
      );
      return next;
    });
    setCollectionMenuId(null);
    await refresh();
    setCollectionModal(null);
  };

  const duplicateCollection = async (collection: CollectionRow) => {
    try {
      const duplicated = await client.collections.duplicate(collection.id);
      await refresh();
      setBootstrap((current) => {
        if (!current) return current;
        const nextCollections = current.collections.filter(
          (item) => item.id !== duplicated.collection.id,
        );
        const sourceIndex = nextCollections.findIndex(
          (item) => item.id === collection.id,
        );
        nextCollections.splice(
          sourceIndex >= 0 ? sourceIndex + 1 : nextCollections.length,
          0,
          duplicated.collection,
        );
        return { ...current, collections: nextCollections };
      });
      selectCollection(duplicated.collection);
      setCollectionMenuId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to duplicate collection");
    }
  };

  const reorderCollectionRequests = async (
    collectionId: string,
    requestIds: string[],
  ) => {
    try {
      await client.requests.reorder(collectionId, requestIds);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reorder requests");
    } finally {
      setDraggedRequestId(null);
      setDragOverRequestId(null);
      setDragOverCollectionId(null);
    }
  };

  const sortCollectionRequests = async (collection: CollectionRow) => {
    const requests = (bootstrap?.requests ?? []).filter(
      (request) => request.collectionId === collection.id,
    );
    const sortedIds = [...requests]
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
          numeric: true,
        }),
      )
      .map((request) => request.id);
    setCollectionMenuId(null);
    if (sortedIds.length > 1) {
      await reorderCollectionRequests(collection.id, sortedIds);
    }
  };

  const dropRequest = (
    collectionId: string,
    targetRequestId: string,
    event: React.DragEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    const sourceRequestId =
      draggedRequestId ?? event.dataTransfer.getData("text/plain");
    setDragOverRequestId(null);
    if (!sourceRequestId || sourceRequestId === targetRequestId) {
      setDraggedRequestId(null);
      return;
    }
    const requests = (bootstrap?.requests ?? []).filter(
      (request) => request.collectionId === collectionId,
    );
    const sourceRequest = (bootstrap?.requests ?? []).find(
      (request) => request.id === sourceRequestId,
    );
    if (!sourceRequest) {
      setDraggedRequestId(null);
      return;
    }
    const insertionIndex = requests.findIndex(
      (request) => request.id === targetRequestId,
    );
    if (sourceRequest.collectionId !== collectionId) {
      void moveRequestToCollection(
        sourceRequestId,
        collectionId,
        insertionIndex < 0 ? requests.length : insertionIndex,
      );
      return;
    }
    const reordered = [...requests];
    const sourceIndex = reordered.findIndex(
      (request) => request.id === sourceRequestId,
    );
    const targetIndex = reordered.findIndex(
      (request) => request.id === targetRequestId,
    );
    if (sourceIndex < 0 || targetIndex < 0) {
      setDraggedRequestId(null);
      return;
    }
    const [moved] = reordered.splice(sourceIndex, 1);
    if (!moved) {
      setDraggedRequestId(null);
      return;
    }
    reordered.splice(targetIndex, 0, moved);
    void reorderCollectionRequests(
      collectionId,
      reordered.map((request) => request.id),
    );
  };

  const moveRequestToCollection = async (
    requestId: string,
    targetCollectionId: string,
    targetIndex?: number,
  ) => {
    const sourceRequest = (bootstrap?.requests ?? []).find(
      (request) => request.id === requestId,
    );
    if (!sourceRequest || sourceRequest.collectionId === targetCollectionId) {
      setDraggedRequestId(null);
      setDragOverCollectionId(null);
      return;
    }

    const targetRequests = (bootstrap?.requests ?? []).filter(
      (request) => request.collectionId === targetCollectionId,
    );
    const targetRequestIds = targetRequests.map((request) => request.id);
    targetRequestIds.splice(targetIndex ?? targetRequestIds.length, 0, requestId);

    try {
      await client.requests.update(requestId, {
        ...sourceRequest,
        collectionId: targetCollectionId,
        retain: Boolean(sourceRequest.retain),
      });
      await client.requests.reorder(targetCollectionId, targetRequestIds);
      await refresh();
      setRequestDrafts((current) => {
        const movedDraft = current[requestId];
        if (!movedDraft) return current;
        return {
          ...current,
          [requestId]: {
            ...movedDraft,
            collectionId: targetCollectionId,
          },
        };
      });
      setDraft((current) =>
        current.id === requestId
          ? { ...current, collectionId: targetCollectionId }
          : current,
      );
      setSelectedCollectionId(targetCollectionId);
      setSelectedRequestId(requestId);
      setExpandedCollectionIds((current) => {
        if (current.includes(targetCollectionId)) return current;
        const next = [...current, targetCollectionId];
        localStorage.setItem(
          "mqtt.expandedCollections",
          JSON.stringify(next),
        );
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to move request");
    } finally {
      setDraggedRequestId(null);
      setDragOverRequestId(null);
      setDragOverCollectionId(null);
    }
  };

  const dropRequestOnCollection = (
    collectionId: string,
    event: React.DragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedCollectionId) {
      void reorderCollections(draggedCollectionId, collectionId);
      return;
    }
    const sourceRequestId =
      draggedRequestId ?? event.dataTransfer.getData("text/plain");
    if (sourceRequestId) {
      void moveRequestToCollection(sourceRequestId, collectionId);
    }
  };

  const reorderCollections = async (
    sourceCollectionId: string,
    targetCollectionId: string,
  ) => {
    setDragOverCollectionId(null);
    if (sourceCollectionId === targetCollectionId) {
      setDraggedCollectionId(null);
      return;
    }

    const reordered = [...sortedCollections];
    const sourceIndex = reordered.findIndex(
      (collection) => collection.id === sourceCollectionId,
    );
    const targetIndex = reordered.findIndex(
      (collection) => collection.id === targetCollectionId,
    );
    if (sourceIndex < 0 || targetIndex < 0) {
      setDraggedCollectionId(null);
      return;
    }
    const [moved] = reordered.splice(sourceIndex, 1);
    if (!moved) {
      setDraggedCollectionId(null);
      return;
    }
    reordered.splice(targetIndex, 0, moved);

    try {
      await client.collections.reorder(reordered.map((collection) => collection.id));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reorder collections");
    } finally {
      setDraggedCollectionId(null);
      setDragOverCollectionId(null);
    }
  };

  const openCreateCollection = () => {
    setCollectionDraft({ id: "", name: "", description: "" });
    setCollectionMenuId(null);
    setCollectionModal("create");
  };

  const openEditCollection = (collection: CollectionRow) => {
    setCollectionDraft({
      id: collection.id,
      name: collection.name,
      description: collection.description ?? "",
    });
    setCollectionMenuId(null);
    setCollectionModal("edit");
  };

  const askDeleteConfirmation = (
    title: string,
    message: string,
    onConfirm: () => void | Promise<void>,
  ) => {
    setDeleteConfirmation({ title, message, onConfirm });
  };

  const confirmDelete = async () => {
    if (!deleteConfirmation) return;
    const { onConfirm } = deleteConfirmation;
    setDeleteConfirmation(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete");
    }
  };

  const addRequestToCollection = async (collection: CollectionRow) => {
    selectCollection(collection);
    const { id: _draftId, ...newRequestPayload } = emptyDraft(
      collection.id,
      fallbackConnectionId,
    );
    const saved = await client.requests.create({
      ...newRequestPayload,
      name: "New Request",
      brokerProfileId: newRequestPayload.brokerProfileId || null,
    });
    await refresh();
    setSelectedCollectionId(collection.id);
    setSelectedRequestId(saved.id);
    setTopicValidationError(false);
    setDraft(requestToDraft(saved));
    setCollectionMenuId(null);
  };

  const toggleFavoriteCollection = (collectionId: string) => {
    setFavoriteCollectionIds((current) => {
      const next = current.includes(collectionId)
        ? current.filter((id) => id !== collectionId)
        : [collectionId, ...current];
      localStorage.setItem(
        "mqtt.favoriteCollections",
        JSON.stringify(next),
      );
      return next;
    });
    setCollectionMenuId(null);
  };

  const saveRequest = async () => {
    if (!draft.collectionId) return;
    const payload = {
      ...draft,
      brokerProfileId: draft.brokerProfileId || null,
    };
    const saved = draft.id
      ? await client.requests.update(draft.id, payload)
      : await client.requests.create(payload);
    await refresh();
    setSelectedRequestId(saved.id);
    setDraft(requestToDraft(saved));
    setRequestDrafts((current) => {
      const next = { ...current };
      delete next[saved.id];
      return next;
    });
    setDiscardConfirmOpen(false);
  };

  const discardRequestChanges = () => {
    if (!selectedRequestRecord) return;
    setDraft(requestToDraft(selectedRequestRecord));
    setRequestDrafts((current) => {
      const next = { ...current };
      delete next[selectedRequestRecord.id];
      return next;
    });
    setTopicValidationError(false);
    setDiscardConfirmOpen(false);
  };

  const deleteRequest = async () => {
    if (!draft.id) return;
    await client.requests.remove(draft.id);
    await refresh();
    setSelectedRequestId("");
    setRequestDrafts((current) => {
      const next = { ...current };
      const draftId = draft.id;
      if (draftId) delete next[draftId];
      return next;
    });
    setDraft(
      emptyDraft(
        selectedCollectionId,
        fallbackConnectionId,
      ),
    );
  };

  const deleteRequestById = async (requestId: string) => {
    await client.requests.remove(requestId);
    setRequestDrafts((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
    if (selectedRequestId === requestId) {
      setSelectedRequestId("");
      setDraft(
        emptyDraft(
          selectedCollectionId,
          fallbackConnectionId,
        ),
      );
    }
    setRequestMenuId(null);
    await refresh();
  };

  const duplicateRequest = async (request: RequestRow) => {
    try {
      const duplicated = await client.requests.create({
        collectionId: request.collectionId,
        name: `${request.name} Copy`,
        topic: request.topic,
        payloadTemplate: request.payloadTemplate,
        payloadFormat: request.payloadFormat,
        qos: request.qos,
        retain: Boolean(request.retain),
        brokerProfileId: request.brokerProfileId,
      });
      const collectionRequests = (bootstrap?.requests ?? []).filter(
        (item) => item.collectionId === request.collectionId,
      );
      const requestIds = collectionRequests.map((item) => item.id);
      const sourceIndex = requestIds.indexOf(request.id);
      requestIds.splice(sourceIndex < 0 ? requestIds.length : sourceIndex + 1, 0, duplicated.id);
      await client.requests.reorder(request.collectionId, requestIds);
      await refresh();
      setSelectedCollectionId(request.collectionId);
      setSelectedRequestId(duplicated.id);
      setDraft(requestToDraft(duplicated));
      setRequestMenuId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to duplicate request");
    }
  };

  const publishRequest = async () => {
    const trimmedTopic = draft.topic.trim();
    const hasConnectedBroker = Boolean(
      activeConnectionId &&
      brokerStatuses.some(
        (status) => status.profileId === activeConnectionId && status.connected,
      ),
    );
    const hasTopic = Boolean(trimmedTopic);
    const hasNullCharacter = draft.topic.includes("\u0000");
    const hasPublishWildcard = draft.topic.includes("+") || draft.topic.includes("#");
    setTopicValidationError(!hasTopic || hasNullCharacter || hasPublishWildcard);
    if (!hasTopic) {
      toast.error("Enter a topic before publishing.");
      return;
    }
    if (hasNullCharacter) {
      toast.error("Publish topic must not contain the NULL character.");
      return;
    }
    if (hasPublishWildcard) {
      toast.error("Publish topic must not contain MQTT wildcards (+ or #).");
      return;
    }
    if (!hasConnectedBroker) {
      toast.error("Connect to a broker before publishing.");
      return;
    }
    const result = await client.batchPublish({
      requestId: draft.id,
      brokerProfileId: activeConnectionId,
      topic: draft.topic,
      payloadTemplate: draft.payloadTemplate,
      count: batchCount,
      delayMs: batchDelayMs,
      qos: draft.qos,
      retain: draft.retain,
      variables: {},
    });
    const publishedLogs = result.results
      .filter((item) => item.ok && item.log)
      .map((item) => item.log);
    if (publishedLogs.length) {
      setHistoryLogs((current) => mergeWatchedLogs(current, publishedLogs));
      setBootstrap((current) =>
        current
          ? { ...current, logs: mergeLogs(current.logs, publishedLogs) }
          : current,
      );
    }
    const fetchedLogs = await client.logs.list();
    setHistoryLogs((current) => mergeWatchedLogs(current, fetchedLogs));
    setBootstrap((current) =>
      current ? { ...current, logs: mergeLogs(current.logs, fetchedLogs) } : current,
    );
  };

  const clearHistory = async () => {
    await client.logs.clear();
    setHistoryLogs([]);
    setBootstrap((current) => (current ? { ...current, logs: [] } : current));
  };

  const addConsumerTopicsToOrder = (brokerProfileId: string, topics: string[]) => {
    setConsumerTopicOrder((current) => {
      const next = [...current];
      for (const topic of topics) {
        const key = `${brokerProfileId}:${topic}`;
        if (!next.includes(key)) next.push(key);
      }
      localStorage.setItem(
        "mqtt.consumerTopicOrder",
        JSON.stringify(next),
      );
      return next;
    });
  };

  const preserveConsumerTopicOrder = () => {
    const activeKeys = consumerSessions.flatMap((session) =>
      (JSON.parse(session.topicsJson) as string[]).map(
        (topic) => `${session.brokerProfileId}:${topic}`,
      ),
    );
    const knownKeys = [...activeKeys, ...inactiveConsumerTopics.map((item) => item.key)];
    setConsumerTopicOrder((current) => {
      const next = [
        ...current.filter((key) => knownKeys.includes(key)),
        ...knownKeys.filter((key) => !current.includes(key)),
      ].filter((key, index, keys) => keys.indexOf(key) === index);
      localStorage.setItem(
        "mqtt.consumerTopicOrder",
        JSON.stringify(next),
      );
      return next;
    });
  };

  const updateConsumerSession = (session: ConsumerSessionRow) => {
    setBootstrap((current) => mergeConsumerSession(current, session));
  };

  const clearLiveMessages = () => {
    pendingConsumerMessagesRef.current = [];
    setLiveMessages([]);
    setVisibleLiveMessageCount(25);
  };

  const loadMoreLiveMessages = () => {
    setVisibleLiveMessageCount((current) => current + 25);
  };

  const startConsumer = async () => {
    const topics = joinTopics(consumerTopics);
    const targetBroker = activeConnectionId;
    const hasConnectedBroker = Boolean(
      targetBroker &&
      brokerStatuses.some(
        (status) => status.profileId === targetBroker && status.connected,
      ),
    );
    if (!hasConnectedBroker) {
      toast.error("Connect to a broker before subscribing.");
      return;
    }
    if (!topics.length) {
      toast.error("Enter at least one topic.");
      return;
    }
    try {
      const session = await client.consumers.create({
        name: "consumer",
        brokerProfileId: targetBroker,
        topics,
        qos: consumerQos,
      });
      updateConsumerSession(session);
      addConsumerTopicsToOrder(targetBroker, topics);
      setTopicColors((current) => {
        const next = { ...current };
        for (const topic of topics) next[topic] = consumerTopicColor;
        localStorage.setItem(
          "mqtt.topicColors",
          JSON.stringify(next),
        );
        return next;
      });
      setConsumerTopics("");
      const nextColor = randomTopicColor();
      setConsumerTopicColor(nextColor);
      localStorage.setItem("mqtt.consumerTopicColor", nextColor);
      setInactiveConsumerTopics((current) => {
        const next = current.filter(
          (item) =>
            item.brokerProfileId !== targetBroker ||
            !topics.includes(item.topic),
        );
        localStorage.setItem(
          "mqtt.inactiveConsumerTopics",
          JSON.stringify(next),
        );
        return next;
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to subscribe",
      );
    }
  };

  const unsubscribeTopic = async (sessionId: string, topic: string) => {
    try {
      const session = consumerSessions.find((item) => item.id === sessionId);
      if (!session) return;
      preserveConsumerTopicOrder();
      const updatedSession = await client.consumers.unsubscribe(sessionId, topic);
      if (updatedSession) updateConsumerSession(updatedSession);
      setInactiveConsumerTopics((current) => {
        const item = {
          key: `${session.brokerProfileId}:${topic}`,
          topic,
          brokerProfileId: session.brokerProfileId,
          qos: session.qos,
        };
        const next = [
          ...current.filter((entry) => entry.key !== item.key),
          item,
        ];
        localStorage.setItem(
          "mqtt.inactiveConsumerTopics",
          JSON.stringify(next),
        );
        return next;
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to unsubscribe",
      );
    }
  };

  const subscribeSavedTopic = async (item: InactiveConsumerTopic) => {
    try {
      const targetBroker = activeConnectionId;
      const hasConnectedBroker = Boolean(
        targetBroker &&
        brokerStatuses.some(
          (status) => status.profileId === targetBroker && status.connected,
        ),
      );
      if (!hasConnectedBroker) {
        toast.error("Connect to a broker before subscribing.");
        return;
      }
      const session = await client.consumers.create({
        name: "consumer",
        brokerProfileId: targetBroker,
        topics: [item.topic],
        qos: item.qos,
      });
      updateConsumerSession(session);
      addConsumerTopicsToOrder(targetBroker, [item.topic]);
      setTopicColors((current) => {
        const next = { ...current, [item.topic]: getTopicColor(item.topic) };
        localStorage.setItem(
          "mqtt.topicColors",
          JSON.stringify(next),
        );
        return next;
      });
      setInactiveConsumerTopics((current) => {
        const next = current.filter((entry) => entry.key !== item.key);
        localStorage.setItem(
          "mqtt.inactiveConsumerTopics",
          JSON.stringify(next),
        );
        return next;
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to subscribe",
      );
    }
  };

  const deleteSavedTopic = (key: string) => {
    setInactiveConsumerTopics((current) => {
      const next = current.filter((item) => item.key !== key);
      localStorage.setItem(
        "mqtt.inactiveConsumerTopics",
        JSON.stringify(next),
      );
      return next;
    });
    setConsumerTopicOrder((current) => {
      const next = current.filter((item) => item !== key);
      localStorage.setItem(
        "mqtt.consumerTopicOrder",
        JSON.stringify(next),
      );
      return next;
    });
  };

  const selectVariableCollection = (collection: VariableCollectionRow) => {
    setSelectedVariableCollectionId(collection.id);
    setVariableCollectionDraft({ id: collection.id, name: collection.name });
  };

  const openNewVariableCollection = () => {
    setSelectedVariableCollectionId("");
    setVariableCollectionDraft({ id: "", name: "" });
  };

  const saveVariableCollection = async () => {
    if (!variableCollectionDraft.name.trim()) return undefined;
    const saved = variableCollectionDraft.id
      ? await client.variableCollections.update(variableCollectionDraft.id, {
          name: variableCollectionDraft.name.trim(),
        })
      : await client.variableCollections.create({
          name: variableCollectionDraft.name.trim(),
        });
    await refresh();
    setSelectedVariableCollectionId(saved.id);
    setVariableCollectionDraft({ id: saved.id, name: saved.name });
    return saved.id;
  };

  const deleteVariableCollection = async () => {
    if (!variableCollectionDraft.id) return;
    await client.variableCollections.remove(variableCollectionDraft.id);
    setSelectedVariableCollectionId("");
    setVariableCollectionDraft({ id: "", name: "" });
    await refresh();
  };

  const saveVariables = async (collectionId: string, rows: VariableDraftRow[]) => {
    const currentRows = variables.filter(
      (variable) => variable.variableCollectionId === collectionId,
    );
    const draftRows = rows.filter((row) => row.name.trim() || row.value);
    const draftIds = new Set(draftRows.map((row) => row.id).filter(Boolean));
    for (const variable of currentRows) {
      if (!draftIds.has(variable.id)) {
        await client.variableCollections.removeVariable(variable.id);
      }
    }
    const persistedIds: string[] = [];
    for (const row of draftRows) {
      if (row.id) {
        const saved = await client.variableCollections.updateVariable(row.id, {
          name: row.name.trim(),
          value: row.value,
        });
        persistedIds.push(saved.id);
      } else {
        const saved = await client.variableCollections.createVariable(collectionId, {
          name: row.name.trim(),
          value: row.value,
        });
        persistedIds.push(saved.id);
      }
    }
    await client.variableCollections.reorderVariables(collectionId, persistedIds);
    await refresh();
  };

  const saveBroker = async () => {
    setConnectionTestMessage(null);
    const { id: brokerId, ...brokerPayload } = brokerDraft;
    const payload = {
      ...brokerPayload,
      name: brokerDraft.name,
      validateCertificate: Boolean(brokerDraft.validateCertificate),
      encryption: Boolean(brokerDraft.encryption),
      username: brokerDraft.username || null,
      password: brokerDraft.password || null,
      clientId: brokerDraft.clientId || `mqtt-postwoman-${Date.now()}`,
      caCert: brokerDraft.caCert || null,
      clientCert: brokerDraft.clientCert || null,
      clientKey: brokerDraft.clientKey || null,
    };
    if (brokerId) {
      await client.brokers.update(brokerId, payload);
    } else {
      await client.brokers.create(payload);
    }
    await refresh();
    setConnectionView("list");
    setConnectionId("");
  };

  const connectBroker = async (brokerId: string) => {
    if (connectingBrokerId) return;
    setError("");
    setConnectingBrokerId(brokerId);
    try {
      const activeConsumerSessionIds = consumerSessions
        .filter((session) => Boolean(session.active))
        .map((session) => session.id);
      await Promise.all(
        activeConsumerSessionIds.map((sessionId) =>
          client.consumers.remove(sessionId),
        ),
      );
      const otherConnectedIds = brokerStatuses
        .filter((status) => status.connected && status.profileId !== brokerId)
        .map((status) => status.profileId);
      await Promise.all(
        otherConnectedIds.map((profileId) =>
          client.brokers.disconnect(profileId),
        ),
      );
      setActiveConnectionId("");
      const status = await client.brokers.connect(brokerId);
      await refresh();
      if (status.connected) {
        setActiveConnectionId(brokerId);
      } else {
        toast.error(
          status.lastError?.trim() || "Unable to connect to MQTT broker",
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error && err.message.trim()
          ? err.message
          : "Unable to connect to MQTT broker",
      );
    } finally {
      setConnectingBrokerId("");
    }
  };

  const testBroker = async () => {
    setError("");
    setConnectionTestMessage(null);
    setConnectionTestPending(true);
    try {
      const { id: _brokerId, ...brokerPayload } = brokerDraft;
      await client.brokers.test({
        ...brokerPayload,
        name: brokerDraft.name,
        validateCertificate: Boolean(brokerDraft.validateCertificate),
        encryption: Boolean(brokerDraft.encryption),
        username: brokerDraft.username || null,
        password: brokerDraft.password || null,
        clientId: brokerDraft.clientId || undefined,
        caCert: brokerDraft.caCert || null,
        clientCert: brokerDraft.clientCert || null,
        clientKey: brokerDraft.clientKey || null,
      });
      setConnectionTestMessage({
        type: "success",
        text: "Test connection succeeded.",
      });
    } catch (err) {
      setConnectionTestMessage({
        type: "error",
        text:
          err instanceof Error && err.message.trim()
            ? err.message
            : "Unable to test connection",
      });
    } finally {
      setConnectionTestPending(false);
    }
  };

  const openNewConnection = () => {
    setBrokerDraft(emptyBrokerDraft());
    setConnectionTestMessage(null);
    setShowPassword(false);
    setConnectionId("");
    setConnectionView("form");
  };

  const openEditConnection = (broker: BrokerProfileRow) => {
    setConnectionTestMessage(null);
    setShowPassword(false);
    setBrokerDraft({
      id: broker.id,
      name: broker.name,
      host: broker.host,
      port: broker.port,
      protocol:
        broker.protocol === "ws" || broker.protocol === "wss" ? "ws" : "mqtt",
      validateCertificate: Boolean(broker.validateCertificate),
      encryption:
        Boolean(broker.encryption) ||
        broker.protocol === "mqtts" ||
        broker.protocol === "wss",
      username: broker.username ?? "",
      password: broker.password ?? "",
      clientId: broker.clientId,
      clean: Boolean(broker.clean),
      keepAlive: broker.keepAlive,
      reconnectPeriod: broker.reconnectPeriod,
      caCert: broker.caCert ?? "",
      clientCert: broker.clientCert ?? "",
      clientKey: broker.clientKey ?? "",
    });
    setConnectionId(broker.id);
    setConnectionView("form");
  };

  useEffect(() => {
    if (
      mainTab !== "connections" ||
      connectionView !== "form" ||
      !connectionId ||
      !bootstrap ||
      brokerDraft.id === connectionId
    ) {
      return;
    }
    const broker = brokers.find((item) => item.id === connectionId);
    if (broker) {
      openEditConnection(broker);
      return;
    }
    setConnectionView("list");
  }, [
    bootstrap,
    brokerDraft.id,
    brokers,
    connectionId,
    connectionView,
    mainTab,
  ]);

  const cancelConnectionForm = () => {
    setConnectionView("list");
    setConnectionId("");
    setBrokerDraft(emptyBrokerDraft());
    setConnectionTestMessage(null);
    setShowPassword(false);
  };

  const disconnectBroker = async (brokerId: string) => {
    await client.brokers.disconnect(brokerId);
    if (activeConnectionId === brokerId) {
      setActiveConnectionId("");
    }
    await refresh();
  };

  const deleteBroker = async () => {
    if (!brokerDraft.id) return;
    await client.brokers.remove(brokerDraft.id);
    await refresh();
    setConnectionView("list");
    setBrokerDraft(emptyBrokerDraft());
  };

  const openCustomFunctionModal = (customFunction?: CustomFunctionRow) => {
    setCustomFunctionDraft(
      customFunction
        ? {
            id: customFunction.id,
            name: customFunction.name,
            description: customFunction.description ?? "",
            value: customFunction.value,
          }
        : { id: "", name: "", description: "", value: "" },
    );
    setCustomFunctionError("");
    setCustomFunctionModal(true);
  };

  const saveCustomFunction = async () => {
    try {
      const payload = {
        name: customFunctionDraft.name.trim(),
        description: customFunctionDraft.description.trim() || null,
        value: customFunctionDraft.value,
      };
      if (customFunctionDraft.id) {
        await client.customFunctions.update(customFunctionDraft.id, payload);
      } else {
        await client.customFunctions.create(payload);
      }
      await refresh();
      setCustomFunctionModal(false);
      toast.success("Custom function saved.");
    } catch (err) {
      setCustomFunctionError(
        err instanceof Error ? err.message : "Unable to save custom function",
      );
    }
  };

  const deleteCustomFunction = (customFunction: CustomFunctionRow) => {
    askDeleteConfirmation(
      "Delete custom function",
      `Delete {{${customFunction.name}}}?`,
      async () => {
        await client.customFunctions.remove(customFunction.id);
        await refresh();
      },
    );
  };

  const handleCollectionMenuToggle = (collectionId: string, anchor: HTMLElement) => {
    if (collectionMenuId === collectionId) {
      closeActionPopover();
      return;
    }
    setRequestMenuId(null);
    setCollectionMenuId(collectionId);
    setPopoverPosition(getPopoverPosition(anchor));
  };

  const handleRequestMenuToggle = (requestId: string, anchor: HTMLElement) => {
    if (requestMenuId === requestId) {
      closeActionPopover();
      return;
    }
    setCollectionMenuId(null);
    setRequestMenuId(requestId);
    setPopoverPosition(getPopoverPosition(anchor));
  };

  const handleCollectionDragOver = (collectionId: string) => {
    if (draggedCollectionId !== collectionId) {
      setDragOverCollectionId(collectionId);
    }
  };

  const workspaceContextValue: WorkspaceContextValue = {
    collections: sortedCollections,
    requests: bootstrap?.requests ?? [],
    selectedCollectionId,
    selectedRequestId,
    expandedCollectionIds,
    favoriteCollectionIds,
    requestDrafts,
    draggedRequestId,
    draggedCollectionId,
    dragOverRequestId,
    dragOverCollectionId,
    onCreateCollection: openCreateCollection,
    onImportCollection: openImportCollection,
    onSelectCollection: selectCollection,
    onSelectRequest: selectRequest,
    onToggleCollection: toggleCollection,
    onAddRequest: addRequestToCollection,
    onToggleFavorite: toggleFavoriteCollection,
    onCollectionMenuToggle: handleCollectionMenuToggle,
    onRequestMenuToggle: handleRequestMenuToggle,
    onDropRequestOnCollection: dropRequestOnCollection,
    onCollectionDragOver: handleCollectionDragOver,
    onDropRequest: dropRequest,
    onCollectionDragStart: setDraggedCollectionId,
    onCollectionDragEnd: () => {
      setDraggedCollectionId(null);
      setDragOverCollectionId(null);
    },
    onRequestDragStart: setDraggedRequestId,
    onRequestDragOver: setDragOverRequestId,
    onRequestDragEnd: () => {
      setDraggedRequestId(null);
      setDragOverRequestId(null);
      setDragOverCollectionId(null);
    },
    consumerSessions,
    consumerTopics,
    consumerTopicColor,
    consumerQos,
    allTopics,
    inactiveConsumerTopics,
    consumerTopicOrder,
    activeTopicKeys,
    liveMessages,
    visibleLiveMessageCount,
    clearLiveMessages,
    loadMoreLiveMessages,
    startConsumer,
    setConsumerTopics,
    setConsumerTopicColor,
    setConsumerQos,
    getTopicColor,
    unsubscribeTopic,
    subscribeSavedTopic,
    deleteSavedTopic,
    askDeleteConfirmation,
    onBackToPublishers: () => setMainTab("publishers"),
    brokers,
    brokerStatuses,
    activeConnectionId,
    connectingBrokerId,
    connectionView,
    brokerDraft,
    connectionTestMessage,
    connectionTestPending,
    showPassword,
    setBrokerDraft,
    setConnectionView,
    setShowPassword,
    openNewConnection,
    openEditConnection,
    connectBroker,
    disconnectBroker,
    testBroker,
    saveBroker,
    cancelConnectionForm,
    deleteBroker,
    selectedCollectionName: selectedCollection?.name,
    activeConnection,
    activeConnectionStatus,
    mainTab,
    unreadConsumerMessages,
    onTabChange: setMainTab,
    onOpenConnections: () => {
      setConnectionView("list");
      setMainTab("connections");
    },
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
  };

  return (
    <WorkspaceProvider value={workspaceContextValue}>
      <div className="shell">
        <CollectionSidebar />

      <main className="workspace">
        <WorkspaceHeader />

        {mainTab === "publishers" ? (
          <PublishersPage>
            <div
              className={`card editor-card ${!selectedRequestId ? "request-editor-empty" : ""}`}
            >
              {!selectedRequestId && (
                <div className="request-empty-state">
                  <div className="empty-state-icon">⌁</div>
                  <strong>Select a request</strong>
                  <span>
                    Choose an MQTT request from the collection tree to view its
                    details.
                  </span>
                </div>
              )}
              <div className="request-toolbar">
                <div>
                  <div className="request-name-line">
                    <span className="request-method request-detail-method">MQTT</span>
                    <input
                      className="request-name-input"
                      aria-label="Request name"
                      value={draft.name}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value })
                      }
                    />
                    {selectedRequestModified && (
                      <span className="modified-label">(Modified)</span>
                    )}
                  </div>
                  <div className="card-sub">MQTT message</div>
                </div>
                <div className="button-row">
                  <button onClick={saveRequest}>Save</button>
                  <div
                    ref={discardControlRef}
                    className="request-discard-control"
                  >
                    <button
                      type="button"
                      disabled={!selectedRequestModified}
                      onClick={() => {
                        if (discardConfirmOpen) {
                          discardRequestChanges();
                        } else {
                          setDiscardConfirmOpen(true);
                        }
                      }}
                    >
                      {discardConfirmOpen ? "Confirm" : "Discard changes"}
                    </button>
                    {discardConfirmOpen && (
                      <div className="request-discard-popover" role="status">
                        Discard all unsaved changes?
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      askDeleteConfirmation(
                        "Delete request",
                        "Delete this MQTT request?",
                        deleteRequest,
                      )
                    }
                    className="danger"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div
                className={`request-topic-row ${topicValidationError ? "topic-invalid" : ""}`}
              >
                <div className="topic-field">
                  <TopicAutocomplete
                    label="Topic"
                    value={draft.topic}
                    topics={allTopics}
                    variables={payloadEditorVariables}
                    onChange={(topic) => {
                      setTopicValidationError(false);
                      setDraft({ ...draft, topic });
                    }}
                  />
                </div>
                <button
                  className="topic-clear"
                  aria-label="Clear topic"
                  title="Clear topic"
                  onClick={() => setDraft({ ...draft, topic: "" })}
                >
                  ×
                </button>
              </div>

              <div className="request-options-row">
                <div className="payload-format-tabs">
                  {(["raw", "xml", "json"] as PayloadFormat[]).map((format) => (
                    <button
                      type="button"
                      key={format}
                      className={draft.payloadFormat === format ? "active" : ""}
                      onClick={() => changePayloadFormat(format)}
                    >
                      {format}
                    </button>
                  ))}
                </div>
                <div className="request-send-actions">
                  <button onClick={publishRequest} className="publish-button">
                    Publish
                  </button>
                </div>
              </div>

              <PayloadEditor
                requestId={draft.id ?? ""}
                value={draft.payloadTemplate}
                language={payloadEditorLanguage}
                variables={payloadEditorVariables}
                customFunctions={payloadEditorCustomFunctions}
                onChange={(payloadTemplate) =>
                  setDraft((current) => ({ ...current, payloadTemplate }))
                }
              />

              <div className="request-controls">
                {draft.payloadFormat !== "raw" && (
                  <button
                    type="button"
                    className="beautify-link"
                    onClick={() => {
                      if (draft.payloadFormat === "json") {
                        try {
                          setDraft({
                            ...draft,
                            payloadTemplate: JSON.stringify(
                              JSON.parse(draft.payloadTemplate),
                              null,
                              2,
                            ),
                          });
                        } catch {
                          toast.error("Payload is not valid JSON.");
                        }
                      } else {
                        setDraft({
                          ...draft,
                          payloadTemplate: beautifyXml(draft.payloadTemplate),
                        });
                      }
                    }}
                  >
                    Beautify
                  </button>
                )}
                <div className="flex-1" />
                <label>
                  Batch
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    step={1}
                    value={batchCount}
                    onChange={(event) =>
                      setBatchCount(
                        Math.min(
                          1000000,
                          Math.max(1, Number(event.target.value) || 1),
                        ),
                      )
                    }
                  />
                </label>
                <label>
                    Variables
                  <select
                    value={selectedCollection?.variableCollectionId ?? ""}
                    onChange={(event) => void updateCollectionVariables(event.target.value)}
                  >
                    <option value="">No variables</option>
                    {variableCollections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  QoS
                  <QosSelect
                    value={draft.qos}
                    onChange={(qos) => setDraft({ ...draft, qos })}
                  />
                </label>
                <label className="retain-control">
                  <input
                    type="checkbox"
                    checked={draft.retain}
                    onChange={(event) =>
                      setDraft({ ...draft, retain: event.target.checked })
                    }
                  />
                  Retain
                </label>
              </div>
            </div>

            <div className="card inspector-card">
              <div className="tab-row">
                <button
                  className={rightTab === "history" ? "active" : ""}
                  onClick={() => setRightTab("history")}
                >
                  History
                </button>
                <button
                  className={rightTab === "functions" ? "active" : ""}
                  onClick={() => setRightTab("functions")}
                >
                  Functions
                </button>
              </div>

              {false && (
                <div className="stack">
                  <div className="card-section">
                    <div className="section-head">
                      <span>Start consumer</span>
                      <button onClick={startConsumer} className="primary">
                        Subscribe
                      </button>
                    </div>
                    <label>
                      Topics comma separated
                      <div className="topic-input-with-color">
                        <TopicAutocomplete
                          label="Topics comma separated"
                          value={consumerTopics}
                          topics={allTopics}
                          onChange={setConsumerTopics}
                        />
                        <input
                          className="topic-color-picker"
                          type="color"
                          value={consumerTopicColor}
                          aria-label="Choose topic color"
                          title="Choose topic color"
                          onChange={(event) => {
                            setConsumerTopicColor(event.target.value);
                            localStorage.setItem(
                              "mqtt.consumerTopicColor",
                              event.target.value,
                            );
                          }}
                        />
                      </div>
                    </label>
                    <label>
                      QoS
                      <QosSelect
                        value={consumerQos}
                        onChange={setConsumerQos}
                      />
                    </label>
                  </div>

                  <div className="card-section">
                    <div className="section-head">
                      <span>Active sessions</span>
                    </div>
                    <div className="session-list">
                      {consumerSessions.flatMap((session) =>
                        (JSON.parse(session.topicsJson) as string[]).map(
                          (topic) => (
                            <div
                              key={`${session.id}:${topic}`}
                              className="session-row consumer-session-topic"
                              style={{ borderLeftColor: getTopicColor(topic) }}
                            >
                              <strong>{topic}</strong>
                              <button
                                onClick={() =>
                                  unsubscribeTopic(session.id, topic)
                                }
                              >
                                Unsubscribe
                              </button>
                            </div>
                          ),
                        ),
                      )}
                      {inactiveConsumerTopics
                        .filter((item) => !activeTopicKeys.has(item.key))
                        .map((item) => (
                          <div
                            key={`inactive:${item.key}`}
                            className="session-row consumer-session-topic inactive-session"
                            style={{
                              borderLeftColor: getTopicColor(item.topic),
                            }}
                          >
                            <strong>{item.topic}</strong>
                            <div className="button-row">
                              <button className="flex-1" onClick={() => subscribeSavedTopic(item)}>
                                Subscribe
                              </button>
                              <button
                                className="danger flex-1"
                                onClick={() =>
                                  askDeleteConfirmation(
                                    "Delete saved topic",
                                    `Delete saved topic "${item.topic}"?`,
                                    () => deleteSavedTopic(item.key),
                                  )
                                }
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="card-section">
                    <div className="section-head">
                      <span>Live messages</span>
                    </div>
                    <div className="message-list">
                      {liveMessages.map((message) => (
                        <div key={`${message.log.id}`} className="message-row">
                          <strong>{message.topic}</strong>
                          <small>
                            {typeof message.payloadJson === "object"
                              ? toPrettyJson(message.payloadJson)
                              : message.payloadText}
                          </small>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {rightTab === "history" && (
                <div className="stack">
                  <div className="card-section">
                    <div className="section-head">
                      <div className="logs-heading">
                        <div className="section-title-stack">
                          <span>Logs</span>
                          <small>
                            (publish: {publishLogCount}, consume:{" "}
                            {consumeLogCount})
                          </small>
                        </div>
                        <label className="inline log-watch-control">
                          <input
                            type="checkbox"
                            checked={watchConsumerLogs}
                            onChange={(event) => {
                              const enabled = event.target.checked;
                              watchConsumerLogsRef.current = enabled;
                              if (enabled) {
                                // Do not backfill messages received while watching was off.
                                consumerLogResumeAfterRef.current = Date.now();
                              }
                              setWatchConsumerLogs(enabled);
                            }}
                          />
                          Watch consumer
                        </label>
                      </div>
                      <button
                        onClick={clearHistory}
                        className="danger"
                        disabled={!logs.length}
                      >
                        Clear
                      </button>
                    </div>
                    <ScrollArea className="log-scroll-area">
                      <div className="log-list">
                        {logs.map((log) => (
                          <div
                            key={log.id}
                            className={`log-row ${log.direction}`}
                          >
                            <div className="log-top">
                              <strong>{log.topic}</strong>
                              <span>{log.direction}</span>
                            </div>
                            <small>{formatTime(log.createdAt)}</small>
                            <pre>{log.payloadText}</pre>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              )}

              {rightTab === "functions" && (
                <div className="stack">
                  <div className="card-section function-section">
                    <ScrollArea className="function-guide function-scroll-area">
                    <div className="section-head">
                      <span>Built-in functions</span>
                    </div>
                    <p className="function-description">
                      Use these tokens directly inside topic or payload
                      templates.
                    </p>
                    <div className="function-list">
                      <div className="function-row">
                        <code>{`{{now[:format]}}`}</code>
                        <span>
                          Current time, optionally formatted with Day.js tokens.
                        </span>
                        <pre>{`{"publishDate":"{{now:yyyy-MM-dd}}"}`}</pre>
                        <div className="custom-function-preview-label">Preview:</div>
                        <pre className="custom-function-preview">
                          {builtinFunctionPreviews.now ?? "Rendering..."}
                        </pre>
                      </div>
                      <div className="function-row">
                        <code>{`{{uuid}}`}</code>
                        <span>Generates a new UUID for each message.</span>
                        <pre>{`{"requestId":"{{uuid}}"}`}</pre>
                        <div className="custom-function-preview-label">Preview:</div>
                        <pre className="custom-function-preview">
                          {builtinFunctionPreviews.uuid ?? "Rendering..."}
                        </pre>
                      </div>
                      <div className="function-row">
                        <code>{`{{sequence:<start>:<numberOfDigits>}}`}</code>
                        <span>
                          Generates a zero-padded sequence from the given start
                          value.
                        </span>
                        <pre>{`{"sequence":"{{sequence:1:6}}"}`}</pre>
                        <div className="custom-function-preview-label">Preview:</div>
                        <pre className="custom-function-preview">
                          {builtinFunctionPreviews.sequence ?? "Rendering..."}
                        </pre>
                      </div>
                    </div>
                    <div className="custom-functions-section">
                      <div className="section-head">
                        <div className="section-title-stack">
                          <span>Custom functions</span>
                          <small className="function-description">
                            Reusable values for topic and payload templates.
                          </small>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Add custom function"
                          title="Add custom function"
                          onClick={() => openCustomFunctionModal()}
                        >
                          +
                        </button>
                      </div>
                      <div className="function-list custom-function-list">
                        {customFunctions.length === 0 ? (
                          <span className="card-sub">No custom functions yet.</span>
                        ) : (
                          customFunctions.map((customFunction) => (
                            <div className="function-row custom-function-row" key={customFunction.id}>
                              <div className="custom-function-content">
                                <code>{`{{${customFunction.name}}}`}</code>
                                {customFunction.description && <span>{customFunction.description}</span>}
                                <pre>{JSON.stringify({ custom: customFunction.value })}</pre>
                                <div className="custom-function-preview-label">Preview:</div>
                                <pre className="custom-function-preview">
                                  {customFunctionPreviews[customFunction.id] ?? "Rendering..."}
                                </pre>
                              </div>
                              <div className="custom-function-actions">
                                <button
                                  className="icon-button"
                                  aria-label={`Edit ${customFunction.name}`}
                                  title="Edit custom function"
                                  onClick={() => openCustomFunctionModal(customFunction)}
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="m4 16.5 9.8-9.8 2.5 2.5-9.8 9.8L4 19Zm11-11 1.4-1.4a1.8 1.8 0 0 1 2.5 2.5l-1.4 1.4" />
                                  </svg>
                                </button>
                                <button
                                  className="icon-button danger"
                                  aria-label={`Delete ${customFunction.name}`}
                                  title="Delete custom function"
                                  onClick={() => deleteCustomFunction(customFunction)}
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M5 7h14M10 11v6M14 11v6M9 7V4h6v3m-9 0 1 13h8l1-13" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    </ScrollArea>
                  </div>
                </div>
              )}

            </div>
          </PublishersPage>
        ) : mainTab === "consumers" ? (
          <ConsumersPage />
        ) : mainTab === "variables" ? (
          <VariablesPage />
        ) : (
          <ConnectionsPage />
        )}

        {error && <div className="error-banner">{error}</div>}
      </main>
      {collectionMenuId &&
        popoverPosition &&
        (() => {
          const collection = collections.find(
            (item) => item.id === collectionMenuId,
          );
          if (!collection) return null;
          return (
            <div
              className="popover-backdrop"
              onMouseDown={closeActionPopover}
            >
              <div
                className="collection-menu"
                style={popoverPosition}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button onClick={() => void exportCollection(collection)}>
                  Export
                </button>
                <button onClick={() => sortCollectionRequests(collection)}>
                  Sort
                </button>
                <button onClick={() => duplicateCollection(collection)}>
                  Duplicate
                </button>
                <button onClick={() => openEditCollection(collection)}>
                  Edit
                </button>
                <button
                  className="danger-text"
                  onClick={() => {
                    closeActionPopover();
                    askDeleteConfirmation(
                      "Delete collection",
                      "Delete this collection and all of its requests?",
                      () => deleteCollection(collection),
                    );
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })()}
      {requestMenuId &&
        popoverPosition &&
        (() => {
          const request = (bootstrap?.requests ?? []).find(
            (item) => item.id === requestMenuId,
          );
          if (!request) return null;
          return (
            <div
              className="popover-backdrop"
              onMouseDown={closeActionPopover}
            >
              <div
                className="request-menu"
                style={popoverPosition}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button onClick={() => duplicateRequest(request)}>
                  Duplicate
                </button>
                <button
                  className="danger-text"
                  onClick={() => {
                    closeActionPopover();
                    askDeleteConfirmation(
                      "Delete request",
                      `Delete request "${request.name}"?`,
                      () => deleteRequestById(request.id),
                    );
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })()}
      {collectionModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={closeCollectionModal}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collection-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="section-head">
              <div>
                <div id="collection-modal-title" className="card-title">
                  {collectionModal === "create"
                    ? "New collection"
                    : collectionModal === "import"
                      ? "Import collection"
                      : "Edit collection"}
                </div>
                <div className="card-sub">
                  {collectionModal === "import"
                    ? "Import a collection and its MQTT requests from a ZIP file."
                    : "Organize requests into a reusable MQTT collection."}
                </div>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={closeCollectionModal}
              >
                ×
              </button>
            </div>
            <label>
              Name
              <input
                autoFocus
                value={collectionDraft.name}
                onChange={(event) =>
                  setCollectionDraft({
                    ...collectionDraft,
                    name: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Description
              <textarea
                rows={4}
                value={collectionDraft.description}
                onChange={(event) =>
                  setCollectionDraft({
                    ...collectionDraft,
                    description: event.target.value,
                  })
                }
              />
            </label>
            {collectionModal === "import" && (
              <>
                <label>
                  ZIP file
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void readImportFile(file);
                    }}
                  />
                </label>
                {importError && <div className="form-error">{importError}</div>}
              </>
            )}
            <div className="button-row modal-actions">
              <button onClick={closeCollectionModal} disabled={importPending}>Cancel</button>
              <button
                className="primary"
                onClick={collectionModal === "import" ? () => void importCollection() : () => void saveCollection()}
                disabled={
                  !collectionDraft.name.trim() ||
                  (collectionModal === "import" && (!importFile || importPending))
                }
              >
                {importPending
                  ? "Importing..."
                  : collectionModal === "create"
                    ? "Create collection"
                    : collectionModal === "import"
                      ? "Import"
                      : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
      {customFunctionModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setCustomFunctionModal(false)}
        >
          <div
            className="modal-card custom-function-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-function-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="section-head">
              <div>
                <div id="custom-function-modal-title" className="card-title">
                  {customFunctionDraft.id ? "Edit custom function" : "New custom function"}
                </div>
                <div className="card-sub">
                  Use built-ins, Variables, or other custom functions in Value.
                </div>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setCustomFunctionModal(false)}
              >
                ×
              </button>
            </div>
            <label>
              Name
              <input
                autoFocus
                value={customFunctionDraft.name}
                onChange={(event) =>
                  setCustomFunctionDraft({
                    ...customFunctionDraft,
                    name: event.target.value.replace(/[^A-Za-z0-9_]/g, ""),
                  })
                }
              />
            </label>
            <label>
              Description
              <input
                value={customFunctionDraft.description}
                onChange={(event) =>
                  setCustomFunctionDraft({
                    ...customFunctionDraft,
                    description: event.target.value,
                  })
                }
              />
            </label>
            <div className="custom-function-value-field">
              <span>Value</span>
              <PayloadEditor
                requestId={customFunctionDraft.id || "new-custom-function"}
                value={customFunctionDraft.value}
                language="plaintext"
                variables={payloadEditorVariables}
                customFunctions={payloadEditorCustomFunctions}
                onChange={(value) =>
                  setCustomFunctionDraft((current) => ({ ...current, value }))
                }
              />
            </div>
            {customFunctionError && (
              <div className="form-error">{customFunctionError}</div>
            )}
            <div className="button-row modal-actions">
              <button onClick={() => setCustomFunctionModal(false)}>Cancel</button>
              <button
                className="primary"
                disabled={!customFunctionDraft.name.trim()}
                onClick={() => void saveCustomFunction()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmation && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setDeleteConfirmation(null)}
        >
          <div
            className="modal-card confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div>
              <div id="delete-modal-title" className="card-title">
                {deleteConfirmation.title}
              </div>
              <div className="card-sub">{deleteConfirmation.message}</div>
            </div>
            <div className="button-row modal-actions">
              <button onClick={() => setDeleteConfirmation(null)}>
                Cancel
              </button>
              <button className="danger" onClick={() => void confirmDelete()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      <ToastContainer
        position="top-right"
        autoClose={3500}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
      />
      </div>
    </WorkspaceProvider>
  );
}
