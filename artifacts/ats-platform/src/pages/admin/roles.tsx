import { useDeferredValue, useMemo, useRef, useState } from "react";
import { getListRolesQueryKey, useListRoles, useUpdateRole, useUpdateRoleStatus } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Briefcase,
  Eye,
  Filter,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "wouter";
import {
  EMPLOYMENT_TYPES,
  WORK_MODES,
  type EmploymentType,
  type WorkMode,
  employmentTypeLabel,
  parseRoleDescription,
  resolveEmploymentType,
  resolveEmploymentTypeDescription,
  resolveWorkMode,
  serializeRoleDescription,
  toApiWorkMode,
  workModeLabel,
  getRoleSummaryLines,
} from "@/lib/role-display";
import {
  buildRoleQueueSnapshot,
  getRoleReviewStateMeta,
  isStaleRole,
  matchesRoleReviewSearch,
  type AdminReviewRole,
} from "@/lib/admin-review";

const emptyForm = {
  title: "",
  description: "",
  skills: "",
  location: "",
  employmentType: "" as "" | EmploymentType,
  employmentTypeDescription: "",
  workMode: "" as "" | WorkMode,
};

type ReviewTab = "all" | "draft" | "pending" | "published" | "on_hold" | "closed";

const REVIEW_TABS: Array<{ key: ReviewTab; label: string }> = [
  { key: "all", label: "All queue" },
  { key: "draft", label: "Needs edits" },
  { key: "pending", label: "Awaiting approval" },
  { key: "published", label: "Live" },
  { key: "on_hold", label: "On hold" },
  { key: "closed", label: "Closed" },
];

function getReviewTabStatus(status: string) {
  if (status === "draft") return "draft";
  if (status === "pending_approval") return "pending";
  if (status === "published") return "published";
  if (status === "on_hold") return "on_hold";
  if (status === "closed") return "closed";
  return "all";
}

function getRoleActionCopy(status: string) {
  return {
    primary: status === "published"
      ? null
      : {
          label: "Publish",
          status: "published" as const,
          variant: "default" as const,
          className: "rounded-lg h-8 border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white",
        },
    secondary: status === "draft"
      ? null
      : {
          label: "Move to draft",
          status: "draft" as const,
          variant: "outline" as const,
          className: "rounded-lg h-8 border-sky-200 bg-white text-sky-800 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-900",
        },
    destructive: status === "closed"
      ? null
      : {
          label: "Close",
          status: "closed" as const,
          variant: "outline" as const,
          className: "rounded-lg h-8 border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800",
        },
  };
}

function formatRoleDate(value: string | number | Date | null | undefined) {
  if (value == null) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unknown" : format(parsed, "MMM d, yyyy");
}

function getDaysWaiting(value: string | number | Date | null | undefined) {
  if (value == null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const diff = Date.now() - parsed.getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function getRoleReviewGuidance(role: AdminReviewRole) {
  switch (role.status) {
    case "draft":
      return {
        heading: "Brief still needs admin shaping",
        description: "This role is still waiting for a final hiring brief, clearer requirements, or a polished market-facing summary before vendors should see it.",
        checklist: [
          "Tighten the role description and expected outcomes.",
          "Confirm work mode, location, and key skills are recruiter-ready.",
          "Publish only when the brief feels final and vendor-facing.",
        ],
      };
    case "pending_approval":
      return {
        heading: "Ready for final approval",
        description: "The role has already moved past drafting and now needs a last admin pass before it becomes part of the live vendor pipeline.",
        checklist: [
          "Check that the brief is complete and easy to understand.",
          "Confirm the visible details match the latest hiring decision.",
          "Approve and publish when no more edits are needed.",
        ],
      };
    case "published":
      return {
        heading: "Live in the vendor pipeline",
        description: "This role is already visible to vendors. The admin panel should now focus on quality control, candidate flow, and whether the brief still reflects the current need.",
        checklist: [
          "Send back to draft if the brief needs a rewrite.",
          "Reject or close if hiring is paused.",
          "Open the candidate pipeline when you need submission context.",
        ],
      };
    case "closed":
      return {
        heading: "Archived from the active queue",
        description: "This role is out of the live hiring flow. Reopen it only if the team wants to restart hiring or refine the brief for a new pass.",
        checklist: [
          "Reopen when the hiring request becomes active again.",
          "Keep it closed if the brief is no longer relevant.",
          "Use edit review before re-publishing an outdated brief.",
        ],
      };
    case "on_hold":
      return {
        heading: "Temporarily paused",
        description: "This role is not actively accepting fresh attention right now, but it stays visible in the review system so the team can resume quickly.",
        checklist: [
          "Resume publishing when hiring is active again.",
          "Send back to draft if the brief needs changes before reopening.",
          "Close it only if the hiring request is no longer relevant.",
        ],
      };
    default:
      return {
        heading: "Admin review context",
        description: "Use this panel to decide whether the role should stay in review, go live, or return for more edits.",
        checklist: [
          "Review the role details.",
          "Pick the next admin action.",
          "Use the pipeline only when candidate context is needed.",
        ],
      };
  }
}

function RoleReviewCard({
  role,
  onEdit,
  onOpenPipeline,
  onUpdateStatus,
  pendingRoleId,
}: {
  role: AdminReviewRole;
  onEdit: (role: AdminReviewRole) => void;
  onOpenPipeline: (roleId: number) => void;
  onUpdateStatus: (roleId: number, status: "draft" | "pending_approval" | "published" | "on_hold" | "closed") => void;
  pendingRoleId: number | null;
}) {
  const summary = getRoleSummaryLines(role);
  const state = getRoleReviewStateMeta(role.status);
  const guidance = getRoleReviewGuidance(role);
  const actions = getRoleActionCopy(role.status);
  const secondaryAction = "secondary" in actions ? actions.secondary! : null;
  const destructiveAction = "destructive" in actions ? actions.destructive! : null;
  const statusLabel = role.status === "pending_approval" ? "Awaiting approval" : state.label;
  const actionDisabled = pendingRoleId === role.id;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {statusLabel}
            </span>
            <StatusBadge status={role.status} />
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700">
              <Sparkles className="h-3.5 w-3.5" />
              {role.candidateCount ?? 0} candidates
            </span>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900">{role.title}</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {role.companyName}
              </span>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {summary.descriptionBody || "This role does not have a detailed brief yet. Open review to shape the final hiring copy."}
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:w-[20rem]">
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Queue state</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{state.label}</p>
          </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Candidate flow</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {role.candidateCount ?? 0} active submission{role.candidateCount === 1 ? "" : "s"}
          </p>
        </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Work mode</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{summary.workModeLabel}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Employment type</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{summary.employmentTypeLabel || "Not specified"}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Location</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{role.location || "Not specified"}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Last updated</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{formatRoleDate(role.updatedAt)}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {role.skills
          ? role.skills.split(",").map((skill) => skill.trim()).filter(Boolean).slice(0, 8).map((skill) => (
              <span key={skill} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {skill}
              </span>
            ))
          : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
              No skills set yet
            </span>
          )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          onClick={() => onEdit(role)}
        >
          <Pencil className="mr-1.5 h-4 w-4" />
          Edit review
        </Button>
        <RoleActionsMenu
          roleId={role.id}
          actions={actions}
          disabled={actionDisabled}
          onUpdateStatus={onUpdateStatus}
        />
        <Link
          href={`/admin/roles/${role.id}/candidates`}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-4 text-sm font-medium text-slate-700 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Eye className="h-4 w-4" />
          Open pipeline
        </Link>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Admin review guidance</p>
            <h3 className="mt-1 text-base font-semibold text-slate-950">{guidance.heading}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{guidance.description}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Queue reason</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{state.label}</p>
              <p className="mt-1 text-sm leading-5 text-slate-600">{state.body}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Role readiness</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {role.status === "published"
                  ? "Live in vendor pipeline"
                  : role.status === "on_hold"
                    ? "Paused but still tracked"
                    : role.status === "closed"
                      ? "Archived from live hiring"
                      : "Still in admin review"}
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                {role.candidateCount ?? 0} candidate{role.candidateCount === 1 ? "" : "s"} currently attached to this role.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {guidance.checklist.map((line) => (
            <div key={line} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RoleActionsMenu({
  roleId,
  actions,
  disabled,
  onUpdateStatus,
}: {
  roleId: number;
  actions: ReturnType<typeof getRoleActionCopy>;
  disabled: boolean;
  onUpdateStatus: (roleId: number, status: "draft" | "pending_approval" | "published" | "on_hold" | "closed") => void;
}) {
  const primaryAction = "primary" in actions ? actions.primary ?? null : null;
  const secondaryAction = "secondary" in actions ? actions.secondary ?? null : null;
  const destructiveAction = "destructive" in actions ? actions.destructive ?? null : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="h-8 rounded-lg px-3 text-xs" disabled={disabled}>
          Actions
          <MoreHorizontal className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="z-[100] w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
      >
        {primaryAction ? (
          <DropdownMenuItem
            className="whitespace-nowrap rounded-lg text-sm font-medium text-slate-700 focus:bg-slate-100 focus:text-slate-900"
            onSelect={() => onUpdateStatus(roleId, primaryAction.status)}
          >
            {primaryAction.label}
          </DropdownMenuItem>
        ) : null}
        {secondaryAction ? (
          <DropdownMenuItem
            className="whitespace-nowrap rounded-lg text-sm font-medium text-slate-700 focus:bg-slate-100 focus:text-slate-900"
            onSelect={() => onUpdateStatus(roleId, secondaryAction.status)}
          >
            {secondaryAction.label}
          </DropdownMenuItem>
        ) : null}
        {destructiveAction ? (
          <>
            {(primaryAction || secondaryAction) ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              className="whitespace-nowrap rounded-lg text-sm font-medium text-rose-700 focus:bg-rose-50 focus:text-rose-800"
              onSelect={() => onUpdateStatus(roleId, destructiveAction.status)}
            >
              {destructiveAction.label}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AdminRoles() {
  const { data: roles, isLoading } = useListRoles();
  const [activeTab, setActiveTab] = useState<ReviewTab>("all");
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [pendingRoleId, setPendingRoleId] = useState<number | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deferredSearch = useDeferredValue(search.trim());
  const reviewPanelRef = useRef<HTMLDivElement | null>(null);

  const selectedRole = useMemo(
    () => roles?.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  const companyOptions = useMemo(() => {
    return Array.from(new Set((roles ?? []).map((role) => role.companyName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [roles]);

  const queueSnapshot = useMemo(() => buildRoleQueueSnapshot((roles ?? []) as AdminReviewRole[]), [roles]);
  const priorityRoles = useMemo(() => {
    const reference = new Date();
    return [...(roles ?? [])]
      .filter((role) => isStaleRole(role as AdminReviewRole, reference))
      .sort((left, right) => new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime())
      .slice(0, 3);
  }, [roles]);

  const filteredRoles = useMemo(() => {
    if (!roles) return [];

    const query = deferredSearch.toLowerCase();
    return [...roles]
      .filter((role) => {
        if (activeTab !== "all" && getReviewTabStatus(role.status) !== activeTab) return false;
        if (companyFilter !== "all" && role.companyName !== companyFilter) return false;
        if (!query) return true;
        return matchesRoleReviewSearch(role, query);
      })
      .sort((left, right) => {
        const priority = (status: string) => {
          if (status === "pending_approval") return 0;
          if (status === "draft") return 1;
          if (status === "published") return 2;
          if (status === "on_hold") return 3;
          return 4;
        };

        const statusDelta = priority(left.status) - priority(right.status);
        if (statusDelta !== 0) return statusDelta;

        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      });
  }, [activeTab, companyFilter, deferredSearch, roles]);

  const previewRole = selectedRole && filteredRoles.some((role) => role.id === selectedRole.id)
    ? selectedRole
    : null;
  const leadPriorityRole = priorityRoles[0] ?? null;

  const resetForm = () => {
    setEditingRoleId(null);
    setFormData(emptyForm);
  };

  const { mutateAsync: updateRoleAsync, isPending: isUpdatingRole } = useUpdateRole();

  const { mutate: updateStatus, isPending: isUpdatingStatus } = useUpdateRoleStatus({
    mutation: {
      onSuccess: (_, vars) => {
        setPendingRoleId(null);
        queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
        const statusLabel = (vars.data as { status?: string })?.status;
        toast({
          title:
            statusLabel === "published"
              ? "Role published"
              : statusLabel === "on_hold"
                ? "Role put on hold"
              : statusLabel === "draft"
                ? "Role sent back to draft"
                : statusLabel === "closed"
                  ? "Role closed"
                  : "Role review updated",
          description: "The review queue has been refreshed.",
        });
      },
      onError: (error: Error) => {
        setPendingRoleId(null);
        toast({
          title: "Role status update failed",
          description: error.message || "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const openEditDialog = (role: AdminReviewRole) => {
    const { body } = parseRoleDescription(role.description);
    setEditingRoleId(role.id);
    setSelectedRoleId(role.id);
    setFormData({
      title: role.title || "",
      description: body,
      skills: role.skills || "",
      location: role.location || "",
      employmentType: resolveEmploymentType(role) || "",
      employmentTypeDescription: resolveEmploymentTypeDescription(role),
      workMode: resolveWorkMode(role),
    });
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingRoleId) return;

    try {
      await updateRoleAsync({
        id: editingRoleId,
        data: {
          title: formData.title.trim(),
          description: serializeRoleDescription(formData.description, {
            workMode: formData.workMode || undefined,
            employmentType: formData.employmentType || undefined,
            employmentTypeDescription:
              formData.employmentType === "other" ? formData.employmentTypeDescription.trim() || undefined : undefined,
          }),
          skills: formData.skills.trim() || undefined,
          location: formData.location.trim() || undefined,
          employmentType: formData.employmentType || undefined,
          workMode: toApiWorkMode(formData.workMode),
          otherEmploymentTypeDescription:
            formData.employmentType === "other" ? formData.employmentTypeDescription.trim() || undefined : undefined,
          isRemote: formData.workMode === "full remote",
        },
      });

      await queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
      setIsEditOpen(false);
      resetForm();
      toast({
        title: "Role updated",
        description: "The admin review copy was updated. You can publish the final version whenever it is ready.",
      });
    } catch (error) {
      toast({
        title: "Role could not be updated",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const changeStatus = (roleId: number, status: "draft" | "pending_approval" | "published" | "on_hold" | "closed") => {
    const currentRole = roles?.find((role) => role.id === roleId);
    if (isUpdatingStatus || currentRole?.status === status) return;
    setPendingRoleId(roleId);
    updateStatus({ id: roleId, data: { status } });
  };

  const focusRoleReview = (roleId: number) => {
    setSelectedRoleId(roleId);
    requestAnimationFrame(() => {
      reviewPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="mb-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Job Roles</h1>
            <p className="text-sm text-slate-500 mt-1">
              Review draft roles, adjust the hiring brief, and publish the approved version into the vendor-facing pipeline.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            {
              label: "Total queue",
              value: queueSnapshot.total,
              tone: "border-slate-200 bg-slate-50 text-slate-800",
              tab: "all" as ReviewTab,
            },
            {
              label: "Awaiting approval",
              value: queueSnapshot.pendingApproval,
              tone: "border-amber-200 bg-amber-50 text-amber-800",
              tab: "pending" as ReviewTab,
            },
            {
              label: "Needs edits",
              value: queueSnapshot.needsEdits,
              tone: "border-sky-200 bg-sky-50 text-sky-800",
              tab: "draft" as ReviewTab,
            },
            {
              label: "On hold",
              value: queueSnapshot.onHold,
              tone: "border-orange-200 bg-orange-50 text-orange-800",
              tab: "on_hold" as ReviewTab,
            },
            {
              label: "Stuck roles",
              value: queueSnapshot.stuckRoles,
              tone: "border-rose-200 bg-rose-50 text-rose-800",
              tab: "all" as ReviewTab,
            },
          ].map((card) => (
            <button
              key={card.label}
              type="button"
              className={`rounded-full border px-4 py-2 text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${card.tone} ${activeTab === card.tab ? "ring-2 ring-primary/30 shadow-md" : ""}`}
              onClick={() => setActiveTab(card.tab)}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">{card.label}</span>
              <span className="ml-2 text-sm font-bold">{card.value}</span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {REVIEW_TABS.map((tab) => (
              <Button
                key={tab.key}
                type="button"
                variant={activeTab === tab.key ? "default" : "outline"}
                className="h-9 rounded-full"
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-[220px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search role, company, skill, or location..."
                className="h-10 rounded-xl pl-11"
              />
            </div>
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="h-10 min-w-[170px] rounded-xl">
                <SelectValue placeholder="Company filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companyOptions.map((company) => (
                  <SelectItem key={company} value={company}>
                    {company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              className="h-10 rounded-full text-slate-500"
              onClick={() => {
                setSearch("");
                setCompanyFilter("all");
                setActiveTab("all");
              }}
            >
              <Filter className="mr-2 h-4 w-4" />
              Clear filters
            </Button>
          </div>
          </div>
        </div>

        {leadPriorityRole ? (
          <div className="mt-5 rounded-3xl border border-rose-100 bg-rose-50/60 p-5 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">Needs attention first</p>
                  <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">
                    {priorityRoles.length} role{priorityRoles.length === 1 ? "" : "s"} marked for escalation
                  </span>
                </div>
                <h2 className="text-xl font-bold text-slate-900">
                  {leadPriorityRole.title} has been waiting {getDaysWaiting(leadPriorityRole.updatedAt ?? leadPriorityRole.createdAt) ?? 0} days for admin action
                </h2>
                <p className="text-sm leading-6 text-slate-600">
                  {leadPriorityRole.companyName} · {getRoleReviewStateMeta(leadPriorityRole.status).body}
                  {priorityRoles.length > 1 ? ` ${priorityRoles.length - 1} more role${priorityRoles.length - 1 === 1 ? "" : "s"} are also waiting in the review queue.` : ""}
                </p>
                <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-500">
                  <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-rose-100">Updated {format(new Date(leadPriorityRole.updatedAt), "MMM d")}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-rose-100">{leadPriorityRole.candidateCount ?? 0} candidates</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" className="rounded-xl" onClick={() => focusRoleReview(leadPriorityRole.id)}>
                  Open review
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => openEditDialog(leadPriorityRole as AdminReviewRole)}
                >
                  Edit review
                </Button>
              </div>
            </div>
          </div>
        ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : filteredRoles.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            No roles matched this review queue.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRoles.map((role) => {
              const reviewState = getRoleReviewStateMeta(role.status);
              const summary = getRoleSummaryLines(role);
              const selected = previewRole?.id === role.id;
              const actionDisabled = isUpdatingStatus && pendingRoleId === role.id;

              return (
                <div
                  key={role.id}
                  className={`flex flex-col gap-3 px-4 py-3 transition-colors sm:px-5 lg:flex-row lg:items-center lg:gap-4 ${
                    selected ? "bg-sky-50/70" : "hover:bg-slate-50/60"
                  }`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    onClick={() => setSelectedRoleId(role.id)}
                  >
                    <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">{role.title}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {role.companyName}
                        </span>
                        <StatusBadge status={role.status} />
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                          {role.candidateCount ?? 0} candidates
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{role.location || "No location"}</span>
                        <span>{summary.workModeLabel}</span>
                        <span>{summary.employmentTypeLabel || "Type not set"}</span>
                        <span>Updated {format(new Date(role.updatedAt), "MMM d")}</span>
                        <span className="text-slate-400">{reviewState.label}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {summary.descriptionBody || reviewState.body}
                      </p>
                    </div>
                  </button>

                  <div className="flex flex-wrap items-center gap-2 lg:ml-auto lg:justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isUpdatingRole}
                      className="h-8 rounded-lg px-3 text-xs"
                      onClick={() => openEditDialog(role as AdminReviewRole)}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <RoleActionsMenu
                      roleId={role.id}
                      actions={getRoleActionCopy(role.status)}
                      disabled={actionDisabled}
                      onUpdateStatus={changeStatus}
                    />
                    <Link
                      href={`/admin/roles/${role.id}/candidates`}
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:text-primary active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Pipeline
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewRole ? (
        <div ref={reviewPanelRef} className="mt-6">
          <RoleReviewCard
            role={previewRole as AdminReviewRole}
            onEdit={openEditDialog}
            onOpenPipeline={(roleId) => setSelectedRoleId(roleId)}
            onUpdateStatus={changeStatus}
            pendingRoleId={pendingRoleId}
          />
        </div>
      ) : null}

      <Dialog
        open={isEditOpen}
        onOpenChange={(open) => {
          setIsEditOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Role Before Publish</DialogTitle>
            <DialogDescription>
              Finalize the hiring brief, then publish the reviewed version to the vendor-facing positions list.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="mt-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Job Title *</label>
              <Input required value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Job Description</label>
              <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={4} className="rounded-xl resize-none" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Required Skills</label>
              <Input value={formData.skills} onChange={(e) => setFormData({ ...formData, skills: e.target.value })} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Work Mode *</label>
              <select
                required
                value={formData.workMode}
                onChange={(e) => setFormData({ ...formData, workMode: e.target.value as WorkMode })}
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">Select work mode...</option>
                {WORK_MODES.map((mode) => (
                  <option key={mode} value={mode}>{workModeLabel[mode]}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Location</label>
                <Input value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Employment Type *</label>
                <select
                  required
                  value={formData.employmentType}
                  onChange={(e) => setFormData({
                    ...formData,
                    employmentType: e.target.value as "" | EmploymentType,
                    employmentTypeDescription: e.target.value === "other" ? formData.employmentTypeDescription : "",
                  })}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select type...</option>
                  {EMPLOYMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{employmentTypeLabel[type]}</option>
                  ))}
                </select>
              </div>
            </div>
            {formData.employmentType === "other" ? (
              <div className="space-y-2">
                <label className="text-sm font-semibold">Employment Type Description *</label>
                <Textarea
                  required
                  value={formData.employmentTypeDescription}
                  onChange={(e) => setFormData({ ...formData, employmentTypeDescription: e.target.value })}
                  rows={3}
                  className="rounded-xl resize-none"
                />
              </div>
            ) : null}
            <Button disabled={isUpdatingRole || !editingRoleId} type="submit" className="mt-2 h-11 w-full rounded-xl">
              {isUpdatingRole ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Role Review"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
