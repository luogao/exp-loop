import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../api/client";

export function useStats() {
  return useQuery({ queryKey: ["stats"], queryFn: api.stats.get });
}

export function useProjectStats() {
  return useQuery({ queryKey: ["stats", "byProject"], queryFn: api.stats.byProject });
}

export function useEpisodes(query?: Record<string, unknown>) {
  return useQuery({
    queryKey: ["episodes", query],
    queryFn: () => api.episodes.list(query),
  });
}

export function useEpisode(id: string) {
  return useQuery({
    queryKey: ["episodes", id],
    queryFn: () => api.episodes.get(id),
    enabled: !!id,
  });
}

export function useExperiences(query?: Record<string, unknown>) {
  return useQuery({
    queryKey: ["experiences", query],
    queryFn: () => api.experiences.list(query),
  });
}

export function useExperience(id: string) {
  return useQuery({
    queryKey: ["experiences", id],
    queryFn: () => api.experiences.get(id),
    enabled: !!id,
  });
}

export function usePatterns() {
  return useQuery({ queryKey: ["patterns"], queryFn: api.patterns.list });
}

export function useSkillSummaries(query?: Record<string, unknown>) {
  return useQuery({
    queryKey: ["skills", query],
    queryFn: () => api.skills.listSummaries(query),
  });
}

export function useSkill(id: string) {
  return useQuery({
    queryKey: ["skills", id],
    queryFn: () => api.skills.load(id),
    enabled: !!id,
  });
}

export function useLearn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: Record<string, unknown>) => api.learn(opts),
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}

export function useObserve() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: Record<string, unknown>) => api.observer.observe(opts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["episodes"] });
      qc.invalidateQueries({ queryKey: ["experiences"] });
    },
  });
}

export function useSync() {
  return useMutation({
    mutationFn: (projectRoot?: string) => api.syncer.syncAll(projectRoot),
  });
}

export function useExportSkill() {
  return useMutation({
    mutationFn: (opts: { skillId: string; targetDir: string; overwrite?: boolean }) =>
      api.skillExporter.export(opts),
  });
}

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: api.config.get });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.config.set,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
    },
  });
}

export function useDetectedSources() {
  return useQuery({
    queryKey: ["sources"],
    queryFn: api.sources.detect,
  });
}

export function useDetectedProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: api.sources.detectProjects,
  });
}

export function useDetectedCredentials() {
  return useQuery({
    queryKey: ["credentials"],
    queryFn: api.config.resolveCredentials,
  });
}
