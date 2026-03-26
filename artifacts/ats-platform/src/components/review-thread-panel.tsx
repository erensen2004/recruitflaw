import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, Loader2, Send, ShieldCheck, CheckCircle2, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ReviewScopeType = "role" | "candidate";
type ReviewVisibility = "admin" | "client" | "vendor" | "shared";
type ReviewRole = "admin" | "client" | "vendor";
type ReviewThreadStatus = "open" | "resolved";

type ReviewMessage = {
  id: number;
  authorUserId: number;
  authorName: string;
  authorRole: string;
  authorCompanyId: number | null;
  message: string;
  createdAt: string;
};

type ReviewThread = {
  id: number;
  scopeType: ReviewScopeType;
  scopeId: number;
  status: ReviewThreadStatus;
  visibility: ReviewVisibility;
  createdByUserId: number;
  createdByName: string;
  createdByRole: string;
  createdByCompanyId: number | null;
  resolvedAt: string | null;
  resolvedByUserId: number | null;
  resolvedByName: string | null;
  resolvedByRole: string | null;
  scopeLabel: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messages?: ReviewMessage[];
};

function getVisibilityOptions(role: ReviewRole) {
  if (role === "admin") {
    return [
      { value: "shared", label: "Shared across teams" },
      { value: "admin", label: "Admin only" },
      { value: "client", label: "Client-facing" },
      { value: "vendor", label: "Vendor-facing" },
    ] satisfies Array<{ value: ReviewVisibility; label: string }>;
  }

  if (role === "client") {
    return [
      { value: "shared", label: "Shared with vendor + admin" },
      { value: "client", label: "Client + admin only" },
    ] satisfies Array<{ value: ReviewVisibility; label: string }>;
  }

  return [
    { value: "shared", label: "Shared with client + admin" },
    { value: "vendor", label: "Vendor + admin only" },
  ] satisfies Array<{ value: ReviewVisibility; label: string }>;
}

function visibilityTone(visibility: ReviewVisibility) {
  switch (visibility) {
    case "admin":
      return "bg-slate-100 text-slate-700";
    case "client":
      return "bg-sky-100 text-sky-700";
    case "vendor":
      return "bg-fuchsia-100 text-fuchsia-700";
    default:
      return "bg-emerald-100 text-emerald-700";
  }
}

function getVisibilityLabel(visibility: ReviewVisibility, scopeType: ReviewScopeType) {
  switch (visibility) {
    case "admin":
      return "Admin only";
    case "client":
      return scopeType === "candidate" ? "Client + admin" : "Client-facing";
    case "vendor":
      return scopeType === "candidate" ? "Vendor + admin" : "Vendor-facing";
    default:
      return "Shared";
  }
}

function statusTone(status: ReviewThreadStatus) {
  return status === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700";
}

function statusLabel(status: ReviewThreadStatus) {
  return status === "resolved" ? "Resolved" : "Open";
}

export function ReviewThreadPanel({
  scopeType,
  scopeId,
  actorRole,
  title = "Review threads",
  description,
}: {
  scopeType: ReviewScopeType;
  scopeId: number;
  actorRole: ReviewRole;
  title?: string;
  description?: string;
}) {
  const { toast } = useToast();
  const [threads, setThreads] = useState<ReviewThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [updatingThreadId, setUpdatingThreadId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const options = useMemo(() => getVisibilityOptions(actorRole), [actorRole]);
  const [visibility, setVisibility] = useState<ReviewVisibility>(options[0].value);
  const orderedThreads = useMemo(
    () =>
      [...threads].sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "open" ? -1 : 1;
        }
        return new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime();
      }),
    [threads],
  );

  useEffect(() => {
    setVisibility(options[0].value);
  }, [options]);

  useEffect(() => {
    let ignore = false;

    async function loadThreads() {
      setLoading(true);
      try {
        const token = localStorage.getItem("ats_token");
        const params = new URLSearchParams({
          scopeType,
          scopeId: String(scopeId),
        });
        const response = await fetch(`/api/review-threads?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Review threads could not be loaded.");
        }

        const payload = await response.json();
        if (!ignore) {
          setThreads(payload.items ?? []);
        }
      } catch (error) {
        if (!ignore) {
          toast({
            title: "Review threads unavailable",
            description: error instanceof Error ? error.message : "Please try again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void loadThreads();
    return () => {
      ignore = true;
    };
  }, [scopeId, scopeType, toast]);

  const submitThread = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    setSubmitting(true);
    try {
      const token = localStorage.getItem("ats_token");
      const response = await fetch("/api/review-threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          scopeType,
          scopeId,
          visibility,
          message: trimmedMessage,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Review thread could not be saved.");
      }

      const thread = await response.json();
      setThreads((current) => {
        const next = current.filter((item) => item.id !== thread.id);
        return [thread, ...next];
      });
      setMessage("");
      toast({ title: "Review thread updated" });
    } catch (error) {
      toast({
        title: "Review thread failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const updateThreadStatus = async (threadId: number, nextStatus: ReviewThreadStatus) => {
    if (updatingThreadId != null) return;

    setUpdatingThreadId(threadId);
    try {
      const token = localStorage.getItem("ats_token");
      const response = await fetch(`/api/review-threads/${threadId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Review thread status could not be updated.");
      }

      const thread = await response.json();
      setThreads((current) => {
        const next = current.filter((item) => item.id !== thread.id);
        return [thread, ...next];
      });
      toast({ title: nextStatus === "resolved" ? "Thread resolved" : "Thread reopened" });
    } catch (error) {
      toast({
        title: "Review thread update failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingThreadId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-lg shadow-black/5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <MessageSquare className="h-5 w-5 text-primary" /> {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            {description || "Keep role- or candidate-specific questions, clarifications, and review feedback in one scoped thread."}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          <ShieldCheck className="h-3.5 w-3.5" />
          Scoped to this {scopeType}
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[180px,1fr,auto]">
        <Select value={visibility} onValueChange={(value) => setVisibility(value as ReviewVisibility)}>
          <SelectTrigger className="h-11 rounded-xl">
            <SelectValue placeholder="Visibility" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={scopeType === "role" ? "Add a scoped role clarification or review note..." : "Add a scoped candidate follow-up, review note, or approval comment..."}
          rows={3}
          className="resize-none rounded-xl"
        />
        <Button type="button" className="h-11 rounded-xl gap-2" disabled={submitting || !message.trim()} onClick={submitThread}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </Button>
      </div>

      <div className="mt-6 space-y-3">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : orderedThreads.length ? (
          orderedThreads.map((thread) => (
            <div key={thread.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(thread.status)}`}>
                  {statusLabel(thread.status)}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${visibilityTone(thread.visibility)}`}>
                  {getVisibilityLabel(thread.visibility, scopeType)}
                </span>
                <span className="text-xs text-slate-400">
                  Updated {new Date(thread.lastMessageAt).toLocaleString()}
                </span>
                {thread.status === "resolved" && thread.resolvedByName ? (
                  <span className="text-xs text-slate-400">
                    Resolved by {thread.resolvedByName}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="ml-auto h-8 rounded-full px-3 text-xs"
                  disabled={updatingThreadId === thread.id}
                  onClick={() => updateThreadStatus(thread.id, thread.status === "resolved" ? "open" : "resolved")}
                >
                  {updatingThreadId === thread.id ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : thread.status === "resolved" ? (
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  ) : (
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  )}
                  {thread.status === "resolved" ? "Reopen" : "Resolve"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Replying below will reopen the thread if it was resolved.
              </p>
              <div className="mt-3 space-y-3">
                {(thread.messages ?? []).map((threadMessage) => (
                  <div key={threadMessage.id} className="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{threadMessage.authorName}</p>
                      <p className="text-xs text-slate-400">{new Date(threadMessage.createdAt).toLocaleString()}</p>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{threadMessage.message}</p>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            No scoped review threads yet. Start the first clarification here so the decision trail stays attached to this {scopeType}.
          </div>
        )}
      </div>
    </div>
  );
}
