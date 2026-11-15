// @agos/shared — enums, domain types, and event taxonomy mirrored from the DB schema.
// DB is snake_case; TS is camelCase for locals but DB row types keep snake_case
// so nothing lies about what Postgres returns.

export const TASK_STATUSES = [
  "draft", "pending", "claimed", "in_progress", "review",
  "blocked", "done", "failed", "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RUN_STATUSES = [
  "queued", "starting", "running", "awaiting_approval",
  "succeeded", "failed", "abandoned", "killed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const AGENT_STATUSES = ["offline", "idle", "working", "blocked", "paused", "error"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const ASSIGNMENT_MODES = ["manual", "suggested", "autonomous"] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

export const AUTHOR_TYPES = ["human", "agent", "system"] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

export const COMMENT_KINDS = ["comment", "status_update", "question", "decision", "handoff"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const ARTIFACT_KINDS = ["file", "link", "code", "log", "image", "evidence"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "denied", "expired"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const SEVERITIES = ["info", "success", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const PROJECT_STATUSES = ["active", "paused", "archived", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const GATED_ACTIONS = [
  "delete_file_outside_workspace", "shell_outside_workspace", "deploy_production",
  "send_email", "send_message", "spend_money", "access_secret",
  "modify_home_automation", "install_software", "network_request_new_domain",
  "write_to_shared_repo",
] as const;
export type GatedAction = (typeof GATED_ACTIONS)[number];

// DETAILS.md §2.1 legal transitions (UI uses this to offer only valid moves;
// the DB trigger is the actual enforcer).
export const LEGAL_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  draft: ["pending", "cancelled"],
  pending: ["claimed", "blocked", "cancelled"],
  claimed: ["in_progress", "pending", "blocked", "cancelled"],
  in_progress: ["review", "blocked", "done", "failed", "pending", "cancelled"],
  review: ["done", "pending", "blocked", "cancelled"],
  blocked: ["pending", "cancelled"],
  failed: ["pending", "cancelled"],
  done: [],
  cancelled: [],
};

export interface AcceptanceCriterion {
  id: string;
  text: string;
  met: boolean;
  verified_by: string | null;
}

export interface VerificationStep {
  id: string;
  instruction: string;
  result: string | null;
}

export interface ProjectGoal {
  id: string;
  text: string;
  done: boolean;
}

// Event taxonomy (DETAILS.md §4)
export const EVENT_TYPES = [
  "project.created", "project.updated", "project.status_changed",
  "task.created", "task.updated", "task.status_changed", "task.ready",
  "task.claimed", "task.blocked", "task.unblocked",
  "task.comment_added", "task.artifact_added", "task.summary_regenerated",
  "run.created", "run.started", "run.progress", "run.awaiting_approval",
  "run.resumed", "run.succeeded", "run.failed", "run.abandoned", "run.killed",
  "agent.registered", "agent.updated", "agent.status_changed",
  "agent.heartbeat_lost", "agent.budget_exceeded",
  "approval.requested", "approval.decided", "approval.expired",
  "cost.recorded", "system.paused", "system.resumed",
  "orchestrator.assigned", "orchestrator.suggested",
  "notification.sent",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EventPayload {
  schema_version: number;
  occurred_at?: string;
  actor?: { type: AuthorType; id: string | null };
  subject?: { type: string; id: string };
  data: Record<string, unknown>;
}

// Agent lanes + deterministic routing (docs/agents/AGENT_ROSTER.md)
export {
  AGENT_ROSTER,
  routeTask,
  rosterByName,
  skillOwnerMap,
  type AgentRosterEntry,
  type AgentRosterName,
  type RouteDecision,
} from "./agent-roster";
