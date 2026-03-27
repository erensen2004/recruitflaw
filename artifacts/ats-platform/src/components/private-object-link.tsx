import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn, openPrivateObject } from "@/lib/utils";

type PrivateObjectLinkProps = {
  objectPath?: string | null;
  className?: string;
  children: ReactNode;
  loadingLabel?: string;
  disabled?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children" | "disabled">;

export function PrivateObjectLink({
  objectPath,
  className,
  children,
  loadingLabel = "Opening CV…",
  disabled = false,
  onClick,
  ...buttonProps
}: PrivateObjectLinkProps) {
  const { toast } = useToast();
  const [opening, setOpening] = useState(false);

  return (
    <button
      {...buttonProps}
      type="button"
      disabled={disabled || !objectPath || opening}
      className={cn(className, (!objectPath || disabled || opening) && "pointer-events-none opacity-60")}
      onClick={async (event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (!objectPath || opening) return;
        setOpening(true);
        try {
          await openPrivateObject(objectPath);
        } catch (error) {
          toast({
            title: "CV could not be opened",
            description: error instanceof Error ? error.message : "Please try again.",
            variant: "destructive",
          });
        } finally {
          setOpening(false);
        }
      }}
    >
      {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}
