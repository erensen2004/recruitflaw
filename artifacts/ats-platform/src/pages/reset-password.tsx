import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Briefcase, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type ResetMeta = {
  email: string;
  name: string;
  role: string;
  purpose: string;
  expiresAt: string;
};

export default function ResetPasswordPage() {
  const [location, setLocation] = useLocation();
  const [tokenInput, setTokenInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [meta, setMeta] = useState<ResetMeta | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const queryToken = new URLSearchParams(location.split("?")[1] ?? "").get("token");
  const token = useMemo(() => (queryToken ?? tokenInput.trim()).trim(), [queryToken, tokenInput]);

  useEffect(() => {
    if (!token) {
      setMeta(null);
      return;
    }

    let cancelled = false;
    setIsLoadingMeta(true);

    fetch(`/api/auth/password-reset/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.message || payload?.error || "This reset link is invalid or expired.");
        }
        return response.json();
      })
      .then((payload: ResetMeta) => {
        if (!cancelled) setMeta(payload);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setMeta(null);
          toast({
            title: "Reset link could not be loaded",
            description: error.message,
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMeta(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, toast]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      toast({ title: "Paste your reset token first", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/auth/password-reset/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Password could not be reset.");
      }

      localStorage.setItem("ats_token", payload.token);
      toast({ title: "Password updated", description: "You are now signed in." });
      setLocation(`/${payload.user.role}`);
    } catch (error) {
      toast({
        title: "Password reset failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/25">
            <Briefcase className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Reset your password</h1>
          <p className="mt-2 text-sm text-slate-500">Use the reset link from your email, then choose a new password.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!queryToken ? (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Reset token</label>
              <Input
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="Paste the token from your reset email"
                className="h-11 rounded-xl"
              />
            </div>
          ) : null}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {isLoadingMeta ? (
              <div className="flex items-center gap-2 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Validating reset link...
              </div>
            ) : meta ? (
              <>
                <p className="font-semibold text-slate-900">{meta.name}</p>
                <p>{meta.email}</p>
              </>
            ) : (
              <p>Paste a valid reset token to continue.</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">New password</label>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
              disabled={!meta || isSubmitting}
              className="h-11 rounded-xl"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Confirm password</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
              disabled={!meta || isSubmitting}
              className="h-11 rounded-xl"
            />
          </div>

          <Button type="submit" disabled={!meta || isSubmitting} className="h-11 w-full rounded-xl">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save new password"}
          </Button>

          <div className="text-center text-sm text-slate-500">
            <Link href="/login" className="font-medium text-primary hover:underline">
              Back to login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
