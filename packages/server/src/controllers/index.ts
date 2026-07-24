import { AppServices, CollectionInput, RequestInput, VariableCollectionInput, VariableInput, PublishInput, BatchPublishInput, BrokerInput } from "../services/app-services";
import { RuntimeService } from "../runtime";
import { CollectionTransferService } from "../services/collection-transfer";

export class CollectionController {
  constructor(private readonly service: AppServices) {}
  list = () => this.service.collections.list();
  save = (input: CollectionInput) => this.service.collections.save(input);
  remove = (id: string) => this.service.collections.delete(id);
  reorder = (ids: string[]) => this.service.collections.reorder(ids);
  duplicate = (id: string) => this.service.collections.duplicate(id);
}

export class CollectionTransferController {
  constructor(private readonly service: CollectionTransferService) {}
  static safeFileName(value: string) { return CollectionTransferService.safeFileName(value); }
  export = (id: string) => this.service.exportCollection(id);
  import = (buffer: Buffer, name?: string, description?: string | null) => this.service.importCollection(buffer, name, description);
}

export class RequestController {
  constructor(private readonly service: AppServices) {}
  list = (collectionId?: string) => this.service.requests.list(collectionId);
  get = (id: string) => this.service.requests.get(id);
  save = (input: RequestInput) => this.service.requests.save(input);
  remove = (id: string) => this.service.requests.delete(id);
  reorder = (collectionId: string, ids: string[]) => this.service.requests.reorder(collectionId, ids);
}

export class VariableController {
  constructor(private readonly service: AppServices) {}
  listCollections = () => this.service.variables.collections();
  saveCollection = (input: VariableCollectionInput) => this.service.variables.saveCollection(input);
  removeCollection = (id: string) => this.service.variables.deleteCollection(id);
  list = (id?: string) => this.service.variables.list(id);
  get = (id: string) => this.service.variables.get(id);
  save = (input: VariableInput) => this.service.variables.save(input);
  remove = (id: string) => this.service.variables.delete(id);
  reorder = (id: string, ids: string[]) => this.service.variables.reorder(id, ids);
}

export class PublishController {
  constructor(private readonly service: AppServices) {}
  publish = (input: PublishInput) => this.service.publish(input);
  batch = (input: BatchPublishInput) => this.service.batchPublish(input);
  resolve = (template: string, variableCollectionId: string | null | undefined, variables: Record<string, unknown>) => this.service.resolve(template, variableCollectionId, variables);
}

export class BrokerController {
  constructor(private readonly service: AppServices, private readonly runtime: RuntimeService) {}
  list = () => this.service.brokers.list();
  save = (input: BrokerInput) => this.service.brokers.save(input);
  remove = (id: string) => this.service.brokers.delete(id);
  statuses = () => this.runtime.listBrokerStatuses();
  connect = (id: string) => this.runtime.connectBroker(id);
  test = (id: string) => this.runtime.testBrokerConnection(id);
  testConfig = (input: Parameters<RuntimeService["testBrokerConfig"]>[0]) => this.runtime.testBrokerConfig(input);
  disconnect = (id: string) => this.runtime.disconnectBroker(id);
}

export class CustomFunctionController {
  constructor(private readonly service: AppServices) {}
  list = () => this.service.customFunctions.list();
  save = (input: Parameters<AppServices["customFunctions"]["save"]>[0]) => this.service.customFunctions.save(input);
  remove = (id: string) => this.service.customFunctions.delete(id);
}

export class ConsumerController {
  constructor(private readonly runtime: RuntimeService, private readonly service: AppServices) {}
  list = () => this.service.repositories.listSessions();
  start = (input: Parameters<RuntimeService["startConsumer"]>[0]) => this.runtime.startConsumer(input);
  stop = (id: string) => this.runtime.stopConsumer(id);
  unsubscribe = (id: string, topic: string) => this.runtime.unsubscribeConsumerTopic(id, topic);
}

export class LogController {
  constructor(private readonly service: AppServices) {}
  list = (limit?: number) => this.service.logs.list(limit);
  clear = () => this.service.logs.clear();
}

export function createControllers(service: AppServices, runtime: RuntimeService) {
  const transfer = new CollectionTransferService(service.repositories);
  return {
    collections: new CollectionController(service),
    collectionTransfer: new CollectionTransferController(transfer),
    requests: new RequestController(service),
    variables: new VariableController(service),
    publish: new PublishController(service),
    brokers: new BrokerController(service, runtime),
    customFunctions: new CustomFunctionController(service),
    consumers: new ConsumerController(runtime, service),
    logs: new LogController(service),
  };
}
