/**
 * PageIndex 真实文档测试
 */

const http = require('http')

// 创建一个真实的财务报告文档
const financialReport = {
  pages: [
    {
      pageNumber: 0,
      text: `年度财务报告 2025

XYZ科技有限公司

本报告呈现了2025财年的详细财务数据和分析。

目录
1. 公司概况
2. 营收分析
3. 成本结构
4. 利润分析
5. 现金流
6. 未来展望`
    },
    {
      pageNumber: 1,
      text: `第1章 公司概况

XYZ科技有限公司成立于2015年，是一家专注于人工智能和云计算的企业解决方案提供商。

公司核心业务：
- 云计算平台服务
- AI模型训练与部署
- 企业数字化转型咨询
- 数据安全解决方案

截至2025年底，公司拥有员工3500人，研发人员占比65%。`
    },
    {
      pageNumber: 2,
      text: `第2章 营收分析

2025年总营收达到15.8亿元人民币，同比增长32.5%。

营收构成：
- 云计算服务：8.2亿元（52%）
- AI解决方案：4.5亿元（28%）
- 咨询服务：2.1亿元（13%）
- 其他：1.0亿元（7%）

重点客户行业分布：
- 金融：35%
- 制造业：28%
- 医疗健康：22%
- 零售：15%`
    },
    {
      pageNumber: 3,
      text: `第3章 成本结构

2025年总成本为10.3亿元人民币，同比增长18.2%。

成本明细：
- 研发投入：4.2亿元（41%）
- 运营成本：3.1亿元（30%）
- 销售与市场：2.0亿元（19%）
- 管理费用：1.0亿元（10%）

研发投入占营收比例：26.6%，较去年提升2.3个百分点。`
    },
    {
      pageNumber: 4,
      text: `第4章 利润分析

2025年净利润为3.2亿元人民币，同比增长58.4%。

关键财务指标：
- 毛利率：52.3%（同比提升3.2%）
- 净利率：20.3%（同比提升5.1%）
- 每股收益（EPS）：4.28元

利润增长主要驱动力：
1. 云计算业务规模效应显现
2. AI产品毛利率提升至65%
3. 运营效率持续改善`
    },
    {
      pageNumber: 5,
      text: `第5章 现金流

2025年经营活动现金流为4.8亿元人民币，同比增长42.1%。

现金流明细：
- 经营活动现金流：4.8亿元
- 投资活动现金流：-2.3亿元
- 筹资活动现金流：0.5亿元

现金储备：截至年底，公司现金及等价物为8.2亿元。

应收账款周转天数：45天（改善8天）
存货周转天数：12天`
    },
    {
      pageNumber: 6,
      text: `第6章 未来展望

2026年发展计划：

1. 云计算业务
   - 扩建3个数据中心
   - 预计营收增长40%

2. AI业务
   - 发布新一代大模型
   - 拓展医疗和金融垂直领域

3. 国际化
   - 进入东南亚市场
   - 预计海外营收占比达15%

4. 研发投入
   - 计划投入5.5亿元
   - 研发占比提升至30%

预期2026年营收：21亿元，净利润：4.5亿元。`
    }
  ],
  metadata: {
    pageCount: 7,
    wordCount: 1200,
    language: 'zh'
  }
}

// 发送HTTP请求
function makeRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          resolve({ status: res.statusCode, body })
        }
      })
    })
    req.on('error', reject)
    if (data) {
      req.write(JSON.stringify(data))
    }
    req.end()
  })
}

async function testPageIndex() {
  console.log('=== PageIndex 真实文档测试 ===\n')
  
  // 测试1：生成索引
  console.log('1. 生成文档索引...')
  const generateRes = await makeRequest({
    hostname: 'localhost',
    port: 4000,
    path: '/api/pageindex/generate',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': 'test-user'
    }
  }, {
    document: financialReport,
    options: {
      maxPagesPerNode: 2,
      maxDepth: 3,
      addNodeSummary: true,
      addDocDescription: true
    }
  })
  
  if (!generateRes.success) {
    console.error('❌ 生成失败:', generateRes)
    return
  }
  
  console.log('✓ 索引生成成功')
  console.log(`  文档ID: ${generateRes.index.documentId}`)
  console.log(`  创建时间: ${new Date(generateRes.index.createdAt).toLocaleString()}`)
  console.log(`  页数: ${generateRes.index.metadata.pageCount}`)
  console.log(`  根节点: ${generateRes.index.root.title}`)
  console.log(`  根节点摘要: ${generateRes.index.root.summary}`)
  console.log(`  子节点数: ${generateRes.index.root.nodes?.length || 0}\n`)
  
  const documentId = generateRes.index.documentId
  
  // 测试2：精确查询
  console.log('2. 测试精确查询...')
  const queries = [
    {
      q: '2025年净利润增长率',
      expected: '第4章'
    },
    {
      q: '研发投入占营收比例',
      expected: '第3章'
    },
    {
      q: '云计算业务营收',
      expected: '第2章'
    },
    {
      q: '2026年发展计划',
      expected: '第6章'
    },
    {
      q: '现金流状况',
      expected: '第5章'
    }
  ]
  
  for (const { q, expected } of queries) {
    const searchRes = await makeRequest({
      hostname: 'localhost',
      port: 4000,
      path: '/api/pageindex/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'test-user'
      }
    }, {
      documentId,
      query: q,
      options: {
        topK: 3,
        threshold: 0.5,
        includeReasoning: true
      }
    })
    
    if (searchRes.success && searchRes.results.length > 0) {
      const top = searchRes.results[0]
      const correct = top.node.title === expected || top.path.includes(expected.replace('第', '').replace('章', ''))
      console.log(`  "${q}"`)
      console.log(`    → ${top.node.title} (相关性: ${(top.relevance * 100).toFixed(1)}%)`)
      console.log(`    → 页码: ${top.pages.start}-${top.pages.end}`)
      console.log(`    → ${correct ? '✓' : '✗'} 预期: ${expected}`)
      if (top.reasoning) {
        console.log(`    → 推理: ${top.reasoning.slice(0, 100)}...`)
      }
    } else {
      console.log(`  "${q}" → ✗ 无结果`)
    }
  }
  
  // 测试3：获取索引
  console.log('\n3. 获取索引详情...')
  const getRes = await makeRequest({
    hostname: 'localhost',
    port: 4000,
    path: `/api/pageindex/${documentId}`,
    method: 'GET',
    headers: {
      'X-User-Id': 'test-user'
    }
  })
  
  if (getRes.success) {
    console.log('✓ 获取成功')
    console.log(`  页数: ${getRes.index.metadata.pageCount}`)
    console.log(`  字数: ${getRes.index.metadata.wordCount}`)
  }
  
  // 测试4：列出所有索引
  console.log('\n4. 列出所有索引...')
  const listRes = await makeRequest({
    hostname: 'localhost',
    port: 4000,
    path: '/api/pageindex',
    method: 'GET',
    headers: {
      'X-User-Id': 'test-user'
    }
  })
  
  if (listRes.success) {
    console.log(`✓ 找到 ${listRes.indexes.length} 个索引`)
    listRes.indexes.forEach((idx, i) => {
      console.log(`  ${i + 1}. ${idx.documentId} (${idx.metadata?.pageCount || '?'} pages)`)
    })
  }
  
  console.log('\n=== 测试完成 ===')
}

testPageIndex().catch(console.error)