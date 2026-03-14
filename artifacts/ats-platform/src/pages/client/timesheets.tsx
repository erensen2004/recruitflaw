import { useListTimesheets } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Clock, Loader2, CheckCircle2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function ClientTimesheets() {
  // Assuming listTimesheets filters by user company in backend
  const { data: timesheets, isLoading } = useListTimesheets();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  return (
    <DashboardLayout allowedRoles={["client"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Contractor Timesheets</h1>
        <p className="text-slate-500 mt-1">Review billed days for active contractors</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : timesheets?.length === 0 ? (
          <div className="col-span-full text-center p-12 bg-white rounded-2xl border border-slate-200 text-slate-500">
            No timesheets to review.
          </div>
        ) : (
          timesheets?.map(ts => (
            <div key={ts.id} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="flex items-center text-green-600 bg-green-50 px-2 py-1 rounded-md text-xs font-bold">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Logged
                </div>
              </div>
              <h3 className="text-lg font-bold text-slate-900">{ts.candidateName}</h3>
              <p className="text-sm text-slate-500">{ts.roleTitle}</p>
              
              <div className="mt-6 bg-slate-50 rounded-xl p-4 flex justify-between items-center">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{months[ts.month - 1]} {ts.year}</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">{ts.totalDays} Days</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Billed</p>
                  <p className="text-xl font-bold text-primary mt-1">{formatCurrency(ts.totalAmount)}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}
