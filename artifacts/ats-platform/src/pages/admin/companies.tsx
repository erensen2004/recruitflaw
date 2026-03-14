import { useState } from "react";
import { useListCompanies, useCreateCompany, useUpdateCompany } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListCompaniesQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";

export default function AdminCompanies() {
  const { data: companies, isLoading } = useListCompanies();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"client" | "vendor">("client");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { mutate: createCompany, isPending } = useCreateCompany({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        setIsOpen(false);
        setName("");
        toast({ title: "Company created successfully" });
      },
      onError: (err) => toast({ title: "Error creating company", variant: "destructive" })
    }
  });

  const { mutate: updateCompany } = useUpdateCompany({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        toast({ title: "Company status updated" });
      }
    }
  });

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Companies</h1>
          <p className="text-slate-500 mt-1">Manage client and vendor companies</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl shadow-md h-11 px-6">
              <Plus className="w-4 h-4 mr-2" />
              Add Company
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle>Create New Company</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createCompany({ data: { name, type }}); }} className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Company Name</label>
                <Input required value={name} onChange={e => setName(e.target.value)} placeholder="Acme Corp" className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Company Type</label>
                <Select value={type} onValueChange={(v: "client" | "vendor") => setType(v)}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="vendor">Vendor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={isPending} type="submit" className="w-full h-11 rounded-xl mt-6">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Company"}
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
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Company</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Joined</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : companies?.length === 0 ? (
                <tr><td colSpan={5} className="p-12 text-center text-slate-500">No companies found.</td></tr>
              ) : (
                companies?.map(company => (
                  <tr key={company.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-5 h-5 text-slate-500" />
                        </div>
                        <span className="font-semibold text-slate-900">{company.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4"><StatusBadge status={company.type} /></td>
                    <td className="px-6 py-4"><StatusBadge status={company.isActive ? 'active' : 'inactive'} /></td>
                    <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(company.createdAt), 'MMM d, yyyy')}</td>
                    <td className="px-6 py-4 text-right">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => updateCompany({ id: company.id, data: { isActive: !company.isActive }})}
                        className="rounded-lg h-8"
                      >
                        {company.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
