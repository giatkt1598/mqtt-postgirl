import { MessageLogRow } from "../models";

export function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function toPrettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

export function joinTopics(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function beautifyXml(value: string) {
  const normalized = value.replace(/>\s*</g, "><").replace(/></g, ">\n<");
  let depth = 0;
  return normalized
    .split("\n")
    .map((line) => {
      if (line.startsWith("</")) depth = Math.max(depth - 1, 0);
      const formatted = `${"  ".repeat(depth)}${line}`;
      if (
        line.startsWith("<") &&
        !line.startsWith("</") &&
        !line.endsWith("/>") &&
        !line.includes("</")
      )
        depth += 1;
      return formatted;
    })
    .join("\n");
}

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toXmlElement(name: string, value: JsonValue): string {
  if (Array.isArray(value)) {
    return value.map((item) => toXmlElement(name, item)).join("");
  }
  if (!isJsonObject(value)) {
    return `<${name}>${value === null ? "" : escapeXml(String(value))}</${name}>`;
  }

  const attributes = Object.entries(value)
    .filter(([key]) => key.startsWith("@"))
    .map(([key, attributeValue]) => ` ${key.slice(1)}="${escapeXml(String(attributeValue ?? ""))}"`)
    .join("");
  const text = value["#text"];
  const children = Object.entries(value)
    .filter(([key]) => !key.startsWith("@") && key !== "#text")
    .map(([key, child]) => toXmlElement(key, child))
    .join("");
  const content = `${text === undefined ? "" : escapeXml(String(text ?? ""))}${children}`;
  return `<${name}${attributes}>${content}</${name}>`;
}

export function jsonToXml(value: string) {
  const parsed = JSON.parse(value) as JsonValue;
  if (!isJsonObject(parsed)) {
    return beautifyXml(toXmlElement("root", parsed));
  }
  const entries = Object.entries(parsed);
  const xml = entries.length === 1
    ? toXmlElement(entries[0]![0], entries[0]![1])
    : toXmlElement("root", parsed);
  return beautifyXml(xml);
}

function fromXmlElement(element: Element): JsonValue {
  const result: JsonObject = {};
  for (const attribute of Array.from(element.attributes)) {
    result[`@${attribute.name}`] = attribute.value;
  }

  const children = Array.from(element.children);
  const text = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();

  if (children.length === 0 && Object.keys(result).length === 0) return text;
  if (text) result["#text"] = text;
  for (const child of children) {
    const childValue = fromXmlElement(child);
    const existing = result[child.tagName];
    result[child.tagName] = existing === undefined
      ? childValue
      : Array.isArray(existing)
        ? [...existing, childValue]
        : [existing, childValue];
  }
  return result;
}

export function xmlToJson(value: string) {
  const document = new DOMParser().parseFromString(value, "application/xml");
  const error = document.querySelector("parsererror");
  if (error || !document.documentElement) {
    throw new Error(error?.textContent?.trim() || "Invalid XML payload.");
  }
  return JSON.stringify(
    { [document.documentElement.tagName]: fromXmlElement(document.documentElement) },
    null,
    2,
  );
}

export function randomTopicColor() {
  return `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0")}`;
}

export function mergeLogs(current: MessageLogRow[], incoming: MessageLogRow[]) {
  const byId = new Map(current.map((log) => [log.id, log]));
  for (const log of incoming) byId.set(log.id, log);
  return [...byId.values()]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    )
    .slice(0, 200);
}
