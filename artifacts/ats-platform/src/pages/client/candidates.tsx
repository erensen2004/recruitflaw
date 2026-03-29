import { useDeferredValue, useMemo, useState } from "react";
import { useListCandidates, useListRoles } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, FileText, Eye, AlertTriangle, Columns3, ArrowUpDown, X } from "lucide-react";
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
  const [status, setStatus] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [reviewRequired, setReviewRequired] = useState("all");
  const [hasCv, setHasCv] = useState("all");
  const [sortBy, setSortBy] = useState("recent");
  const [highCompletenessOnly, setHighCompletenessOnly] = useState(false);
  const [adminApprovedOnly, setAdminApprovedOnly] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const deferredSearch = useDeferredValue(search.trim());
  const { toast } = useToast();
  const { data: roles } = useListRoles();

  const { data: candidates, isLoading } = useListCandidates({
    search: deferredSearch || undefined,
    status: status === "all" ? undefined : status,
    roleId: roleFilter === "all" ? undefined : Number(roleFilter),
    reviewRequired: reviewRequired === "all" ? undefined : reviewRequired === "yes",
    hasCv: hasCv === "all" ? undefined : hasCv === "yes",
    vendorCompanyId: vendorFilter === "all" ? undefined : Number(vendorFilter),
  });

  const roleOptions = useMemo(() => {
    return (roles ?? [])
      .map((role) => ({ id: role.id, title: role.title }))
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [roles]);

  const vendorOptions = useMemo(() => {
    return Array.from(
      new Map((candidates ?? []).map((candidate) => [candidate.vendorCompanyId, candidate.vendorCompanyName])).entries(),
    )
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [candidates]);

  const visibleCandidates = useMemo(() => {
    if (!candidates) return [];

    const filtered = candidates.filter((candidate) => {
      if (highCompletenessOnly && getCandidateCompleteness(candidate) < 85) return false;
      if (adminApprovedOnly && (candidate.parseReviewRequired || candidate.status === "pending_approval")) return false;
      return true;
    });

    return [...filtered].sort((left, right) => {
      switch (sortBy) {
        case "name_asc":
          return `${left.firstName} ${left.lastName}`.localeCompare(`${right.firstName} ${right.lastName}`);
        case "name_desc":
          return `${right.firstName} ${right.lastName}`.localeCompare(`${left.firstName} ${left.lastName}`);
        case "role_asc":
          return (left.roleTitle ?? "").localeCompare(right.roleTitle ?? "");
        case "company_asc":
          return (left.vendorCompanyName ?? "").localeCompare(right.vendorCompanyName ?? "");
        case "salary_desc":
          return (right.expectedSalary ?? 0) - (left.expectedSalary ?? 0);
        case "salary_asc":
          return (left.expectedSalary ?? 0) - (right.expectedSalary ?? 0);
        default:
          return new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime();
      }
    });
  }, [adminApprovedOnly, candidates, highCompletenessOnly, sortBy]);

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
        <h1 className="text-2xl font-bold text-slate-900">All Candidates</h1>
        <p className="text-slate-500 mt-1">Review admin-approved candidate submissions and manage the pipeline</p>
      </div>

      <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="relative xl:min-w-[280px] xl:flex-[1.3]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by candidate, email, role, company, or tags..."
            className="pl-11 h-10 rounded-xl"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:flex xl:flex-1 xl:flex-wrap">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-10 rounded-xl xl:w-[180px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roleOptions.map((role) => (
                <SelectItem key={role.id} value={String(role.id)}>
                  {role.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={vendorFilter} onValueChange={setVendorFilter}>
            <SelectTrigger className="h-10 rounded-xl xl:w-[190px]">
              <SelectValue placeholder="Vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {vendorOptions.map((vendor) => (
                <SelectItem key={vendor.id} value={String(vendor.id)}>
                  {vendor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-10 rounded-xl xl:w-[160px]">
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
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="h-10 rounded-xl xl:w-[190px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Sort: newest first</SelectItem>
              <SelectItem value="name_asc">Sort: A-Z</SelectItem>
              <SelectItem value="name_desc">Sort: Z-A</SelectItem>
              <SelectItem value="role_asc">Sort: role</SelectItem>
              <SelectItem value="company_asc">Sort: vendor</SelectItem>
              <SelectItem value="salary_desc">Sort: salary high-low</SelectItem>
              <SelectItem value="salary_asc">Sort: salary low-high</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500">
          <ArrowUpDown className="h-3.5 w-3.5" />
          {visibleCandidates.length} result{visibleCandidates.length === 1 ? "" : "s"}
        </div>
        <Select value={reviewRequired} onValueChange={setReviewRequired}>
          <SelectTrigger className="h-9 w-[150px] rounded-full border-slate-200 bg-white text-xs">
            <SelectValue placeholder="Review state" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All review states</SelectItem>
            <SelectItem value="yes">Review needed</SelectItem>
            <SelectItem value="no">Finalized brief</SelectItem>
          </SelectContent>
        </Select>
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
            setStatus("all");
            setRoleFilter("all");
            setVendorFilter("all");
            setReviewRequired("all");
            setHasCv("all");
            setSortBy("recent");
            setHighCompletenessOnly(false);
            setAdminApprovedOnly(false);
            clearSelection();
          }}
        >
          Clear filters
        </Button>
      </div>

      {selectedCandidates.length ? (
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50/80 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-500">Compare tray</p>
              <p className="mt-1 text-sm leading-6 text-sky-900">Open the side-by-side intelligence view for the selected shortlist.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => toggleCandidateSelection(candidate.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 shadow-sm transition hover:border-sky-300 hover:bg-sky-50"
                  >
                    {candidate.firstName} {candidate.lastName}
                    <X className="h-3 w-3" />
                  </button>
                ))}
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
      ) : null}

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
                    <td className="px-5 py-4 text-slate-700">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{c.roleTitle}</span>
                        {c.roleStatus ? <StatusBadge status={c.roleStatus} className="w-fit" /> : null}
                      </div>
                    </td>
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
