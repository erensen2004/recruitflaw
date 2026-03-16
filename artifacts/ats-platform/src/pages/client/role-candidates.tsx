import { useState } from "react";
import { useListCandidates, useUpdateCandidateStatus, useGetRole } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserCircle, Loader2, ArrowLeft, FileText } from "lucide-react";
import { useRoute, Link } from "wouter";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { cn, formatCurrency, getPrivateObjectUrl } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
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

export default function ClientRoleCandidates() {
  const [, clientParams] = useRoute("/client/roles/:id/candidates");
  const [, adminParams] = useRoute("/admin/roles/:id/candidates");
  const params = clientParams ?? adminParams;
  const roleId = Number(params?.id);
  const isAdminRoute = Boolean(adminParams?.id);

  const { data: role } = useGetRole(roleId);
  const { data: candidates, isLoading } = useListCandidates({ roleId });
  const [pendingCandidateId, setPendingCandidateId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
    }
  });

  const handleStatusUpdate = (candidateId: number, status: CandidateStatusValue) => {
    const currentCandidate = candidates?.find((candidate) => candidate.id === candidateId);
    if (updatingStatus || currentCandidate?.status === status) return;
    setPendingCandidateId(candidateId);
    updateStatus({ id: candidateId, data: { status } });
  };

  return (
    <DashboardLayout allowedRoles={["client", "admin"]}>
      <div className="mb-8">
        <Link
          href={isAdminRoute ? "/admin/roles" : "/client/roles"}
          className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-primary transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Roles
        </Link>
        <h1 className="text-3xl font-bold text-slate-900">
          {role?.title || "Role"} — Candidates
        </h1>
        <p className="text-slate-500 mt-1">Review submitted candidates and update pipeline status</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Candidate</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Salary Req.</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">CV</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Submitted</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-48">Update Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : candidates?.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center">
                    <UserCircle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500 font-medium">No candidates submitted yet</p>
                    <p className="text-sm text-slate-400 mt-1">Vendors will submit candidates for this role</p>
                  </td>
                </tr>
              ) : candidates?.map(c => (
                <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-600">
                        <UserCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{c.firstName} {c.lastName}</div>
                        <div className="text-sm text-slate-500">{c.email}{c.phone ? ` • ${c.phone}` : ''}</div>
                        <div className="mt-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${getParseBadge(c.parseStatus, c.parseReviewRequired).className}`}>
                            {getParseBadge(c.parseStatus, c.parseReviewRequired).label}
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-600 font-medium">{c.vendorCompanyName}</td>
                  <td className="px-6 py-4 text-slate-600">{c.expectedSalary ? formatCurrency(c.expectedSalary) : '—'}</td>
                  <td className="px-6 py-4">
                      {c.cvUrl ? (
                        <a
                          href={getPrivateObjectUrl(c.cvUrl) ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-all hover:text-primary/80 hover:underline active:scale-[0.98]"
                        >
                          <FileText className="w-4 h-4" /> View CV
                        </a>
                    ) : (
                      <span className="text-slate-400 text-sm">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(c.submittedAt), 'MMM d, yyyy')}</td>
                  <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                  <td className="px-6 py-4">
                    <Select
                      value={c.status}
                      onValueChange={(value) => handleStatusUpdate(c.id, value as CandidateStatusValue)}
                      disabled={updatingStatus && pendingCandidateId === c.id}
                    >
                      <SelectTrigger
                        className={cn(
                          "h-9 rounded-lg transition-all",
                          updatingStatus && pendingCandidateId === c.id && "border-primary/50 bg-primary/5 text-primary",
                        )}
                      >
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
