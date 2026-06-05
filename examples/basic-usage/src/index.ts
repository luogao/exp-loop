import { rm } from "fs/promises";
import {
  createExpLoop,
  createExpExtractor,
  createExpGuard,
  createExpRetriever,
  createContextInjector,
  createPatternMiner,
  createSkillDistiller,
  type Task,
  type EpisodeStatus,
  type ExecutionTrace,
} from "@exp-loop/core";
import { createFileSystemStores } from "@exp-loop/store-fs";

// ─── Mock LLM ──────────────────────────────────────
// 真实项目中替换为 Anthropic/OpenAI API 调用
async function mockLlm(prompt: string): Promise<string> {
  if (prompt.includes("experience extraction")) {
    return JSON.stringify([
      {
        title: "Use overflow-hidden for fixed-height containers",
        problem:
          "Container overflows its parent when content exceeds fixed height",
        recommendation:
          "Apply overflow: hidden or overflow: auto to fixed-height containers instead of relying on parent clipping",
        triggers: ["css", "overflow", "layout", "container"],
        applyWhen: [
          "Working with fixed-height containers",
          "Content may exceed container bounds",
        ],
        avoid: ["overflow: visible on fixed-height elements"],
        evidence: ["Sidebar overflow caused layout shift on window resize"],
        confidence: 0.85,
      },
    ]);
  }

  if (prompt.includes("skill distillation")) {
    return JSON.stringify({
      name: "frontend-bugfix-workflow",
      description: "Standard workflow for fixing frontend layout bugs",
      triggers: ["css", "layout", "bugfix", "frontend"],
      content: [
        "## When To Use\n",
        "Use when fixing CSS layout bugs in frontend components.\n",
        "## Workflow\n",
        "1. Inspect the component tree and identify the affected element\n",
        "2. Check computed styles and box model in DevTools\n",
        "3. Apply the minimal CSS fix\n",
        "4. Verify in multiple viewport sizes\n",
        "5. Run visual regression tests\n",
        "## Common Pitfalls\n",
        "- Verify overflow behavior on fixed-height containers\n",
        "- Check z-index stacking context when modifying position\n",
        "## Verification\n",
        "- Visual check in Chrome and Firefox\n",
        "- Responsive breakpoint testing\n",
      ].join(""),
    });
  }

  return "[]";
}

// ─── 初始化 ────────────────────────────────────────
const DATA_DIR = ".exp-loop-demo";

// 清理旧数据
await rm(DATA_DIR, { recursive: true, force: true });

const stores = createFileSystemStores(DATA_DIR);

const loop = createExpLoop({
  episodeStore: stores.episodeStore,
  experienceStore: stores.experienceStore,
  retriever: createExpRetriever({ store: stores.experienceStore, topK: 5 }),
  extractor: createExpExtractor({ llm: mockLlm }),
  guard: createExpGuard({ minConfidence: 0.5 }),
  injector: createContextInjector({ format: "markdown" }),
  patternMiner: createPatternMiner({
    episodeStore: stores.episodeStore,
    patternStore: stores.patternStore,
    minSupport: 3,
  }),
  skillDistiller: createSkillDistiller({
    llm: mockLlm,
    episodeStore: stores.episodeStore,
    experienceStore: stores.experienceStore,
  }),
  skillRegistry: stores.skillRegistry,
});

// ─── 模拟 3 次任务执行 ─────────────────────────────

const tasks: { task: Task; status: EpisodeStatus; trace: ExecutionTrace }[] = [
  {
    task: {
      id: "task_001",
      description: "Fix CSS overflow bug in sidebar component",
      domain: "frontend",
      taskType: "bugfix",
    },
    status: "success",
    trace: {
      steps: [
        { index: 0, action: "inspect component tree" },
        { index: 1, action: "identify overflow in sidebar" },
        { index: 2, action: "apply overflow-hidden fix" },
        { index: 3, action: "run tests" },
        { index: 4, action: "browser verification" },
      ],
      corrections: [
        {
          from: "overflow: scroll",
          to: "overflow: hidden",
          reason: "scroll causes layout shift on resize",
        },
      ],
    },
  },
  {
    task: {
      id: "task_002",
      description: "Fix z-index stacking bug in modal overlay",
      domain: "frontend",
      taskType: "bugfix",
    },
    status: "success",
    trace: {
      steps: [
        { index: 0, action: "inspect stacking context" },
        { index: 1, action: "identify z-index conflict" },
        { index: 2, action: "fix z-index value" },
        { index: 3, action: "run tests" },
        { index: 4, action: "browser verification" },
      ],
    },
  },
  {
    task: {
      id: "task_003",
      description: "Fix flex layout breaking in responsive grid",
      domain: "frontend",
      taskType: "bugfix",
    },
    status: "success",
    trace: {
      steps: [
        { index: 0, action: "inspect flex container" },
        { index: 1, action: "identify flex-wrap issue" },
        { index: 2, action: "apply flex-wrap fix" },
        { index: 3, action: "run tests" },
        { index: 4, action: "responsive viewport test" },
      ],
    },
  },
];

console.log("═══════════════════════════════════════════════");
console.log("  exp-loop 端到端演示");
console.log("═══════════════════════════════════════════════\n");

for (let i = 0; i < tasks.length; i++) {
  const { task, status, trace } = tasks[i];
  const now = new Date().toISOString();

  console.log(`── 第 ${i + 1} 次任务: ${task.description} ──\n`);

  // 1. beforeRun
  const prep = await loop.beforeRun({ task });
  if (prep.promptBlock) {
    console.log("📥 beforeRun 注入的上下文:\n");
    console.log(prep.promptBlock);
  } else {
    console.log("📥 beforeRun: 无匹配经验/技能\n");
  }
  console.log(`   匹配 experiences: ${prep.experiences.length}`);
  console.log(`   匹配 skills: ${prep.skillSummaries.length}\n`);

  // 2. afterRun
  const result = await loop.afterRun({
    task,
    status,
    trace,
    result: `Completed: ${task.description}`,
    startedAt: now,
    endedAt: now,
  });

  console.log("📤 afterRun 结果:");
  console.log(`   Episode ID: ${result.episodeId}`);
  console.log(`   新 experiences: ${result.newExperiences.length}`);
  if (result.newExperiences.length > 0) {
    result.newExperiences.forEach((exp) => {
      console.log(`     - ${exp.title}`);
      console.log(`       推荐: ${exp.recommendation.slice(0, 80)}...`);
    });
  }
  console.log(`   被拒绝的候选: ${result.rejectedCandidates.length}`);
  console.log(`   更新的 patterns: ${result.updatedPatterns.length}`);
  if (result.updatedPatterns.length > 0) {
    const pat = result.updatedPatterns[0];
    console.log(
      `     Pattern: ${pat.signature} (support=${pat.support}, promotion=${pat.promotion})`,
    );
  }
  console.log(`   Skill proposals: ${result.skillProposals.length}`);
  if (result.skillProposals.length > 0) {
    for (const sp of result.skillProposals) {
      console.log(`     - ${sp.title} (confidence=${sp.confidence.toFixed(2)})`);
      // 保存为 draft skill
      const skill = await stores.skillRegistry.saveDraft(sp);
      console.log(`     → 已保存为 draft: ${skill.path}`);
    }
  }
  console.log("\n");
}

// ─── 最终状态检查 ──────────────────────────────────

console.log("═══════════════════════════════════════════════");
console.log("  最终状态");
console.log("═══════════════════════════════════════════════\n");

const allEpisodes = await stores.episodeStore.list();
console.log(`Episodes: ${allEpisodes.length}`);

const allExps = await stores.experienceStore.list();
console.log(`Experiences: ${allExps.length}`);
allExps.forEach((e) => {
  console.log(`  [${e.id}] ${e.title} (v${e.version}, ${e.status}${e.needsReview ? ", needs review" : ""})`);
});

const allPatterns = await stores.patternStore.list();
console.log(`Patterns: ${allPatterns.length}`);
allPatterns.forEach((p) => {
  console.log(`  [${p.id}] ${p.signature} (support=${p.support}, promotion=${p.promotion})`);
});

const allSkills = await stores.skillRegistry.listSummaries();
console.log(`Skills: ${allSkills.length}`);
allSkills.forEach((s) => {
  console.log(`  [${s.id}] ${s.name}: ${s.description}`);
});

// ─── 第 4 次任务 — 验证 skill 可用 ─────────────────

if (allSkills.length > 0) {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  第 4 次任务 — 验证 skill 加载");
  console.log("═══════════════════════════════════════════════\n");

  const task4: Task = {
    id: "task_004",
    description: "Fix padding inconsistency in card component",
    domain: "frontend",
    taskType: "bugfix",
    tags: ["css"],
  };

  const prep4 = await loop.beforeRun({ task: task4 });
  console.log("📥 beforeRun 注入的上下文:\n");
  console.log(prep4.promptBlock);

  if (prep4.skillSummaries.length > 0) {
    console.log("\n加载完整 skill:\n");
    const skill = await prep4.loadSkill(prep4.skillSummaries[0].id);
    console.log(`名称: ${skill.name}`);
    console.log(`版本: ${skill.version}`);
    console.log(`内容:\n${skill.content}`);
  }
}

console.log("\n✅ 演示完成！查看 .exp-loop-demo/ 目录了解文件存储结构");
console.log("   tree .exp-loop-demo/");
