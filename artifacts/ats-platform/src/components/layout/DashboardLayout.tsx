import { Link, useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import {
  Building2, Users, Briefcase, UserCircle,
  FileText, Clock, LogOut, Loader2, LayoutDashboard,
  Menu, X, BarChart3, LockKeyhole
} from "lucide-react";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getCompanyDisplayName } from "@/lib/candidate-display";

const SIDEBAR_NAV = {
  admin: [
    { name: "Job Roles", href: "/admin/roles", icon: Briefcase },
    { name: "Companies", href: "/admin/companies", icon: Building2 },
    { name: "Users", href: "/admin/users", icon: Users },
    { name: "All Candidates", href: "/admin/candidates", icon: UserCircle },
    { name: "Contracts", href: "/admin/contracts", icon: FileText },
    { name: "Timesheets", href: "/admin/timesheets", icon: Clock },
    { name: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  ],
  client: [
    { name: "My Roles", href: "/client/roles", icon: Briefcase },
    { name: "All Candidates", href: "/client/candidates", icon: UserCircle },
    { name: "Timesheets", href: "/client/timesheets", icon: Clock },
  ],
  vendor: [
    { name: "Open Positions", href: "/vendor/positions", icon: LayoutDashboard },
    { name: "My Candidates", href: "/vendor/candidates", icon: UserCircle },
    { name: "Active Contracts", href: "/vendor/contracts", icon: FileText },
    { name: "Timesheets", href: "/vendor/timesheets", icon: Clock },
  ]
};

export function DashboardLayout({ children, allowedRoles }: { children: React.ReactNode, allowedRoles: string[] }) {
  const [location, setLocation] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { data: user, isLoading, error } = useGetMe();
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("ats_token") : null;
  const errorStatus = typeof error === "object" && error && "status" in error ? (error as { status?: number }).status : undefined;
  const isForbiddenForRole = Boolean(user && !allowedRoles.includes(user.role));
  const shouldRedirectToLogin = !isLoading && (!token || errorStatus === 401 || isForbiddenForRole);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  useEffect(() => {
    if (!shouldRedirectToLogin) return;
    localStorage.removeItem("ats_token");
    setLocation("/login");
  }, [setLocation, shouldRedirectToLogin]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && token && errorStatus !== 401 && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Workspace could not be loaded</h1>
          <p className="mt-2 text-sm text-slate-500">
            We could not refresh your session data. Please try again.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (shouldRedirectToLogin || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const navItems = SIDEBAR_NAV[user.role as keyof typeof SIDEBAR_NAV] || [];
  const accountLabel = getCompanyDisplayName(user.companyName, user.role === "admin" ? "Admin workspace" : null);

  const handleLogout = () => {
    localStorage.removeItem("ats_token");
    setIsMobileMenuOpen(false);
    setLocation("/login");
  };

  const SidebarContent = () => (
    <>
      <div className="p-5">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
            <Briefcase className="h-4 w-4" />
          </div>
          RecruitFlow
        </h1>
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-border/50 px-3 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 font-semibold text-primary-foreground">
            {user.name.charAt(0)}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-white truncate">{user.name}</p>
            <p className="text-xs text-sidebar-foreground/70 truncate">{accountLabel}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {navItems.map((item) => {
          const isActive = location.startsWith(item.href);
          return (
            <Link key={item.name} href={item.href} className="block">
              <div
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-sm shadow-black/10 ring-1 ring-white/10" 
                    : "text-sidebar-foreground hover:-translate-y-0.5 hover:bg-sidebar-border/50 hover:text-white hover:shadow-sm"
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <item.icon className={`w-5 h-5 ${isActive ? "text-white" : "text-sidebar-foreground/70"}`} />
                <span className="font-medium">{item.name}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <Link href="/change-password" className="block">
          <div className="mb-2 flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-foreground transition-all duration-150 hover:-translate-y-0.5 hover:bg-sidebar-border/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20">
            <LockKeyhole className="w-5 h-5 text-sidebar-foreground/70" />
            <span className="font-medium">Change Password</span>
          </div>
        </Link>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-red-400 transition-all duration-150 hover:-translate-y-0.5 hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Sign Out</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 z-20 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar shadow-xl md:flex">
        <SidebarContent />
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 inset-x-0 h-16 bg-sidebar border-b border-sidebar-border z-30 flex items-center justify-between px-4">
        <div className="flex items-center gap-2 text-white font-bold text-lg">
          <div className="w-6 h-6 bg-primary rounded flex items-center justify-center">
            <Briefcase className="w-3 h-3" />
          </div>
          RecruitFlow
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="rounded-xl p-2 text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          aria-label="Toggle navigation"
        >
          {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.3 }}
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar shadow-2xl md:hidden"
            >
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="mt-16 flex min-h-screen min-w-0 flex-1 flex-col md:ml-64 md:mt-0">
        <div className="flex-1 min-w-0 p-4 md:p-6 max-w-7xl mx-auto w-full">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="h-full min-w-0"
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
