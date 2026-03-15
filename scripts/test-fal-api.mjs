#!/usr/bin/env node
/**
 * 测试 fal.ai API 连通性
 * 用法: FAL_KEY=xxx node scripts/test-fal-api.mjs
 * 或: node -r dotenv/config scripts/test-fal-api.mjs（若已安装 dotenv）
 */
const FAL_KEY = process.env.FAL_KEY?.trim();

async function testFalImage() {
  if (!FAL_KEY) {
    console.error('❌ 未设置 FAL_KEY，请设置环境变量或在 .env 中配置');
    process.exit(1);
  }
  console.log('>>> 测试 fal.ai 文生图 (fal-ai/flux/schnell)...');
  const res = await fetch('https://queue.fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${FAL_KEY}`,
    },
    body: JSON.stringify({
      prompt: 'a cute cat',
      output_format: 'jpeg',
      image_size: 'square',
      num_images: 1,
    }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('❌ 响应非 JSON:', text.slice(0, 500));
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`❌ 请求失败: ${res.status}`, data);
    process.exit(1);
  }
  if (data.status === 'COMPLETED' && data.images?.[0]?.url) {
    console.log('✅ 文生图成功:', data.images[0].url);
    return;
  }
  if (data.request_id) {
    console.log('>>> 任务已提交，轮询结果...');
    // 文档：子路径 /schnell 仅用于 POST，状态/结果用 fal-ai/flux（不含子路径）
    const statusUrl = data.status_url ?? `https://queue.fal.run/fal-ai/flux/requests/${data.request_id}/status`;
    const resultUrl = data.response_url ?? `https://queue.fal.run/fal-ai/flux/requests/${data.request_id}`;
    const headers = { Authorization: `Key ${FAL_KEY}` };
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const sRes = await fetch(statusUrl, { headers });
      const sText = await sRes.text();
      let sData;
      try {
        sData = JSON.parse(sText);
      } catch (e) {
        console.error('❌ 状态响应非 JSON:', sText.slice(0, 200));
        process.exit(1);
      }
      if (sData.status === 'COMPLETED') {
        const rRes = await fetch(resultUrl, { headers });
        const rData = await rRes.json();
        const resp = rData.response ?? rData;
        const url = resp?.images?.[0]?.url;
        if (url) {
          console.log('✅ 文生图成功:', url);
          return;
        }
        console.error('❌ 完成但无图片 URL:', rData);
        process.exit(1);
      }
      if (sData.status === 'FAILED' || sData.status === 'CANCELLED') {
        console.error('❌ 任务失败:', sData);
        process.exit(1);
      }
      console.log(`   状态: ${sData.status}...`);
    }
    console.error('❌ 超时');
    process.exit(1);
  }
  console.error('❌ 未知响应:', data);
  process.exit(1);
}

async function testFalSoundEffect() {
  if (!FAL_KEY) return;
  console.log('\n>>> 测试 fal.ai 音效 (cassetteai/sound-effects-generator)...');
  const res = await fetch('https://queue.fal.run/cassetteai/sound-effects-generator', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${FAL_KEY}`,
    },
    body: JSON.stringify({ prompt: 'button click', duration: 2 }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('❌ 响应非 JSON:', text.slice(0, 500));
    return;
  }
  if (!res.ok) {
    console.error(`❌ 音效请求失败: ${res.status}`, data);
    return;
  }
  if (data.audio_file?.url) {
    console.log('✅ 音效生成成功:', data.audio_file.url);
    return;
  }
  if (data.request_id) {
    console.log('>>> 音效任务已提交，轮询...');
    const statusUrl = `https://queue.fal.run/cassetteai/sound-effects-generator/requests/${data.request_id}/status`;
    const resultUrl = `https://queue.fal.run/cassetteai/sound-effects-generator/requests/${data.request_id}`;
    const headers = { Authorization: `Key ${FAL_KEY}` };
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const sRes = await fetch(statusUrl, { headers });
      const sData = await sRes.json();
      if (sData.status === 'COMPLETED') {
        const rRes = await fetch(resultUrl, { headers });
        const rData = await rRes.json();
        const resp = rData.response ?? rData;
        const url = resp?.audio_file?.url;
        if (url) {
          console.log('✅ 音效生成成功:', url);
          return;
        }
      }
      if (sData.status === 'FAILED') {
        console.error('❌ 音效任务失败');
        return;
      }
    }
  }
  console.error('❌ 音效响应异常:', data);
}

testFalImage()
  .then(() => testFalSoundEffect())
  .then(() => console.log('\n>>> 全部测试通过'))
  .catch((err) => {
    console.error('❌ 测试失败:', err.message);
    process.exit(1);
  });
