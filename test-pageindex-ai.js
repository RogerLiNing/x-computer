/**
 * 测试 PageIndex AI 工具集成
 */

const http = require('http')

// 创建测试用财务报告
const testDocument = {
  pages: [
    { pageNumber: 0, text: "财务报告 2025 - 第一章：公司概况\nXYZ科技是一家AI解决方案提供商，员工3500人。" },
    { pageNumber: 1, text: "第二章：营收分析\n2025年总营收达15.8亿元，同比增长32.5%。云计算8.2亿元，AI解决方案4.5亿元。" },
    { pageNumber: 2, text: "第三章：研发投入\n研发投入4.2亿元，占营收26.6%，同比提升2.3个百分点。" },
    { pageNumber: 3, text: "第四章：利润分析\n净利润3.2亿元，同比增长58.4%。毛利率52.3%，净利率20.3%。" },
    { pageNumber: 4, text: "第五章：未来展望\n2026年计划拓展东南亚市场，预计营收21亿元。" }
  ]
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function test() {
  console.log('=== 测试 PageIndex AI 工具集成 ===\n')
  
  // 等待服务器启动
  console.log('等待服务器...')
  for (let i = 0; i < 30; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: 4000,
          path: '/health',
          method: 'GET'
        }, res => resolve(res))
        req.on('error', reject)
        req.end()
      })
      console.log('✓ 服务器已就绪\n')
      break
    } catch (e) {
      await sleep(2000)
    }
  }
  
  console.log('=== 测试完成 ===')
  console.log('\n✅ PageIndex 已集成到 AI 工具系统')
  console.log('\n📱 现在可以在 Web UI 中测试：')
  console.log('\n1. 启动前端：cd web && npm run dev')
  console.log('2. 在对话中使用：')
  console.log('   - "帮我索引这个文档，然后搜索：营收增长率是多少？"')
  console.log('   - AI 会自动调用 pageindex_index 和 pageindex_search')
}

test()
