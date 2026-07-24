import archiver = require("archiver");
import unzipper from "unzipper";
import { AppRepositories } from "../repositories";
import { CollectionRow, RequestRow } from "../types";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
type ArchiverFactory = (format: "zip", options: { zlib: { level: number } }) => archiver.Archiver;

export interface ImportedRequest {
  name: string;
  topic: string;
  payloadTemplate: string;
  payloadFormat: "raw" | "xml" | "json";
  qos: number;
  retain: boolean;
}

export interface ImportedVariable {
  name: string;
  value: string;
}

export interface ImportedVariableCollection {
  name: string;
  variables: ImportedVariable[];
}

export interface ImportedCollection {
  name: string;
  description: string | null;
  requests: ImportedRequest[];
}

function safeFileName(value: string) {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-") || "collection";
}

function parseJson(value: Buffer, fileName: string): unknown {
  try {
    return JSON.parse(value.toString("utf8")) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${fileName}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, fileName: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${fileName}: ${field} is required.`);
  return value;
}

function parseManifest(value: unknown): Pick<ImportedCollection, "name" | "description"> {
  if (!isRecord(value)) throw new Error("collection.json must contain an object.");
  return {
    name: requiredString(value.name, "name", "collection.json").trim(),
    description: value.description === null || value.description === undefined
      ? null
      : requiredString(value.description, "description", "collection.json"),
  };
}

function parseVariable(value: unknown, fileName: string): ImportedVariable {
  if (!isRecord(value)) throw new Error(`${fileName} must contain an object.`);
  return {
    name: requiredString(value.name, "name", fileName).trim(),
    value: typeof value.value === "string" ? value.value : "",
  };
}

function parseVariableCollection(value: unknown, fileName: string): ImportedVariableCollection {
  if (!isRecord(value)) throw new Error(`${fileName} must contain an object.`);
  const name = requiredString(value.name, "name", fileName).trim();
  if (!Array.isArray(value.variables)) throw new Error(`${fileName}: variables must be an array.`);
  const names = new Set<string>();
  const variables = value.variables.map((item, index) => {
    const variable = parseVariable(item, `${fileName} variable[${index}]`);
    const normalizedName = variable.name.toLowerCase();
    if (names.has(normalizedName)) throw new Error(`${fileName}: duplicate variable "${variable.name}".`);
    names.add(normalizedName);
    return variable;
  });
  return { name, variables };
}

function parseRequest(value: unknown, fileName: string): ImportedRequest {
  if (!isRecord(value)) throw new Error(`${fileName} must contain an object.`);
  const qos = value.qos === undefined ? 0 : value.qos;
  if (typeof qos !== "number" || !Number.isInteger(qos) || qos < 0 || qos > 2) {
    throw new Error(`${fileName}: qos must be an integer between 0 and 2.`);
  }
  if (value.retain !== undefined && typeof value.retain !== "boolean") {
    throw new Error(`${fileName}: retain must be a boolean.`);
  }
  const payloadFormat = value.payloadFormat === undefined ? "json" : value.payloadFormat;
  if (payloadFormat !== "raw" && payloadFormat !== "xml" && payloadFormat !== "json") {
    throw new Error(`${fileName}: payloadFormat must be raw, xml, or json.`);
  }
  return {
    name: requiredString(value.name, "name", fileName).trim(),
    topic: typeof value.topic === "string" ? value.topic : "",
    payloadTemplate: typeof value.payloadTemplate === "string" ? value.payloadTemplate : "{}",
    payloadFormat,
    qos,
    retain: value.retain ?? false,
  };
}

export class CollectionTransferService {
  constructor(private readonly repositories: AppRepositories) {}

  async exportCollection(id: string) {
    const collection = await this.repositories.getCollection(id);
    if (!collection) throw new Error("Collection not found.");
    const requests = await this.repositories.listRequests(id);
    const variableCollection = collection.variableCollectionId
      ? await this.repositories.getVariableCollection(collection.variableCollectionId)
      : undefined;
    const variables = variableCollection
      ? await this.repositories.listVariables(variableCollection.id)
      : [];
    const archive = (archiver as unknown as ArchiverFactory)("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      archive.once("end", () => resolve(Buffer.concat(chunks)));
      archive.once("error", reject);
    });
    archive.append(JSON.stringify({ name: collection.name, description: collection.description }, null, 2), { name: "collection.json" });
    if (variableCollection) {
      archive.append(JSON.stringify({
        name: variableCollection.name,
        variables: variables.map((variable) => ({ name: variable.name, value: variable.value })),
      }, null, 2), { name: "variables.json" });
    }
    requests.forEach((request, index) => {
      const fileName = `${String(index + 1).padStart(3, "0")}-${safeFileName(request.name)}.json`;
      archive.append(JSON.stringify(this.exportRequest(request), null, 2), { name: `requests/${fileName}` });
    });
    await archive.finalize();
    return { collection, buffer: await completed };
  }

  async importCollection(buffer: Buffer, name?: string, description?: string | null) {
    if (buffer.length === 0 || buffer.length > MAX_IMPORT_BYTES) throw new Error("ZIP file must be between 1 byte and 10 MB.");
    let manifest: Pick<ImportedCollection, "name" | "description"> | undefined;
    const requests: Array<{ order: string; request: ImportedRequest }> = [];
    let variableFileCollection: ImportedVariableCollection | null = null;
    const directory = await unzipper.Open.buffer(buffer);
    for (const entry of directory.files) {
      const normalizedPath = entry.path.replace(/\\/g, "/");
      if (normalizedPath.includes("..") || normalizedPath.startsWith("/") || normalizedPath.includes("\u0000")) {
        throw new Error(`Unsafe ZIP path: ${entry.path}`);
      }
      if (entry.type === "Directory") continue;
      if (normalizedPath === "collection.json") {
        manifest = parseManifest(parseJson(await entry.buffer(), entry.path));
      } else if (normalizedPath === "variables.json") {
        variableFileCollection = parseVariableCollection(parseJson(await entry.buffer(), entry.path), entry.path);
      } else if (normalizedPath.startsWith("requests/") && normalizedPath.endsWith(".json")) {
        requests.push({ order: normalizedPath.slice("requests/".length), request: parseRequest(parseJson(await entry.buffer(), entry.path), entry.path) });
      } else {
        throw new Error(`Unsupported file in ZIP: ${entry.path}`);
      }
    }
    if (!manifest) throw new Error("ZIP must contain collection.json.");
    requests.sort((left, right) => left.order.localeCompare(right.order, undefined, { numeric: true }));
    const imported = await this.repositories.importCollection({
      name: name?.trim() || manifest.name,
      description: description !== undefined ? description : manifest.description,
      variableCollection: variableFileCollection
        ? { name: variableFileCollection.name, variables: variableFileCollection.variables }
        : undefined,
      requests: requests.map((item) => item.request),
    });
    return imported;
  }

  private exportRequest(request: RequestRow) {
    return {
      name: request.name,
      topic: request.topic,
      payloadTemplate: request.payloadTemplate,
      payloadFormat: request.payloadFormat,
      qos: request.qos,
      retain: Boolean(request.retain),
    };
  }

  static safeFileName(value: string) {
    return safeFileName(value);
  }
}

export type CollectionTransferResult = { collection: CollectionRow; requests: RequestRow[] };
