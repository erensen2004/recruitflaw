import { useMemo, useState } from "react";
import { useListRoles, useCreateRole, useUpdateRole } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Briefcase, Plus, Loader2, Users, MapPin, DollarSign, Wifi, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListRolesQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";

const EMPLOYMENT_TYPES = ["full-time", "part-time", "contract", "freelance"];

const empTypeLabel: Record<string, string> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  "full_time": "Full-time",
  "part_time": "Part-time",
  "contract": "Contract",
  "freelance": "Freelance",
};

const emptyForm = {
  title: "", description: "", skills: "",
  salaryMin: "", salaryMax: "",
  location: "", employmentType: "", isRemote: false,
};

export default function ClientRoles() {
  const { data: roles, isLoading } = useListRoles();
  const [isOpen, setIsOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [deleteRoleId, setDeleteRoleId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState(emptyForm);

  const selectedRole = useMemo(
    () => roles?.find((role) => role.id === editingRoleId) ?? null,
    [editingRoleId, roles],
  );

  const { mutate: createRole, isPending } = useCreateRole({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
        setIsOpen(false);
        setFormData(emptyForm);
        toast({ title: "Position created and sent for approval" });
      },
      onError: (error: Error) => {
        toast({
          title: "Position could not be created",
          description: error.message || "Please try again.",
          variant: "destructive",
        });
      },
    }
  });

  const { mutate: updateRole, isPending: isUpdating } = useUpdateRole({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
        setIsEditOpen(false);
        setEditingRoleId(null);
        setFormData(emptyForm);
        toast({ title: "Position updated successfully" });
      },
      onError: (error: Error) => {
        toast({
          title: "Position could not be updated",
          description: error.message || "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createRole({
      data: {
        title: formData.title,
        description: formData.description || undefined,
        skills: formData.skills || undefined,
        salaryMin: formData.salaryMin ? Number(formData.salaryMin) : undefined,
        salaryMax: formData.salaryMax ? Number(formData.salaryMax) : undefined,
        location: formData.location || undefined,
        employmentType: (formData.employmentType as any) || undefined,
        isRemote: formData.isRemote,
      }
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoleId) return;

    updateRole({
      id: editingRoleId,
      data: {
        title: formData.title,
        description: formData.description || undefined,
        skills: formData.skills || undefined,
        salaryMin: formData.salaryMin ? Number(formData.salaryMin) : undefined,
        salaryMax: formData.salaryMax ? Number(formData.salaryMax) : undefined,
        location: formData.location || undefined,
        employmentType: (formData.employmentType as any) || undefined,
        isRemote: formData.isRemote,
      },
    });
  };

  const openEditDialog = (role: NonNullable<typeof roles>[number]) => {
    setEditingRoleId(role.id);
    setFormData({
      title: role.title || "",
      description: role.description || "",
      skills: role.skills || "",
      salaryMin: role.salaryMin != null ? String(role.salaryMin) : "",
      salaryMax: role.salaryMax != null ? String(role.salaryMax) : "",
      location: role.location || "",
      employmentType: role.employmentType || "",
      isRemote: Boolean(role.isRemote),
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">My Job Roles</h1>
          <p className="text-slate-500 mt-1">Manage open positions and track candidates</p>
        </div>

        <Dialog
          open={isOpen}
          onOpenChange={(open) => {
            setIsOpen(open);
            if (!open) setFormData(emptyForm);
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
                Create a role request with the salary range, skills, and hiring details your team wants vendors to work against.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Job Title *</label>
                <Input required value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Senior Frontend Engineer" className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Job Description</label>
                <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} className="rounded-xl resize-none" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Required Skills <span className="font-normal text-slate-400">(comma separated)</span></label>
                <Input value={formData.skills} onChange={e => setFormData({ ...formData, skills: e.target.value })} placeholder="React, TypeScript, Node.js" className="h-11 rounded-xl" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Min Salary ($)</label>
                  <Input type="number" value={formData.salaryMin} onChange={e => setFormData({ ...formData, salaryMin: e.target.value })} placeholder="60000" className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Max Salary ($)</label>
                  <Input type="number" value={formData.salaryMax} onChange={e => setFormData({ ...formData, salaryMax: e.target.value })} placeholder="90000" className="h-11 rounded-xl" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Location</label>
                  <Input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} placeholder="Istanbul, Turkey" className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Employment Type</label>
                  <select
                    value={formData.employmentType}
                    onChange={e => setFormData({ ...formData, employmentType: e.target.value })}
                    className="h-11 rounded-xl w-full border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select type...</option>
                    {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{empTypeLabel[t]}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <input
                  type="checkbox"
                  id="isRemote"
                  checked={formData.isRemote}
                  onChange={e => setFormData({ ...formData, isRemote: e.target.checked })}
                  className="w-4 h-4 accent-primary"
                />
                <label htmlFor="isRemote" className="text-sm font-medium cursor-pointer">Remote-friendly position</label>
              </div>

              <Button disabled={isPending} type="submit" className="w-full h-11 rounded-xl mt-2">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit for Approval"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog
        open={isEditOpen}
        onOpenChange={(open) => {
          setIsEditOpen(open);
          if (!open) {
            setEditingRoleId(null);
            setFormData(emptyForm);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Position</DialogTitle>
            <DialogDescription>
              Update the role details, salary range, and hiring information for this position.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Job Title *</label>
              <Input required value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Senior Frontend Engineer" className="h-11 rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Job Description</label>
              <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} className="rounded-xl resize-none" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Required Skills <span className="font-normal text-slate-400">(comma separated)</span></label>
              <Input value={formData.skills} onChange={e => setFormData({ ...formData, skills: e.target.value })} placeholder="React, TypeScript, Node.js" className="h-11 rounded-xl" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Min Salary ($)</label>
                <Input type="number" value={formData.salaryMin} onChange={e => setFormData({ ...formData, salaryMin: e.target.value })} placeholder="60000" className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Max Salary ($)</label>
                <Input type="number" value={formData.salaryMax} onChange={e => setFormData({ ...formData, salaryMax: e.target.value })} placeholder="90000" className="h-11 rounded-xl" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Location</label>
                <Input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} placeholder="Istanbul, Turkey" className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Employment Type</label>
                <select
                  value={formData.employmentType}
                  onChange={e => setFormData({ ...formData, employmentType: e.target.value })}
                  className="h-11 rounded-xl w-full border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select type...</option>
                  {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{empTypeLabel[t]}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
              <input
                type="checkbox"
                id="editIsRemote"
                checked={formData.isRemote}
                onChange={e => setFormData({ ...formData, isRemote: e.target.checked })}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="editIsRemote" className="text-sm font-medium cursor-pointer">Remote-friendly position</label>
            </div>
            <Button disabled={isUpdating || !selectedRole} type="submit" className="w-full h-11 rounded-xl mt-2">
              {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : roles?.length === 0 ? (
          <div className="col-span-full text-center p-12 bg-white rounded-2xl border border-slate-200 text-slate-500">
            You haven't opened any positions yet.
          </div>
        ) : roles?.map(role => (
          <div key={role.id} className="bg-white rounded-2xl p-6 shadow-lg shadow-black/5 border border-slate-100 hover:shadow-xl transition-all flex flex-col">
            <div className="flex justify-between items-start mb-3">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Briefcase className="w-5 h-5" />
              </div>
              <StatusBadge status={role.status} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">{role.title}</h3>

            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mb-3">
              {role.location && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{role.location}</span>
              )}
              {role.isRemote && (
                <span className="flex items-center gap-1 text-green-600"><Wifi className="w-3 h-3" />Remote</span>
              )}
              {(role.salaryMin || role.salaryMax) && (
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  {role.salaryMin && role.salaryMax
                    ? `$${(role.salaryMin / 1000).toFixed(0)}k – $${(role.salaryMax / 1000).toFixed(0)}k`
                    : role.salaryMin ? `From $${(role.salaryMin / 1000).toFixed(0)}k` : `Up to $${(role.salaryMax! / 1000).toFixed(0)}k`
                  }
                </span>
              )}
              {role.employmentType && (
                <span className="bg-slate-100 px-2 py-0.5 rounded-full capitalize">{empTypeLabel[role.employmentType] ?? role.employmentType}</span>
              )}
            </div>

            <p className="text-sm text-slate-500 line-clamp-2 mb-4 flex-1">{role.description}</p>

            <div className="mb-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => openEditDialog(role)}
              >
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
                className="inline-flex min-h-8 items-center justify-center rounded-lg px-3 text-xs font-medium text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:bg-slate-100 hover:text-primary active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                View Details
              </Link>
            </div>
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
}
