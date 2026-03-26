import { useMemo, type ReactNode } from "react";
import { useListCandidates, type Candidate } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Eye, FileText, Sparkles, AlertTriangle, Columns3, X } from "lucide-react";
import { getPrivateObjectUrl } from "@/lib/utils";
import {
  formatTurkishLira,
  getCandidateCompleteness,
  getCandidateDecisionGuidance,
  getCandidateExecutiveBrief,
  getCandidateReadinessSnapshot,
} from "@/lib/candidate-display";

function parseCompareIds(location: string) {
  const search = location.split("?")[1] ?? "";
  const ids = new URLSearchParams(search)
    .get("ids")
    ?.split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    ?? [];

  return Array.from(new Set(ids));
}

function ComparisonMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "emerald" | "amber" | "sky" | "slate" | "rose";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "sky"
          ? "border-sky-200 bg-sky-50 text-sky-800"
          : tone === "rose"
            ? "border-rose-200 bg-rose-50 text-rose-800"
            : "border-slate-200 bg-slate-50 text-slate-800";

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</p>
      <p className="mt-2 text-sm font-semibold leading-6">{value}</p>
    </div>
  );
}

export default function CandidateCompare() {
  const [location, setLocation] = useLocation();
  const [, clientCompareRoute] = useRoute("/client/compare");
  const [, adminCompareRoute] = useRoute("/admin/compare");
  const backHref = clientCompareRoute ? "/client/candidates" : "/admin/candidates";
  const roleLabel = adminCompareRoute ? "Admin" : "Client";
  const selectedIds = useMemo(() => parseCompareIds(location).slice(0, 3), [location]);
  const { data: candidates, isLoading } = useListCandidates();

  const selectedCandidates = useMemo(() => {
    if (!candidates?.length || !selectedIds.length) return [];
    return selectedIds
      .map((id) => candidates.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is Candidate => Boolean(candidate))
      .slice(0, 3);
  }, [candidates, selectedIds]);

  const selectedSnapshots = useMemo(
    () => selectedCandidates.map((candidate) => getCandidateReadinessSnapshot(candidate)),
    [selectedCandidates],
  );

  const compareStats = useMemo(() => {
    if (!selectedCandidates.length) {
      return {
        avgCompleteness: 0,
        avgFitScore: 0,
        adminReadyCount: 0,
        salaryCapturedCount: 0,
        languageCapturedCount: 0,
        highRiskCount: 0,
        mostCompleteLabel: "Waiting for selection",
        lowestRiskLabel: "Waiting for selection",
        strongestFitLabel: "Waiting for selection",
      };
    }

    const briefs = selectedCandidates.map((candidate) => getCandidateExecutiveBrief(candidate));
    const totalCompleteness = selectedCandidates.reduce((sum, candidate) => sum + getCandidateCompleteness(candidate), 0);
    const totalFit = briefs.reduce((sum, brief) => sum + brief.fitScore, 0);
    const salaryCapturedCount = selectedSnapshots.filter((snapshot) => snapshot.compensationReady).length;
    const languageCapturedCount = selectedSnapshots.filter((snapshot) => snapshot.languageReady).length;
    const highRiskCount = selectedSnapshots.filter((snapshot) => snapshot.riskLevel === "high").length;
    const mostCompleteIndex = selectedSnapshots.reduce((bestIndex, snapshot, index, array) => {
      if (snapshot.completeness > array[bestIndex].completeness) return index;
      return bestIndex;
    }, 0);
    const lowestRiskIndex = selectedSnapshots.reduce((bestIndex, snapshot, index, array) => {
      const weight = snapshot.riskLevel === "high" ? 3 : snapshot.riskLevel === "medium" ? 2 : 1;
      const bestWeight = array[bestIndex].riskLevel === "high" ? 3 : array[bestIndex].riskLevel === "medium" ? 2 : 1;
      if (weight < bestWeight) return index;
      return bestIndex;
    }, 0);
    const strongestFitIndex = briefs.reduce((bestIndex, brief, index, array) => {
      if (brief.fitScore > array[bestIndex].fitScore) return index;
      return bestIndex;
    }, 0);

    return {
      avgCompleteness: Math.round(totalCompleteness / selectedCandidates.length),
      avgFitScore: Math.round(totalFit / selectedCandidates.length),
      adminReadyCount: briefs.filter((brief) => brief.adminReady).length,
      salaryCapturedCount,
      languageCapturedCount,
      highRiskCount,
      mostCompleteLabel: selectedCandidates[mostCompleteIndex]
        ? `${selectedCandidates[mostCompleteIndex].firstName} ${selectedCandidates[mostCompleteIndex].lastName}`
        : "Waiting for selection",
      lowestRiskLabel: selectedCandidates[lowestRiskIndex]
        ? `${selectedCandidates[lowestRiskIndex].firstName} ${selectedCandidates[lowestRiskIndex].lastName}`
        : "Waiting for selection",
      strongestFitLabel: selectedCandidates[strongestFitIndex]
        ? `${selectedCandidates[strongestFitIndex].firstName} ${selectedCandidates[strongestFitIndex].lastName}`
        : "Waiting for selection",
    };
  }, [selectedCandidates, selectedSnapshots]);

  const clearCompare = () => setLocation(backHref);

  return (
    <DashboardLayout allowedRoles={["client", "admin"]}>
      <div className="mx-auto max-w-7xl space-y-6">
        <Link href={backHref} className="inline-flex items-center text-sm font-medium text-slate-500 transition-colors hover:text-primary">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to candidates
        </Link>

        <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-900 p-6 text-white shadow-2xl shadow-slate-900/10 md:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white/80">
                <Sparkles className="h-3.5 w-3.5" /> {roleLabel} candidate compare
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
                Side-by-side candidate brief for faster final decisions.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200">
                Compare 2-3 candidates using the same executive signals: completeness, role-fit summary, risk flags, compensation readiness, and normalized profile quality.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[420px]">
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Selected</p>
                <p className="mt-2 text-2xl font-bold">{selectedCandidates.length}</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Avg completeness</p>
                <p className="mt-2 text-2xl font-bold">{compareStats.avgCompleteness}%</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Avg fit score</p>
                <p className="mt-2 text-2xl font-bold">{compareStats.avgFitScore}</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Admin-ready</p>
                <p className="mt-2 text-2xl font-bold">{compareStats.adminReadyCount}</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Salary captured</p>
                <p className="mt-2 text-2xl font-bold">{compareStats.salaryCapturedCount}</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Language captured</p>
                <p className="mt-2 text-2xl font-bold">{compareStats.languageCapturedCount}</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">High risk</p>
                <p className="mt-2 text-2xl font-bold">{compareStats.highRiskCount}</p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="rounded-full border-white/20 bg-white/5 text-white hover:bg-white/10" onClick={clearCompare}>
              Clear selection
            </Button>
            <Button type="button" variant="outline" className="rounded-full border-white/20 bg-white/5 text-white hover:bg-white/10" onClick={() => setLocation(backHref)}>
              Review more candidates
            </Button>
          </div>

          {selectedCandidates.length ? (
            <div className="mt-5 rounded-2xl border border-white/15 bg-white/10 p-4 text-sm leading-6 text-white/85">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">Quick decision read</p>
              <p className="mt-2">
                Strongest fit: <span className="font-semibold text-white">{compareStats.strongestFitLabel}</span>. Most complete:
                <span className="font-semibold text-white"> {compareStats.mostCompleteLabel}</span>. Lowest risk:
                <span className="font-semibold text-white"> {compareStats.lowestRiskLabel}</span>.
              </p>
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex justify-center p-12">
            <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
              Loading candidates...
            </div>
          </div>
        ) : selectedCandidates.length < 2 ? (
          <Card className="border-dashed border-slate-200 bg-white/80 shadow-sm">
            <CardContent className="p-8 text-center">
              <AlertTriangle className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-lg font-semibold text-slate-900">Pick 2-3 candidates to compare</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Open the candidate list, select a few records, then return here with the compare tray. This keeps the workflow fast and focused.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {selectedCandidates.map((candidate, index) => {
                const brief = getCandidateExecutiveBrief(candidate);
                const readiness = selectedSnapshots[index] ?? getCandidateReadinessSnapshot(candidate);
                const guidance = getCandidateDecisionGuidance(candidate);
                return (
                  <Card key={candidate.id} className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
                    <CardContent className="space-y-4 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{candidate.roleTitle}</p>
                          <h2 className="mt-2 text-xl font-bold text-slate-900">
                            {candidate.firstName} {candidate.lastName}
                          </h2>
                          <p className="mt-1 text-sm text-slate-500">{candidate.vendorCompanyName}</p>
                        </div>
                        <StatusBadge status={candidate.status} />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl bg-slate-50 p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Role alignment</p>
                          <p className="mt-2 text-sm leading-6 text-slate-700">{brief.fitLabel}</p>
                          <p className="mt-2 text-xs leading-5 text-slate-500">{brief.spotlight}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Admin posture</p>
                          <p className="mt-2 text-sm leading-6 text-slate-700">
                            {guidance.label}
                          </p>
                          <p className="mt-2 text-xs leading-5 text-slate-500">
                            {guidance.body}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <ComparisonMetric label="Fit score" value={`${brief.fitScore}/100`} tone={brief.adminReady ? "emerald" : "sky"} />
                        <ComparisonMetric label="Completeness" value={`${getCandidateCompleteness(candidate)}%`} tone={getCandidateCompleteness(candidate) >= 85 ? "emerald" : "amber"} />
                        <ComparisonMetric label="Salary" value={readiness.salaryLabel} tone={readiness.compensationReady ? "emerald" : "amber"} />
                        <ComparisonMetric label="Language" value={readiness.languageLabel} tone={readiness.languageReady ? "emerald" : "amber"} />
                        <ComparisonMetric label="Risk" value={readiness.riskLevel === "low" ? "Low risk" : readiness.riskLevel === "medium" ? "Moderate risk" : "High risk"} tone={readiness.riskLevel === "low" ? "emerald" : readiness.riskLevel === "medium" ? "amber" : "slate"} />
                        <ComparisonMetric label="Decision" value={readiness.readinessLabel} tone={readiness.readinessTone} />
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Role fit summary</p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{brief.fitSummary}</p>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Decision support</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{readiness.readinessLabel}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{readiness.decisionSummary}</p>
                        <p className="mt-2 text-xs leading-5 text-slate-500">Next step: {readiness.nextAction}</p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Top strengths</p>
                        <div className="flex flex-wrap gap-2">
                          {brief.strengths.slice(0, 4).map((strength) => (
                            <span key={strength} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                              {strength}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-500">Risk flags</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {brief.riskFlags.length ? (
                              brief.riskFlags.slice(0, 4).map((flag) => (
                                <span key={flag} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-100">
                                  {flag}
                                </span>
                              ))
                            ) : (
                              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                                No critical flags
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-500">Normalization notes</p>
                          <div className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                            {brief.normalizationNotes.length ? (
                              brief.normalizationNotes.slice(0, 3).map((note) => (
                                <p key={note} className="rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200">
                                  {note}
                                </p>
                              ))
                            ) : (
                              <p className="rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200">
                                Profile is already clean enough for a fast handoff.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-2 text-sm sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Contact</p>
                          <p className="mt-1 text-slate-700">{candidate.email}</p>
                          <p className="text-slate-600">{candidate.phone || "Phone missing"}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Snapshot</p>
                          <p className="mt-1 text-slate-700">{candidate.location || "Location not set"}</p>
                          <p className="text-slate-600">{readiness.languageLabel || "English level missing"}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm" className="rounded-xl">
                          <Link href={`/client/candidates/${candidate.id}`}>
                            <Eye className="h-4 w-4" /> Open detail
                          </Link>
                        </Button>
                        {candidate.cvUrl ? (
                          <Button asChild variant="outline" size="sm" className="rounded-xl">
                            <a href={getPrivateObjectUrl(candidate.cvUrl) ?? "#"} target="_blank" rel="noreferrer">
                              <FileText className="h-4 w-4" /> View CV
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200">
                        <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Metric</th>
                        {selectedCandidates.map((candidate) => (
                          <th key={candidate.id} className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            {candidate.firstName} {candidate.lastName}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(
                        [
                          { label: "Role", render: (candidate: Candidate) => candidate.roleTitle },
                          { label: "Company", render: (candidate: Candidate) => candidate.vendorCompanyName },
                          { label: "Status", render: (candidate: Candidate) => <StatusBadge key={candidate.id} status={candidate.status} /> },
                          { label: "Salary", render: (candidate: Candidate) => formatTurkishLira(candidate.expectedSalary) },
                          {
                            label: "Language",
                            render: (candidate: Candidate) => getCandidateReadinessSnapshot(candidate).languageLabel,
                          },
                          {
                            label: "Risk",
                            render: (candidate: Candidate) => {
                              const readiness = getCandidateReadinessSnapshot(candidate);
                              return readiness.riskLevel === "low"
                                ? "Low"
                                : readiness.riskLevel === "medium"
                                  ? "Moderate"
                                  : "High";
                            },
                          },
                          {
                            label: "Decision",
                            render: (candidate: Candidate) => getCandidateReadinessSnapshot(candidate).readinessLabel,
                          },
                          { label: "Completeness", render: (candidate: Candidate) => `${getCandidateCompleteness(candidate)}%` },
                        ] satisfies Array<{ label: string; render: (candidate: Candidate) => ReactNode }>
                      ).map(({ label, render }) => (
                        <tr key={label as string} className="hover:bg-slate-50/60">
                          <td className="px-5 py-4 font-semibold text-slate-700">{label}</td>
                          {selectedCandidates.map((candidate) => (
                            <td key={`${label}-${candidate.id}`} className="px-5 py-4 text-slate-700">
                              {render(candidate)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
