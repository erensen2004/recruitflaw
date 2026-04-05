import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

const NotFound = lazy(() => import("@/pages/not-found"));
const Login = lazy(() => import("@/pages/login"));
const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
const SetPassword = lazy(() => import("@/pages/set-password"));
const ResetPassword = lazy(() => import("@/pages/reset-password"));
const ChangePassword = lazy(() => import("@/pages/change-password"));

const AdminCompanies = lazy(() => import("@/pages/admin/companies"));
const AdminUsers = lazy(() => import("@/pages/admin/users"));
const AdminRoles = lazy(() => import("@/pages/admin/roles"));
const AdminCandidates = lazy(() => import("@/pages/admin/candidates"));
const AdminContracts = lazy(() => import("@/pages/admin/contracts"));
const AdminTimesheets = lazy(() => import("@/pages/admin/timesheets"));
const AdminAnalytics = lazy(() => import("@/pages/admin/analytics"));
const Interviews = lazy(() => import("@/pages/interviews"));

const ClientRoles = lazy(() => import("@/pages/client/roles"));
const ClientRoleCandidates = lazy(() => import("./pages/client/role-candidates"));
const ClientCandidates = lazy(() => import("@/pages/client/candidates"));
const ClientCandidateDetail = lazy(() => import("@/pages/client/candidate-detail"));
const ClientCandidateCompare = lazy(() => import("@/pages/client/candidate-compare"));
const ClientTimesheets = lazy(() => import("@/pages/client/timesheets"));

const VendorPositions = lazy(() => import("@/pages/vendor/positions"));
const VendorSubmitCandidate = lazy(() => import("@/pages/vendor/submit-candidate"));
const VendorCandidates = lazy(() => import("@/pages/vendor/candidates"));
const VendorCandidateDetail = lazy(() => import("@/pages/vendor/candidate-detail"));
const VendorContracts = lazy(() => import("@/pages/vendor/contracts"));
const VendorTimesheets = lazy(() => import("@/pages/vendor/timesheets"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/set-password" component={SetPassword} />
      <Route path="/setup-password" component={SetPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/change-password" component={ChangePassword} />

      <Route path="/admin" component={() => <Redirect to="/admin/roles" />} />
      <Route path="/admin/companies" component={AdminCompanies} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/roles" component={AdminRoles} />
      <Route path="/admin/roles/:id/candidates" component={ClientRoleCandidates} />
      <Route path="/admin/candidates" component={AdminCandidates} />
      <Route path="/admin/candidates/:id" component={ClientCandidateDetail} />
      <Route path="/admin/compare" component={ClientCandidateCompare} />
      <Route path="/admin/contracts" component={AdminContracts} />
      <Route path="/admin/timesheets" component={AdminTimesheets} />
      <Route path="/admin/analytics" component={AdminAnalytics} />
      <Route path="/admin/interviews" component={Interviews} />

      <Route path="/client" component={() => <Redirect to="/client/roles" />} />
      <Route path="/client/roles" component={ClientRoles} />
      <Route path="/client/roles/:id/candidates" component={ClientRoleCandidates} />
      <Route path="/client/candidates" component={ClientCandidates} />
      <Route path="/client/candidates/:id" component={ClientCandidateDetail} />
      <Route path="/client/compare" component={ClientCandidateCompare} />
      <Route path="/client/timesheets" component={ClientTimesheets} />
      <Route path="/client/interviews" component={Interviews} />

      <Route path="/vendor" component={() => <Redirect to="/vendor/positions" />} />
      <Route path="/vendor/positions" component={VendorPositions} />
      <Route path="/vendor/positions/:roleId" component={VendorSubmitCandidate} />
      <Route path="/vendor/submit/:roleId" component={VendorSubmitCandidate} />
      <Route path="/vendor/candidates" component={VendorCandidates} />
      <Route path="/vendor/candidates/:id" component={VendorCandidateDetail} />
      <Route path="/vendor/contracts" component={VendorContracts} />
      <Route path="/vendor/timesheets" component={VendorTimesheets} />
      <Route path="/vendor/interviews" component={Interviews} />

      <Route path="/" component={() => <Redirect to="/login" />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center">
      <div className="space-y-2">
        <p className="text-lg font-semibold text-slate-900">Loading workspace</p>
        <p className="text-sm text-slate-500">Preparing the next screen...</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Suspense fallback={<RouteFallback />}>
            <Router />
          </Suspense>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
