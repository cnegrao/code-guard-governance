import type { DetectedAgent } from './types';
import type { OversightLevel } from './oversight';

interface FrameworkPattern {
  name: string;
  signals: RegExp[];
  agentType: DetectedAgent['type'];
  defaultRisk: DetectedAgent['riskLevel'];
  defaultOversight: OversightLevel;
  isAutonomous: boolean;
}

const FRAMEWORKS: FrameworkPattern[] = [
  {
    name: 'OpenAI Agents SDK',
    signals: [/from\s+['"]openai['"].*Agent|openai.*agents.*Runner|OpenAI.*Agent|from\s+['"]@openai\/agents/, /agents\.Runner\.run/, /Agent\(.*instructions/, /handoff\s*\(/],
    agentType: 'ai_persona', defaultRisk: 'high', defaultOversight: 'l3_human_approval', isAutonomous: true,
  },
  {
    name: 'LangChain',
    signals: [/from\s+['"]langchain|import.*langchain|langchain\.agents|create_react_agent|AgentExecutor/, /from\s+['"]@langchain/],
    agentType: 'ai_persona', defaultRisk: 'medium', defaultOversight: 'l2_human_review', isAutonomous: false,
  },
  {
    name: 'LangGraph',
    signals: [/from\s+['"]langgraph/, /StateGraph|CompiledGraph|add_node|add_edge/, /langgraph\.prebuilt/],
    agentType: 'ai_persona', defaultRisk: 'high', defaultOversight: 'l2_human_review', isAutonomous: false,
  },
  {
    name: 'CrewAI',
    signals: [/from\s+['"]crewai/, /Crew\s*\(|Agent\s*\(.*role|Task\s*\(.*description/, /crewai\.tools/],
    agentType: 'ai_persona', defaultRisk: 'medium', defaultOversight: 'l2_human_review', isAutonomous: false,
  },
  {
    name: 'AutoGen',
    signals: [/from\s+['"]autogen/, /autogen\.AssistantAgent|autogen\.UserProxyAgent|ConversableAgent/, /pyautogen|autogen_agentchat/],
    agentType: 'ai_persona', defaultRisk: 'high', defaultOversight: 'l3_human_approval', isAutonomous: true,
  },
  {
    name: 'Claude Code / Anthropic',
    signals: [/from\s+['"]anthropic/, /claude\.messages\.create|Anthropic\(\)|Claude\(/, /tool_use\b|@anthropic-ai\/sdk/, /claude_code|CLAUDE\.md/],
    agentType: 'ai_persona', defaultRisk: 'medium', defaultOversight: 'l2_human_review', isAutonomous: false,
  },
  {
    name: 'Cursor Origin',
    signals: [/\.cursor\/rules|\.cursor\/commands|\.cursor\/agents/, /cursor.*agent|origin.*agent/i],
    agentType: 'service', defaultRisk: 'medium', defaultOversight: 'l2_human_review', isAutonomous: false,
  },
  {
    name: 'OpenRouter',
    signals: [/from\s+['"]openrouter|openrouter\.ai|openrouter\/chat/, /openrouter.*completions/],
    agentType: 'service', defaultRisk: 'low', defaultOversight: 'l1_automated', isAutonomous: false,
  },
  {
    name: 'Dify',
    signals: [/dify|dify\.ai|dify_app/, /dify.*workflow|dify.*agent/],
    agentType: 'service', defaultRisk: 'medium', defaultOversight: 'l2_human_review', isAutonomous: false,
  },
  {
    name: 'Semantic Kernel',
    signals: [/Microsoft\.SemanticKernel|using.*SemanticKernel|CreateKernel|Kernel\.Builder/, /semantic-kernel/],
    agentType: 'service', defaultRisk: 'medium', defaultOversight: 'l2_human_review', isAutonomous: false,
  },
  {
    name: 'LlamaIndex',
    signals: [/from\s+['"]llama_index|llama_index\.agent|from\s+['"]llamaindex/, /ReActAgent|OpenAIAgent|FunctionCallingAgent/],
    agentType: 'ai_persona', defaultRisk: 'low', defaultOversight: 'l1_automated', isAutonomous: false,
  },
  {
    name: 'OpenAI SDK',
    signals: [/from\s+['"]openai['"]|import\s+OpenAI|openai\.chat\.completions/, /new\s+OpenAI\(/, /openai\.beta\.chat/],
    agentType: 'service', defaultRisk: 'low', defaultOversight: 'l1_automated', isAutonomous: false,
  },
  {
    name: 'MCP Server',
    signals: [/from\s+['"]@modelcontextprotocol/, /Server\(.*name|server\.run\(|StdioServerTransport/, /mcp\/server|mcp\.server/],
    agentType: 'service', defaultRisk: 'medium', defaultOversight: 'l2_human_review', isAutonomous: false,
  },
  {
    name: 'CAMEL',
    signals: [/from\s+['"]camel/, /camel\.agent|CamelAgent|camel\.models|camel\.messages/, /OWL\.run|owl\.agent/i, /CAMEL\.run|RolePlaying/, /@camel-ai\//],
    agentType: 'ai_persona', defaultRisk: 'high', defaultOversight: 'l3_human_approval', isAutonomous: true,
  },
  {
    name: 'n8n AI',
    signals: [/n8n.*ai|n8n.*agent|n8n.*workflow/, /@n8n/],
    agentType: 'service', defaultRisk: 'medium', defaultOversight: 'l2_human_review', isAutonomous: false,
  },
  {
    name: 'Custom Agent',
    signals: [/\b(agent|assistant|bot|workflow|orchestrat|crew|autonomous|reasoning|planner|memory|router|function_calling|tool_use|handoff)\b/i],
    agentType: 'ai_persona', defaultRisk: 'medium', defaultOversight: 'l2_human_review', isAutonomous: false,
  },
];

const SCAN_EXTENSIONS = ['.py', '.ts', '.tsx', '.js', '.jsx', '.go', '.rs', '.java', '.cs', '.rb', '.php', '.yaml', '.yml', '.json', '.toml', '.md'];

export interface FrameworkMatch {
  framework: string;
  agentType: DetectedAgent['type'];
  defaultRisk: DetectedAgent['riskLevel'];
  defaultOversight: OversightLevel;
  isAutonomous: boolean;
  confidence: number;
  evidence: string[];
}

export function detectAgentFrameworks(files: Map<string, string>): Map<string, FrameworkMatch[]> {
  const fileMatches = new Map<string, FrameworkMatch[]>();

  for (const [path, content] of Array.from(files)) {
    if (!content || content.length > 500000) continue;
    const ext = path.slice(path.lastIndexOf('.'));
    if (!SCAN_EXTENSIONS.includes(ext)) continue;

    const matched: FrameworkMatch[] = [];

    for (const fw of FRAMEWORKS) {
      const matchedSignals = fw.signals.filter((s) => s.test(content));
      if (matchedSignals.length === 0) continue;
      if (fw.name === 'Custom Agent' && matchedSignals.length < 3) continue;

      const confidence = Math.min(95, 40 + matchedSignals.length * 15);
      matched.push({
        framework: fw.name,
        agentType: fw.agentType,
        defaultRisk: fw.defaultRisk,
        defaultOversight: fw.defaultOversight,
        isAutonomous: fw.isAutonomous,
        confidence,
        evidence: matchedSignals.map((s) => `Pattern: ${s.source.slice(0, 60)}`),
      });
    }

    if (matched.length > 0) {
      fileMatches.set(path, matched.sort((a, b) => b.confidence - a.confidence));
    }
  }

  return fileMatches;
}

export function buildAgentsFromFrameworkMatches(
  fileMatches: Map<string, FrameworkMatch[]>
): DetectedAgent[] {
  const agents: DetectedAgent[] = [];
  const seen = new Set<string>();

  for (const [filePath, matches] of Array.from(fileMatches)) {
    for (const match of matches) {
      const filename = filePath.split('/').pop() ?? filePath;
      const agentName = `${match.framework.replace(/\s+/g, '')}_${filename.replace(/\.[^.]+$/, '')}`.slice(0, 60);
      const key = `${agentName}:${filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      agents.push({
        name: agentName,
        type: match.agentType,
        tools: [match.framework],
        models: [],
        riskLevel: match.defaultRisk,
        critical: match.isAutonomous || match.defaultRisk === 'high',
        framework: match.framework,
        oversightLevel: 'UNKNOWN',
        oversightSuggestion: match.defaultOversight,
        filePath,
        isAutonomous: match.isAutonomous,
        confidence: match.confidence,
      });
    }
  }

  return agents;
}
