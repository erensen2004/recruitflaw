import { useState, useEffect, useRef } from "react";
import { useGetCandidate, useUpdateCandidateStatus } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ArrowLeft, FileText, Tag, MessageSquare, Send, Download } from "lucide-react";
import { useRoute, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetCandidateQueryKey } from "@workspace/api-client-react";

const STATUSES = ["submitted", "screening", "interview", "offer", "hired", "rejected"] as const;
const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted", screening: "Screening", interview: "Interview",
  offer: "Offer", hired: "Hired", rejected: "Rejected",
};

interface Note { id: number; authorName: string; content: string; createdAt: string; }

function exportCandidatePDF(candidate: any) {
  import("jspdf").then(({ default: jsPDF }) => {
    const doc = new jsPDF();
    const lineH = 10;
    let y = 20;

    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text(`${candidate.firstName} ${candidate.lastName}`, 20, y);
    y += lineH * 1.5;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");

    const lines: [string, string][] = [
      ["Email:", candidate.email],
      ["Phone:", candidate.phone || "—"],
      ["Role:", candidate.roleTitle],
      ["Company:", candidate.vendorCompanyName],
      ["Status:", STATUS_LABELS[candidate.status] || candidate.status],
      ["Expected Salary:", candidate.expectedSalary ? `$${candidate.expectedSalary.toLocaleString()}` : "—"],
      ["Submitted:", new Date(candidate.submittedAt).toLocaleDateString()],
    ];

    for (const [label, value] of lines) {
      doc.setFont("helvetica", "bold");
      doc.text(label, 20, y);
      doc.setFont("helvetica", "normal");
      doc.text(value, 60, y);
      y += lineH;
    }

    if (candidate.tags) {
      y += 5;
      doc.setFont("helvetica", "bold");
      doc.text("Tags / Skills:", 20, y);
      y += lineH;
      doc.setFont("helvetica", "normal");
      doc.text(candidate.tags, 20, y, { maxWidth: 170 });
    }

    doc.save(`${candidate.firstName}_${candidate.lastName}_profile.pdf`);
  });
}

export default function ClientCandidateDetail() {
  const [, params] = useRoute("/client/candidates/:id");
  const candidateId = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: candidate, isLoading } = useGetCandidate(candidateId);
  const { mutate: updateStatus, isPending: updatingStatus } = useUpdateCandidateStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCandidateQueryKey(candidateId) });
        toast({ title: "Status updated" });
      }
    }
  });

  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const fetchNotes = async () => {
    try {
      const token = localStorage.getItem("ats_token");
      const res = await fetch(`/api/candidates/${candidateId}/notes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setNotes(await res.json());
    } finally {
      setLoadingNotes(false);
    }
  };

  useEffect(() => { if (candidateId) fetchNotes(); }, [candidateId]);

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      const token = localStorage.getItem("ats_token");
      const res = await fetch(`/api/candidates/${candidateId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: noteText }),
      });
      if (res.ok) {
        setNoteText("");
        await fetchNotes();
      }
    } finally {
      setAddingNote(false);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout allowedRoles={["client"]}>
        <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      </DashboardLayout>
    );
  }

  if (!candidate) {
    return (
      <DashboardLayout allowedRoles={["client"]}>
        <div className="text-center text-slate-500 p-12">Candidate not found.</div>
      </DashboardLayout>
    );
  }

  const tags = candidate.tags ? candidate.tags.split(",").map(t => t.trim()).filter(Boolean) : [];

  return (
    <DashboardLayout allowedRoles={["client"]}>
      <div className="max-w-3xl mx-auto">
        <Link href="/client/candidates" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-primary transition-colors mb-6">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Candidates
        </Link>

        <div className="bg-white rounded-2xl p-8 shadow-lg shadow-black/5 border border-slate-100 mb-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{candidate.firstName} {candidate.lastName}</h1>
              <p className="text-slate-500 mt-1">{candidate.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={candidate.status} />
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl gap-2"
                onClick={() => exportCandidatePDF(candidate)}
              >
                <Download className="w-4 h-4" /> Export PDF
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            {[
              { label: "Role", value: candidate.roleTitle },
              { label: "Vendor", value: candidate.vendorCompanyName },
              { label: "Phone", value: candidate.phone || "—" },
              { label: "Expected Salary", value: candidate.expectedSalary ? `$${candidate.expectedSalary.toLocaleString()}` : "—" },
              { label: "Submitted", value: new Date(candidate.submittedAt).toLocaleDateString() },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 font-medium mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-slate-800">{value}</p>
              </div>
            ))}
            {candidate.cvUrl && (
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 font-medium mb-0.5">CV</p>
                <a href={`/api/storage/objects/${candidate.cvUrl}`} target="_blank" rel="noreferrer"
                   className="text-sm font-semibold text-primary hover:underline flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" /> View CV
                </a>
              </div>
            )}
          </div>

          {tags.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 font-medium mb-2 flex items-center gap-1"><Tag className="w-3.5 h-3.5" />Tags</p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag, i) => (
                  <span key={i} className="bg-primary/10 text-primary text-xs font-medium px-3 py-1 rounded-full">{tag}</span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-slate-100">
            <p className="text-sm font-semibold text-slate-700 mb-3">Update Status</p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map(s => (
                <button
                  key={s}
                  disabled={updatingStatus || candidate.status === s}
                  onClick={() => updateStatus({ id: candidateId, data: { status: s } })}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                    candidate.status === s
                      ? "bg-primary text-white border-primary"
                      : "border-slate-200 text-slate-600 hover:border-primary hover:text-primary"
                  }`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-lg shadow-black/5 border border-slate-100">
          <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" /> Notes & Activity
          </h2>

          <div className="flex gap-3 mb-6">
            <Textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Add a note about this candidate..."
              rows={2}
              className="rounded-xl resize-none flex-1"
              onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) handleAddNote(); }}
            />
            <Button
              onClick={handleAddNote}
              disabled={addingNote || !noteText.trim()}
              className="rounded-xl self-end"
            >
              {addingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>

          {loadingNotes ? (
            <div className="flex justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : notes.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">No notes yet. Add the first one.</p>
          ) : (
            <div className="space-y-4">
              {notes.map(note => (
                <div key={note.id} className="bg-slate-50 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-semibold text-slate-800">{note.authorName}</span>
                    <span className="text-xs text-slate-400">
                      {new Date(note.createdAt).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
