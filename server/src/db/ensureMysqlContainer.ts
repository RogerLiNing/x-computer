/**
 * 当配置使用 MySQL 且连接失败时，检查并启动 MySQL Docker 容器（x-computer-mysql）。
 * 仅当 MYSQL_HOST 为 localhost/127.0.0.1 时尝试 Docker；远程 MySQL 不自动启动容器。
 */

import Docker from 'dockerode';
import mysql from 'mysql2/promise';
import { serverLogger } from '../observability/ServerLogger.js';

const MYSQL_CONTAINER_NAME = 'x-computer-mysql';
const MYSQL_IMAGE = 'mysql:8';
const CONNECT_TIMEOUT_MS = 3000;
const WAIT_RETRY_MS = 2000;
/** mysql:8 首次启动初始化可能需 1～2 分钟 */
const WAIT_MAX_MS = 120000;
/** 新创建容器后先等待一段时间再开始检测，避免过早重试 */
const INITIAL_DELAY_AFTER_CREATE_MS = 15000;

function getMysqlConfig(): { host: string; port: number; user: string; password: string; database: string } {
  const host = process.env.MYSQL_HOST ?? 'localhost';
  const port = parseInt(process.env.MYSQL_PORT ?? '3306', 10);
  const user = process.env.MYSQL_USER ?? 'root';
  const password = process.env.MYSQL_PASSWORD ?? '';
  const database = process.env.MYSQL_DATABASE ?? 'x_computer';
  return { host, port, user, password, database };
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().trim();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '::ffff:127.0.0.1';
}

/** 尝试连接 MySQL，成功返回 true，失败返回 false（不抛错） */
async function tryConnect(): Promise<boolean> {
  const { host, port, user, password, database } = getMysqlConfig();
  try {
    const conn = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });
    await conn.end();
    return true;
  } catch {
    return false;
  }
}

/** 等待 MySQL 可连接，带重试。可选先等待 initialDelayMs（新容器刚启动时用） */
async function waitForMysql(initialDelayMs = 0): Promise<void> {
  if (initialDelayMs > 0) {
    serverLogger.info('db', `等待 ${initialDelayMs / 1000} 秒后开始检测 MySQL…`);
    await new Promise((r) => setTimeout(r, initialDelayMs));
  }
  const start = Date.now();
  while (Date.now() - start < WAIT_MAX_MS) {
    if (await tryConnect()) return;
    await new Promise((r) => setTimeout(r, WAIT_RETRY_MS));
  }
  throw new Error(`MySQL 在 ${WAIT_MAX_MS / 1000} 秒内未就绪，请检查容器日志: docker logs ${MYSQL_CONTAINER_NAME}`);
}

/** 查找已存在的 x-computer-mysql 容器（仅按名称，不匹配其他 MySQL 容器） */
async function findMysqlContainer(docker: Docker): Promise<Docker.ContainerInfo | null> {
  const list = await docker.listContainers({ all: true });
  return list.find((c) => c.Names.some((n) => n === `/${MYSQL_CONTAINER_NAME}`)) ?? null;
}

/** 启动已有容器或创建并启动新容器。返回是否为新创建的容器（新容器需要更长时间初始化） */
async function ensureContainerRunning(docker: Docker): Promise<boolean> {
  const existing = await findMysqlContainer(docker);
  const password = process.env.MYSQL_PASSWORD ?? '';
  const database = process.env.MYSQL_DATABASE ?? 'x_computer';

  if (existing) {
    if (existing.State !== 'running') {
      const container = docker.getContainer(existing.Id);
      await container.start();
      serverLogger.info('db', `已启动已有 MySQL 容器: ${existing.Id.substring(0, 12)}`);
    }
    return false;
  }

  try {
    await docker.getImage(MYSQL_IMAGE).inspect();
  } catch {
    serverLogger.info('db', `拉取 MySQL 镜像: ${MYSQL_IMAGE}`);
    await new Promise<void>((resolve, reject) => {
      docker.pull(MYSQL_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
      });
    });
  }

  const rootPassword = password || 'x-computer-mysql-root';
  if (!password) {
    serverLogger.warn('db', '未设置 MYSQL_PASSWORD，容器将使用默认 root 密码，请设置环境变量以匹配');
  }

  const container = await docker.createContainer({
    Image: MYSQL_IMAGE,
    name: MYSQL_CONTAINER_NAME,
    Env: [
      `MYSQL_ROOT_PASSWORD=${rootPassword}`,
      `MYSQL_DATABASE=${database}`,
    ],
    HostConfig: {
      PortBindings: {
        '3306/tcp': [{ HostPort: String(process.env.MYSQL_PORT ?? '3306') }],
      },
    },
  });
  await container.start();
  serverLogger.info('db', `已创建并启动 MySQL 容器: ${MYSQL_CONTAINER_NAME}`);
  return true;
}

/**
 * 确保 MySQL 可用：若连接失败且为本地 host，则检查并启动 MySQL Docker 容器后重试。
 * 仅在 database.type === 'mysql' 时由 app 调用。
 */
export async function ensureMysqlReady(): Promise<void> {
  serverLogger.info('db', '正在检查 MySQL 连接…');
  if (await tryConnect()) {
    serverLogger.info('db', 'MySQL 已就绪');
    return;
  }

  const { host } = getMysqlConfig();
  if (!isLocalHost(host)) {
    throw new Error(
      `无法连接 MySQL (${host})。若使用本地 MySQL，请先启动服务；若使用 Docker，请确保 MYSQL_HOST=localhost 并已启动容器。`
    );
  }

  serverLogger.info('db', 'MySQL 不可用，正在检查 Docker 并尝试启动 MySQL 容器…');
  let docker: Docker;
  try {
    docker = new Docker({ socketPath: '/var/run/docker.sock' });
    await docker.ping();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`MySQL 不可用且无法访问 Docker（${msg}）。请先启动 MySQL 或确保 Docker 可用。`);
  }

  const created = await ensureContainerRunning(docker);
  const initialDelay = created ? INITIAL_DELAY_AFTER_CREATE_MS : 0;
  serverLogger.info('db', `等待 MySQL 就绪（最多约 ${WAIT_MAX_MS / 1000} 秒）…`);
  await waitForMysql(initialDelay);
  serverLogger.info('db', 'MySQL 已就绪');
}
