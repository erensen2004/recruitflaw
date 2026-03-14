import { useListTimesheets } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Clock, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";

export default function AdminTimesheets() {
  const { data: timesheets, isLoading } = useListTimesheets();

  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Timesheets</h1>
        <p className="text-slate-500 mt-1">All submitted vendor timesheets</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {isLoading ? (
          <div className="col-span-full flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : timesheets?.length === 0 ? (
          <div className="col-span-full text-center p-12 bg-white rounded-2xl border border-slate-200 text-slate-500">
            No timesheets submitted yet.
          </div>
        ) : (
          timesheets?.map(ts => (
            <div key={ts.id} className="bg-white rounded-2xl p-6 shadow-lg shadow-black/5 border border-slate-100 hover:shadow-xl transition-all">
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-slate-900">{months[ts.month - 1]} {ts.year}</div>
                  <div className="text-xs text-slate-500">{ts.totalDays} Days</div>
                </div>
              </div>
              <h3 className="text-lg font-bold text-slate-900">{ts.candidateName}</h3>
              <p className="text-sm text-slate-500 mb-4">{ts.roleTitle}</p>
              
              <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                <span className="text-sm text-slate-500">Total Amount</span>
                <span className="text-xl font-bold text-primary">{formatCurrency(ts.totalAmount)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}
