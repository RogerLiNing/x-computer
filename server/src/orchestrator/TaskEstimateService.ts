/**
 * Task Complexity Estimator
 * Analyzes task intent and planned steps to predict complexity, difficulty, and potential challenges.
 */

export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'complex';

export interface TaskEstimate {
  difficulty: DifficultyLevel;
  estimatedSteps: number;
  estimatedMinutes: number;
  requiredSkills: string[];
  potentialChallenges: string[];
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
}

function sanitize(text: string): string {
  return text.replace(/\x00/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}

function parseDifficulty(raw: string): DifficultyLevel {
  const lower = raw.toLowerCase();
  if (lower.includes('complex') || lower.includes('very hard')) return 'complex';
  if (lower.includes('hard') || lower.includes('difficult')) return 'hard';
  if (lower.includes('medium') || lower.includes('moderate')) return 'medium';
  return 'easy';
}

export interface EstimateOptions {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
}

/**
 * Analyze a task intent and return complexity estimation.
 */
export async function estimateTaskComplexity(
  taskIntent: string,
  plannedSteps: string[],
  opts: EstimateOptions,
): Promise<TaskEstimate> {
  const { callLLM } = await import('../chat/chatService.js');

  const stepsText = plannedSteps.length > 0
    ? plannedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（尚无分解步骤）';

  const prompt = `分析以下任务，评估其复杂度和难度。

任务意图：${taskIntent}

计划步骤：
${stepsText}

请以 JSON 格式输出分析结果：
{
  "difficulty": "easy/medium/hard/complex",
  "estimatedSteps": 数字（你估计的总步骤数）,
  "estimatedMinutes": 数字（估计完成时间，单位分钟）,
  "requiredSkills": ["技能1", "技能2", ...],
  "potentialChallenges": ["挑战1", "挑战2", ...],
  "riskLevel": "low/medium/high",
  "summary": "一句话总结"
}

只输出 JSON，不要有解释，不要有 markdown 包裹。`;

  try {
    const result = await callLLM({
      messages: [{ role: 'user', content: prompt }],
      providerId: opts.providerId,
      modelId: opts.modelId,
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
    });

    const text = sanitize(result ?? '');
    // Extract JSON object from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return defaultEstimate();
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      difficulty: parseDifficulty(parsed.difficulty ?? 'medium'),
      estimatedSteps: Math.max(1, parseInt(String(parsed.estimatedSteps), 10) || 3),
      estimatedMinutes: Math.max(1, parseInt(String(parsed.estimatedMinutes), 10) || 5),
      requiredSkills: Array.isArray(parsed.requiredSkills) ? parsed.requiredSkills.slice(0, 5) : [],
      potentialChallenges: Array.isArray(parsed.potentialChallenges) ? parsed.potentialChallenges.slice(0, 4) : [],
      riskLevel: ['low', 'medium', 'high'].includes(parsed.riskLevel) ? parsed.riskLevel : 'medium',
      summary: String(parsed.summary ?? '').slice(0, 200) || '',
    };
  } catch (err) {
    console.error('[TaskEstimate] Failed to estimate:', err);
    return defaultEstimate();
  }
}

function defaultEstimate(): TaskEstimate {
  return {
    difficulty: 'medium',
    estimatedSteps: 3,
    estimatedMinutes: 5,
    requiredSkills: [],
    potentialChallenges: [],
    riskLevel: 'medium',
    summary: '无法评估任务复杂度',
  };
}
