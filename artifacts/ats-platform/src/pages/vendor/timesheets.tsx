import { useState } from "react";
import { useListTimesheets, useListContracts, useSubmitTimesheet } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Clock } from "lucide-react";
import { motion } from "framer-motion";

export default function VendorTimesheets() {
  const { data: timesheets, isLoading, refetch } = useListTimesheets();
  const { data: contracts } = useListContracts();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contractId: "", month: "", year: "", totalDays: "" });
  const { toast } = useToast();

  const { mutate: submit, isPending } = useSubmitTimesheet({
    mutation: {
      onSuccess: () => {
        toast({ title: "Timesheet submitted successfully" });
        setOpen(false);
        setForm({ contractId: "", month: "", year: "", totalDays: "" });
        refetch();
      },
      onError: () => {
        toast({ title: "Failed to submit timesheet", variant: "destructive" });
      }
    }
  });

  const activeContracts = contracts?.filter(c => c.isActive) || [];

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  return (
    <DashboardLayout allowedRoles={["vendor"]}>
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Timesheets</h1>
          <p className="text-slate-500 mt-1">Track and submit monthly working days</p>
        </div>
        <Button onClick={() => setOpen(true)} className="rounded-xl shadow-sm">
          <Plus className="w-4 h-4 mr-2" /> Submit Timesheet
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (timesheets || []).length === 0 ? (
        <div className="text-center p-12 bg-white rounded-2xl border border-slate-200 text-slate-500">
          <Clock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="font-medium">No timesheets yet</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {(timesheets || []).map((ts, i) => (
            <motion.div
              key={ts.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex items-center justify-between"
            >
              <div>
                <p className="font-semibold text-slate-900">{ts.candidateName}</p>
                <p className="text-sm text-slate-500">{ts.roleTitle}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {monthNames[ts.month - 1]} {ts.year} • {ts.totalDays} days
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-slate-900">
                  ${ts.totalAmount.toLocaleString()}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {new Date(ts.submittedAt).toLocaleDateString()}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Submit Timesheet</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            submit({
              data: {
                contractId: Number(form.contractId),
                month: Number(form.month),
                year: Number(form.year),
                totalDays: Number(form.totalDays),
              }
            });
          }} className="space-y-4 mt-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Contract</label>
              <Select value={form.contractId} onValueChange={(v) => setForm(f => ({ ...f, contractId: v }))}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select contract" />
                </SelectTrigger>
                <SelectContent>
                  {activeContracts.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.candidateName} - {c.roleTitle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Month</label>
                <Select value={form.month} onValueChange={(v) => setForm(f => ({ ...f, month: v }))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {monthNames.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Year</label>
                <Input
                  type="number"
                  min="2020"
                  max="2030"
                  value={form.year}
                  onChange={(e) => setForm(f => ({ ...f, year: e.target.value }))}
                  placeholder="2026"
                  className="rounded-xl"
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Total Working Days</label>
              <Input
                type="number"
                min="1"
                max="31"
                value={form.totalDays}
                onChange={(e) => setForm(f => ({ ...f, totalDays: e.target.value }))}
                placeholder="22"
                className="rounded-xl"
                required
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="flex-1 rounded-xl">Cancel</Button>
              <Button type="submit" disabled={isPending} className="flex-1 rounded-xl">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
