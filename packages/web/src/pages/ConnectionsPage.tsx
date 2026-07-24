import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { BrokerProfileRow } from "../models";
import { useWorkspaceContext } from "../contexts";

export interface BrokerDraft {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  validateCertificate: boolean;
  encryption: boolean;
  username: string;
  password: string;
  clientId: string;
  clean: boolean;
  keepAlive: number;
  reconnectPeriod: number;
  caCert: string;
  clientCert: string;
  clientKey: string;
}

export interface ConnectionsPageProps {
  brokers: BrokerProfileRow[];
  brokerStatuses: Array<{
    profileId: string;
    connected: boolean;
    refCount: number;
    lastError: string | null;
  }>;
  activeConnectionId: string;
  connectingBrokerId: string;
  connectionView: "list" | "form";
  brokerDraft: BrokerDraft;
  connectionTestMessage: { type: "success" | "error"; text: string } | null;
  connectionTestPending: boolean;
  showPassword: boolean;
  setBrokerDraft: Dispatch<SetStateAction<BrokerDraft>>;
  setConnectionView: (view: "list" | "form") => void;
  setShowPassword: (value: boolean | ((current: boolean) => boolean)) => void;
  openNewConnection: () => void;
  openEditConnection: (broker: BrokerProfileRow) => void;
  connectBroker: (id: string) => void;
  disconnectBroker: (id: string) => void;
  testBroker: () => void;
  saveBroker: () => void;
  cancelConnectionForm: () => void;
  deleteBroker: () => void;
  askDeleteConfirmation: (
    title: string,
    message: string,
    onConfirm: () => void | Promise<void>,
  ) => void;
  onBackToPublishers: () => void;
}

function brokerEndpoint(broker: BrokerProfileRow): string {
  const protocol = broker.protocol.replace("://", "");
  const isWebSocket = protocol === "ws" || protocol === "wss";
  const isEncrypted =
    Boolean(broker.encryption) || protocol === "mqtts" || protocol === "wss";
  const transport = isEncrypted
    ? isWebSocket
      ? "wss"
      : "mqtts"
    : isWebSocket
      ? "ws"
      : "mqtt";

  return `${transport}://${broker.host}:${broker.port}`;
}

export function ConnectionsPage(): ReactNode {
  const {
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
    askDeleteConfirmation,
    onBackToPublishers,
  } = useWorkspaceContext();
  return (
    <section className="editor-grid full-width-page">
      <div className="card connection-manager">
        <div className="card-head">
          <div className="mt-3">
            <div className="card-title">Connections</div>
            <div className="card-sub">
              Choose one active connection for the workspace, or create/edit
              connection profiles here.
            </div>
          </div>
          <div className="button-row">
            {connectionView === "list" ? (
              <>
                <button onClick={openNewConnection} className="primary">
                  New connection
                </button>
                <button onClick={onBackToPublishers}>Back to publishers</button>
              </>
            ) : (
              <button onClick={() => setConnectionView("list")}>
                Back to list
              </button>
            )}
          </div>
        </div>

        {connectionView === "list" ? (
          <div className="connection-list mt-3">
            {brokers.length === 0 ? (
              <div className="empty-state">
                <strong>No connections yet</strong>
                <small>Click New connection to add one.</small>
              </div>
            ) : (
              brokers.map((broker) => {
                const status = brokerStatuses.find(
                  (item) => item.profileId === broker.id,
                );
                const isActive = broker.id === activeConnectionId;
                const isConnecting = broker.id === connectingBrokerId;
                return (
                  <div
                    key={broker.id}
                    className={`connection-row ${isActive ? "active" : ""}`}
                  >
                    <div className="connection-details">
                      <strong className="connection-name">{broker.name}</strong>
                      <small className="connection-endpoint">
                        {brokerEndpoint(broker)}
                      </small>
                      <small className="connection-auth">
                        {broker.username?.trim() || "(No Auth)"}
                      </small>
                    </div>
                    <div className="button-row">
                      <button onClick={() => openEditConnection(broker)}>
                        Edit
                      </button>
                      {status?.connected && (
                        <button
                          className="danger"
                          onClick={() => disconnectBroker(broker.id)}
                        >
                          Disconnect
                        </button>
                      )}
                      <button
                        className={status?.connected ? "connected" : "primary"}
                        disabled={status?.connected === true || Boolean(connectingBrokerId)}
                        aria-busy={isConnecting}
                        onClick={() => connectBroker(broker.id)}
                      >
                        {status?.connected
                          ? "Connected"
                          : isConnecting
                            ? "Connecting..."
                            : "Connect"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="connections-form">
            <div className="section-head">
              <span>
                {brokerDraft.id ? "Edit connection" : "Create connection"}
              </span>
            </div>
            <div className="connection-primary-row">
              <label className="connection-name-field">
                Name
                <input
                  value={brokerDraft.name}
                  onChange={(event) =>
                    setBrokerDraft({ ...brokerDraft, name: event.target.value })
                  }
                />
              </label>
              <label className="inline switch-control mb-3">
                <input
                  type="checkbox"
                  checked={brokerDraft.validateCertificate}
                  onChange={(event) =>
                    setBrokerDraft({
                      ...brokerDraft,
                      validateCertificate: event.target.checked,
                    })
                  }
                />
                Validate certificate
              </label>
              <label className="inline switch-control mb-3">
                <input
                  type="checkbox"
                  checked={brokerDraft.encryption}
                  onChange={(event) =>
                    setBrokerDraft({
                      ...brokerDraft,
                      encryption: event.target.checked,
                    })
                  }
                />
                Encryption (TLS)
              </label>
            </div>
            <div className="connection-endpoint-row">
              <label className="connection-protocol-field">
                Protocol
                <select
                  value={brokerDraft.protocol}
                  onChange={(event) =>
                    setBrokerDraft({ ...brokerDraft, protocol: event.target.value })
                  }
                >
                  <option value="mqtt">mqtt://</option>
                  <option value="ws">ws://</option>
                </select>
              </label>
              <label>
                Host
                <input
                  value={brokerDraft.host}
                  onChange={(event) =>
                    setBrokerDraft({ ...brokerDraft, host: event.target.value })
                  }
                />
              </label>
              <label className="connection-port-field">
                Port
                <input
                  type="number"
                  value={brokerDraft.port}
                  onChange={(event) =>
                    setBrokerDraft({
                      ...brokerDraft,
                      port: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <div className="connection-credentials-row">
              <label>
                Client ID
                <input
                  value={brokerDraft.clientId}
                  onChange={(event) =>
                    setBrokerDraft({ ...brokerDraft, clientId: event.target.value })
                  }
                />
              </label>
              <label>
                Username
                <input
                  value={brokerDraft.username}
                  onChange={(event) =>
                    setBrokerDraft({ ...brokerDraft, username: event.target.value })
                  }
                />
              </label>
              <label>
                Password
                <span className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={brokerDraft.password}
                    onChange={(event) =>
                      setBrokerDraft({ ...brokerDraft, password: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" />
                      <circle cx="12" cy="12" r="2.5" />
                      {!showPassword && <path d="m4 4 16 16" />}
                    </svg>
                  </button>
                </span>
              </label>
            </div>
            <div className="connection-advanced-row">
              <label>
                Keep alive (in seconds)
                <input
                  type="number"
                  value={brokerDraft.keepAlive}
                  onChange={(event) =>
                    setBrokerDraft({
                      ...brokerDraft,
                      keepAlive: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Reconnect period (in milliseconds)
                <input
                  type="number"
                  value={brokerDraft.reconnectPeriod}
                  onChange={(event) =>
                    setBrokerDraft({
                      ...brokerDraft,
                      reconnectPeriod: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="inline mb-3">
                <input
                  type="checkbox"
                  checked={brokerDraft.clean}
                  onChange={(event) =>
                    setBrokerDraft({ ...brokerDraft, clean: event.target.checked })
                  }
                />
                Clean session
              </label>
            </div>
            <div className="connection-form-actions">
              <button onClick={testBroker} disabled={connectionTestPending}>
                {connectionTestPending ? "Testing..." : "Test connection"}
              </button>
              <button onClick={saveBroker} className="primary">
                Save
              </button>
              <button onClick={cancelConnectionForm}>Cancel</button>
              {brokerDraft.id && (
                <button
                  onClick={() =>
                    askDeleteConfirmation(
                      "Delete connection",
                      "Delete this connection?",
                      deleteBroker,
                    )
                  }
                  className="danger"
                >
                  Delete
                </button>
              )}
            </div>
            {connectionTestMessage && (
              <div
                className={`connection-test-alert ${connectionTestMessage.type}`}
                role="alert"
              >
                {connectionTestMessage.text}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
