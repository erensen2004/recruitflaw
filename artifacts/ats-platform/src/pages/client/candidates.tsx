import { useDeferredValue, useMemo, useState } from "react";
import { useListCandidates } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, FileText, Eye, AlertTriangle, Columns3, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { getCandidateCompleteness, parseCandidateTags } from "@/lib/candidate-display";
import { useToast } from "@/hooks/use-toast";
import { PrivateObjectLink } from "@/components/private-object-link";

function getParseBadge(candidate: { parseStatus: string; parseReviewRequired: boolean }) {
  if (candidate.parseStatus === "parsed" && !candidate.parseReviewRequired) {
    return { label: "Final profile", className: "bg-emerald-100 text-emerald-700" };
  }
  if (candidate.parseStatus === "partial" || candidate.parseReviewRequired) {
    return { label: "Candidate brief", className: "bg-sky-100 text-sky-700" };
  }
  return { label: "Profile captured", className: "bg-slate-100 text-slate-700" };
}

export default function ClientCandidates() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState("");
  const [status, setStatus] = useState("all");
  const [reviewRequired, setReviewRequired] = useState("all");
  const [hasCv, setHasCv] = useState("all");
  const [minExperience, setMinExperience] = useState("");
  const [highCompletenessOnly, setHighCompletenessOnly] = useState(false);
  const [adminApprovedOnly, setAdminApprovedOnly] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const deferredSearch = useDeferredValue(search.trim());
  const deferredSkill = useDeferredValue(skill.trim());
  const { toast } = useToast();

  const { data: candidates, isLoading } = useListCandidates({
    search: deferredSearch || undefined,
    skill: deferredSkill || undefined,
    status: status === "all" ? undefined : status,
    reviewRequired: reviewRequired === "all" ? undefined : reviewRequired === "yes",
    hasCv: hasCv === "all" ? undefined : hasCv === "yes",
    minExperience: minExperience ? Number(minExperience) : undefined,
  });

  const visibleCandidates = useMemo(() => {
    if (!candidates) return [];

    return candidates.filter((candidate) => {
      if (highCompletenessOnly && getCandidateCompleteness(candidate) < 85) return false;
      if (adminApprovedOnly && (candidate.parseReviewRequired || candidate.status === "pending_approval")) return false;
      return true;
    });
  }, [adminApprovedOnly, candidates, highCompletenessOnly]);

  const selectedCandidates = useMemo(
    () => (candidates ?? []).filter((candidate) => selectedCandidateIds.includes(candidate.id)).slice(0, 3),
    [candidates, selectedCandidateIds],
  );

  const compareCandidates = () => {
    if (selectedCandidates.length < 2) {
      toast({
        title: "Pick at least two candidates",
        description: "Select 2-3 candidates to open the compare view.",
      });
      return;
    }

    setLocation(`/client/compare?ids=${selectedCandidates.map((candidate) => candidate.id).join(",")}`);
  };

  const toggleCandidateSelection = (candidateId: number) => {
    setSelectedCandidateIds((current) => {
      if (current.includes(candidateId)) {
        return current.filter((id) => id !== candidateId);
      }

      if (current.length >= 3) {
        toast({
          title: "Compare tray is full",
          description: "You can compare up to 3 candidates at a time.",
        });
        return current;
      }

      return [...current, candidateId];
    });
  };

  const clearSelection = () => setSelectedCandidateIds([]);

  return (
    <DashboardLayout allowedRoles={["client"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">All Candidates</h1>
        <p className="text-slate-500 mt-1">Review admin-approved candidate submissions and manage the pipeline</p>
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-[1.6fr,1fr,1fr,1fr,1fr]">
        <div className="relative lg:col-span-2">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by candidate, email, role, company, or tags..."
            className="pl-11 h-11 rounded-xl"
          />
        </div>
        <Input
          value={skill}
          onChange={e => setSkill(e.target.value)}
          placeholder="Filter by skill"
          className="h-11 rounded-xl"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11 rounded-xl">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="screening">Screening</SelectItem>
            <SelectItem value="interview">Interview</SelectItem>
            <SelectItem value="offer">Offer</SelectItem>
            <SelectItem value="hired">Hired</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={minExperience}
          onChange={e => setMinExperience(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="Min years exp."
          className="h-11 rounded-xl"
          inputMode="numeric"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={reviewRequired === "yes" ? "default" : "outline"}
          className="rounded-full"
          onClick={() => setReviewRequired(reviewRequired === "yes" ? "all" : "yes")}
        >
          <AlertTriangle className="mr-2 h-4 w-4" />
          Review needed
        </Button>
        <Button
          type="button"
          variant={hasCv === "yes" ? "default" : "outline"}
          className="rounded-full"
          onClick={() => setHasCv(hasCv === "yes" ? "all" : "yes")}
        >
          Has CV
        </Button>
        <Button
          type="button"
          variant={adminApprovedOnly ? "default" : "outline"}
          className="rounded-full"
          onClick={() => setAdminApprovedOnly((value) => !value)}
        >
          Admin-approved
        </Button>
        <Button
          type="button"
          variant={highCompletenessOnly ? "default" : "outline"}
          className="rounded-full"
          onClick={() => setHighCompletenessOnly((value) => !value)}
        >
          High completeness
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="rounded-full text-slate-500"
          onClick={() => {
            setSearch("");
            setSkill("");
            setStatus("all");
            setReviewRequired("all");
            setHasCv("all");
            setMinExperience("");
            setHighCompletenessOnly(false);
            setAdminApprovedOnly(false);
            clearSelection();
          }}
        >
          Clear filters
        </Button>
      </div>

      <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50/80 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-500">Compare tray</p>
            <p className="mt-1 text-sm leading-6 text-sky-900">
              Select up to 3 candidates to open the side-by-side intelligence view.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedCandidates.length ? (
                selectedCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => toggleCandidateSelection(candidate.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 shadow-sm transition hover:border-sky-300 hover:bg-sky-50"
                  >
                    {candidate.firstName} {candidate.lastName}
                    <X className="h-3 w-3" />
                  </button>
                ))
              ) : (
                <span className="text-sm text-sky-700">No candidates selected yet.</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="rounded-full" onClick={clearSelection}>
              Clear selection
            </Button>
            <Button type="button" className="rounded-full gap-2" disabled={selectedCandidates.length < 2} onClick={compareCandidates}>
              <Columns3 className="h-4 w-4" />
              Compare selected
            </Button>
          </div>
        </div>
      </div>

      {!isLoading && candidates?.length ? (
        <p className="mb-6 text-sm text-slate-500">
          Showing <span className="font-semibold text-slate-700">{visibleCandidates.length}</span> candidate{visibleCandidates.length === 1 ? "" : "s"}.
        </p>
      ) : null}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : !visibleCandidates.length ? (
          <div className="p-12 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-medium text-slate-600">No candidates matched these filters.</p>
            <p className="mt-1 text-sm text-slate-400">Try widening the search, clearing filters, or checking another status bucket.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
        {["", "Candidate", "Role", "Company", "Tags", "Status", "CV", ""].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {visibleCandidates.map(c => {
                const { visibleTags: tags, englishLevel } = parseCandidateTags(c.tags);
                const parseBadge = getParseBadge(c);
                const completeness = getCandidateCompleteness(c);
                const isSelected = selectedCandidateIds.includes(c.id);
                return (
                  <tr key={c.id} className={`transition-colors hover:bg-slate-50/50 ${isSelected ? "bg-sky-50/70" : ""}`}>
                    <td className="px-5 py-4 align-top">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleCandidateSelection(c.id)}
                        aria-label={`Select ${c.firstName} ${c.lastName} for comparison`}
                        className="mt-1"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">{c.firstName} {c.lastName}</p>
                      <p className="text-slate-400 text-xs mt-0.5">{c.email}</p>
                      <div className="mt-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${parseBadge.className}`}>
                          {parseBadge.label}
                        </span>
                        {englishLevel ? (
                          <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                            English {englishLevel}
                          </span>
                        ) : null}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${completeness >= 85 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {completeness}% complete
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-700">{c.roleTitle}</td>
                    <td className="px-5 py-4 text-slate-500">{c.vendorCompanyName}</td>
                    <td className="px-5 py-4">
                      {tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {tags.slice(0, 3).map((tag, i) => (
                            <span key={i} className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">{tag}</span>
                          ))}
                          {tags.length > 3 && (
                            <span className="text-xs text-slate-400">+{tags.length - 3}</span>
                          )}
                        </div>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-4"><StatusBadge status={c.status} /></td>
                    <td className="px-5 py-4">
                      {c.cvUrl ? (
                        <PrivateObjectLink
                          objectPath={c.cvUrl}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-all hover:text-primary/80 hover:underline active:scale-[0.98]">
                          <FileText className="w-3.5 h-3.5" /> View
                        </PrivateObjectLink>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/client/candidates/${c.id}`}
                        className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-xs font-medium text-slate-700 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <Eye className="w-3.5 h-3.5" /> Details
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
