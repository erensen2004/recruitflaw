import { useListRoles, useUpdateRoleStatus } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Briefcase, Loader2, CheckCircle, XCircle, Archive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListRolesQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";

export default function AdminRoles() {
  const { data: roles, isLoading } = useListRoles();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { mutate: updateStatus, isPending } = useUpdateRoleStatus({
    mutation: {
      onSuccess: (_, vars) => {
        queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
        const statusLabel = (vars.data as any).status;
        toast({ title: `Role ${statusLabel === 'published' ? 'approved' : statusLabel === 'closed' ? 'closed' : 'rejected'} successfully` });
      }
    }
  });

  return (
    <DashboardLayout allowedRoles={["admin"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Job Roles</h1>
        <p className="text-slate-500 mt-1">Review and approve pending roles</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Role Title</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Company</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Created</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : roles?.length === 0 ? (
                <tr><td colSpan={5} className="p-12 text-center text-slate-500">No roles found.</td></tr>
              ) : roles?.map(role => (
                  <tr key={role.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div className="font-semibold text-slate-900">{role.title}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 font-medium">{role.companyName}</td>
                    <td className="px-6 py-4"><StatusBadge status={role.status} /></td>
                    <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(role.createdAt), 'MMM d, yyyy')}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {role.status === 'pending_approval' && (
                          <>
                            <Button
                              size="sm"
                              disabled={isPending}
                              className="rounded-lg h-8 bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => updateStatus({ id: role.id, data: { status: 'published' }})}
                            >
                              <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isPending}
                              className="rounded-lg h-8 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => updateStatus({ id: role.id, data: { status: 'closed' }})}
                            >
                              <XCircle className="w-3.5 h-3.5 mr-1.5" />
                              Reject
                            </Button>
                          </>
                        )}
                        {role.status === 'published' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            className="rounded-lg h-8 border-slate-200 text-slate-600 hover:bg-slate-100"
                            onClick={() => updateStatus({ id: role.id, data: { status: 'closed' }})}
                          >
                            <Archive className="w-3.5 h-3.5 mr-1.5" />
                            Close
                          </Button>
                        )}
                        {(role.status === 'draft' || role.status === 'closed') && (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </div>
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
