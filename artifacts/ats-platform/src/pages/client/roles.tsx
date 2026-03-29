import { useMemo, useState } from "react";
import { useCreateRole, useListRoles, useUpdateRole } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
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
import { Briefcase, Loader2, MapPin, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListRolesQueryKey } from "@workspace/api-client-react";
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
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [deleteRoleId, setDeleteRoleId] = useState<number | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const selectedRole = useMemo(
    () => roles?.find((role) => role.id === editingRoleId) ?? null,
    [editingRoleId, roles],
  );

  const { mutateAsync: createRoleAsync, isPending: isCreating } = useCreateRole();
  const { mutateAsync: updateRoleAsync, isPending: isUpdating } = useUpdateRole();

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : roles?.length === 0 ? (
          <div className="col-span-full text-center p-12 bg-white rounded-2xl border border-slate-200 text-slate-500">
            You haven&apos;t opened any positions yet.
          </div>
        ) : (roles ?? []).map((role) => {
          const details = getRoleSummaryLines(role);
          return (
            <div key={role.id} className="bg-white rounded-2xl p-6 shadow-lg shadow-black/5 border border-slate-100 hover:shadow-xl transition-all flex flex-col">
              <div className="flex justify-between items-start mb-3">
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <Briefcase className="w-5 h-5" />
                </div>
                <StatusBadge status={role.status} />
              </div>

              <h3 className="text-lg font-bold text-slate-900 mb-1">{role.title}</h3>

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mb-3">
                {role.location ? (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {role.location}
                  </span>
                ) : null}
                <span className="rounded-full bg-slate-100 px-2 py-0.5">{details.workModeLabel}</span>
                {details.employmentTypeLabel ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">{details.employmentTypeLabel}</span>
                ) : null}
              </div>

              <p className="text-sm text-slate-500 line-clamp-3 mb-4 flex-1">
                {details.descriptionBody || "Waiting for the admin team to finalize and publish the hiring brief."}
              </p>

              <div className="mb-4 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => openEditDialog(role)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700"
                  disabled={deleteRoleId === role.id}
                  onClick={() => handleDeleteRole(role.id)}
                >
                  {deleteRoleId === role.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Delete
                </Button>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between mt-auto">
                <div className="flex items-center gap-2 text-slate-600 font-medium text-sm">
                  <Users className="w-4 h-4" />
                  {role.candidateCount} Candidates
                </div>
                <Link
                  href={`/client/roles/${role.id}/candidates`}
                  className="inline-flex min-h-9 items-center justify-center rounded-lg border border-primary/20 bg-primary px-3.5 text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  View
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </DashboardLayout>
  );
}
