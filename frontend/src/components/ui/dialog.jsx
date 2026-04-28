import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[150] bg-black/40 backdrop-blur-[2px]",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// Sensa-styled card. Two notes:
//   • `dialog-content` class is kept as a hook so the existing CSS
//     (typography overrides, mobile sizing, fullscreen variants like
//     `.dialog-wide`) still applies. Tailwind classes here provide the
//     base look; CSS overrides win where `!important` is set.
//   • If a caller passes `fullscreen` (or composes their own classes),
//     they can override `max-w-lg` / `rounded-3xl` freely via className.
const DialogContent = React.forwardRef(({ className, children, hideClose = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-[151] -translate-x-1/2 -translate-y-1/2",
        "w-[calc(100%-32px)] max-w-lg max-h-[88vh] overflow-y-auto",
        "rounded-[28px] text-[#1A1717]",
        // Subtle vertical gradient for depth, ends in app surface tone
        "bg-gradient-to-b from-[#FAFAF7] to-[#F1F0EA]",
        "p-8 sm:p-9",
        // Layered shadow + faint inner highlight at top for "lift"
        "shadow-[0_30px_80px_-20px_rgba(20,18,16,0.35),0_8px_24px_-8px_rgba(20,18,16,0.15)]",
        "ring-1 ring-black/[0.06]",
        "before:absolute before:inset-x-6 before:top-0 before:h-px before:bg-white/60 before:rounded-full before:pointer-events-none",
        "duration-200",
        className
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          className={cn(
            "absolute right-5 top-5 inline-flex h-9 w-9 items-center justify-center rounded-full",
            "bg-black/5 text-[#1A1717] transition-colors hover:bg-black/10",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1717]/20",
            "disabled:pointer-events-none"
          )}
          aria-label="закрити"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }) => (
  <div className={cn("flex flex-col gap-1.5 pr-10", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }) => (
  <div
    className={cn(
      "mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-xl font-semibold tracking-tight text-[#1A1717]", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-relaxed text-[#1A1717]/65", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
