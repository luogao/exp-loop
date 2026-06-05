// ─── Task ──────────────────────────────────────────

export interface Task {
  id: string;
  description: string;
  domain?: string;
  taskType?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ─── Episode ───────────────────────────────────────

export type EpisodeStatus = "success" | "failure" | "partial";

export interface TraceStep {
  index: number;
  action: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ExecutionTrace {
  steps: TraceStep[];
  toolCalls?: { name: string; args?: unknown; result?: unknown }[];
  errors?: { message: string; code?: string; step?: number }[];
  corrections?: { from: string; to: string; reason: string }[];
}

export interface Episode {
  id: string;
  task: Task;
  status: EpisodeStatus;
  trace: ExecutionTrace;
  result?: unknown;
  startedAt: string;
  endedAt: string;
}

// ─── Experience ────────────────────────────────────

export type Scope = "global" | "domain" | "project";
export type ExperienceStatus = "active" | "draft" | "deprecated";

export interface ExperienceRevision {
  version: number;
  recommendation: string;
  mergedFromEpisodeId: string;
  replacedAt: string;
}

export interface Experience {
  id: string;
  title: string;
  domain?: string;
  taskType?: string;
  scope: Scope;
  triggers: string[];
  problem: string;
  recommendation: string;
  avoid?: string[];
  applyWhen: string[];
  evidence?: string[];
  sourceEpisodeIds: string[];
  confidence: number;
  version: number;
  history?: ExperienceRevision[];
  needsReview?: boolean;
  status: ExperienceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExperienceCandidate {
  title: string;
  domain?: string;
  taskType?: string;
  scope?: Scope;
  triggers: string[];
  problem: string;
  recommendation: string;
  avoid?: string[];
  applyWhen: string[];
  evidence?: string[];
  confidence: number;
}

// ─── Pattern ───────────────────────────────────────

export type PromotionStatus =
  | "none"
  | "candidate_skill"
  | "existing_skill_patch";

export interface Pattern {
  id: string;
  domain?: string;
  taskType?: string;
  signature: string;
  matchedEpisodeIds: string[];
  commonSteps: string[];
  commonTools?: string[];
  recurringFailures?: string[];
  successRate: number;
  support: number;
  confidence: number;
  promotion: PromotionStatus;
}

// ─── Skill ─────────────────────────────────────────

export type SkillStatus = "draft" | "active" | "deprecated";

export interface Skill {
  id: string;
  name: string;
  description: string;
  domain?: string;
  taskType?: string;
  scope: Scope;
  triggers: string[];
  version: string;
  status: SkillStatus;
  sourcePatternIds: string[];
  sourceExperienceIds: string[];
  content: string;
  path?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  domain?: string;
  taskType?: string;
  triggers: string[];
}

export interface SkillProposal {
  id: string;
  title: string;
  reason: string;
  sourcePatternId: string;
  sourceExperienceIds: string[];
  proposedSkill: Omit<Skill, "id" | "createdAt" | "updatedAt">;
  confidence: number;
  status: "pending_review" | "auto_approved";
}

// ─── Usage Tracking ────────────────────────────────

export type UsageOutcome = "helped" | "neutral" | "harmful" | "unknown";

export interface ExperienceUsage {
  experienceId: string;
  episodeId: string;
  matchedAt: string;
  injected: boolean;
  outcome?: UsageOutcome;
}

export interface SkillUsage {
  skillId: string;
  episodeId: string;
  matchedAt: string;
  loaded: boolean;
  followed?: boolean;
  outcome?: UsageOutcome;
}

// ─── Store Interfaces ──────────────────────────────

export interface EpisodeQuery {
  domain?: string;
  taskType?: string;
  status?: EpisodeStatus;
  limit?: number;
  after?: string;
}

export interface EpisodeStore {
  save(episode: Episode): Promise<void>;
  get(id: string): Promise<Episode | null>;
  list(query?: EpisodeQuery): Promise<Episode[]>;
}

export interface ExpListQuery {
  domain?: string;
  taskType?: string;
  scope?: Scope;
  status?: ExperienceStatus;
}

export interface ExperienceStore {
  save(exp: Experience): Promise<void>;
  get(id: string): Promise<Experience | null>;
  list(query?: ExpListQuery): Promise<Experience[]>;
  update(id: string, patch: Partial<Experience>): Promise<void>;
  recordUsage(usage: ExperienceUsage): Promise<void>;
}

export interface PatternStore {
  save(pattern: Pattern): Promise<void>;
  get(id: string): Promise<Pattern | null>;
  list(): Promise<Pattern[]>;
  update(id: string, patch: Partial<Pattern>): Promise<void>;
}

export interface SkillQuery {
  domain?: string;
  taskType?: string;
  status?: SkillStatus;
}

export interface SkillRegistry {
  listSummaries(query?: SkillQuery): Promise<SkillSummary[]>;
  load(id: string): Promise<Skill | null>;
  saveDraft(proposal: SkillProposal): Promise<Skill>;
  activate(id: string): Promise<void>;
  deprecate(id: string): Promise<void>;
  markUsed(usage: SkillUsage): Promise<void>;
}

// ─── Module Interfaces ─────────────────────────────

export interface ExtractorConfig {
  llm: (prompt: string) => Promise<string>;
  maxCandidates?: number;
}

export interface ExpExtractor {
  extract(episode: Episode): Promise<ExperienceCandidate[]>;
}

export type GuardDecision = "accept" | "reject" | "merge";

export interface GuardResult {
  decision: GuardDecision;
  reason: string;
  mergeTargetId?: string;
}

export interface ExpGuardConfig {
  minConfidence?: number;
  minApplyWhenCount?: number;
  minRecommendationLength?: number;
}

export interface ExpGuard {
  evaluate(
    candidate: ExperienceCandidate,
    existing: Experience[],
  ): Promise<GuardResult>;
}

export interface RetrieveInput {
  task: Task;
  topK?: number;
}

export interface RetrieverConfig {
  store: ExperienceStore;
  topK?: number;
}

export interface ExpRetriever {
  retrieve(input: RetrieveInput): Promise<Experience[]>;
}

export type InjectionFormat = "markdown" | "xml" | "json";

export interface InjectorConfig {
  format?: InjectionFormat;
  maxExperiences?: number;
  maxSkillSummaries?: number;
}

export interface ContextInjector {
  render(experiences: Experience[], skillSummaries: SkillSummary[]): string;
}

export interface PatternMinerConfig {
  episodeStore: EpisodeStore;
  patternStore: PatternStore;
  minSupport?: number;
  minSuccessRate?: number;
}

export interface PatternMiner {
  mine(episode: Episode): Promise<Pattern[]>;
}

export interface SkillDistillerConfig {
  llm: (prompt: string) => Promise<string>;
  episodeStore: EpisodeStore;
  experienceStore: ExperienceStore;
}

export interface SkillDistiller {
  distill(pattern: Pattern): Promise<SkillProposal | null>;
}

// ─── Runtime IO ────────────────────────────────────

export interface BeforeRunInput {
  task: Task;
  agent?: { name: string; version?: string };
  project?: string;
}

export interface BeforeRunResult {
  promptBlock: string;
  experiences: Experience[];
  skillSummaries: SkillSummary[];
  loadSkill: (id: string) => Promise<Skill>;
}

export interface AfterRunInput {
  task: Task;
  status: EpisodeStatus;
  trace: ExecutionTrace;
  result?: unknown;
  startedAt: string;
  endedAt: string;
}

export interface AfterRunResult {
  episodeId: string;
  newExperiences: Experience[];
  rejectedCandidates: { candidate: ExperienceCandidate; reason: string }[];
  updatedPatterns: Pattern[];
  skillProposals: SkillProposal[];
}

export interface ExpLoopConfig {
  episodeStore: EpisodeStore;
  experienceStore: ExperienceStore;
  retriever: ExpRetriever;
  extractor: ExpExtractor;
  guard: ExpGuard;
  injector: ContextInjector;
  skillRegistry?: SkillRegistry;
  patternMiner?: PatternMiner;
  skillDistiller?: SkillDistiller;
}

export interface ExpLoopRuntime {
  beforeRun(input: BeforeRunInput): Promise<BeforeRunResult>;
  afterRun(input: AfterRunInput): Promise<AfterRunResult>;
}
