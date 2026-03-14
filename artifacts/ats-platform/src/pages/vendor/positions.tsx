import { useListRoles } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Briefcase, Loader2, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export default function VendorPositions() {
  const { data: roles, isLoading } = useListRoles();
  
  // Vendors only see published roles
  const publishedRoles = roles?.filter(r => r.status === 'published') || [];

  return (
    <DashboardLayout allowedRoles={["vendor"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Open Positions</h1>
        <p className="text-slate-500 mt-1">Available roles to submit candidates</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isLoading ? (
           <div className="col-span-full flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : publishedRoles.length === 0 ? (
          <div className="col-span-full text-center p-12 bg-white rounded-2xl border border-slate-200 text-slate-500">
            No open positions available at the moment.
          </div>
        ) : publishedRoles.map(role => (
          <div key={role.id} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-lg transition-all flex flex-col group">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600">
                <Briefcase className="w-6 h-6" />
              </div>
              <StatusBadge status="Actively Hiring" className="bg-green-100 text-green-800 border-green-200" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">{role.title}</h3>
            <p className="font-medium text-primary mt-1 mb-3">{role.companyName}</p>
            <p className="text-sm text-slate-500 line-clamp-2 mb-6 flex-1">{role.description}</p>
            
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between mt-auto">
               <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                Required: {role.skills || 'Not specified'}
               </span>
              <Link href={`/vendor/submit/${role.id}`}>
                <Button className="rounded-lg shadow-sm group-hover:bg-primary/90 transition-colors">
                  Submit Candidate <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
}
