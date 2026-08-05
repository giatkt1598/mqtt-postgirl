import { useCallback, useEffect, useRef, useState } from "react";

export type WorkspaceTab = "publishers" | "consumers" | "variables" | "connections";
export type ConnectionView = "list" | "form";
export type InspectorTab = "history" | "functions" | "variables";

type WorkspaceRoute = {
  mainTab: WorkspaceTab;
  selectedCollectionId: string;
  selectedRequestId: string;
  selectedVariableCollectionId: string;
  rightTab: InspectorTab;
  connectionView: ConnectionView;
  connectionId: string;
};

const workspaceTabs = new Set<WorkspaceTab>([
  "publishers",
  "consumers",
  "variables",
  "connections",
]);

function readRoute(): WorkspaceRoute {
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page");
  const requestedPage = workspaceTabs.has(page as WorkspaceTab)
    ? (page as WorkspaceTab)
    : "publishers";
  const requestId = params.get("request") ?? "";
  const connection = params.get("connection");
  const mainTab = requestId ? "publishers" : requestedPage;
  return {
    mainTab,
    selectedCollectionId: params.get("collection") ?? "",
    selectedRequestId: requestId,
    selectedVariableCollectionId: params.get("variableCollection") ?? "",
    rightTab:
      params.get("panel") === "functions"
        ? "functions"
        : params.get("panel") === "variables"
          ? "variables"
          : "history",
    connectionView:
      mainTab === "connections" && connection !== null ? "form" : "list",
    connectionId: connection === "new" || connection === null ? "" : connection,
  };
}

function routeUrl(route: WorkspaceRoute) {
  const params = new URLSearchParams();
  params.set("page", route.mainTab);
  if (route.mainTab === "publishers") {
    if (route.selectedCollectionId) params.set("collection", route.selectedCollectionId);
    if (route.selectedRequestId) params.set("request", route.selectedRequestId);
    params.set("panel", route.rightTab);
  }
  if (route.mainTab === "connections" && route.connectionView === "form") {
    params.set("connection", route.connectionId || "new");
  }
  if (route.mainTab === "variables" && route.selectedVariableCollectionId) {
    params.set("variableCollection", route.selectedVariableCollectionId);
  }
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

export function useWorkspaceNavigation() {
  const [route, setRoute] = useState<WorkspaceRoute>(readRoute);
  const routeRef = useRef(route);
  const mainTabRef = useRef<WorkspaceTab>(route.mainTab);

  const updateRoute = useCallback(
    (patch: Partial<WorkspaceRoute>, replace = false) => {
      const next = { ...routeRef.current, ...patch };
      routeRef.current = next;
      mainTabRef.current = next.mainTab;
      setRoute(next);
      const nextUrl = routeUrl(next);
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) {
        window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
      }
    },
    [],
  );

  useEffect(() => {
    const onPopState = () => {
      const next = readRoute();
      routeRef.current = next;
      mainTabRef.current = next.mainTab;
      setRoute(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const setMainTab = (mainTab: WorkspaceTab) =>
    updateRoute({
      mainTab,
      connectionView: mainTab === "connections" ? routeRef.current.connectionView : "list",
      connectionId: mainTab === "connections" ? routeRef.current.connectionId : "",
    });
  const setSelectedCollectionId = (selectedCollectionId: string) =>
    updateRoute({ selectedCollectionId });
  const setSelectedRequestId = (selectedRequestId: string) =>
    updateRoute({ selectedRequestId });
  const setSelectedVariableCollectionId = (
    selectedVariableCollectionId: string,
  ) => updateRoute({ selectedVariableCollectionId });
  const setRightTab = (rightTab: InspectorTab) => updateRoute({ rightTab });
  const setConnectionView = (connectionView: ConnectionView) =>
    updateRoute({
      connectionView,
      connectionId: connectionView === "list" ? "" : routeRef.current.connectionId,
    });
  const setConnectionId = (connectionId: string) => updateRoute({ connectionId });

  return {
    mainTab: route.mainTab,
    setMainTab,
    mainTabRef,
    selectedCollectionId: route.selectedCollectionId,
    setSelectedCollectionId,
    selectedRequestId: route.selectedRequestId,
    setSelectedRequestId,
    selectedVariableCollectionId: route.selectedVariableCollectionId,
    setSelectedVariableCollectionId,
    rightTab: route.rightTab,
    setRightTab,
    connectionView: route.connectionView,
    setConnectionView,
    connectionId: route.connectionId,
    setConnectionId,
  };
}
