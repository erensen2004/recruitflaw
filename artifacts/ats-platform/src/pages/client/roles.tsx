import { useMemo, useState } from "react";
import { getListRolesQueryKey, useCreateRole, useListRoles, useUpdateRole, useUpdateRoleStatus } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, MapPin, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  EMPLOYMENT_TYPES,
  type EmploymentType,
  type WorkMode,
  WORK_MODES,
  employmentTypeLabel,
  getRoleSummaryLines,
  parseRoleDescription,
  resolveEmploymentTypeDescription,
  resolveEmploymentType,
  resolveWorkMode,
  serializeRoleDescription,
  toApiWorkMode,
  workModeLabel,
} from "@/lib/role-display";

type ClientRoleFilter = "all" | "draft" | "pending" | "published" | "on_hold" | "closed";

const CLIENT_ROLE_FILTERS: Array<{ key: ClientRoleFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending", label: "Awaiting approval" },
  { key: "published", label: "Live" },
  { key: "on_hold", label: "On hold" },
  { key: "closed", label: "Closed" },
];

type ClientLifecycleRoleStatus = "published" | "on_hold" | "closed";

function getClientLifecycleActions(status: string) {
  if (status === "published") {
    return [
      { label: "Move to on hold", status: "on_hold" as ClientLifecycleRoleStatus },
      { label: "Close", status: "closed" as ClientLifecycleRoleStatus },
    ];
  }

  if (status === "on_hold") {
    return [
      { label: "Publish", status: "published" as ClientLifecycleRoleStatus },
      { label: "Close", status: "closed" as ClientLifecycleRoleStatus },
    ];
  }

  if (status === "closed") {
    return [
      { label: "Publish", status: "published" as ClientLifecycleRoleStatus },
      { label: "Move to on hold", status: "on_hold" as ClientLifecycleRoleStatus },
    ];
  }

  return [];
}

const emptyForm = {
  title: "",
  description: "",
  skills: "",
  location: "",
  employmentType: "" as "" | EmploymentType,
  employmentTypeDescription: "",
  workMode: "" as "" | WorkMode,
};

export default function ClientRoles() {
  const { data: roles, isLoading } = useListRoles();
  const [isOpen, setIsOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ClientRoleFilter>("all");
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [deleteRoleId, setDeleteRoleId] = useState<number | null>(null);
  const [pendingStatusRoleId, setPendingStatusRoleId] = useState<number | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const selectedRole = useMemo(
    () => roles?.find((role) => role.id === editingRoleId) ?? null,
    [editingRoleId, roles],
  );

  const filteredRoles = useMemo(() => {
    if (!roles) return [];
    if (activeFilter === "all") return roles;

    return roles.filter((role) => {
      if (activeFilter === "pending") return role.status === "pending_approval";
      return role.status === activeFilter;
    });
  }, [activeFilter, roles]);

  const roleCounts = useMemo(() => {
    const counts: Record<ClientRoleFilter, number> = {
      all: roles?.length ?? 0,
      draft: 0,
      pending: 0,
      published: 0,
      on_hold: 0,
      closed: 0,
    };

    for (const role of roles ?? []) {
      if (role.status === "pending_approval") {
        counts.pending += 1;
      } else if (role.status === "draft" || role.status === "published" || role.status === "on_hold" || role.status === "closed") {
        counts[role.status] += 1;
      }
    }

    return counts;
  }, [roles]);

  const { mutateAsync: createRoleAsync, isPending: isCreating } = useCreateRole();
  const { mutateAsync: updateRoleAsync, isPending: isUpdating } = useUpdateRole();
  const { mutate: updateRoleStatus, isPending: isUpdatingStatus } = useUpdateRoleStatus({
    mutation: {
      onSuccess: (_, vars) => {
        setPendingStatusRoleId(null);
        void queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
        const nextStatus = (vars.data as { status?: string })?.status;
        toast({
          title:
            nextStatus === "published"
              ? "Role published"
              : nextStatus === "on_hold"
                ? "Role put on hold"
                : nextStatus === "closed"
                  ? "Role closed"
                  : "Role status updated",
          description: "The role list has been refreshed.",
        });
      },
      onError: (error: Error) => {
        setPendingStatusRoleId(null);
        toast({
          title: "Role status update failed",
          description: error.message || "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const resetForm = () => {
    setFormData(emptyForm);
    setEditingRoleId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createRoleAsync({
        data: {
          title: formData.title.trim(),
          description: serializeRoleDescription(formData.description, {
            workMode: formData.workMode || undefined,
            employmentType: formData.employmentType || undefined,
            employmentTypeDescription:
              formData.employmentType === "other" ? formData.employmentTypeDescription || undefined : undefined,
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
      setIsOpen(false);
      resetForm();
      toast({
        title: "Role saved as draft",
        description: "The admin team will review and publish this role after the final checks.",
      });
    } catch (error) {
      toast({
        title: "Position could not be created",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
              formData.employmentType === "other" ? formData.employmentTypeDescription || undefined : undefined,
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
        description: "Changes were saved and routed back to the admin review queue.",
      });
    } catch (error) {
      toast({
        title: "Position could not be updated",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (role: NonNullable<typeof roles>[number]) => {
    const { body } = parseRoleDescription(role.description);
    setEditingRoleId(role.id);
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

  const handleDeleteRole = async (roleId: number) => {
    const confirmed = window.confirm("Delete this role? Roles with submitted candidates cannot be deleted.");
    if (!confirmed) return;

    setDeleteRoleId(roleId);
    try {
      const token = localStorage.getItem("ats_token");
      const response = await fetch(`/api/roles/${roleId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Role could not be deleted");
      }

      await queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
      toast({ title: "Role deleted successfully" });
    } catch (error) {
      toast({
        title: "Role could not be deleted",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleteRoleId(null);
    }
  };

  const changeRoleStatus = (roleId: number, status: ClientLifecycleRoleStatus) => {
    const currentRole = roles?.find((role) => role.id === roleId);
    if (isUpdatingStatus || currentRole?.status === status) return;
    setPendingStatusRoleId(roleId);
    updateRoleStatus({ id: roleId, data: { status } });
  };

  return (
    <DashboardLayout allowedRoles={["client"]}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Job Roles</h1>
          <p className="text-slate-500 mt-1">Create draft roles for admin approval and manage the positions already in review.</p>
        </div>

        <Dialog
          open={isOpen}
          onOpenChange={(open) => {
            setIsOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button className="rounded-xl shadow-md h-11 px-6">
              <Plus className="w-4 h-4 mr-2" />
              Open New Position
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Open New Position</DialogTitle>
              <DialogDescription>
                Draft the role request first. The admin team will review, adjust if needed, and publish the final version.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Job Title *</label>
                <Input required value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder="Senior Backend Engineer" className="h-11 rounded-xl" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Job Description</label>
                <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={4} className="rounded-xl resize-none" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Required Skills <span className="font-normal text-slate-400">(comma separated)</span></label>
                <Input value={formData.skills} onChange={(e) => setFormData({ ...formData, skills: e.target.value })} placeholder="Java, Spring Boot, PostgreSQL" className="h-11 rounded-xl" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Work Mode *</label>
                <select
                  required
                  value={formData.workMode}
                  onChange={(e) => setFormData({ ...formData, workMode: e.target.value as WorkMode })}
                  className="h-11 rounded-xl w-full border border-input bg-background px-3 text-sm"
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
                  <Input value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} placeholder="Istanbul, Turkey" className="h-11 rounded-xl" />
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
                    className="h-11 rounded-xl w-full border border-input bg-background px-3 text-sm"
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
                    placeholder="Describe the arrangement the admin team should review and publish."
                    className="rounded-xl resize-none"
                  />
                </div>
              ) : null}

              <Button disabled={isCreating} type="submit" className="w-full h-11 rounded-xl mt-2">
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Draft"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog
        open={isEditOpen}
        onOpenChange={(open) => {
          setIsEditOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Position</DialogTitle>
            <DialogDescription>
              Updating a role sends it back into draft so the admin team can publish the revised version.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4 mt-4">
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
                className="h-11 rounded-xl w-full border border-input bg-background px-3 text-sm"
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
                  className="h-11 rounded-xl w-full border border-input bg-background px-3 text-sm"
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
            <Button disabled={isUpdating || !selectedRole} type="submit" className="w-full h-11 rounded-xl mt-2">
              {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Draft Changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="mb-4 flex flex-wrap gap-2">
        {CLIENT_ROLE_FILTERS.map((filter) => (
          <Button
            key={filter.key}
            type="button"
            variant={activeFilter === filter.key ? "default" : "outline"}
            className="h-8 rounded-full px-3 text-xs"
            onClick={() => setActiveFilter(filter.key)}
          >
            {filter.label}
            <span className="ml-2 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold text-current">
              {roleCounts[filter.key]}
            </span>
          </Button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : filteredRoles.length === 0 ? (
          <div className="text-center p-12 text-slate-500">
            {roles?.length
              ? "No roles match this filter."
              : "You haven&apos;t opened any positions yet."}
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredRoles.map((role) => {
              const details = getRoleSummaryLines(role);
              return (
                <div
                  key={role.id}
                  className="px-4 py-3 sm:px-5 hover:bg-slate-50/80 transition-colors"
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:items-center xl:gap-3">
                        <div className="min-w-0 flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-900">{role.title}</h3>
                          <StatusBadge status={role.status} />
                        </div>

                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 xl:flex-nowrap xl:overflow-hidden">
                          {role.location ? (
                            <span className="inline-flex min-w-0 items-center gap-1 truncate">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{role.location}</span>
                            </span>
                          ) : null}
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                            {details.workModeLabel}
                          </span>
                          {details.employmentTypeLabel ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                              {details.employmentTypeLabel}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center gap-1 text-slate-600">
                            <Users className="h-3.5 w-3.5 shrink-0" />
                            {role.candidateCount}
                          </span>
                        </div>
                      </div>

                      <p className="mt-1 truncate pr-0 text-xs text-slate-500 xl:pr-6">
                        {details.descriptionBody || "Waiting for the admin team to finalize and publish the hiring brief."}
                      </p>
                    </div>

                    <div className="flex items-center justify-end gap-2 xl:shrink-0">
                      {role.status === "published" || role.status === "on_hold" || role.status === "closed" ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg px-2.5 text-xs"
                              disabled={isUpdatingStatus && pendingStatusRoleId === role.id}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                              Status
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                            {getClientLifecycleActions(role.status).map((action) => (
                              <DropdownMenuItem
                                key={action.status}
                                className="rounded-lg px-3 py-2 text-sm"
                                onSelect={(event) => {
                                  event.preventDefault();
                                  changeRoleStatus(role.id, action.status);
                                }}
                              >
                                {action.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg px-2.5 text-xs"
                          onClick={() => openEditDialog(role)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-lg px-2.5 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={deleteRoleId === role.id}
                        onClick={() => handleDeleteRole(role.id)}
                      >
                        {deleteRoleId === role.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Delete
                      </Button>
                      <Link
                        href={`/client/roles/${role.id}/candidates`}
                        className="inline-flex h-8 items-center justify-center rounded-lg border border-primary/20 bg-primary px-3 text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        View Candidates
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
