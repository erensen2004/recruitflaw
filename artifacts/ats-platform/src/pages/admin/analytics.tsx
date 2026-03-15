import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Loader2, Users, Briefcase, Building2, UserCircle, TrendingUp } from "lucide-react";

interface Analytics {
  totalCandidates: number;
  totalRoles: number;
  totalCompanies: number;
  totalUsers: number;
  candidatesByStatus: { status: string; count: number }[];
  rolesByStatus: { status: string; count: number }[];
  topRoles: { roleId: number; roleTitle: string; count: number }[];
}

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
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("ats_token");
    fetch("/api/analytics", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Analytics</h1>
        <p className="text-slate-500 mt-1">Platform-wide overview and metrics</p>
      </div>

      {loading ? (
        <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : !data ? (
        <div className="text-center text-slate-500 p-12">Failed to load analytics.</div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { label: "Total Candidates", value: data.totalCandidates, icon: Users, color: "text-blue-500", bg: "bg-blue-50" },
              { label: "Total Roles", value: data.totalRoles, icon: Briefcase, color: "text-violet-500", bg: "bg-violet-50" },
              { label: "Companies", value: data.totalCompanies, icon: Building2, color: "text-orange-500", bg: "bg-orange-50" },
              { label: "Users", value: data.totalUsers, icon: UserCircle, color: "text-green-500", bg: "bg-green-50" },
            ].map(stat => (
              <div key={stat.label} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center mb-4`}>
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <p className="text-3xl font-bold text-slate-900">{stat.value}</p>
                <p className="text-sm text-slate-500 mt-1">{stat.label}</p>
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
        </div>
      )}
    </DashboardLayout>
  );
}
