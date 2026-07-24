import type { ReactNode } from "react";
import { QosSelect, TopicAutocomplete } from "../components";
import type {
  ConsumerMessageEvent,
  ConsumerSessionRow,
} from "../models";
import { toPrettyJson } from "../utilities";
import { useWorkspaceContext } from "../contexts";

export interface SavedTopic {
  key: string;
  topic: string;
  brokerProfileId: string;
}

export interface ConsumersPageProps {
  consumerSessions: ConsumerSessionRow[];
  consumerTopics: string;
  consumerTopicColor: string;
  consumerQos: number;
  allTopics: string[];
  inactiveConsumerTopics: SavedTopic[];
  activeTopicKeys: Set<string>;
  liveMessages: ConsumerMessageEvent[];
  startConsumer: () => void;
  setConsumerTopics: (value: string) => void;
  setConsumerTopicColor: (value: string) => void;
  setConsumerQos: (value: number) => void;
  getTopicColor: (topic: string) => string;
  unsubscribeTopic: (sessionId: string, topic: string) => void;
  subscribeSavedTopic: (item: SavedTopic) => void;
  deleteSavedTopic: (key: string) => void;
  askDeleteConfirmation: (
    title: string,
    message: string,
    onConfirm: () => void | Promise<void>,
  ) => void;
  onBackToPublishers: () => void;
}

export function ConsumersPage(): ReactNode {
  const {
    consumerSessions,
    consumerTopics,
    consumerTopicColor,
    consumerQos,
    allTopics,
    inactiveConsumerTopics,
    activeTopicKeys,
    liveMessages,
    startConsumer,
    setConsumerTopics,
    setConsumerTopicColor,
    setConsumerQos,
    getTopicColor,
    unsubscribeTopic,
    subscribeSavedTopic,
    deleteSavedTopic,
    askDeleteConfirmation,
    onBackToPublishers,
  } = useWorkspaceContext();
  return (
    <section className="editor-grid full-width-page">
      <div className="card consumer-card">
        <div className="card-head">
          <div>
            <div className="card-title">Consumers</div>
            <div className="card-sub">
              Subscribe to MQTT topics and inspect incoming messages in
              realtime.
            </div>
          </div>
          <button onClick={onBackToPublishers}>Back to publishers</button>
        </div>
        <div className="consumer-layout">
          <div className="card-section">
            <div className="section-head">
              <span>Start consumer</span>
              <button onClick={startConsumer} className="primary">
                Subscribe
              </button>
            </div>
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
                    "mqtt-postwoman.consumerTopicColor",
                    event.target.value,
                  );
                }}
              />
            </div>
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
                (JSON.parse(session.topicsJson) as string[]).map((topic) => (
                  <div
                    key={`${session.id}:${topic}`}
                    className="session-row consumer-session-topic"
                    style={{ borderLeftColor: getTopicColor(topic) }}
                  >
                    <strong>{topic}</strong>
                    <button onClick={() => unsubscribeTopic(session.id, topic)}>
                      Unsubscribe
                    </button>
                  </div>
                )),
              )}
              {inactiveConsumerTopics
                .filter((item) => !activeTopicKeys.has(item.key))
                .map((item) => (
                  <div
                    key={`inactive:${item.key}`}
                    className="session-row consumer-session-topic inactive-session"
                    style={{ borderLeftColor: getTopicColor(item.topic) }}
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
        </div>
        <div className="card-section live-consumer-messages">
          <div className="section-head">
            <span>Live messages</span>
          </div>
          <div className="message-list">
            {liveMessages.map((message) => (
              <div
                key={message.log.id}
                className="message-row"
                style={{ borderLeftColor: getTopicColor(message.topic) }}
              >
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
    </section>
  );
}
