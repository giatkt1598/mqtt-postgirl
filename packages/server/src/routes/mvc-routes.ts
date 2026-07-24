import express, { Request as ExpressRequest, Response, Router } from "express";
import { DataSource } from "typeorm";
import { z } from "zod";
import { asyncHandler } from "../middleware/async-handler";
import { AppRepositories } from "../repositories";
import { RuntimeService } from "../runtime";
import { AppServices, schemas } from "../services/app-services";
import { CollectionTransferController, createControllers } from "../controllers";
import { listBuiltinFunctions } from "../template/functions";
import { nowIso } from "../utils";

const route = asyncHandler;
type Request = ExpressRequest<{ id: string }>;
const orderSchema = z.object({ collectionIds: z.array(z.string()).optional(), requestIds: z.array(z.string()).optional(), variableIds: z.array(z.string()).optional() });
const consumerSchema = z.object({ name: z.string().min(1), brokerProfileId: z.string().min(1), topics: z.array(z.string().min(1)).min(1), qos: z.number().int().min(0).max(2).default(0) });
const customFunctionSchema = z.object({ id: z.string().optional(), name: z.string().trim().regex(/^[A-Za-z0-9_]+$/, "Custom function name may only contain letters, numbers, and underscores."), description: z.string().trim().optional().nullable(), value: z.string() });
const templateSchema = z.object({ template: z.string(), variableCollectionId: z.string().nullable().optional(), variables: z.record(z.string(), z.unknown()).default({}) });
const publishSchema = z.object({ requestId: z.string().optional(), brokerProfileId: z.string().optional(), topic: z.string().optional(), payloadTemplate: z.string().optional(), qos: z.number().int().min(0).max(2).default(0), retain: z.boolean().default(false), variableCollectionId: z.string().nullable().optional(), variables: z.record(z.string(), z.unknown()).default({}) });
const batchSchema = publishSchema.extend({ count: z.number().int().min(1).max(1000000).default(10), delayMs: z.number().int().min(0).max(60000).default(0), items: z.array(z.object({ topic: z.string().optional(), payloadTemplate: z.string().optional(), variables: z.record(z.string(), z.unknown()).optional() })).optional() });

export function buildMvcRouter(dataSource: DataSource, runtime: RuntimeService) {
  const router = Router();
  const repositories = new AppRepositories(dataSource);
  const services = new AppServices(repositories, runtime);
  const controllers = createControllers(services, runtime);

  router.get("/health", (_req: Request, res: Response) => res.json({ ok: true, now: nowIso() }));
  router.get("/bootstrap", route(async (_req: Request, res: Response) => res.json(await repositories.bootstrap())));

  router.get("/collections", route(async (_req: Request, res: Response) => res.json(await controllers.collections.list())));
  router.get("/collections/:id/export", route(async (req: Request, res: Response) => {
    const result = await controllers.collectionTransfer.export(req.params.id);
    res.type("application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${CollectionTransferController.safeFileName(result.collection.name)}.mqtt-postgirl.zip"`);
    res.send(result.buffer);
  }));
  router.post("/collections/import", express.raw({ type: "application/zip", limit: "10mb" }), route(async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body)) throw new Error("A ZIP file is required.");
    const name = typeof req.headers["x-collection-name"] === "string" ? req.headers["x-collection-name"] : undefined;
    const description = typeof req.headers["x-collection-description"] === "string" ? req.headers["x-collection-description"] : undefined;
    res.status(201).json(await controllers.collectionTransfer.import(req.body, name, description));
  }));
  router.post("/collections", route(async (req: Request, res: Response) => res.status(201).json(await controllers.collections.save(schemas.collection.parse(req.body)))));
  router.put("/collections/order", route(async (req: Request, res: Response) => { const input = orderSchema.parse(req.body); if (!input.collectionIds) throw new Error("Collection order is required."); return res.json(await controllers.collections.reorder(input.collectionIds)); }));
  router.put("/collections/:id", route(async (req: Request, res: Response) => res.json(await controllers.collections.save(schemas.collection.parse({ ...req.body, id: req.params.id })) )));
  router.delete("/collections/:id", route(async (req: Request, res: Response) => { await controllers.collections.remove(req.params.id); res.status(204).end(); }));
  router.post("/collections/:id/duplicate", route(async (req: Request, res: Response) => { const result = await controllers.collections.duplicate(req.params.id); if (!result) return res.status(404).json({ message: "Collection not found" }); return res.status(201).json(result); }));

  router.get("/requests", route(async (req: Request, res: Response) => res.json(await services.requests.list(typeof req.query.collectionId === "string" ? req.query.collectionId : undefined))));
  router.post("/requests", route(async (req: Request, res: Response) => res.status(201).json(await controllers.requests.save(schemas.request.parse(req.body)))));
  router.put("/requests/:id", route(async (req: Request, res: Response) => res.json(await controllers.requests.save(schemas.request.parse({ ...req.body, id: req.params.id })) )));
  router.delete("/requests/:id", route(async (req: Request, res: Response) => { await controllers.requests.remove(req.params.id); res.status(204).end(); }));
  router.put("/collections/:id/requests/order", route(async (req: Request, res: Response) => { const input = orderSchema.parse(req.body); if (!input.requestIds) throw new Error("Request order is required."); return res.json(await controllers.requests.reorder(req.params.id, input.requestIds)); }));

  router.get("/variable-collections", route(async (_req: Request, res: Response) => res.json(await controllers.variables.listCollections())));
  router.post("/variable-collections", route(async (req: Request, res: Response) => res.status(201).json(await controllers.variables.saveCollection(schemas.variableCollection.parse(req.body)))));
  router.put("/variable-collections/:id", route(async (req: Request, res: Response) => res.json(await controllers.variables.saveCollection(schemas.variableCollection.parse({ ...req.body, id: req.params.id })) )));
  router.delete("/variable-collections/:id", route(async (req: Request, res: Response) => { await controllers.variables.removeCollection(req.params.id); res.status(204).end(); }));
  router.get("/variable-collections/:id/variables", route(async (req: Request, res: Response) => res.json(await controllers.variables.list(req.params.id))));
  router.post("/variable-collections/:id/variables", route(async (req: Request, res: Response) => res.status(201).json(await controllers.variables.save(schemas.variable.parse({ ...req.body, variableCollectionId: req.params.id })) )));
  router.put("/variable-collections/:id/variables/order", route(async (req: Request, res: Response) => { const input = orderSchema.parse(req.body); if (!input.variableIds) throw new Error("Variable order is required."); return res.json(await controllers.variables.reorder(req.params.id, input.variableIds)); }));
  router.put("/variables/:id", route(async (req: Request, res: Response) => { const current = await controllers.variables.get(req.params.id); if (!current) return res.status(404).json({ message: "Variable not found" }); return res.json(await controllers.variables.save(schemas.variable.parse({ ...current, ...req.body, id: req.params.id }))); }));
  router.delete("/variables/:id", route(async (req: Request, res: Response) => { await controllers.variables.remove(req.params.id); res.status(204).end(); }));

  router.get("/brokers", route(async (_req: Request, res: Response) => res.json(await services.brokers.list())));
  router.get("/brokers/status", (_req: Request, res: Response) => res.json(runtime.listBrokerStatuses()));
  router.post("/brokers", route(async (req: Request, res: Response) => res.status(201).json(await services.brokers.save(schemas.broker.parse(req.body)))));
  router.put("/brokers/:id", route(async (req: Request, res: Response) => res.json(await services.brokers.save(schemas.broker.parse({ ...req.body, id: req.params.id })) )));
  router.delete("/brokers/:id", route(async (req: Request, res: Response) => { await services.brokers.delete(req.params.id); res.status(204).end(); }));
  router.post("/brokers/:id/connect", route(async (req: Request, res: Response) => res.json(await runtime.connectBroker(req.params.id))));
  router.post("/brokers/:id/test", route(async (req: Request, res: Response) => res.json(await runtime.testBrokerConnection(req.params.id))));
  router.post("/brokers/test", route(async (req: Request, res: Response) => res.json(await runtime.testBrokerConfig(schemas.broker.omit({ id: true, name: true }).parse(req.body)) )));
  router.post("/brokers/:id/disconnect", route(async (req: Request, res: Response) => { await runtime.disconnectBroker(req.params.id); res.status(204).end(); }));

  router.get("/custom-functions", route(async (_req: Request, res: Response) => res.json(await controllers.customFunctions.list())));
  router.post("/custom-functions", route(async (req: Request, res: Response) => res.status(201).json(await controllers.customFunctions.save(customFunctionSchema.parse(req.body)))));
  router.put("/custom-functions/:id", route(async (req: Request, res: Response) => res.json(await controllers.customFunctions.save(customFunctionSchema.parse({ ...req.body, id: req.params.id })) )));
  router.delete("/custom-functions/:id", route(async (req: Request, res: Response) => { const deleted = await controllers.customFunctions.remove(req.params.id); if (!deleted) return res.status(404).json({ message: "Custom function not found" }); return res.status(204).end(); }));

  router.get("/consumer-sessions", route(async (_req: Request, res: Response) => res.json(await repositories.listSessions())));
  router.post("/consumer-sessions", route(async (req: Request, res: Response) => res.status(201).json(await runtime.startConsumer(consumerSchema.parse(req.body)))));
  router.delete("/consumer-sessions/:id", route(async (req: Request, res: Response) => { const result = await runtime.stopConsumer(req.params.id); if (!result) return res.status(404).json({ message: "Consumer session not found" }); return res.status(204).end(); }));
  router.delete("/consumer-sessions/:id/topics", route(async (req: Request, res: Response) => { const result = await runtime.unsubscribeConsumerTopic(req.params.id, z.object({ topic: z.string().min(1) }).parse(req.body).topic); if (!result) return res.status(404).json({ message: "Consumer session not found" }); return res.json(result); }));

  router.get("/logs", route(async (req: Request, res: Response) => { const limit = Math.min(Number(req.query.limit ?? 200), 1000); return res.json(await services.logs.list(Number.isNaN(limit) ? 200 : limit)); }));
  router.delete("/logs", route(async (_req: Request, res: Response) => { await services.logs.clear(); res.status(204).end(); }));
  router.post("/publish", route(async (req: Request, res: Response) => res.json(await controllers.publish.publish(publishSchema.parse(req.body)))));
  router.post("/publish/batch", route(async (req: Request, res: Response) => res.json(await controllers.publish.batch(batchSchema.parse(req.body)))));
  router.post("/templates/resolve", route(async (req: Request, res: Response) => { const input = templateSchema.parse(req.body); return res.json(await controllers.publish.resolve(input.template, input.variableCollectionId, input.variables)); }));
  router.get("/templates/functions", (_req: Request, res: Response) => res.json(listBuiltinFunctions()));
  router.get("/catalog", route(async (_req: Request, res: Response) => res.json(await repositories.bootstrap())));
  return router;
}
