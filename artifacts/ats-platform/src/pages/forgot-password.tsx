import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { Briefcase, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Password reset request failed.");
      }

      toast({
        title: "Check your email",
        description: payload?.message || "If the account exists, a reset link has been sent.",
      });
    } catch (error) {
      toast({
        title: "Could not request reset",
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
          <h1 className="text-2xl font-bold text-slate-900">Forgot password</h1>
          <p className="mt-2 text-sm text-slate-500">Enter your RecruitFlow email and we will send a reset link if the account exists.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Email address</label>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="h-11 rounded-xl"
            />
          </div>

          <Button type="submit" disabled={isSubmitting} className="h-11 w-full rounded-xl">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link"}
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
