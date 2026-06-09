import { useState, useEffect } from "react";
import {
  Save,
  TestTube2,
  Loader2,
  CheckCircle2,
  XCircle,
  Radio,
  FolderSearch,
  FolderOpen,
} from "lucide-react";
import {
  useConfig,
  useUpdateConfig,
  useDetectedSources,
  useDetectedProjects,
  useDetectedCredentials,
} from "../hooks/useApiQuery";
import { api } from "../api/client";
import type { LlmKeySource } from "../api/types";
import { cn } from "../lib/utils";

export function Settings() {
  const { data: config, isLoading } = useConfig();
  const { data: sources } = useDetectedSources();
  const { data: projects } = useDetectedProjects();
  const { data: credentials } = useDetectedCredentials();
  const updateConfig = useUpdateConfig();

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [keySource, setKeySource] = useState<LlmKeySource>("manual");
  const [dataDir, setDataDir] = useState("");
  const [claudeDir, setClaudeDir] = useState("");
  const [enabledSources, setEnabledSources] = useState<string[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{
    valid: boolean;
    error?: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setApiKey(config.llmApiKey || "");
      setBaseUrl(config.llmBaseUrl || "");
      setModel(config.llmModel || "");
      setKeySource(config.llmKeySource || "manual");
      setDataDir(config.dataDir || "");
      setClaudeDir(config.claudeProjectsDir || "");
      setEnabledSources(config.enabledSources || ["claude-code"]);
      setSelectedProjects(config.selectedProjects || []);
    }
  }, [config]);

  const handleSave = async () => {
    await updateConfig.mutateAsync({
      llmApiKey: keySource === "manual" ? apiKey || undefined : undefined,
      llmBaseUrl: baseUrl || undefined,
      llmModel: model || undefined,
      llmKeySource: keySource,
      dataDir: dataDir || undefined,
      claudeProjectsDir: claudeDir || undefined,
      enabledSources,
      selectedProjects,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.config.validate({
        apiKey: keySource === "manual" ? apiKey : "",
        baseUrl: baseUrl || undefined,
        model: model || undefined,
        keySource,
      });
      setTestResult(result);
    } catch (e: any) {
      setTestResult({ valid: false, error: e.message || String(e) });
    } finally {
      setTesting(false);
    }
  };

  const toggleSource = (id: string) => {
    setEnabledSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const toggleProject = (path: string) => {
    setSelectedProjects((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  };

  const selectAllProjects = () => {
    if (projects) {
      setSelectedProjects(projects.map((p) => p.path));
    }
  };

  const clearAllProjects = () => {
    setSelectedProjects([]);
  };

  if (isLoading)
    return <div className="p-6 text-sm text-gray-400">加载中...</div>;

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-6">设置</h1>

      <div className="space-y-8">
        {/* ─── 数据源 ─── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FolderSearch size={16} className="text-gray-500" />
            <h2 className="text-sm font-medium text-gray-700">数据源</h2>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            已检测到本机上的 Agent 数据，选择要观察的数据源。
          </p>
          <div className="space-y-2">
            {sources?.map((source) => (
              <div
                key={source.id}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border",
                  source.available
                    ? "border-gray-200 bg-white"
                    : "border-gray-100 bg-gray-50 opacity-60",
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full",
                      source.available ? "bg-emerald-400" : "bg-gray-300",
                    )}
                  />
                  <div>
                    <span className="text-sm font-medium">{source.name}</span>
                    <p className="text-xs text-gray-400">{source.dataDir}</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledSources.includes(source.id)}
                    onChange={() => toggleSource(source.id)}
                    disabled={!source.available}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 peer-disabled:opacity-40 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                </label>
              </div>
            ))}
            {!sources && (
              <p className="text-xs text-gray-400">正在检测数据源...</p>
            )}
          </div>
        </section>

        {/* ─── 学习项目 ─── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen size={16} className="text-gray-500" />
            <h2 className="text-sm font-medium text-gray-700">学习项目</h2>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            选择要学习的项目。只有勾选的项目会在「开始学习」时被处理。不选择则处理全部。
          </p>
          <div className="flex gap-2 mb-2">
            <button
              onClick={selectAllProjects}
              className="text-xs text-blue-600 hover:underline"
            >
              全选
            </button>
            <button
              onClick={clearAllProjects}
              className="text-xs text-gray-400 hover:underline"
            >
              清空
            </button>
            <span className="text-xs text-gray-300 ml-auto">
              已选 {selectedProjects.length} / {projects?.length ?? 0} 个项目
            </span>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-2">
            {projects?.map((project) => (
              <label
                key={project.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded cursor-pointer hover:bg-gray-50 transition-colors",
                  selectedProjects.includes(project.path) && "bg-blue-50",
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedProjects.includes(project.path)}
                  onChange={() => toggleProject(project.path)}
                  className="text-blue-600 rounded"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm truncate block">{project.name}</span>
                  <span className="text-xs text-gray-400">
                    {project.sessionCount} 个会话
                  </span>
                </div>
              </label>
            ))}
            {!projects && (
              <p className="text-xs text-gray-400 p-2">正在检测项目...</p>
            )}
            {projects?.length === 0 && (
              <p className="text-xs text-gray-400 p-2">未检测到项目。</p>
            )}
          </div>
        </section>

        {/* ─── LLM 凭证 ─── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Radio size={16} className="text-gray-500" />
            <h2 className="text-sm font-medium text-gray-700">LLM 凭证</h2>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            选择用于经验提取的 API Key 来源。
          </p>

          <div className="space-y-2 mb-4">
            {credentials?.map((cred) => (
              <label
                key={cred.source}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  keySource === cred.source
                    ? "border-blue-300 bg-blue-50"
                    : "border-gray-200 bg-white",
                  !cred.available &&
                    cred.source !== "manual" &&
                    "opacity-50 cursor-not-allowed",
                )}
              >
                <input
                  type="radio"
                  name="keySource"
                  value={cred.source}
                  checked={keySource === cred.source}
                  onChange={() => setKeySource(cred.source)}
                  disabled={!cred.available && cred.source !== "manual"}
                  className="text-blue-600"
                />
                <div className="flex-1">
                  <span className="text-sm">{cred.label}</span>
                  {cred.keyPreview && (
                    <span className="ml-2 text-xs text-gray-400 font-mono">
                      {cred.keyPreview}
                    </span>
                  )}
                </div>
                {cred.available && cred.source !== "manual" && (
                  <CheckCircle2 size={14} className="text-emerald-500" />
                )}
              </label>
            ))}
          </div>

          {keySource === "manual" && (
            <div className="space-y-3 pl-6 border-l-2 border-blue-200">
              <Field label="API Key">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
                />
              </Field>
              <Field label="Base URL（可选）">
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.anthropic.com"
                  className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
                />
              </Field>
            </div>
          )}

          <div className="mt-3">
            <Field label="模型">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm bg-white"
              >
                <option value="claude-sonnet-4-20250514">
                  Claude Sonnet 4
                </option>
                <option value="claude-haiku-4-5-20251001">
                  Claude Haiku 4.5
                </option>
                <option value="claude-opus-4-8">Claude Opus 4.8</option>
              </select>
            </Field>
          </div>

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <TestTube2 size={14} />
              )}
              测试连接
            </button>
            {testResult && (
              <span className="flex items-center gap-1 text-sm">
                {testResult.valid ? (
                  <>
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    <span className="text-emerald-600">连接成功</span>
                  </>
                ) : (
                  <>
                    <XCircle size={14} className="text-red-500" />
                    <span className="text-red-600 text-xs">
                      {testResult.error}
                    </span>
                  </>
                )}
              </span>
            )}
          </div>
        </section>

        {/* ─── 存储 ─── */}
        <section>
          <h2 className="text-sm font-medium text-gray-700 mb-3">存储</h2>
          <div className="space-y-3">
            <Field label="数据目录">
              <input
                type="text"
                value={dataDir}
                onChange={(e) => setDataDir(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
              />
            </Field>
            <Field label="Claude 项目目录">
              <input
                type="text"
                value={claudeDir}
                onChange={(e) => setClaudeDir(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
              />
            </Field>
          </div>
        </section>

        {/* ─── 保存 ─── */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={updateConfig.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={14} />
            保存
          </button>
          {saved && <span className="text-sm text-emerald-600">已保存</span>}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
