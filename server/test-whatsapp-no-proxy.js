/**
 * WhatsApp Baileys 无代理连接测试
 * 用于对比测试，看看是否是代理的问题
 */

import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TEST_AUTH_DIR = path.join(os.tmpdir(), 'whatsapp-no-proxy-test', Date.now().toString());

console.log('🧪 WhatsApp 无代理连接测试（对照组）');
console.log('测试目录:', TEST_AUTH_DIR);
console.log('---');

fs.mkdirSync(TEST_AUTH_DIR, { recursive: true });

async function testNoProxy() {
  console.log('\n📡 测试无代理直连...');
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState(TEST_AUTH_DIR);
    
    console.log('  创建 WASocket（无代理）...');
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: state.keys,
      },
      connectTimeoutMs: 30000,
      logger: {
        level: 'warn',
        trace: () => {},
        debug: () => {},
        info: (msg) => console.log('    [Info]', JSON.stringify(msg)),
        warn: (msg) => console.warn('    [Warn]', JSON.stringify(msg)),
        error: (msg) => console.error('    [Error]', JSON.stringify(msg)),
        fatal: (msg) => console.error('    [Fatal]', JSON.stringify(msg)),
        child: () => ({
          level: 'warn',
          trace: () => {},
          debug: () => {},
          info: (msg) => console.log('    [Child Info]', JSON.stringify(msg)),
          warn: (msg) => console.warn('    [Child Warn]', JSON.stringify(msg)),
          error: (msg) => console.error('    [Child Error]', JSON.stringify(msg)),
          fatal: (msg) => console.error('    [Child Fatal]', JSON.stringify(msg)),
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
          console.log('  ✅ 无代理连接成功！说明 WhatsApp 服务可访问');
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
          const message = err?.message || 'Unknown error';
          
          console.error('  ❌ 连接关闭:', message);
          console.error('  这说明本地网络无法直接访问 WhatsApp（需要代理）');
          
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

async function run() {
  try {
    await testNoProxy();
    console.log('\n✅ 无代理测试成功！');
    console.log('结论：本地网络可以直接访问 WhatsApp');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 无代理测试失败！');
    console.error('结论：本地网络无法直接访问 WhatsApp，需要代理');
    process.exit(1);
  } finally {
    try {
      fs.rmSync(TEST_AUTH_DIR, { recursive: true, force: true });
    } catch (e) {}
  }
}

run();
