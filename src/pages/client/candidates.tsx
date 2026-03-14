import { useState } from "react";
import { useListCandidates } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Tag, FileText, Eye } from "lucide-react";
import { Link } from "wouter";

export default function ClientCandidates() {
  const { data: candidates, isLoading } = useListCandidates();
  const [search, setSearch] = useState("");

  const filtered = candidates?.filter(c => {
    const q = search.toLowerCase();
    return (
      !q ||
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.roleTitle.toLowerCase().includes(q) ||
      (c.tags && c.tags.toLowerCase().includes(q))
    );
  });

  return (
    <DashboardLayout allowedRoles={["client"]}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">All Candidates</h1>
        <p className="text-slate-500 mt-1">Review and manage all submitted candidates</p>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, role, or tags..."
          className="pl-11 h-11 rounded-xl"
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : !filtered?.length ? (
          <div className="text-center text-slate-400 p-12">No candidates found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {["Candidate", "Role", "Vendor", "Tags", "Status", "CV", ""].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(c => {
                const tags = c.tags ? c.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
                return (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">{c.firstName} {c.lastName}</p>
                      <p className="text-slate-400 text-xs mt-0.5">{c.email}</p>
                    </td>
                    <td className="px-5 py-4 text-slate-700">{c.roleTitle}</td>
                    <td className="px-5 py-4 text-slate-500">{c.vendorCompanyName}</td>
                    <td className="px-5 py-4">
                      {tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {tags.slice(0, 3).map((tag, i) => (
                            <span key={i} className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">{tag}</span>
                          ))}
                          {tags.length > 3 && (
                            <span className="text-xs text-slate-400">+{tags.length - 3}</span>
                          )}
                        </div>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-4"><StatusBadge status={c.status} /></td>
                    <td className="px-5 py-4">
                      {c.cvUrl ? (
                        <a href={`/api/storage/objects/${c.cvUrl}`} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                          <FileText className="w-3.5 h-3.5" /> View
                        </a>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/client/candidates/${c.id}`}>
                        <Button variant="ghost" size="sm" className="rounded-lg gap-1">
                          <Eye className="w-3.5 h-3.5" /> Details
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </DashboardLayout>
  );
}
