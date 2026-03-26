import { useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

type ResumeDropzoneRenderArgs = {
  isDragging: boolean;
  openPicker: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

type ResumeDropzoneProps = {
  accept: string;
  disabled?: boolean;
  className?: string;
  onFileSelected: (file: File | null) => void | Promise<void>;
  children: (args: ResumeDropzoneRenderArgs) => ReactNode;
};

export function ResumeDropzone({
  accept,
  disabled = false,
  className,
  onFileSelected,
  children,
}: ResumeDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const handleFiles = async (files: FileList | null) => {
    if (disabled) return;
    const file = files?.[0] ?? null;
    await onFileSelected(file);
  };

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current += 1;
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) {
            setIsDragging(false);
          }
        }}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current = 0;
          setIsDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          "cursor-pointer outline-none transition-all",
          disabled && "cursor-not-allowed opacity-70",
        )}
      >
        {children({ isDragging, openPicker, inputRef })}
      </div>
    </div>
  );
}
