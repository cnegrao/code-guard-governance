/** ADR L15 §23: estimates are QUARANTINED; observed cost requires L12 evidence.
 * Covers the legacy amount, costRisk, hotspots and every breakdown field (including confidence).
 * A numeric heuristic zero is not an observed zero, financial measure, governed fact or KPI.
 */
export interface FinOpsCostEvidence {
  kind: "HEURISTIC";
  authority: "QUARANTINED";
  observedCostState: "UNKNOWN";
  evidenceState: "NOT_EVIDENCED";
}

export function heuristicCostEvidence(): FinOpsCostEvidence {
  return { kind: "HEURISTIC", authority: "QUARANTINED", observedCostState: "UNKNOWN", evidenceState: "NOT_EVIDENCED" };
}

export interface FinOpsResult {
  nPlusOneDetected: boolean;
  expensiveScans: boolean;
  missingTimeout: boolean;
  missingRateLimit: boolean;
  missingCircuitBreaker: boolean;
  monthlyCostEstimate: number;
  costRisk: "low" | "medium" | "high" | "critical";
  costHotspots: string[];
  breakdown: CostBreakdownItem[];
  /** Optional for legacy adapter callers; analyseFinOps always emits the boundary. */
  costEvidence?: FinOpsCostEvidence;
}

export interface CostBreakdownItem {
  category: string;
  estimatedMonthly: number;
  confidence: number;
  callCount: number;
  costEvidence?: FinOpsCostEvidence;
}

const N_PLUS_ONE_PATTERNS: RegExp[] = [
  /for\s*\(.*\)\s*\{[\s\S]*\.(?:get|post|put|delete|fetch|query|find)\s*\(/,
  /\.forEach\s*\([\s\S]*=>\s*\{[\s\S]*await[\s\S]*\.(?:get|post|query|find)\s*\(/,
  /\.map\s*\([\s\S]*=>\s*\{[\s\S]*await[\s\S]*\.(?:get|post|query|find)\s*\(/,
  /while\s*\(.*\)\s*\{[\s\S]*\.(?:get|post|put|delete|fetch|query|find)\s*\(/,
];

const EXPENSIVE_SCAN_PATTERNS: RegExp[] = [
  /\.select\s*\(\s*["']\*["']\s*\)/i,
  /\.findAll\s*\(/i,
  /\.all\s*\(/i,
  /paginate\s*\(\s*false/i,
  /limit\s*\(\s*\d{4,}\s*\)/i,
  /LIMIT\s+\d{4,}/i,
  /SELECT\s+\*/i,
];

const TIMEOUT_PATTERNS: RegExp[] = [
  /fetch\s*\(/i, /axios\./i, /\.get\s*\(/i, /\.post\s*\(/i,
  /openai\.chat\.completions/i, /claude\.messages\.create/i,
  /\.query\s*\(/i, /\.execute\s*\(/i,
];

const HAS_TIMEOUT = /timeout|Timeout|TIMEOUT|signal|AbortSignal|AbortController/i;
const HAS_RATE_LIMIT = /rate.?limit|RateLimit|throttle|Throttle|debounce|Debounce/i;
const HAS_CIRCUIT_BREAKER = /circuit.?breaker|CircuitBreaker|circuit.?open|fallback|Fallback|retry|Retry|backoff/i;

interface CostFactor {
  pattern: RegExp;
  category: string;
  baseCost: number;
  costPerCall: number;
  /** Expected calls per day for a typical production deployment */
  expectedDailyCalls: number;
}

const COST_FACTORS: CostFactor[] = [
  { pattern: /openai\.chat\.completions/i, category: "LLM API (OpenAI)", baseCost: 20, costPerCall: 0.02, expectedDailyCalls: 500 },
  { pattern: /claude\.messages\.create/i, category: "LLM API (Anthropic)", baseCost: 20, costPerCall: 0.03, expectedDailyCalls: 500 },
  { pattern: /anthropic\.messages/i, category: "LLM API (Anthropic)", baseCost: 20, costPerCall: 0.03, expectedDailyCalls: 500 },
  { pattern: /elasticsearch|opensearch|Elasticsearch/i, category: "Search Infrastructure", baseCost: 80, costPerCall: 0.001, expectedDailyCalls: 10000 },
  { pattern: /redis|Redis|cache|Cache/i, category: "Caching Infrastructure", baseCost: 25, costPerCall: 0.0001, expectedDailyCalls: 50000 },
  { pattern: /kafka|Kafka|rabbitmq|RabbitMQ|sqs|SQS/i, category: "Message Queue", baseCost: 40, costPerCall: 0.0005, expectedDailyCalls: 20000 },
  { pattern: /s3|S3|blob|Blob|storage|Storage/i, category: "Object Storage", baseCost: 15, costPerCall: 0.0003, expectedDailyCalls: 5000 },
  { pattern: /lambda|Lambda|serverless|Serverless|function.*app/i, category: "Serverless Compute", baseCost: 20, costPerCall: 0.0002, expectedDailyCalls: 100000 },
  { pattern: /kubernetes|k8s|docker|Docker|container/i, category: "Container Orchestration", baseCost: 120, costPerCall: 0, expectedDailyCalls: 0 },
  { pattern: /\bdatabase\b|\bdb\b|\bpostgres\b|\bmysql\b|\bmongodb\b/i, category: "Database", baseCost: 50, costPerCall: 0.0001, expectedDailyCalls: 50000 },
  { pattern: /cloud\s*run|app\s*engine|ecs|ec2|vm/i, category: "Compute", baseCost: 80, costPerCall: 0, expectedDailyCalls: 0 },
  { pattern: /api\s*gateway|apigw|kong|nginx/i, category: "API Gateway", baseCost: 25, costPerCall: 0.0001, expectedDailyCalls: 100000 },
];

function countMatches(content: string, pattern: RegExp): number {
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    count++;
    if (count > 10000) break;
  }
  return count;
}

function isInsideLoop(content: string, matchIndex: number): boolean {
  const before = content.substring(0, matchIndex);
  const lastLoopEnd = Math.max(
    before.lastIndexOf("}"),
    0,
  );
  const loopStart = before.search(/(?:for\s*\(|\.forEach\s*\(|\.map\s*\(|while\s*\()[\s\S]*$/);
  if (loopStart === -1) return false;
  return loopStart > lastLoopEnd;
}

export function analyseFinOps(content: string): FinOpsResult {
  const hasNPlusOne = N_PLUS_ONE_PATTERNS.some((p) => p.test(content));
  const hasExpensiveScans = EXPENSIVE_SCAN_PATTERNS.some((p) => p.test(content));
  const hasNetworkCalls = TIMEOUT_PATTERNS.some((p) => p.test(content));

  const hasTimeout = HAS_TIMEOUT.test(content);
  const hasRateLimit = HAS_RATE_LIMIT.test(content);
  const hasCircuitBreaker = HAS_CIRCUIT_BREAKER.test(content);

  const breakdown: CostBreakdownItem[] = COST_FACTORS
    .filter((f) => f.pattern.test(content))
    .map((f) => {
      const callCount = countMatches(content, f.pattern);

      let loopMultiplier = 1;
      const globalPattern = new RegExp(f.pattern.source, f.pattern.flags.includes("g") ? f.pattern.flags : f.pattern.flags + "g");
      let match: RegExpExecArray | null;
      let inLoopCount = 0;
      while ((match = globalPattern.exec(content)) !== null) {
        if (isInsideLoop(content, match.index)) inLoopCount++;
      }
      if (inLoopCount > 0 && hasNPlusOne) {
        loopMultiplier = Math.min(100, 10 + inLoopCount * 5);
      }

      const effectiveDailyCalls = f.expectedDailyCalls * loopMultiplier;
      const usageCost = effectiveDailyCalls * f.costPerCall * 30;
      const estimatedMonthly = Math.round(f.baseCost + usageCost);

      let confidence = 50;
      if (callCount > 0) confidence = Math.min(90, 50 + Math.min(40, callCount * 5));
      if (loopMultiplier > 1) confidence = Math.min(95, confidence + 10);

      return {
        category: f.category,
        estimatedMonthly,
        confidence,
        callCount,
        costEvidence: heuristicCostEvidence(),
      };
    });

  const totalMonthly = breakdown.reduce((sum, b) => sum + b.estimatedMonthly, 0);

  const hotspots: string[] = [];
  if (hasNPlusOne) hotspots.push("N+1 query pattern detected — exponential cost risk");
  if (hasExpensiveScans) hotspots.push("Expensive scan/full table scan detected");
  if (hasNetworkCalls && !hasTimeout) hotspots.push("Network calls without timeout — runaway cost risk");
  if (hasNetworkCalls && !hasRateLimit) hotspots.push("API calls without rate limiting");
  if (hasNetworkCalls && !hasCircuitBreaker) hotspots.push("No circuit breaker — cascading failure risk");
  const llmInLoop = breakdown.some(b => b.category.includes("LLM") && b.callCount > 1 && hasNPlusOne);
  if (llmInLoop) hotspots.push("LLM API calls inside loops — cost amplification risk");

  let costRisk: FinOpsResult["costRisk"] = "low";
  if (hotspots.length >= 3 || totalMonthly > 500) costRisk = "critical";
  else if (hotspots.length >= 2 || totalMonthly > 200) costRisk = "high";
  else if (hotspots.length >= 1 || totalMonthly > 50) costRisk = "medium";

  return {
    nPlusOneDetected: hasNPlusOne,
    expensiveScans: hasExpensiveScans,
    missingTimeout: hasNetworkCalls && !hasTimeout,
    missingRateLimit: hasNetworkCalls && !hasRateLimit,
    missingCircuitBreaker: hasNetworkCalls && !hasCircuitBreaker,
    monthlyCostEstimate: totalMonthly,
    costRisk,
    costHotspots: hotspots,
    breakdown,
    costEvidence: heuristicCostEvidence(),
  };
}
