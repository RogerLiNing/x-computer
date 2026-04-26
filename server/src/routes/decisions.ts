/**
 * 决策日志路由：/api/decisions
 *
 * - GET    /api/decisions              → 列出所有决策（支持 ?status=&search=）
 * - POST   /api/decisions             → 创建决策
 * - PUT    /api/decisions/:id         → 更新决策
 * - DELETE /api/decisions/:id         → 删除决策
 * - GET    /api/decisions/followup     → 获取待回顾的决策
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export function createDecisionsRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const journals = await db.listDecisionJournals(userId, { status, search });
      res.json(journals.map(mapDecision));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  router.post('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const { title, context, decisionText, rationale, alternatives, tags, followUpAt } = req.body ?? {};
    try {
      if (!title || !decisionText) {
        res.status(400).json({ error: 'title 和 decisionText 必填' });
        return;
      }
      const journal = await db.createDecisionJournal({
        userId,
        title: String(title),
        context: context !== undefined ? String(context) : undefined,
        decisionText: String(decisionText),
        rationale: rationale !== undefined ? String(rationale) : undefined,
        alternatives: Array.isArray(alternatives) ? alternatives.map(String) : undefined,
        tags: Array.isArray(tags) ? tags.map(String) : undefined,
        followUpAt: followUpAt !== undefined ? String(followUpAt) : undefined,
      });
      res.status(201).json(mapDecision(journal));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '创建失败' });
    }
  });

  router.put('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { title, context, decisionText, rationale, alternatives, outcome, outcomePositive, tags, status, followUpAt } = req.body ?? {};
    try {
      const updated = await db.updateDecisionJournal(id, userId, {
        title: title !== undefined ? String(title) : undefined,
        context: context !== undefined ? (context === null ? null : String(context)) : undefined,
        decisionText: decisionText !== undefined ? String(decisionText) : undefined,
        rationale: rationale !== undefined ? (rationale === null ? null : String(rationale)) : undefined,
        alternatives: alternatives !== undefined ? (Array.isArray(alternatives) ? alternatives.map(String) : undefined) : undefined,
        outcome: outcome !== undefined ? (outcome === null ? null : String(outcome)) : undefined,
        outcomePositive: outcomePositive !== undefined ? (outcomePositive === null ? null : Boolean(outcomePositive)) : undefined,
        tags: tags !== undefined ? (Array.isArray(tags) ? tags.map(String) : undefined) : undefined,
        status: status !== undefined ? String(status) : undefined,
        followUpAt: followUpAt !== undefined ? String(followUpAt) : undefined,
      });
      if (!updated) { res.status(404).json({ error: '决策不存在' }); return; }
      res.json(mapDecision(updated));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '更新失败' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    try {
      const existing = await db.getDecisionJournal(id, userId);
      if (!existing) { res.status(404).json({ error: '决策不存在' }); return; }
      await db.deleteDecisionJournal(id, userId);
      res.status(204).send();
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '删除失败' });
    }
  });

  router.get('/followup', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    try {
      const journals = await db.getDecisionJournalsForFollowUp(userId);
      res.json({ journals });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  return router;
}

type DecisionRow = {
  id: string; user_id: string; title: string; context: string | null;
  decision_text: string; rationale: string | null; alternatives: string[];
  outcome: string | null; outcome_positive: number | null; tags: string[];
  status: string; follow_up_at: string | null; created_at: string; updated_at: string;
};

function mapDecision(d: DecisionRow) {
  return {
    id: d.id,
    title: d.title,
    context: d.context,
    decisionText: d.decision_text,
    rationale: d.rationale,
    alternatives: d.alternatives,
    outcome: d.outcome,
    outcomePositive: d.outcome_positive === null ? null : d.outcome_positive === 1,
    tags: d.tags,
    status: d.status,
    followUpAt: d.follow_up_at,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}
