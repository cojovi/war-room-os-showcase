// Agent roster + deterministic task routing.
// Human prose: docs/PROVENANCE.md — keep this file in sync when lanes change.
// Claim loop still uses agent_capabilities; this module decides required_skills
// (and suggestions) so the right specialist can claim.

export interface AgentRosterEntry {
  name: string;
  displayName: string;
  /** Exclusive primary skill — only this agent should have it in DB. */
  primarySkill: string;
  skills: { skill: string; proficiency: number }[];
  /** Weighted keyword/phrase hits against title+description. */
  keywords: string[];
  summary: string;
  systemPrompt: string;
}

export const AGENT_ROSTER: readonly AgentRosterEntry[] = [
  {
    "name": "atlas",
    "displayName": "Atlas",
    "primarySkill": "tech",
    "skills": [
      {
        "skill": "tech",
        "proficiency": 5
      }
    ],
    "keywords": [
      "code",
      "api",
      "automation",
      "script",
      "debug",
      "integration"
    ],
    "summary": "Fictional tech specialist for the showcase.",
    "systemPrompt": "You are Atlas, a fictional showcase worker. Attach evidence to completed work."
  },
  {
    "name": "signal",
    "displayName": "Signal",
    "primarySkill": "research",
    "skills": [
      {
        "skill": "research",
        "proficiency": 5
      }
    ],
    "keywords": [
      "research",
      "review",
      "source",
      "evidence"
    ],
    "summary": "Fictional research specialist for the showcase.",
    "systemPrompt": "You are Signal, a fictional showcase worker. Attach evidence to completed work."
  },
  {
    "name": "relay",
    "displayName": "Relay",
    "primarySkill": "ops",
    "skills": [
      {
        "skill": "ops",
        "proficiency": 5
      }
    ],
    "keywords": [
      "queue",
      "schedule",
      "handoff",
      "dispatch"
    ],
    "summary": "Fictional ops specialist for the showcase.",
    "systemPrompt": "You are Relay, a fictional showcase worker. Attach evidence to completed work."
  }
] as const;

export type AgentRosterName = (typeof AGENT_ROSTER)[number]["name"];

export interface RouteDecision {
  agentName: AgentRosterName;
  displayName: string;
  requiredSkills: string[];
  reason: string;
  score: number;
  /** Top matches for suggested mode (best first). */
  candidates: { agentName: AgentRosterName; displayName: string; score: number; reason: string }[];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreAgent(haystack: string, entry: AgentRosterEntry): { score: number; hits: string[] } {
  const hits: string[] = [];
  let score = 0;
  for (const kw of entry.keywords) {
    const needle = kw.toLowerCase();
    if (!needle) continue;
    if (haystack.includes(needle)) {
      hits.push(kw);
      // Longer phrases are more specific → slightly higher weight.
      score += needle.includes(" ") ? 3 : 2;
    }
  }
  return { score, hits };
}

/**
 * Pick the best agent lane for a task from title + description.
 * When nothing matches, fall back to Atlas (default generalist).
 */
export function routeTask(title: string, description?: string | null): RouteDecision {
  const haystack = normalize(`${title}\n${description ?? ""}`);
  const scored = AGENT_ROSTER.map((entry) => {
    const { score, hits } = scoreAgent(haystack, entry);
    return {
      entry,
      score,
      reason: hits.length
        ? `matched: ${hits.slice(0, 6).join(", ")}`
        : "no keyword hits",
    };
  }).sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));

  const best = scored[0]!;
  const useAtlasFallback = best.score === 0;
  const winner = useAtlasFallback
    ? scored.find((s) => s.entry.name === "atlas") ?? best
    : best;

  const candidates = (useAtlasFallback ? scored.filter((s) => s.entry.name === "atlas") : scored)
    .filter((s) => useAtlasFallback || s.score > 0)
    .slice(0, 3)
    .map((s) => ({
      agentName: s.entry.name as AgentRosterName,
      displayName: s.entry.displayName,
      score: s.score,
      reason: s.reason,
    }));

  return {
    agentName: winner.entry.name as AgentRosterName,
    displayName: winner.entry.displayName,
    requiredSkills: [winner.entry.primarySkill],
    reason: useAtlasFallback
      ? "no specialist keywords — defaulted to Atlas (tech generalist)"
      : `${winner.entry.displayName}: ${winner.reason}`,
    score: winner.score,
    candidates: candidates.length
      ? candidates
      : [{
          agentName: "atlas",
          displayName: "Atlas",
          score: 0,
          reason: "default generalist",
        }],
  };
}

export function rosterByName(name: string): AgentRosterEntry | undefined {
  return AGENT_ROSTER.find((a) => a.name === name);
}

/** Flat skill → agent name map for UI hints. */
export function skillOwnerMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of AGENT_ROSTER) {
    for (const { skill } of a.skills) {
      if (!(skill in out)) out[skill] = a.name;
    }
  }
  return out;
}
