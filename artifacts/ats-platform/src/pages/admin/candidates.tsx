import { useState } from "react";
import { useListCandidates, useUpdateCandidateStatus } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserCircle, Loader2, FileText, AlertTriangle, Eye, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";
import { getPrivateObjectUrl } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { invalidateCandidateQueries, syncCandidateAcrossCaches } from "@/lib/candidate-query";

const CANDIDATE_STATUSES = ["submitted", "screening", "interview", "offer", "hired", "rejected"] as const;
type CandidateStatusValue = (typeof CANDIDATE_STATUSES)[number];

function getParseBadge(parseStatus: string, reviewRequired: boolean) {
  if (parseStatus === "parsed" && !reviewRequired) {
    return { label: "Parsed", className: "bg-emerald-100 text-emerald-700" };
  }
  if (parseStatus === "partial" || reviewRequired) {
    return { label: "Review", className: "bg-amber-100 text-amber-700" };
  }
  return { label: "Manual", className: "bg-slate-100 text-slate-700" };
}

export default function AdminCandidates() {
  const [pendingCandidateId, setPendingCandidateId] = useState<number | null>(null);
  const { data: candidates, isLoading } = useListCandidates();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { mutate: updateStatus, isPending: updatingStatus } = useUpdateCandidateStatus({
    mutation: {
      onSuccess: (updatedCandidate) => {
        setPendingCandidateId(null);
        syncCandidateAcrossCaches(queryClient, updatedCandidate);
        void invalidateCandidateQueries(queryClient, updatedCandidate.id);
        toast({ title: "Candidate status updated" });
      },
      onError: (error: Error) => {
        setPendingCandidateId(null);
        toast({
          title: "Status update failed",
          description: error.message || "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const handleStatusUpdate = (candidateId: number, status: CandidateStatusValue) => {
    const currentCandidate = candidates?.find((candidate) => candidate.id === candidateId);
    if (updatingStatus || currentCandidate?.status === status) return;
    setPendingCandidateId(candidateId);
    updateStatus({ id: candidateId, data: { status } });
  };

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">All Candidates</h1>
        <p className="text-slate-500 mt-1">Platform-wide candidate overview</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Candidate</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">CV</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Submitted</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : candidates?.length === 0 ? (
                <tr><td colSpan={7} className="p-12 text-center text-slate-500">No candidates found.</td></tr>
              ) : candidates?.map(c => (
                <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-600">
                        <UserCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{c.firstName} {c.lastName}</div>
                        <div className="text-sm text-slate-500">{c.email}</div>
                        <div className="mt-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${getParseBadge(c.parseStatus, c.parseReviewRequired).className}`}>
                            {getParseBadge(c.parseStatus, c.parseReviewRequired).label}
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-700">{c.roleTitle}</td>
                  <td className="px-6 py-4 text-slate-600">{c.vendorCompanyName}</td>
                  <td className="px-6 py-4">
                    {c.cvUrl ? (
                      <a
                        href={getPrivateObjectUrl(c.cvUrl) ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        <FileText className="w-4 h-4" /> View CV
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600 text-sm">
                        <AlertTriangle className="w-4 h-4" /> Missing
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                  <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(c.submittedAt), 'MMM d, yyyy')}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/candidates/${c.id}`}
                        className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-xs font-medium text-slate-700 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <Eye className="h-3.5 w-3.5" /> Details
                      </Link>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100"
                        disabled={updatingStatus && pendingCandidateId === c.id}
                        onClick={() => handleStatusUpdate(c.id, "screening")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Accept
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl gap-1.5 border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-400 hover:bg-rose-100"
                        disabled={updatingStatus && pendingCandidateId === c.id}
                        onClick={() => handleStatusUpdate(c.id, "rejected")}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <Select
                        value={c.status}
                        onValueChange={(value) => handleStatusUpdate(c.id, value as CandidateStatusValue)}
                        disabled={updatingStatus && pendingCandidateId === c.id}
                      >
                        <SelectTrigger className="h-9 min-w-[140px] rounded-xl border-slate-200 bg-white">
                          <SelectValue placeholder={updatingStatus && pendingCandidateId === c.id ? "Updating..." : undefined} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="submitted">Submitted</SelectItem>
                          <SelectItem value="screening">Screening</SelectItem>
                          <SelectItem value="interview">Interview</SelectItem>
                          <SelectItem value="offer">Offer</SelectItem>
                          <SelectItem value="hired">Hired</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
