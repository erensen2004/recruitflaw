import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const getBadgeStyle = (s: string) => {
    switch (s.toLowerCase()) {
      // Role Statuses
      case "draft":
        return "bg-gray-100 text-gray-700 border-gray-200";
      case "pending_approval":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "published":
        return "bg-green-100 text-green-800 border-green-200";
      case "closed":
        return "bg-red-100 text-red-800 border-red-200";
        
      // Candidate Statuses
      case "submitted":
        return "bg-slate-100 text-slate-700 border-slate-200";
      case "screening":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "interview":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "offer":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "hired":
        return "bg-green-100 text-green-800 border-green-200";
      case "rejected":
        return "bg-red-100 text-red-800 border-red-200";
        
      // User Roles & Company Types
      case "admin":
        return "bg-indigo-100 text-indigo-800 border-indigo-200";
      case "client":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "vendor":
        return "bg-orange-100 text-orange-800 border-orange-200";
        
      // Boolean/Active states
      case "active":
      case "true":
        return "bg-green-100 text-green-800 border-green-200";
      case "inactive":
      case "false":
        return "bg-gray-100 text-gray-600 border-gray-200";

      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const formatText = (s: string) => {
    return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <span
      className={cn(
        "px-2.5 py-0.5 rounded-full text-xs font-medium border inline-flex items-center",
        getBadgeStyle(status),
        className
      )}
    >
      {formatText(status)}
    </span>
  );
}
