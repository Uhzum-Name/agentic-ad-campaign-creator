import {
  answerQuestion,
  approvePlan,
  askQuestions,
  getCampaignContext,
  getPlan,
  listPlans,
  pendingInput,
  proposePlan,
  requestPlanChanges,
  saveBriefAnalysis,
} from "@adengine/engine";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type AppDeps, parse } from "../app.ts";

const AnswerBody = z.object({ answer: z.string() });
const ApproveBody = z.object({ by: z.enum(["user", "agent"]).default("user"), note: z.string().max(2000).optional() });
const ChangesBody = z.object({ feedback: z.string() });

export function planningRoutes(app: FastifyInstance, { db }: AppDeps): void {
  /** Everything an agent needs to work on the campaign. */
  app.get<{ Params: { id: string } }>("/campaigns/:id/context", async (req) => ({ data: await getCampaignContext(db, req.params.id) }));

  app.put<{ Params: { id: string } }>("/campaigns/:id/brief/analysis", async (req) => ({ data: await saveBriefAnalysis(db, req.params.id, req.body) }));

  app.post<{ Params: { id: string } }>("/campaigns/:id/questions", async (req, reply) =>
    reply.status(201).send({ data: await askQuestions(db, req.params.id, req.body) }),
  );

  app.post<{ Params: { id: string } }>("/messages/:id/answer", async (req) => ({
    data: await answerQuestion(db, req.params.id, parse(AnswerBody, req.body).answer),
  }));

  app.get<{ Params: { id: string }; Querystring: { markRead?: string } }>("/campaigns/:id/pending-input", async (req) => ({
    data: await pendingInput(db, req.params.id, req.query.markRead === "true"),
  }));

  app.get<{ Params: { id: string } }>("/campaigns/:id/plans", async (req) => ({ data: await listPlans(db, req.params.id) }));

  app.post<{ Params: { id: string } }>("/campaigns/:id/plans", async (req, reply) =>
    reply.status(201).send({ data: await proposePlan(db, req.params.id, req.body) }),
  );

  app.get<{ Params: { id: string } }>("/plans/:id", async (req) => ({ data: await getPlan(db, req.params.id) }));

  app.post<{ Params: { id: string } }>("/plans/:id/approve", async (req) => {
    const body = parse(ApproveBody, req.body);
    return { data: await approvePlan(db, req.params.id, { by: body.by, ...(body.note ? { note: body.note } : {}) }) };
  });

  app.post<{ Params: { id: string } }>("/plans/:id/request-changes", async (req) => ({
    data: await requestPlanChanges(db, req.params.id, parse(ChangesBody, req.body).feedback),
  }));
}
