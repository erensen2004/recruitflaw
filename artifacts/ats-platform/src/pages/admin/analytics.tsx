import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AlertTriangle, Briefcase, CalendarClock, CheckCircle2, Clock3, Loader2, ShieldCheck, UserCircle } from "lucide-react";

// This endpoint is intentionally small: the admin landing page should be a control tower,
// not a reason to fetch every role and candidate record on load.
type WorkbenchItem = {
  id: number;
  title?: string | null;
  name?: string | null;
  roleTitle?: string | null;
  companyName?: string | null;
  clientCompanyName?: string | null;
  vendorCompanyName?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  submittedAt?: string | null;
  parseStatus?: string | null;
  parseConfidence?: number | null;
  preferredDate?: string | null;
  preferredWindow?: string | null;
  candidates?: Array<{ name: string | null; vendorCompanyName: string | null; status: string }>;
};

type AdminWorkbench = {
  generatedAt: string;
  totals: { roles: number; candidates: number };
  queues: {
    roleApprovals: number;
    candidateApprovals: number;
    parseReviews: number;
    interviewAdminReview: number;
    interviewVendorReplied: number;
    interviewAwaitingVendor: number;
    scheduledInterviewRequests: number;
  };
  roleQueue: WorkbenchItem[];
  candidateQueue: WorkbenchItem[];
  parseReviewQueue: WorkbenchItem[];
  interviewQueue: WorkbenchItem[];
  recentScheduled: WorkbenchItem[];
  stuckItems: { roles: WorkbenchItem[]; candidates: WorkbenchItem[] };
};

async function fetchAdminWorkbench(): Promise<AdminWorkbench> {
  const token = localStorage.getItem("ats_token");
  const response = await fetch("/api/analytics/workbench", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Admin control tower could not be loaded.");
  }
  return response.json();
}

function formatDate(value?: string | null) {
  if (!value) return "Time pending";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatStatus(value?: string | null) {
  if (!value) return "Pending";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function QueueList({
  title,
  description,
  items,
  empty,
  hrefForItem,
}: {
  title: string;
  description: string;
  items: WorkbenchItem[];
  empty: string;
  hrefForItem: (item: WorkbenchItem) => string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {items.length ? (
          items.map((item) => (
            <Link key={`${title}-${item.id}`} href={hrefForItem(item)} className="block px-5 py-3 transition hover:bg-slate-50">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.title || item.name || item.roleTitle || "Review item"}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {[item.roleTitle, item.companyName || item.clientCompanyName || item.vendorCompanyName].filter(Boolean).join(" • ") || "Admin-owned workflow"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-semibold text-slate-600">{formatStatus(item.status)}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{formatDate(item.updatedAt || item.createdAt || item.submittedAt)}</p>
                </div>
              </div>
            </Link>
          ))
        ) : (
          <p className="px-5 py-6 text-sm text-slate-400">{empty}</p>
        )}
      </div>
    </section>
  );
}

export default function AdminAnalytics() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-workbench"],
    queryFn: fetchAdminWorkbench,
    staleTime: 20_000,
  });

  const metrics = useMemo(() => {
    if (!data) return [];
    const interviewNeedsAction = data.queues.interviewAdminReview + data.queues.interviewVendorReplied;
    return [
      { label: "Admin review", value: data.queues.roleApprovals + data.queues.candidateApprovals, icon: ShieldCheck, href: "/admin/candidates" },
      { label: "Interview desk", value: interviewNeedsAction, icon: CalendarClock, href: "/admin/interviews" },
      { label: "Parse review", value: data.queues.parseReviews, icon: AlertTriangle, href: "/admin/candidates" },
      { label: "Scheduled", value: data.queues.scheduledInterviewRequests, icon: CheckCircle2, href: "/admin/interviews" },
    ];
  }, [data]);

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Admin control tower</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-950">Review Desk</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Prioritized approvals, interview handoffs, parse checks, and stuck items in one admin-owned workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-primary hover:text-primary" href="/admin/roles">
              Role queue
            </Link>
            <Link className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-primary hover:text-primary" href="/admin/interviews">
              Interview requests
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center rounded-2xl border border-slate-200 bg-white p-16 shadow-sm">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : error || !data ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error instanceof Error ? error.message : "Admin control tower could not be loaded."}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <Link key={metric.label} href={metric.href} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-3xl font-bold text-slate-950">{metric.value}</p>
                      <p className="mt-1 text-sm text-slate-500">{metric.label}</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                      <metric.icon className="h-5 w-5" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
              <QueueList
                title="Interview scheduling desk"
                description="Requests that need admin review, vendor follow-up, or a scheduling decision."
                items={data.interviewQueue}
                empty="No interview requests need admin action right now."
                hrefForItem={() => "/admin/interviews"}
              />
              <QueueList
                title="Approval queue"
                description="Roles and candidates waiting for admin release."
                items={[...data.roleQueue, ...data.candidateQueue].slice(0, 8)}
                empty="No approvals are waiting."
                hrefForItem={(item) => (item.title ? "/admin/roles" : `/admin/candidates/${item.id}`)}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <QueueList
                title="Parse quality checks"
                description="Profiles that need admin confidence before client handoff."
                items={data.parseReviewQueue}
                empty="No parse reviews are currently flagged."
                hrefForItem={(item) => `/admin/candidates/${item.id}`}
              />
              <QueueList
                title="Stuck items"
                description="Items older than the current review SLA."
                items={[...data.stuckItems.roles, ...data.stuckItems.candidates].slice(0, 8)}
                empty="No stale review items right now."
                hrefForItem={(item) => (item.title ? "/admin/roles" : `/admin/candidates/${item.id}`)}
              />
              <QueueList
                title="Recently scheduled"
                description="Confirmed interview requests for quick operational visibility."
                items={data.recentScheduled}
                empty="No scheduled interviews yet."
                hrefForItem={() => "/admin/interviews"}
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500">
                <span className="inline-flex items-center gap-2"><Briefcase className="h-4 w-4" /> {data.totals.roles} roles</span>
                <span className="inline-flex items-center gap-2"><UserCircle className="h-4 w-4" /> {data.totals.candidates} candidates</span>
                <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" /> Refreshed {formatDate(data.generatedAt)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
