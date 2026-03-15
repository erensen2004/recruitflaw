import { useState } from "react";
import { useListUsers, useCreateUser, useUpdateUser, useListCompanies } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListUsersQueryKey } from "@workspace/api-client-react";

export default function AdminUsers() {
  const { data: users, isLoading } = useListUsers();
  const { data: companies } = useListCompanies();
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({ name: "", email: "", password: "", role: "client" as any, companyId: "none" });

  const { mutate: createUser, isPending } = useCreateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setIsOpen(false);
        setFormData({ name: "", email: "", password: "", role: "client", companyId: "none" });
        toast({ title: "User created successfully" });
      },
      onError: () => toast({ title: "Error creating user", variant: "destructive" })
    }
  });

  const { mutate: updateUser } = useUpdateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "User updated" });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...formData, companyId: formData.companyId === "none" ? null : Number(formData.companyId) };
    createUser({ data: payload });
  };

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Users</h1>
          <p className="text-slate-500 mt-1">Manage platform access and roles</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl shadow-md h-11 px-6">
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create New User</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Full Name</label>
                <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Email</label>
                <Input type="email" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Password</label>
                <Input type="password" required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Role</label>
                <Select value={formData.role} onValueChange={(v: any) => setFormData({...formData, role: v, companyId: v === 'admin' ? "none" : formData.companyId})}>
                  <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="client">Client HR</SelectItem>
                    <SelectItem value="vendor">Vendor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.role !== 'admin' && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Company Assignment</label>
                  <Select value={formData.companyId} onValueChange={v => setFormData({...formData, companyId: v})}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Select Company" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Company</SelectItem>
                      {companies?.filter(c => c.type === formData.role).map(c => (
                        <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button disabled={isPending} type="submit" className="w-full h-11 rounded-xl mt-6">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create User"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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
                <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : users?.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-600 font-bold">
                          {u.name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{u.name}</div>
                          <div className="text-sm text-slate-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4"><StatusBadge status={u.role} /></td>
                    <td className="px-6 py-4 text-slate-600 font-medium">{u.companyName || '-'}</td>
                    <td className="px-6 py-4"><StatusBadge status={u.isActive ? 'active' : 'inactive'} /></td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="outline" size="sm" onClick={() => updateUser({ id: u.id, data: { isActive: !u.isActive }})} className="rounded-lg h-8">
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
