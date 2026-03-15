import { useMemo } from "react";
import { useGetAnalytics } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Loader2, Users, Briefcase, Building2, UserCircle, TrendingUp, Activity } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700",
  screening: "bg-yellow-100 text-yellow-700",
  interview: "bg-violet-100 text-violet-700",
  offer: "bg-orange-100 text-orange-700",
  hired: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  draft: "bg-slate-100 text-slate-600",
  pending_approval: "bg-yellow-100 text-yellow-700",
  published: "bg-green-100 text-green-700",
  closed: "bg-slate-100 text-slate-600",
};

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  draft: "Draft",
  pending_approval: "Pending Approval",
  published: "Published",
  closed: "Closed",
};

export default function AdminAnalytics() {
  const { data, isLoading } = useGetAnalytics();
  const headlineStats = useMemo(
    () =>
      data
        ? [
            { label: "Total Candidates", value: data.totalCandidates, icon: Users, color: "text-blue-500", bg: "bg-blue-50" },
            { label: "Interview Pipeline", value: data.interviewingCandidates, icon: Briefcase, color: "text-violet-500", bg: "bg-violet-50" },
            { label: "Hired", value: data.hiredCandidates, icon: Building2, color: "text-green-500", bg: "bg-green-50" },
            { label: "Rejected", value: data.rejectedCandidates, icon: UserCircle, color: "text-rose-500", bg: "bg-rose-50" },
          ]
        : [],
    [data],
  );

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Analytics</h1>
        <p className="text-slate-500 mt-1">Platform-wide overview and metrics</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : !data ? (
        <div className="text-center text-slate-500 p-12">Failed to load analytics.</div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {headlineStats.map(stat => (
              <div key={stat.label} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center mb-4`}>
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <p className="text-3xl font-bold text-slate-900">{stat.value}</p>
                <p className="text-sm text-slate-500 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { label: "Total Roles", value: data.totalRoles },
              { label: "Companies", value: data.totalCompanies },
              { label: "Users", value: data.totalUsers },
            ].map((item) => (
              <div key={item.label} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                <p className="text-sm text-slate-500">{item.label}</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" /> Candidates by Status
              </h2>
              <div className="space-y-3">
                {data.candidatesByStatus.length === 0 ? (
                  <p className="text-slate-400 text-sm">No data yet.</p>
                ) : data.candidatesByStatus.map(s => (
                  <div key={s.status} className="flex items-center justify-between">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[s.status] || "bg-slate-100 text-slate-600"}`}>
                      {STATUS_LABELS[s.status] || s.status}
                    </span>
                    <div className="flex items-center gap-3 flex-1 ml-4">
                      <div className="flex-1 bg-slate-100 rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full"
                          style={{ width: `${data.totalCandidates ? (s.count / data.totalCandidates * 100) : 0}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-slate-700 w-6 text-right">{s.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-primary" /> Roles by Status
              </h2>
              <div className="space-y-3">
                {data.rolesByStatus.length === 0 ? (
                  <p className="text-slate-400 text-sm">No data yet.</p>
                ) : data.rolesByStatus.map(s => (
                  <div key={s.status} className="flex items-center justify-between">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[s.status] || "bg-slate-100 text-slate-600"}`}>
                      {STATUS_LABELS[s.status] || s.status}
                    </span>
                    <div className="flex items-center gap-3 flex-1 ml-4">
                      <div className="flex-1 bg-slate-100 rounded-full h-2">
                        <div
                          className="bg-violet-500 h-2 rounded-full"
                          style={{ width: `${data.totalRoles ? (s.count / data.totalRoles * 100) : 0}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-slate-700 w-6 text-right">{s.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Top Roles by Candidate Count
            </h2>
            {data.topRoles.length === 0 ? (
              <p className="text-slate-400 text-sm">No candidates yet.</p>
            ) : (
              <div className="space-y-3">
                {data.topRoles.map((r, idx) => (
                  <div key={r.roleId} className="flex items-center gap-4">
                    <span className="text-2xl font-black text-slate-200 w-6">#{idx + 1}</span>
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-semibold text-slate-800">{r.roleTitle}</span>
                        <span className="text-sm font-bold text-primary">{r.count}</span>
                      </div>
                      <div className="bg-slate-100 rounded-full h-1.5">
                        <div
                          className="bg-primary h-1.5 rounded-full"
                          style={{ width: `${data.topRoles[0].count ? (r.count / data.topRoles[0].count * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Recent Activity
            </h2>
            {data.recentActivity.length === 0 ? (
              <p className="text-slate-400 text-sm">No recent platform activity yet.</p>
            ) : (
              <div className="space-y-3">
                {data.recentActivity.map((item, index) => (
                  <div key={`${item.type}-${item.createdAt}-${index}`} className="rounded-xl bg-slate-50 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm font-semibold text-slate-800">{item.candidateName || item.type}</p>
                      <span className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{item.message}</p>
                    {item.actorName ? <p className="mt-1 text-xs text-slate-400">by {item.actorName}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
