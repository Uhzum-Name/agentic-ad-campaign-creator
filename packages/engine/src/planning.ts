import {
  AppError,
  AskQuestionsInput,
  BriefAnalysis,
  CreativePlan,
  type PlanStatus,
  estimatePlan,
} from "@adengine/core";
import {
  type Db,
  agentMessages,
  briefs,
  campaigns,
  creativeDirections,
  creativePlans,
  designDocuments,
  projectFonts,
  projects,
  variations,
} from "@adengine/db";
import { summarizeDesign } from "@adengine/design";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";

/*
 * Planning: everything between a brief and approved creative directions.
 * The connected agent does the thinking and submits structured results; this
 * module validates them, stores them, records the conversation, and applies
 * approvals.
 */

export type PlanRow = typeof creativePlans.$inferSelect;
export type MessageRow = typeof agentMessages.$inferSelect;

function invalid(message: string, issues: { path: PropertyKey[]; message: string }[]): AppError {
  return new AppError("validation_error", message, issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })));
}

async function requireCampaign(db: Db, id: string) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!row) throw AppError.notFound("Campaign", id);
  return row;
}

async function currentBrief(db: Db, campaignId: string) {
  const [row] = await db.select().from(briefs).where(eq(briefs.campaignId, campaignId)).orderBy(desc(briefs.version)).limit(1);
  return row ?? null;
}

async function post(db: Db, values: typeof agentMessages.$inferInsert): Promise<MessageRow> {
  const [row] = await db.insert(agentMessages).values(values).returning();
  if (!row) throw new Error("Failed to record message");
  return row;
}

// ---------------------------------------------------------------- context

/**
 * Everything an agent needs to work on a campaign, in one read: the project,
 * the brief and its analysis, the designs it can build from (with their
 * layers' roles and text), fonts, directions, plans, and what the person has
 * said that the agent has not yet picked up.
 */
export async function getCampaignContext(db: Db, campaignId: string) {
  const campaign = await requireCampaign(db, campaignId);
  const [project] = await db.select().from(projects).where(eq(projects.id, campaign.projectId));
  const brief = await currentBrief(db, campaignId);
  const [designs, fonts, directions, variationCounts, plans, recent, pending] = await Promise.all([
    db.select().from(designDocuments).where(eq(designDocuments.projectId, campaign.projectId)).orderBy(asc(designDocuments.createdAt)),
    db.select({ family: projectFonts.family, weight: projectFonts.weight, style: projectFonts.style }).from(projectFonts).where(eq(projectFonts.projectId, campaign.projectId)),
    db.select().from(creativeDirections).where(eq(creativeDirections.campaignId, campaignId)).orderBy(asc(creativeDirections.position)),
    db
      .select({ directionId: variations.directionId, status: variations.status, n: sql<number>`count(*)::int` })
      .from(variations)
      .where(eq(variations.campaignId, campaignId))
      .groupBy(variations.directionId, variations.status),
    db.select().from(creativePlans).where(eq(creativePlans.campaignId, campaignId)).orderBy(desc(creativePlans.version)),
    db.select().from(agentMessages).where(eq(agentMessages.campaignId, campaignId)).orderBy(desc(agentMessages.createdAt)).limit(30),
    pendingInput(db, campaignId, false),
  ]);
  const uploaded = new Set(fonts.map((f) => f.family.toLowerCase()));
  const latestPlan = plans[0];
  return {
    project: project ? { id: project.id, name: project.name, description: project.description } : null,
    campaign: { id: campaign.id, name: campaign.name, objective: campaign.objective, status: campaign.status },
    brief: brief ? { version: brief.version, text: brief.text, analysis: brief.analysis, analyzedAt: brief.analyzedAt, savedAt: brief.createdAt } : null,
    designs: designs.map((d) => {
      const s = summarizeDesign(d.document);
      return {
        id: d.id,
        name: d.name,
        width: d.width,
        height: d.height,
        source: d.source.kind,
        roles: s.roles,
        texts: s.texts,
        images: s.images.map((i) => ({ id: i.id, name: i.name, role: i.role })),
        fonts: s.fonts.map((family) => ({ family, uploaded: uploaded.has(family.toLowerCase()) })),
      };
    }),
    fonts,
    directions: directions.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      concept: d.concept,
      messagingAngle: d.messagingAngle,
      visualTreatment: d.visualTreatment,
      planId: d.planId,
      plannedVariations: d.plannedVariations,
      varyElements: d.varyElements,
      sourceDesignId: d.sourceDesignId,
      variations: Object.fromEntries(variationCounts.filter((v) => v.directionId === d.id).map((v) => [v.status, v.n])),
    })),
    plans: plans.map((p) => ({ id: p.id, version: p.version, status: p.status, feedback: p.feedback, decidedBy: p.decidedBy, decidedAt: p.decidedAt })),
    latestPlan: latestPlan ? { ...latestPlan } : null,
    pendingInput: pending,
    recentThread: recent.reverse().map((m) => ({
      id: m.id,
      role: m.role,
      kind: m.kind,
      text: m.text,
      ...(m.question ? { question: m.question, answer: m.answer } : {}),
      createdAt: m.createdAt,
    })),
  };
}

// ---------------------------------------------------------------- brief

export async function saveBriefAnalysis(db: Db, campaignId: string, input: unknown) {
  const parsed = BriefAnalysis.safeParse(input);
  if (!parsed.success) throw invalid("The brief analysis is not valid", parsed.error.issues);
  await requireCampaign(db, campaignId);
  const brief = await currentBrief(db, campaignId);
  if (!brief) throw new AppError("conflict", "This campaign has no brief yet. Save a brief before analysing it.");
  const [row] = await db.update(briefs).set({ analysis: parsed.data, analyzedAt: new Date() }).where(eq(briefs.id, brief.id)).returning();
  await post(db, {
    campaignId,
    role: "agent",
    kind: "activity",
    text: `Analysed brief v${brief.version}${parsed.data.missingInformation.length ? `; ${parsed.data.missingInformation.length} open question${parsed.data.missingInformation.length === 1 ? "" : "s"}` : ""}`,
  });
  return row!;
}

// ---------------------------------------------------------------- questions

export async function askQuestions(db: Db, campaignId: string, input: unknown): Promise<MessageRow[]> {
  const parsed = AskQuestionsInput.safeParse(input);
  if (!parsed.success) throw invalid("The questions are not valid", parsed.error.issues);
  await requireCampaign(db, campaignId);
  const out: MessageRow[] = [];
  for (const q of parsed.data.questions) {
    if (q.options.length === 0 && !q.allowOther) throw new AppError("validation_error", `"${q.question}" has no options and does not allow a typed answer`);
    out.push(await post(db, { campaignId, role: "agent", kind: "question", text: q.question, question: q }));
  }
  return out;
}

export async function answerQuestion(db: Db, messageId: string, answer: string): Promise<MessageRow> {
  const value = answer.trim();
  if (!value || value.length > 2000) throw new AppError("validation_error", "The answer must be 1 to 2000 characters");
  const [message] = await db.select().from(agentMessages).where(eq(agentMessages.id, messageId));
  if (!message) throw AppError.notFound("Message", messageId);
  if (message.kind !== "question" || !message.question) throw new AppError("validation_error", "Only questions can be answered");
  const q = message.question;
  if (!q.allowOther && !q.options.includes(value)) throw new AppError("validation_error", `Choose one of: ${q.options.join(", ")}`);
  // Re-answering is allowed; it becomes new input for the agent again.
  const [row] = await db.update(agentMessages).set({ answer: value, answeredAt: new Date(), acknowledgedAt: null }).where(eq(agentMessages.id, messageId)).returning();
  return row!;
}

// ---------------------------------------------------------------- pending input

/**
 * What the person has said that the agent has not picked up: their messages,
 * answers to questions, and plan decisions. With `markRead`, returning them
 * marks them as picked up (the person then sees "Picked up by the agent").
 */
export async function pendingInput(db: Db, campaignId: string, markRead: boolean) {
  await requireCampaign(db, campaignId);
  const rows = await db
    .select()
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.campaignId, campaignId),
        isNull(agentMessages.acknowledgedAt),
        or(eq(agentMessages.role, "user"), and(eq(agentMessages.kind, "question"), isNotNull(agentMessages.answeredAt))),
      ),
    )
    .orderBy(asc(agentMessages.createdAt));
  if (markRead && rows.length) {
    await db.update(agentMessages).set({ acknowledgedAt: new Date() }).where(inArray(agentMessages.id, rows.map((r) => r.id)));
  }
  return rows.map((r) =>
    r.kind === "question"
      ? { type: "answer" as const, messageId: r.id, question: r.text, answer: r.answer, answeredAt: r.answeredAt }
      : { type: r.planId ? ("plan_decision" as const) : ("message" as const), messageId: r.id, text: r.text, planId: r.planId, createdAt: r.createdAt },
  );
}

// ---------------------------------------------------------------- plans

export async function getPlan(db: Db, planId: string): Promise<PlanRow> {
  const [row] = await db.select().from(creativePlans).where(eq(creativePlans.id, planId));
  if (!row) throw AppError.notFound("Plan", planId);
  return row;
}

export async function listPlans(db: Db, campaignId: string): Promise<PlanRow[]> {
  await requireCampaign(db, campaignId);
  return db.select().from(creativePlans).where(eq(creativePlans.campaignId, campaignId)).orderBy(desc(creativePlans.version));
}

/** Records a proposed plan as the next version. An earlier proposal still awaiting a decision is superseded. */
export async function proposePlan(db: Db, campaignId: string, input: unknown): Promise<PlanRow> {
  const parsed = CreativePlan.safeParse(input);
  if (!parsed.success) throw invalid("The plan is not valid", parsed.error.issues);
  const plan = parsed.data;
  const campaign = await requireCampaign(db, campaignId);

  const designIds = [...new Set(plan.directions.map((d) => d.sourceDesignId).filter((id): id is string => Boolean(id)))];
  if (designIds.length) {
    const found = await db.select({ id: designDocuments.id }).from(designDocuments).where(and(inArray(designDocuments.id, designIds), eq(designDocuments.projectId, campaign.projectId)));
    const missing = designIds.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw new AppError("validation_error", `These designs are not in this campaign's project: ${missing.join(", ")}`);
  }
  const names = plan.directions.map((d) => d.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new AppError("validation_error", "Each direction in a plan needs a different name");

  const brief = await currentBrief(db, campaignId);
  const estimate = estimatePlan(plan);
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from ${campaigns} where ${campaigns.id} = ${campaignId} for update`);
    const [latest] = await tx.select({ v: sql<number>`coalesce(max(${creativePlans.version}), 0)::int` }).from(creativePlans).where(eq(creativePlans.campaignId, campaignId));
    await tx
      .update(creativePlans)
      .set({ status: "superseded" })
      // Only undecided proposals; a plan the person sent back keeps that record.
      .where(and(eq(creativePlans.campaignId, campaignId), eq(creativePlans.status, "proposed" satisfies PlanStatus)));
    const [inserted] = await tx
      .insert(creativePlans)
      .values({ campaignId, version: (latest?.v ?? 0) + 1, plan, estimate, briefVersion: brief?.version ?? null })
      .returning();
    if (campaign.status === "draft") await tx.update(campaigns).set({ status: "planning", updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
    return inserted!;
  });
  await post(db, {
    campaignId,
    role: "agent",
    kind: "plan",
    planId: row.id,
    text: `Proposed plan v${row.version}: ${estimate.directions} direction${estimate.directions === 1 ? "" : "s"}, ${estimate.variations} variation${estimate.variations === 1 ? "" : "s"} in ${estimate.sizes} size${estimate.sizes === 1 ? "" : "s"}. Waiting for approval.`,
  });
  return row;
}

/**
 * Approves a proposed plan and creates its directions in the workspace.
 * Directions from an earlier approved plan that have no variations yet are
 * removed; any with variations are kept.
 */
export async function approvePlan(db: Db, planId: string, opts: { by: "user" | "agent"; note?: string }): Promise<{ plan: PlanRow; directionIds: string[] }> {
  const plan = await getPlan(db, planId);
  if (plan.status !== "proposed") throw new AppError("conflict", `Plan v${plan.version} is ${plan.status.replace("_", " ")} and cannot be approved. Only the current proposed plan can be.`);
  if (opts.by === "agent" && !opts.note?.trim()) {
    throw new AppError("validation_error", "An agent may only approve a plan on the person's explicit instruction; quote it in `note`.");
  }
  const result = await db.transaction(async (tx) => {
    const [approved] = await tx
      .update(creativePlans)
      .set({ status: "approved", decidedBy: opts.by, decisionNote: opts.note?.trim() || null, decidedAt: new Date() })
      .where(and(eq(creativePlans.id, planId), eq(creativePlans.status, "proposed")))
      .returning();
    if (!approved) throw new AppError("conflict", "The plan changed while it was being approved. Reload and try again.");
    const previous = await tx
      .select({ id: creativePlans.id })
      .from(creativePlans)
      .where(and(eq(creativePlans.campaignId, plan.campaignId), eq(creativePlans.status, "approved"), ne(creativePlans.id, planId)));
    if (previous.length) {
      const prevIds = previous.map((p) => p.id);
      await tx.update(creativePlans).set({ status: "superseded" }).where(inArray(creativePlans.id, prevIds));
      const used = tx.select({ id: variations.directionId }).from(variations);
      await tx.delete(creativeDirections).where(and(inArray(creativeDirections.planId, prevIds), notInArray(creativeDirections.id, used)));
    }
    const [pos] = await tx.select({ p: sql<number>`coalesce(max(${creativeDirections.position}), -1)::int` }).from(creativeDirections).where(eq(creativeDirections.campaignId, plan.campaignId));
    const inserted = await tx
      .insert(creativeDirections)
      .values(
        plan.plan.directions.map((d, i) => ({
          campaignId: plan.campaignId,
          name: d.name,
          concept: d.concept,
          messagingAngle: d.messagingAngle,
          visualTreatment: d.visualTreatment ?? null,
          status: "approved" as const,
          position: (pos?.p ?? -1) + 1 + i,
          planId: plan.id,
          plannedVariations: d.variationCount,
          varyElements: d.varyElements,
          sourceDesignId: d.sourceDesignId ?? null,
          sampleHeadlines: d.sampleHeadlines,
        })),
      )
      .returning({ id: creativeDirections.id });
    return { plan: approved, directionIds: inserted.map((r) => r.id) };
  });
  if (opts.by === "user") {
    // Recorded as the person's input so the agent picks it up as its go-ahead.
    await post(db, { campaignId: plan.campaignId, role: "user", kind: "message", planId, text: `Approved plan v${plan.version}.${opts.note?.trim() ? ` ${opts.note.trim()}` : ""}` });
  } else {
    await post(db, { campaignId: plan.campaignId, role: "agent", kind: "activity", planId, text: `Approved plan v${plan.version} on the person's instruction: "${opts.note!.trim()}"` });
  }
  return result;
}

export async function requestPlanChanges(db: Db, planId: string, feedback: string): Promise<PlanRow> {
  const value = feedback.trim();
  if (!value || value.length > 5000) throw new AppError("validation_error", "Describe the changes you want (up to 5000 characters)");
  const plan = await getPlan(db, planId);
  if (plan.status !== "proposed") throw new AppError("conflict", `Plan v${plan.version} is ${plan.status.replace("_", " ")}; changes can only be requested on the current proposed plan.`);
  const [row] = await db
    .update(creativePlans)
    .set({ status: "changes_requested", feedback: value, decidedBy: "user", decidedAt: new Date() })
    .where(and(eq(creativePlans.id, planId), eq(creativePlans.status, "proposed")))
    .returning();
  if (!row) throw new AppError("conflict", "The plan changed while saving. Reload and try again.");
  await post(db, { campaignId: plan.campaignId, role: "user", kind: "message", planId, text: `Requested changes to plan v${plan.version}: ${value}` });
  return row;
}
