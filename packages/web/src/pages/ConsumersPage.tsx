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
  qos: number;
}

export interface ConsumersPageProps {
  consumerSessions: ConsumerSessionRow[];
  consumerTopics: string;
  consumerTopicColor: string;
  consumerQos: number;
  allTopics: string[];
  inactiveConsumerTopics: SavedTopic[];
  consumerTopicOrder: string[];
  activeTopicKeys: Set<string>;
  liveMessages: ConsumerMessageEvent[];
  visibleLiveMessageCount: number;
  clearLiveMessages: () => void;
  loadMoreLiveMessages: () => void;
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
    onBackToPublishers,
  } = useWorkspaceContext();
  const activeTopics = consumerSessions.flatMap((session) =>
    (JSON.parse(session.topicsJson) as string[]).map((topic) => ({
      key: `${session.brokerProfileId}:${topic}`,
      topic,
      brokerProfileId: session.brokerProfileId,
      sessionId: session.id,
      qos: session.qos,
    })),
  );
  const inactiveTopics = inactiveConsumerTopics
    .filter((item) => !activeTopicKeys.has(item.key))
    .map((item) => ({
      ...item,
      sessionId: null,
      qos: Number.isInteger(item.qos) ? item.qos : 0,
    }));
  const topicsByKey = new Map(
    [...activeTopics, ...inactiveTopics].map((item) => [item.key, item]),
  );
  const orderedTopicKeys = [
    ...consumerTopicOrder.filter((key) => topicsByKey.has(key)),
    ...topicsByKey.keys(),
  ].filter((key, index, keys) => keys.indexOf(key) === index);
  return (
    <section className="editor-grid full-width-page consumers-page">
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
          <div className="card-section consumer-start-section">
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
            <label className="consumer-qos-field">
              QoS
              <QosSelect
                value={consumerQos}
                onChange={setConsumerQos}
              />
            </label>
          </div>
          <div className="card-section consumer-sessions-section">
            <div className="section-head">
              <span>Active sessions</span>
            </div>
            <div className="session-list">
              {orderedTopicKeys.map((key) => {
                const item = topicsByKey.get(key);
                if (!item) return null;
                return item.sessionId !== null ? (
                  <div
                    key={item.key}
                    className="session-row consumer-session-topic"
                    style={{ borderLeftColor: getTopicColor(item.topic) }}
                  >
                    <strong>
                      {item.topic} <small>(QoS: {item.qos})</small>
                    </strong>
                    <button onClick={() => unsubscribeTopic(item.sessionId, item.topic)}>
                      Unsubscribe
                    </button>
                  </div>
                ) : (
                  <div
                    key={item.key}
                    className="session-row consumer-session-topic inactive-session"
                    style={{ borderLeftColor: getTopicColor(item.topic) }}
                  >
                    <strong>
                      {item.topic} <small>(QoS: {item.qos})</small>
                    </strong>
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
                );
              })}
            </div>
          </div>
        </div>
        <div className="card-section live-consumer-messages">
          <div className="section-head">
            <span>
              Live messages ({liveMessages.length >= 999 ? "999+" : liveMessages.length} messages)
            </span>
            <button
              type="button"
              className="danger"
              onClick={clearLiveMessages}
              disabled={!liveMessages.length}
            >
              Clear
            </button>
          </div>
          <div className="message-list">
            {liveMessages.slice(0, visibleLiveMessageCount).map((message) => (
              <div
                key={message.log.id}
                className="message-row"
                style={{ borderLeftColor: getTopicColor(message.topic) }}
              >
                <strong>{message.topic}</strong>
                <small>
                  {message.payloadJson !== null &&
                  typeof message.payloadJson === "object"
                    ? toPrettyJson(message.payloadJson)
                    : message.payloadText}
                </small>
              </div>
            ))}
            {visibleLiveMessageCount < liveMessages.length && (
              <button
                type="button"
                className="load-more-live-messages"
                onClick={loadMoreLiveMessages}
              >
                Load more
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
