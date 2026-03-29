import { useState } from "react";
import { useListUsers, useUpdateUser, useListCompanies, getListUsersQueryKey } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Plus, Loader2, Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type CreateUserForm = {
  name: string;
  email: string;
  role: "admin" | "client" | "vendor";
  companyId: string;
};

export default function AdminUsers() {
  const { data: users, isLoading } = useListUsers();
  const { data: companies } = useListCompanies();
  const [isOpen, setIsOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [formData, setFormData] = useState<CreateUserForm>({
    name: "",
    email: "",
    role: "client",
    companyId: "none",
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { mutate: updateUser } = useUpdateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "User updated" });
      },
      onError: () => toast({ title: "User update failed", variant: "destructive" }),
    },
  });

  const resetForm = () => {
    setFormData({ name: "", email: "", role: "client", companyId: "none" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const token = localStorage.getItem("ats_token");
      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          email: formData.email.trim().toLowerCase(),
          role: formData.role,
          companyId: formData.companyId === "none" ? null : Number(formData.companyId),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "User could not be created");
      }

      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      const setupUrl =
        payload?.setupUrl ||
        (payload?.setupToken ? `${window.location.origin}/set-password?token=${encodeURIComponent(payload.setupToken)}` : "");

      setInviteLink(setupUrl);
      setInviteName(payload?.name || formData.name.trim());
      setIsOpen(false);
      resetForm();

      toast({
        title: "Invite created",
        description: setupUrl ? "A password setup link is ready to copy." : "User created.",
      });
    } catch (error) {
      toast({
        title: "Error creating user",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    toast({ title: "Setup link copied" });
  };

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="mt-1 text-sm text-slate-500">Create controlled workspace access and activate accounts with setup links.</p>
        </div>

        <Dialog
          open={isOpen}
          onOpenChange={(open) => {
            setIsOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button className="h-10 rounded-xl px-5 shadow-md">
              <Plus className="mr-2 h-4 w-4" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Invite New User</DialogTitle>
              <DialogDescription>
                Create the account now and send a password setup link instead of choosing a permanent password up front.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Full Name</label>
                <Input required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Email</label>
                <Input type="email" required value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Role</label>
                <Select value={formData.role} onValueChange={(value: "admin" | "client" | "vendor") => setFormData({ ...formData, role: value, companyId: value === "admin" ? "none" : formData.companyId })}>
                  <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="client">Client HR</SelectItem>
                    <SelectItem value="vendor">Vendor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.role !== "admin" ? (
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Company Assignment</label>
                  <Select value={formData.companyId} onValueChange={(value) => setFormData({ ...formData, companyId: value })}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Select Company" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Company</SelectItem>
                      {companies?.filter((company) => company.type === formData.role).map((company) => (
                        <SelectItem key={company.id} value={String(company.id)}>
                          {company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <Button type="submit" className="mt-4 h-11 w-full rounded-xl">
                Create Invite
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {inviteLink ? (
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50/80 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-500">Setup link ready</p>
              <p className="mt-1 text-sm font-medium text-sky-900">
                {inviteName} can set their password from this link before first login.
              </p>
              <p className="mt-1 break-all text-xs text-sky-700">{inviteLink}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-full" onClick={copyInviteLink}>
                <Copy className="mr-2 h-4 w-4" />
                Copy link
              </Button>
              <Button type="button" className="rounded-full" asChild>
                <a href={inviteLink} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open link
                </a>
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Company</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                  </td>
                </tr>
              ) : users?.map((user) => (
                <tr key={user.id} className="transition-colors hover:bg-slate-50/50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-600">
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{user.name}</div>
                        <div className="text-sm text-slate-500">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={user.role} />
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-600">{user.companyName || "-"}</td>
                  <td className="px-6 py-4">
                    <StatusBadge status={user.isActive ? "active" : "inactive"} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateUser({ id: user.id, data: { isActive: !user.isActive } })}
                      className="h-8 rounded-lg"
                    >
                      {user.isActive ? "Deactivate" : "Activate"}
                    </Button>
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
