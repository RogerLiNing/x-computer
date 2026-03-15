/**
 * 工作流引擎微服务
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { WorkflowStore } from './store.js';
import { WorkflowRunner } from './runner.js';
import { createRouter } from './routes.js';
import { startTimerScheduler } from './triggers.js';
import { createRemoteTaskExecutor } from './remoteTaskExecutor.js';

const PORT = parseInt(process.env.WORKFLOW_ENGINE_PORT ?? '4001', 10);
const dbPath = process.env.WORKFLOW_ENGINE_DB
  ? path.resolve(process.env.WORKFLOW_ENGINE_DB)
  : path.join(process.cwd(), 'workflow-data.sqlite');

const store = new WorkflowStore(dbPath);
const onTaskExecute = createRemoteTaskExecutor();
const runner = new WorkflowRunner({ store, onTaskExecute });
const app = express();

app.use(cors());
app.use(express.json());
app.use('/api', createRouter({ store, runner }));

startTimerScheduler({ store, runner });

app.listen(PORT, () => {
  console.log(`[workflow-engine] listening on port ${PORT}`);
});
