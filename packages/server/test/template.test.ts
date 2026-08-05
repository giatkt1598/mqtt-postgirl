import test from "node:test";
import assert from "node:assert/strict";
import { resolveTemplatePayload, resolveTemplateText } from "../src/template";
import { listBuiltinFunctions } from "../src/template/functions";

const context = { variableCollection: {}, variables: {}, customFunctions: {}, sequenceOffset: 0 };

test("resolves now token inside json string", () => {
  const result = resolveTemplatePayload('{"publishDate":"{{now}}"}', context);
  assert.equal(typeof result.value, "object");
});

test("resolves now token with a Day.js format", () => {
  const result = resolveTemplatePayload('{"publishDate":"{{now:yyyy-MM-dd}}"}', context);
  assert.match(String((result.value as Record<string, unknown>).publishDate), /^\d{4}-\d{2}-\d{2}$/);
});

test("resolves dollar variable token in body and topic", () => {
  const variables = { NAME: "mqtt", DEVICE_ID: "device-01", 1212: "numeric-name" };
  const body = resolveTemplatePayload('{"name":"$NAME","numeric":"$1212","suffix":"$NAMEABC"}', { ...context, variableCollection: variables });
  const topic = resolveTemplatePayload("device/$DEVICE_ID/status", { ...context, variableCollection: variables });
  assert.equal((body.value as Record<string, unknown>).name, "mqtt");
  assert.equal((body.value as Record<string, unknown>).numeric, "numeric-name");
  assert.equal((body.value as Record<string, unknown>).suffix, "mqttABC");
  assert.equal(topic.text, "device/device-01/status");
});

test("preserves dollar text that does not match a variable", () => {
  const topic = resolveTemplatePayload("device/$notAVariable/status", {
    ...context,
    variableCollection: { NAME: "mqtt" },
  });
  assert.equal(topic.text, "device/$notAVariable/status");
});

test("preserves a long numeric topic as text", () => {
  const topic = "123456789012345678901234567890";
  assert.equal(resolveTemplateText(topic, context), topic);
});

test("does not resolve the removed var token", () => {
  const result = resolveTemplatePayload('{"name":"{{var.NAME}}"}', { ...context, variableCollection: { NAME: "mqtt" } });
  assert.equal((result.value as Record<string, unknown>).name, "{{var.NAME}}");
});

test("does not resolve the removed env token", () => {
  const result = resolveTemplatePayload('{"name":"{{env.NAME}}"}', { ...context, variableCollection: { NAME: "mqtt" } });
  assert.equal((result.value as Record<string, unknown>).name, "{{env.NAME}}");
});

test("resolves nested custom functions with variables and built-ins", () => {
  const result = resolveTemplatePayload('{"value":"{{requestValue}}"}', {
    ...context,
    variableCollection: { API_KEY: "secret" },
    customFunctions: {
      requestValue: { id: "request", name: "requestValue", description: null, value: "key-$API_KEY-{{suffix}}", createdAt: "now", updatedAt: "now" },
      suffix: { id: "suffix", name: "suffix", description: null, value: "{{uuid}}", createdAt: "now", updatedAt: "now" },
    },
  });
  assert.match(String((result.value as Record<string, unknown>).value), /^key-secret-[0-9a-f-]{36}$/);
});

test("resolves padded sequence token with batch offset", () => {
  const result = resolveTemplatePayload('{"sequence":"{{sequence:1:6}}"}', { ...context, sequenceOffset: 1 });
  assert.equal((result.value as Record<string, unknown>).sequence, "000002");
});

test("exposes built-ins from the function registry", () => {
  const functions = listBuiltinFunctions();
  assert.deepEqual(functions.map((item) => item.name), ["now", "uuid", "timestamp", "sequence", "randomInt"]);
});
