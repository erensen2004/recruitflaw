import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";

import AdminCompanies from "@/pages/admin/companies";
import AdminUsers from "@/pages/admin/users";
import AdminRoles from "@/pages/admin/roles";
import AdminCandidates from "@/pages/admin/candidates";
import AdminContracts from "@/pages/admin/contracts";
import AdminTimesheets from "@/pages/admin/timesheets";
import AdminAnalytics from "@/pages/admin/analytics";

import ClientRoles from "@/pages/client/roles";
import ClientRoleCandidates from "@/pages/client/role-candidates";
import ClientCandidates from "@/pages/client/candidates";
import ClientCandidateDetail from "@/pages/client/candidate-detail";
import ClientTimesheets from "@/pages/client/timesheets";

import VendorPositions from "@/pages/vendor/positions";
import VendorSubmitCandidate from "@/pages/vendor/submit-candidate";
import VendorCandidates from "@/pages/vendor/candidates";
import VendorContracts from "@/pages/vendor/contracts";
import VendorTimesheets from "@/pages/vendor/timesheets";

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

      <Route path="/admin" component={() => <Redirect to="/admin/companies" />} />
      <Route path="/admin/companies" component={AdminCompanies} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/roles" component={AdminRoles} />
      <Route path="/admin/candidates" component={AdminCandidates} />
      <Route path="/admin/contracts" component={AdminContracts} />
      <Route path="/admin/timesheets" component={AdminTimesheets} />
      <Route path="/admin/analytics" component={AdminAnalytics} />

      <Route path="/client" component={() => <Redirect to="/client/roles" />} />
      <Route path="/client/roles" component={ClientRoles} />
      <Route path="/client/roles/:id/candidates" component={ClientRoleCandidates} />
      <Route path="/client/candidates" component={ClientCandidates} />
      <Route path="/client/candidates/:id" component={ClientCandidateDetail} />
      <Route path="/client/timesheets" component={ClientTimesheets} />

      <Route path="/vendor" component={() => <Redirect to="/vendor/positions" />} />
      <Route path="/vendor/positions" component={VendorPositions} />
      <Route path="/vendor/submit/:roleId" component={VendorSubmitCandidate} />
      <Route path="/vendor/candidates" component={VendorCandidates} />
      <Route path="/vendor/contracts" component={VendorContracts} />
      <Route path="/vendor/timesheets" component={VendorTimesheets} />

      <Route path="/" component={() => <Redirect to="/login" />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
