import { DataSource, EntityManager, EntitySchema, FindManyOptions, ObjectLiteral, Repository } from "typeorm";
import { createId, nowIso } from "../utils";
import { BrokerProfileEntity, CollectionEntity, ConsumerSessionEntity, CustomFunctionEntity, MessageLogEntity, RequestEntity, VariableCollectionEntity, VariableEntity } from "../database/entities";
import { BrokerProfileRow, CollectionRow, ConsumerSessionRow, CustomFunctionRow, MessageLogRow, RequestRow, VariableCollectionRow, VariableRow } from "../types";
import { customFunctionNamePattern, extractCustomFunctionReferences } from "../template/custom-functions";
import { listBuiltinFunctions } from "../template/functions";

type Store = EntityManager | DataSource;

export class AppRepositories {
  constructor(private readonly source: Store) {}

  private repository<T extends ObjectLiteral>(entity: EntitySchema<T>): Repository<T> {
    return this.source.getRepository(entity);
  }

  collections() { return this.repository<CollectionRow>(CollectionEntity); }
  requests() { return this.repository<RequestRow>(RequestEntity); }
  variables() { return this.repository<VariableRow>(VariableEntity); }
  variableCollections() { return this.repository<VariableCollectionRow>(VariableCollectionEntity); }
  brokers() { return this.repository<BrokerProfileRow>(BrokerProfileEntity); }
  customFunctions() { return this.repository<CustomFunctionRow>(CustomFunctionEntity); }
  sessions() { return this.repository<ConsumerSessionRow>(ConsumerSessionEntity); }
  logs() { return this.repository<MessageLogRow>(MessageLogEntity); }

  async listCollections() { return this.collections().find({ order: { sortOrder: "ASC", createdAt: "DESC" } }); }
  async getCollection(id: string) { return this.collections().findOneBy({ id }); }
  async saveCollection(input: { id?: string | undefined; name: string; description?: string | null | undefined; variableCollectionId?: string | null | undefined; sortOrder?: number | undefined }) {
    const repo = this.collections(); const current = input.id ? await this.getCollection(input.id) : undefined; const timestamp = nowIso();
    const entity = repo.create({ id: input.id ?? createId(), name: input.name, description: input.description ?? null, variableCollectionId: input.variableCollectionId !== undefined ? input.variableCollectionId : current?.variableCollectionId ?? null, sortOrder: input.sortOrder ?? current?.sortOrder ?? (await repo.count()), createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp });
    return repo.save(entity);
  }
  async deleteCollection(id: string) { await this.collections().delete(id); }
  async reorderCollections(ids: string[]) { return this.source.transaction(async (manager) => { const repo = new AppRepositories(manager); const current = await repo.listCollections(); if (ids.length !== current.length || ids.some((id) => !current.some((item) => item.id === id))) throw new Error("Collection order does not match the workspace."); for (const [index, id] of ids.entries()) await repo.collections().update(id, { sortOrder: index, updatedAt: nowIso() }); return repo.listCollections(); }); }
  async duplicateCollection(id: string) { return this.source.transaction(async (manager) => { const repo = new AppRepositories(manager); const source = await repo.getCollection(id); if (!source) return undefined; const duplicate = await repo.saveCollection({ name: `${source.name} Copy`, description: source.description, variableCollectionId: source.variableCollectionId, sortOrder: source.sortOrder + 1 }); const requests = await repo.listRequests(id); for (const request of requests) await repo.saveRequest({ collectionId: duplicate.id, name: request.name, topic: request.topic, payloadTemplate: request.payloadTemplate, payloadFormat: request.payloadFormat, qos: request.qos, retain: request.retain, brokerProfileId: request.brokerProfileId, sortOrder: request.sortOrder }); return { collection: duplicate, requests: await repo.listRequests(duplicate.id) }; }); }
  async importCollection(input: { name: string; description?: string | null | undefined; variableCollection?: { name: string; variables: Array<{ name: string; value: string }> } | undefined; requests: Array<{ name: string; topic: string; payloadTemplate: string; payloadFormat: string; qos: number; retain: boolean }> }) {
    return this.source.transaction(async (manager) => {
      const repo = new AppRepositories(manager);
      let variableCollectionId: string | null = null;
      if (input.variableCollection) {
        const variableCollectionName = input.variableCollection.name.trim();
        const existingVariableCollection = await repo.variableCollections().createQueryBuilder("item").where("lower(item.name) = lower(:name)", { name: variableCollectionName }).getOne();
        const variableCollection = existingVariableCollection ?? await repo.saveVariableCollection({ name: variableCollectionName });
        variableCollectionId = variableCollection.id;
        for (const [index, variable] of input.variableCollection.variables.entries()) {
          const existingVariable = await repo.variables().createQueryBuilder("item").where("item.variableCollectionId = :collectionId", { collectionId: variableCollection.id }).andWhere("lower(item.name) = lower(:name)", { name: variable.name }).getOne();
          if (!existingVariable) await repo.saveVariable({ variableCollectionId: variableCollection.id, name: variable.name, value: variable.value, sortOrder: index });
        }
      }
      const baseName = input.name.trim();
      let name = baseName;
      let suffix = 0;
      while (await repo.collections().createQueryBuilder("item").where("lower(item.name) = lower(:name)", { name }).getOne()) {
        suffix += 1;
        name = suffix === 1 ? `${baseName} (Imported)` : `${baseName} (${suffix})`;
      }
      const collection = await repo.saveCollection({ name, description: input.description ?? null, variableCollectionId });
      for (const [index, request] of input.requests.entries()) {
        await repo.saveRequest({
          collectionId: collection.id,
          name: request.name,
          topic: request.topic,
          payloadTemplate: request.payloadTemplate,
          payloadFormat: request.payloadFormat,
          qos: request.qos,
          retain: request.retain,
          brokerProfileId: null,
          sortOrder: index,
        });
      }
      return { collection, requests: await repo.listRequests(collection.id) };
    });
  }

  async listRequests(collectionId?: string) { const options: FindManyOptions<RequestRow> = { order: { sortOrder: "ASC", createdAt: "DESC" } }; if (collectionId) options.where = { collectionId }; return this.requests().find(options); }
  async getRequest(id: string) { return this.requests().findOneBy({ id }); }
  async saveRequest(input: { id?: string | undefined; collectionId: string; name: string; topic: string; payloadTemplate: string; payloadFormat?: string | undefined; qos?: number | undefined; retain?: number | boolean | undefined; brokerProfileId?: string | null | undefined; sortOrder?: number | undefined }) { const repo = this.requests(); const current = input.id ? await this.getRequest(input.id) : undefined; const timestamp = nowIso(); return repo.save(repo.create({ id: input.id ?? createId(), collectionId: input.collectionId, name: input.name, topic: input.topic, payloadTemplate: input.payloadTemplate, payloadFormat: input.payloadFormat ?? current?.payloadFormat ?? "json", qos: input.qos ?? current?.qos ?? 0, retain: Number(Boolean(input.retain ?? current?.retain)), brokerProfileId: input.brokerProfileId !== undefined ? input.brokerProfileId : current?.brokerProfileId ?? null, sortOrder: input.sortOrder ?? current?.sortOrder ?? 0, createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp })); }
  async deleteRequest(id: string) { await this.requests().delete(id); }
  async reorderRequests(collectionId: string, ids: string[]) { return this.source.transaction(async (manager) => { const repo = new AppRepositories(manager); const current = await repo.listRequests(collectionId); if (ids.length !== current.length || ids.some((id) => !current.some((item) => item.id === id))) throw new Error("Request order does not match the collection."); for (const [index, id] of ids.entries()) await repo.requests().update({ id, collectionId }, { sortOrder: index, updatedAt: nowIso() }); return repo.listRequests(collectionId); }); }

  async listVariableCollections() { return this.variableCollections().find({ order: { createdAt: "DESC" } }); }
  async getVariableCollection(id: string) { return this.variableCollections().findOneBy({ id }); }
  async saveVariableCollection(input: { id?: string | undefined; name: string }) { const name = input.name.trim(); if (!name) throw new Error("Variable Collection name is required."); const query = this.variableCollections().createQueryBuilder("item").where("lower(item.name) = lower(:name)", { name }); if (input.id) query.andWhere("item.id != :id", { id: input.id }); const duplicate = await query.getOne(); if (duplicate) throw new Error(`Variable Collection "${name}" already exists.`); const current = input.id ? await this.getVariableCollection(input.id) : undefined; const timestamp = nowIso(); return this.variableCollections().save(this.variableCollections().create({ id: input.id ?? createId(), name, createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp })); }
  async deleteVariableCollection(id: string) { await this.variableCollections().delete(id); }
  async listVariables(collectionId?: string) { const options: FindManyOptions<VariableRow> = { order: { sortOrder: "ASC", createdAt: "ASC" } }; if (collectionId) options.where = { variableCollectionId: collectionId }; return this.variables().find(options); }
  async getVariable(id: string) { return this.variables().findOneBy({ id }); }
  async saveVariable(input: { id?: string | undefined; variableCollectionId: string; name: string; value?: string | undefined; sortOrder?: number | undefined }) { const name = input.name.trim(); if (!name) throw new Error("Variable name is required."); if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("Variable name may only contain letters, numbers, and underscores."); const duplicate = await this.variables().findOne({ where: { variableCollectionId: input.variableCollectionId, name } }); if (duplicate && duplicate.id !== input.id) throw new Error(`Variable "${name}" already exists in this collection.`); const current = input.id ? await this.getVariable(input.id) : undefined; const timestamp = nowIso(); return this.variables().save(this.variables().create({ id: input.id ?? createId(), variableCollectionId: input.variableCollectionId, name, value: input.value ?? current?.value ?? "", sortOrder: input.sortOrder ?? current?.sortOrder ?? (await this.variables().count({ where: { variableCollectionId: input.variableCollectionId } })), createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp })); }
  async deleteVariable(id: string) { await this.variables().delete(id); }
  async reorderVariables(collectionId: string, ids: string[]) { return this.source.transaction(async (manager) => { const repo = new AppRepositories(manager); const current = await repo.listVariables(collectionId); if (ids.length !== current.length || ids.some((id) => !current.some((item) => item.id === id))) throw new Error("Variable order does not match the collection."); for (const [index, id] of ids.entries()) await repo.variables().update({ id, variableCollectionId: collectionId }, { sortOrder: index, updatedAt: nowIso() }); return repo.listVariables(collectionId); }); }

  async listBrokers() { return this.brokers().find({ order: { createdAt: "DESC" } }); }
  async getBroker(id: string) { return this.brokers().findOneBy({ id }); }
  async saveBroker(input: { id?: string | undefined; name: string; host: string; port: number; protocol: string; validateCertificate?: boolean | number | undefined; encryption?: boolean | number | undefined; username?: string | null | undefined; password?: string | null | undefined; clientId?: string | undefined; clean?: boolean | number | undefined; keepAlive?: number | undefined; reconnectPeriod?: number | undefined; caCert?: string | null | undefined; clientCert?: string | null | undefined; clientKey?: string | null | undefined }) {
    const current = input.id ? await this.getBroker(input.id) : undefined;
    const timestamp = nowIso();
    const entity = this.brokers().create({
      id: input.id ?? createId(), name: input.name, host: input.host, port: input.port, protocol: input.protocol,
      clientId: input.clientId ?? current?.clientId ?? `mqtt-postwoman-${createId().slice(0, 8)}`,
      validateCertificate: Number(input.validateCertificate ?? current?.validateCertificate ?? 1), encryption: Number(input.encryption ?? current?.encryption ?? 0),
      clean: Number(input.clean ?? current?.clean ?? 1), keepAlive: input.keepAlive ?? current?.keepAlive ?? 30, reconnectPeriod: input.reconnectPeriod ?? current?.reconnectPeriod ?? 1000,
      username: input.username !== undefined ? input.username : current?.username ?? null, password: input.password !== undefined ? input.password : current?.password ?? null,
      caCert: input.caCert !== undefined ? input.caCert : current?.caCert ?? null, clientCert: input.clientCert !== undefined ? input.clientCert : current?.clientCert ?? null, clientKey: input.clientKey !== undefined ? input.clientKey : current?.clientKey ?? null,
      createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp,
    });
    return this.brokers().save(entity);
  }
  async deleteBroker(id: string) { await this.brokers().delete(id); }
  async listCustomFunctions() { return this.customFunctions().find({ order: { createdAt: "DESC" } }); }
  async getCustomFunction(id: string) { return this.customFunctions().findOneBy({ id }); }
  async saveCustomFunction(input: { id?: string | undefined; name: string; description?: string | null | undefined; value: string }) {
    const name = input.name.trim();
    if (!customFunctionNamePattern.test(name)) throw new Error("Custom function name may only contain letters, numbers, and underscores.");
    const builtInNames = new Set(listBuiltinFunctions().map((builtin) => builtin.name));
    if (builtInNames.has(name)) throw new Error(`Custom function name "${name}" conflicts with a built-in function.`);
    const duplicate = await this.customFunctions().findOneBy({ name });
    if (duplicate && duplicate.id !== input.id) throw new Error(`Custom function "${name}" already exists.`);
    const current = input.id ? await this.getCustomFunction(input.id) : undefined;
    const timestamp = nowIso();
    const candidate: CustomFunctionRow = {
      id: input.id ?? createId(), name, description: input.description?.trim() || null, value: input.value,
      createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp,
    };
    const functions = [...(await this.listCustomFunctions()).filter((item) => item.id !== candidate.id), candidate];
    const names = new Set(functions.map((item) => item.name));
    const dependencies = new Map(functions.map((item) => [
      item.name,
      extractCustomFunctionReferences(item.value).filter(
        (reference) => names.has(reference) && !builtInNames.has(reference),
      ),
    ]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (functionName: string): boolean => {
      if (visiting.has(functionName)) return true;
      if (visited.has(functionName)) return false;
      visiting.add(functionName);
      const hasLoop = (dependencies.get(functionName) ?? []).some(visit);
      visiting.delete(functionName);
      visited.add(functionName);
      return hasLoop;
    };
    if (functions.some((item) => visit(item.name))) throw new Error("Custom function dependency loop detected.");
    return this.customFunctions().save(this.customFunctions().create(candidate));
  }
  async deleteCustomFunction(id: string) {
    const current = await this.getCustomFunction(id);
    if (!current) return false;
    const builtInNames = new Set(listBuiltinFunctions().map((builtin) => builtin.name));
    const dependents = (await this.listCustomFunctions())
      .filter(
        (item) =>
          item.id !== id &&
          !builtInNames.has(current.name) &&
          extractCustomFunctionReferences(item.value).includes(current.name),
      )
      .map((item) => item.name);
    if (dependents.length) throw new Error(`Custom function "${current.name}" is referenced by: ${dependents.join(", ")}.`);
    await this.customFunctions().delete(id);
    return true;
  }
  async listSessions() { return this.sessions().find({ order: { createdAt: "DESC" } }); }
  async getSession(id: string) { return this.sessions().findOneBy({ id }); }
  async saveSession(input: Partial<ConsumerSessionRow> & { name: string; brokerProfileId: string; topics: string[] }) { const current = input.id ? await this.getSession(input.id) : undefined; const timestamp = nowIso(); return this.sessions().save(this.sessions().create({ ...current, id: input.id ?? createId(), name: input.name, brokerProfileId: input.brokerProfileId, topicsJson: JSON.stringify(input.topics), qos: input.qos ?? current?.qos ?? 0, active: Number(input.active ?? current?.active ?? 1), createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp })); }
  async deleteSession(id: string) { await this.sessions().delete(id); }
  async listLogs(limit = 200) { return this.logs().find({ order: { createdAt: "DESC" }, take: limit }); }
  async clearLogs() { await this.logs().clear(); }
  async addLog(input: Omit<MessageLogRow, "id"> & { id?: string }) { return this.logs().save(this.logs().create({ ...input, id: input.id ?? createId() })); }
  async bootstrap() { return { collections: await this.listCollections(), requests: await this.listRequests(), variableCollections: await this.listVariableCollections(), variables: await this.listVariables(), brokers: await this.listBrokers(), customFunctions: await this.listCustomFunctions(), consumerSessions: await this.listSessions(), logs: await this.listLogs() }; }
}
