import { useState } from "react";
import { useListUsers, useUpdateUser, useListCompanies, getListUsersQueryKey } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Plus, Loader2, Copy, Mail } from "lucide-react";
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
  const [createdUserName, setCreatedUserName] = useState("");
  const [createdUserEmail, setCreatedUserEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [isSendingReset, setIsSendingReset] = useState(false);
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
      setCreatedUserName(payload?.name || formData.name.trim());
      setCreatedUserEmail(payload?.email || formData.email.trim().toLowerCase());
      setTemporaryPassword(payload?.temporaryPassword || "");
      setIsOpen(false);
      resetForm();

      toast({
        title: "User created",
        description: "Temporary password is ready. The preferred onboarding path is still forgot password.",
      });
    } catch (error) {
      toast({
        title: "Error creating user",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const copyTemporaryPassword = async () => {
    if (!temporaryPassword) return;
    await navigator.clipboard.writeText(temporaryPassword);
    toast({ title: "Temporary password copied" });
  };

  const sendResetEmail = async () => {
    if (!createdUserEmail) return;
    setIsSendingReset(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: createdUserEmail }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Reset email could not be sent.");
      }
      toast({
        title: "Reset email queued",
        description: payload?.message || "If the account exists, a reset link has been sent.",
      });
    } catch (error) {
      toast({
        title: "Reset email failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="mt-1 text-sm text-slate-500">Create controlled workspace access with a one-time temporary password and reset-first onboarding.</p>
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
              Create User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>
                Create the account with a random temporary password. Users can sign in with it or use forgot password to set their own permanent password.
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
                Create User
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {temporaryPassword ? (
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50/80 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-500">Temporary password shown once</p>
              <p className="mt-1 text-sm font-medium text-sky-900">
                {createdUserName} can sign in with this password, but the preferred onboarding path is to use forgot password.
              </p>
              <p className="mt-1 text-xs text-sky-700">{createdUserEmail}</p>
              <p className="mt-3 rounded-xl border border-sky-200 bg-white px-4 py-3 font-mono text-sm font-semibold text-slate-900">
                {temporaryPassword}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-full" onClick={copyTemporaryPassword}>
                <Copy className="mr-2 h-4 w-4" />
                Copy password
              </Button>
              <Button type="button" className="rounded-full" onClick={sendResetEmail} disabled={isSendingReset}>
                {isSendingReset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                Send reset email
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
