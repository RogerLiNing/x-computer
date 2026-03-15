/**
 * WhatsApp Baileys 代理连接测试脚本
 * 用于验证不同代理配置的可行性
 */

import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent } from 'undici';
import { Boom } from '@hapi/boom';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TEST_AUTH_DIR = path.join(os.tmpdir(), 'whatsapp-proxy-test', Date.now().toString());

console.log('🧪 WhatsApp 代理连接测试');
console.log('测试目录:', TEST_AUTH_DIR);
console.log('---');

// 确保测试目录存在
fs.mkdirSync(TEST_AUTH_DIR, { recursive: true });

async function testProxyConnection(proxyUrl) {
  console.log(`\n📡 测试代理: ${proxyUrl}`);
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState(TEST_AUTH_DIR);
    
    let wsAgent, fetchAgent;
    
    if (proxyUrl) {
      console.log('  配置代理 agents...');
      wsAgent = new HttpsProxyAgent(proxyUrl);
      fetchAgent = new ProxyAgent(proxyUrl);
      console.log('  ✅ Agents 创建成功');
    }
    
    console.log('  创建 WASocket...');
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: state.keys,
      },
      browser: ['Mac OS', 'Desktop', '14.4.1'],
      ...(wsAgent && { agent: wsAgent }),
      ...(fetchAgent && { fetchAgent }),
      connectTimeoutMs: 30000,
      logger: {
        level: 'warn',
        trace: () => {},
        debug: () => {},
        info: (msg) => console.log('    [Baileys Info]', JSON.stringify(msg)),
        warn: (msg) => console.warn('    [Baileys Warn]', JSON.stringify(msg)),
        error: (msg) => console.error('    [Baileys Error]', JSON.stringify(msg)),
        fatal: (msg) => console.error('    [Baileys Fatal]', JSON.stringify(msg)),
        child: () => ({
          level: 'warn',
          trace: () => {},
          debug: () => {},
          info: (msg) => console.log('    [Baileys Child Info]', JSON.stringify(msg)),
          warn: (msg) => console.warn('    [Baileys Child Warn]', JSON.stringify(msg)),
          error: (msg) => console.error('    [Baileys Child Error]', JSON.stringify(msg)),
          fatal: (msg) => console.error('    [Baileys Child Fatal]', JSON.stringify(msg)),
          child: () => ({}),
        }),
      },
    });
    
    console.log('  ✅ WASocket 创建成功');
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        sock.end();
        reject(new Error('连接超时（30秒）'));
      }, 30000);
      
      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          console.log('  📱 收到 QR 码（长度:', qr.length, '字符）');
          clearTimeout(timeout);
          sock.end();
          resolve({ success: true, qr: true });
        }
        
        if (connection === 'open') {
          console.log('  ✅ 连接成功！');
          clearTimeout(timeout);
          sock.end();
          resolve({ success: true, connected: true });
        }
        
        if (connection === 'close') {
          const err = lastDisconnect?.error;
          const statusCode = (err instanceof Boom) ? err.output?.statusCode : undefined;
          const message = err?.message || 'Unknown error';
          
          console.error('  ❌ 连接关闭:', message);
          if (statusCode) {
            console.error('     状态码:', statusCode);
          }
          
          clearTimeout(timeout);
          sock.end();
          reject(new Error(`Connection closed: ${message}`));
        }
      });
      
      sock.ev.on('creds.update', saveCreds);
    });
    
  } catch (error) {
    console.error('  ❌ 测试失败:', error.message);
    throw error;
  }
}

async function runTests() {
  const proxyUrl = 'http://127.0.0.1:10809';
  
  console.log('\n🔍 开始测试...\n');
  
  try {
    const result = await testProxyConnection(proxyUrl);
    console.log('\n✅ 测试成功！');
    console.log('结果:', result);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 测试失败！');
    console.error('错误:', error.message);
    console.error('\n堆栈:', error.stack);
    process.exit(1);
  } finally {
    // 清理测试目录
    try {
      fs.rmSync(TEST_AUTH_DIR, { recursive: true, force: true });
      console.log('\n🧹 已清理测试目录');
    } catch (e) {
      // ignore
    }
  }
}

runTests();
