import { Link, useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { 
  Building2, Users, Briefcase, UserCircle, 
  FileText, Clock, LogOut, Loader2, LayoutDashboard,
  Menu, X, BarChart3
} from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SIDEBAR_NAV = {
  admin: [
    { name: "Companies", href: "/admin/companies", icon: Building2 },
    { name: "Users", href: "/admin/users", icon: Users },
    { name: "Job Roles", href: "/admin/roles", icon: Briefcase },
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !user || !allowedRoles.includes(user.role)) {
    setLocation("/login");
    return null;
  }

  const navItems = SIDEBAR_NAV[user.role as keyof typeof SIDEBAR_NAV] || [];

  const handleLogout = () => {
    localStorage.removeItem("ats_token");
    setLocation("/login");
  };

  const SidebarContent = () => (
    <>
      <div className="p-6">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white">
            <Briefcase className="w-5 h-5" />
          </div>
          RecruitFlow
        </h1>
        <div className="mt-6 flex items-center gap-3 px-3 py-2 bg-sidebar-border/50 rounded-xl border border-sidebar-border">
          <div className="w-10 h-10 rounded-full bg-primary/20 text-primary-foreground flex items-center justify-center font-semibold">
            {user.name.charAt(0)}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-white truncate">{user.name}</p>
            <p className="text-xs text-sidebar-foreground/70 truncate">{user.role}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.startsWith(item.href);
          return (
            <Link key={item.name} href={item.href} className="block">
              <div
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-sm shadow-black/10" 
                    : "text-sidebar-foreground hover:bg-sidebar-border/50 hover:text-white"
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
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-red-400 hover:bg-red-400/10 transition-colors"
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
      <aside className="hidden md:flex w-72 flex-col bg-sidebar border-r border-sidebar-border fixed inset-y-0 z-20 shadow-xl">
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
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-white p-2">
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
              className="fixed inset-y-0 left-0 w-72 bg-sidebar border-r border-sidebar-border z-50 flex flex-col shadow-2xl md:hidden"
            >
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 md:ml-72 min-h-screen flex flex-col mt-16 md:mt-0">
        <div className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="h-full"
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
