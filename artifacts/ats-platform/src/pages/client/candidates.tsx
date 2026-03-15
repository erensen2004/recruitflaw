import { useDeferredValue, useState } from "react";
import { useListCandidates } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, FileText, Eye, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { getPrivateObjectUrl } from "@/lib/utils";

function getParseBadge(candidate: { parseStatus: string; parseReviewRequired: boolean }) {
  if (candidate.parseStatus === "parsed" && !candidate.parseReviewRequired) {
    return { label: "Parsed", className: "bg-emerald-100 text-emerald-700" };
  }
  if (candidate.parseStatus === "partial" || candidate.parseReviewRequired) {
    return { label: "Review", className: "bg-amber-100 text-amber-700" };
  }
  return { label: "Manual", className: "bg-slate-100 text-slate-700" };
}

export default function ClientCandidates() {
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState("");
  const [status, setStatus] = useState("all");
  const [reviewRequired, setReviewRequired] = useState("all");
  const [hasCv, setHasCv] = useState("all");
  const [minExperience, setMinExperience] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const deferredSkill = useDeferredValue(skill.trim());

  const { data: candidates, isLoading } = useListCandidates({
    search: deferredSearch || undefined,
    skill: deferredSkill || undefined,
    status: status === "all" ? undefined : status,
    reviewRequired: reviewRequired === "all" ? undefined : reviewRequired === "yes",
    hasCv: hasCv === "all" ? undefined : hasCv === "yes",
    minExperience: minExperience ? Number(minExperience) : undefined,
  });

  return (
    <DashboardLayout allowedRoles={["client"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">All Candidates</h1>
        <p className="text-slate-500 mt-1">Review and manage all submitted candidates</p>
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-[1.6fr,1fr,1fr,1fr,1fr]">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by candidate, email, role, or tags..."
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

      <div className="mb-6 flex flex-wrap gap-2">
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
          variant="ghost"
          className="rounded-full text-slate-500"
          onClick={() => {
            setSearch("");
            setSkill("");
            setStatus("all");
            setReviewRequired("all");
            setHasCv("all");
            setMinExperience("");
          }}
        >
          Clear filters
        </Button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : !candidates?.length ? (
          <div className="text-center text-slate-400 p-12">No candidates found.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {["Candidate", "Role", "Vendor", "Tags", "Status", "CV", ""].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {candidates.map(c => {
                const tags = c.tags ? c.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
                const parseBadge = getParseBadge(c);
                return (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">{c.firstName} {c.lastName}</p>
                      <p className="text-slate-400 text-xs mt-0.5">{c.email}</p>
                      <div className="mt-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${parseBadge.className}`}>
                          {parseBadge.label}
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
                        <a href={getPrivateObjectUrl(c.cvUrl) ?? "#"} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                          <FileText className="w-3.5 h-3.5" /> View
                        </a>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/client/candidates/${c.id}`}>
                        <Button variant="ghost" size="sm" className="rounded-lg gap-1">
                          <Eye className="w-3.5 h-3.5" /> Details
                        </Button>
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
