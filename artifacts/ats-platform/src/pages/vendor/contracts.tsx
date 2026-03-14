import { useListContracts } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";

export default function VendorContracts() {
  const { data: contracts, isLoading } = useListContracts();

  return (
    <DashboardLayout allowedRoles={["vendor"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Active Contracts</h1>
        <p className="text-slate-500 mt-1">Manage billing rates and durations for your hired candidates</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Candidate / Role</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Daily Rate</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Start Date</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">End Date</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : contracts?.length === 0 ? (
                <tr><td colSpan={5} className="p-12 text-center text-slate-500">No active contracts found.</td></tr>
              ) : contracts?.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{c.candidateName}</div>
                      <div className="text-sm text-slate-500">{c.roleTitle}</div>
                    </td>
                    <td className="px-6 py-4 font-bold text-green-600">{formatCurrency(c.dailyRate)}</td>
                    <td className="px-6 py-4 text-slate-700">{format(new Date(c.startDate), 'MMM d, yyyy')}</td>
                    <td className="px-6 py-4 text-slate-700">{c.endDate ? format(new Date(c.endDate), 'MMM d, yyyy') : 'Ongoing'}</td>
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
