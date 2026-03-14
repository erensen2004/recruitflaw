import { useState } from "react";
import { useListContracts, useCreateContract, useListCandidates } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListContractsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";

export default function AdminContracts() {
  const { data: contracts, isLoading } = useListContracts();
  const { data: candidates } = useListCandidates();
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({ candidateId: "", startDate: "", endDate: "", dailyRate: "" });

  const { mutate: createContract, isPending } = useCreateContract({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
        setIsOpen(false);
        setFormData({ candidateId: "", startDate: "", endDate: "", dailyRate: "" });
        toast({ title: "Contract created successfully" });
      },
      onError: () => toast({ title: "Error creating contract", variant: "destructive" })
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createContract({ 
      data: { 
        candidateId: Number(formData.candidateId),
        startDate: formData.startDate,
        endDate: formData.endDate || undefined,
        dailyRate: Number(formData.dailyRate)
      } 
    });
  };

  const hiredCandidates = candidates?.filter(c => c.status === 'hired') || [];

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Contracts</h1>
          <p className="text-slate-500 mt-1">Manage vendor contracts for hired candidates</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl shadow-md h-11 px-6">
              <Plus className="w-4 h-4 mr-2" />
              New Contract
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader><DialogTitle>Create Contract</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Hired Candidate</label>
                <Select required value={formData.candidateId} onValueChange={v => setFormData({...formData, candidateId: v})}>
                  <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Select candidate" /></SelectTrigger>
                  <SelectContent>
                    {hiredCandidates.map(c => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.firstName} {c.lastName} ({c.vendorCompanyName})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Start Date</label>
                  <Input type="date" required value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})} className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">End Date (Optional)</label>
                  <Input type="date" value={formData.endDate} onChange={e => setFormData({...formData, endDate: e.target.value})} className="h-11 rounded-xl" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Daily Rate ($)</label>
                <Input type="number" min="0" step="0.01" required value={formData.dailyRate} onChange={e => setFormData({...formData, dailyRate: e.target.value})} className="h-11 rounded-xl" />
              </div>
              <Button disabled={isPending} type="submit" className="w-full h-11 rounded-xl mt-6">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Contract"}
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
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Candidate / Role</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Daily Rate</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Duration</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : contracts?.length === 0 ? (
                <tr><td colSpan={5} className="p-12 text-center text-slate-500">No contracts found.</td></tr>
              ) : contracts?.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{c.candidateName}</div>
                      <div className="text-sm text-slate-500">{c.roleTitle}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-700">{c.vendorCompanyName}</td>
                    <td className="px-6 py-4 font-semibold text-primary">{formatCurrency(c.dailyRate)}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {format(new Date(c.startDate), 'MMM d, yyyy')} - {c.endDate ? format(new Date(c.endDate), 'MMM d, yyyy') : 'Ongoing'}
                    </td>
                    <td className="px-6 py-4"><StatusBadge status={c.isActive ? 'active' : 'inactive'} /></td>
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
