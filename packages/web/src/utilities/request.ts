import { DraftRequest, RequestRow } from "../models";

export function emptyDraft(
  collectionId = "",
  brokerProfileId = "",
): DraftRequest {
  return {
    collectionId,
    name: "New request",
    topic: "",
    payloadTemplate: '{"publishDate":"{{now}}"}',
    payloadFormat: "json",
    qos: 0,
    retain: false,
    brokerProfileId,
  };
}

export function requestToDraft(request: RequestRow): DraftRequest {
  return {
    id: request.id,
    collectionId: request.collectionId,
    name: request.name,
    topic: request.topic,
    payloadTemplate: request.payloadTemplate,
    payloadFormat: request.payloadFormat,
    qos: request.qos,
    retain: Boolean(request.retain),
    brokerProfileId: request.brokerProfileId ?? "",
  };
}

export function isRequestModified(
  request: RequestRow | undefined,
  draft: DraftRequest | undefined,
) {
  if (!request || !draft) return false;
  return (
    request.collectionId !== draft.collectionId ||
    request.name !== draft.name ||
    request.topic !== draft.topic ||
    request.payloadTemplate !== draft.payloadTemplate ||
    request.payloadFormat !== draft.payloadFormat ||
    request.qos !== draft.qos ||
    Boolean(request.retain) !== draft.retain ||
    (request.brokerProfileId ?? "") !== draft.brokerProfileId
  );
}
