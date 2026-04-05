import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InterviewInboxPage } from "@/components/interview-workflow";
import { fetchInterviewInbox, type InterviewInboxItem, type InterviewInboxView } from "@/lib/interviews";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CalendarClock } from "lucide-react";

const ROLE_BASES = [
  { route: "/admin/interviews", base: "/admin", roles: ["admin"] as const },
  { route: "/client/interviews", base: "/client", roles: ["client"] as const },
  { route: "/vendor/interviews", base: "/vendor", roles: ["vendor"] as const },
] as const;

export default function InterviewsPage() {
  const { toast } = useToast();
  const [isAdminRoute] = useRoute("/admin/interviews");
  const [isClientRoute] = useRoute("/client/interviews");
  const [isVendorRoute] = useRoute("/vendor/interviews");
  const matches = [
    { ...ROLE_BASES[0], matched: isAdminRoute },
    { ...ROLE_BASES[1], matched: isClientRoute },
    { ...ROLE_BASES[2], matched: isVendorRoute },
  ];
  const active = matches.find((entry) => entry.matched) ?? matches[0];
  const roleBase = active.base;
  const allowedRoles = active.roles as unknown as Array<"admin" | "client" | "vendor">;

  const [items, setItems] = useState<InterviewInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const readViewFromUrl = () => {
    if (typeof window === "undefined") return "needs_action" as InterviewInboxView;
    const raw = new URLSearchParams(window.location.search).get("view") ?? "needs_action";
    return (["needs_action", "scheduled", "history", "all"].includes(raw) ? raw : "needs_action") as InterviewInboxView;
  };
  const [view, setView] = useState<InterviewInboxView>(readViewFromUrl);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await fetchInterviewInbox(view));
    } catch (error) {
      toast({
        title: "Interview inbox unavailable",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    const syncFromUrl = () => setView(readViewFromUrl());
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleViewChange = (nextView: InterviewInboxView) => {
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", `${roleBase}/interviews?view=${nextView}`);
    }
    setView(nextView);
  };

  return (
    <DashboardLayout allowedRoles={allowedRoles}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <CalendarClock className="h-3.5 w-3.5" />
              Interview Requests
            </div>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Scheduling inbox</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Keep the interview thread structured, compact, and easy to act on. Every negotiation stays on one timeline until a slot is confirmed.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Actionable threads</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{items.length}</p>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 shadow-sm">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <InterviewInboxPage
            view={view}
            items={items}
            loading={loading}
            onRefresh={load}
            roleBase={roleBase}
            onViewChange={handleViewChange}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
