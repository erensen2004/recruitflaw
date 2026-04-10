import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { Briefcase, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";

function getFriendlyLoginError(error: unknown) {
  if (error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 401) {
    return "Invalid email or password";
  }

  if (error instanceof Error) {
    if (/invalid email or password/i.test(error.message)) {
      return "Invalid email or password";
    }

    return error.message.replace(/^HTTP\s+\d+\s+[A-Z ]+:\s*/i, "").trim() || "Could not sign you in";
  }

  return "Could not sign you in";
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { mutate: login, isPending } = useLogin({
    mutation: {
      onSuccess: (data) => {
        setErrorMessage(null);
        localStorage.setItem("ats_token", data.token);
        queryClient.setQueryData(getGetMeQueryKey(), {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          companyId: data.user.companyId ?? null,
          companyName: data.user.companyName ?? null,
        });
        setLocation(`/${data.user.role}`);
      },
      onError: (error: unknown) => {
        setErrorMessage(getFriendlyLoginError(error));
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    setErrorMessage(null);
    login({ data: { email: email.trim().toLowerCase(), password } });
  };

  const handleEnterSubmit = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || isPending) return;
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-gradient-to-b from-primary/10 to-transparent pointer-events-none" />
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-40 -left-40 w-96 h-96 bg-accent/20 rounded-full blur-[100px] pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-black/5 border border-slate-100 p-8 relative z-10"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/25">
            <Briefcase className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome to RecruitFlow</h1>
          <p className="text-slate-500 mt-2">Sign in with your approved company account.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-semibold text-slate-700">Email Address</label>
            <Input 
              id="email"
              type="email" 
              required 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleEnterSubmit}
              placeholder="name@company.com"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              disabled={isPending}
              className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-colors"
            />
          </div>
          
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-semibold text-slate-700">Password</label>
            <Input 
              id="password"
              type="password" 
              required 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleEnterSubmit}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={isPending}
              className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-colors"
            />
          </div>

          {errorMessage ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          <Button 
            type="submit" 
            disabled={isPending}
            className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-md hover:shadow-lg transition-all active:scale-[0.98]"
          >
            {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign In"}
          </Button>
        </form>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          <p className="font-medium text-slate-700">Admin-created access</p>
          <p className="mt-1">Accounts are opened by the admin team. Use your temporary password or reset it from the link below.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/forgot-password" className="inline-flex min-h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-primary hover:text-primary">
              Forgot password
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
