import { useListRoles } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Briefcase, ChevronRight, Loader2, MapPin } from "lucide-react";
import { Link, useLocation } from "wouter";
import { getRoleSummaryLines } from "@/lib/role-display";

export default function VendorPositions() {
  const { data: roles, isLoading } = useListRoles();
  const [, setLocation] = useLocation();
  const publishedRoles = roles?.filter((role) => role.status === "published") || [];

  return (
    <DashboardLayout allowedRoles={["vendor"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Open Positions</h1>
        <p className="text-slate-500 mt-1">Open a role to review the brief, then submit the candidate from the detail page.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Role</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Company</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Work setup</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Max salary</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center">
                    <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
                  </td>
                </tr>
              ) : publishedRoles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-500">
                    No open positions are available right now.
                  </td>
                </tr>
              ) : (
                publishedRoles.map((role) => {
                  const details = getRoleSummaryLines(role);
                  return (
                    <tr
                      key={role.id}
                      className="cursor-pointer transition-colors hover:bg-slate-50/70"
                      onClick={() => setLocation(`/vendor/positions/${role.id}`)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                            <Briefcase className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900">{role.title}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                              {role.location ? (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5" />
                                  {role.location}
                                </span>
                              ) : null}
                              <span>{details.employmentTypeLabel || "Employment type pending"}</span>
                            </div>
                            <div className="mt-2 text-sm text-slate-500 line-clamp-2 max-w-xl">
                              {details.descriptionBody || "The final hiring brief will be confirmed on the role detail screen."}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-700">{role.companyName}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{details.workModeLabel}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{details.salaryLabel || "Not specified"}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status="published" className="bg-green-100 text-green-800 border-green-200" />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/vendor/positions/${role.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex min-h-9 items-center justify-center gap-1 rounded-xl border border-primary bg-primary px-4 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          View
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
