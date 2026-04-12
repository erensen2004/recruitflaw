import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { Briefcase, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Briefcase className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-2 text-sm text-slate-500">Use your approved company account.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">Email address</label>
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
            <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
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
            className="w-full h-12 rounded-xl text-base font-semibold bg-primary hover:bg-primary/90 shadow-sm transition-all active:scale-[0.98]"
          >
            {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign In"}
          </Button>
        </form>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          <p className="text-slate-700">Accounts are created by admins.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/forgot-password" className="inline-flex min-h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-primary hover:text-primary">
              Forgot password
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
