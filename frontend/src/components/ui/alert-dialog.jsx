import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/lib/utils"

const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogPortal = AlertDialogPrimitive.Portal

// Soft overlay with subtle blur. Higher z-index than Dialog (which uses 150)
// so confirm dialogs always sit on top of regular forms / detail modals.
const AlertDialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[180] bg-black/55",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

// Sensa-styled card: warm cream background to match app surface,
// pillowy 24px rounded corners, generous padding, soft elevated shadow.
const AlertDialogContent = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-[181] -translate-x-1/2 -translate-y-1/2",
        "w-[calc(100%-32px)] max-w-md",
        "rounded-3xl bg-[#D6CBC0] text-[#1A1717]",
        "p-7 sm:p-8",
        "shadow-[0_24px_64px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5",
        "duration-200",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({ className, ...props }) => (
  <div className={cn("flex flex-col gap-1.5", className)} {...props} />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogFooter = ({ className, ...props }) => (
  <div
    className={cn(
      // Stack on mobile (most-emphasis on top via reverse), inline on desktop.
      "mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3",
      className
    )}
    {...props}
  />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

const AlertDialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("text-xl font-semibold tracking-tight text-[#1A1717]", className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-relaxed text-[#1A1717]/65", className)}
    {...props}
  />
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

// Pill button variants — match the Sensa look (rounded-full, h-11, medium weight).
const ACTION_BASE =
  "inline-flex items-center justify-center h-11 px-5 rounded-full font-medium text-sm transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1717]/20 disabled:opacity-50 disabled:pointer-events-none"

const ACTION_VARIANTS = {
  primary: "bg-[#1A1717] text-[#D6CBC0] hover:bg-[#333333]",
  danger: "bg-[#DC2626] text-white hover:bg-[#B91C1C]",
  warning: "bg-[#C4703D] text-white hover:bg-[#A8602F]",
  ghost: "bg-transparent text-[#1A1717] hover:bg-black/5",
  outline: "bg-transparent text-[#1A1717] border border-[#1A1717]/15 hover:bg-black/5",
}

const AlertDialogAction = React.forwardRef(({ className, variant = "primary", ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(ACTION_BASE, ACTION_VARIANTS[variant] || ACTION_VARIANTS.primary, className)}
    {...props}
  />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(ACTION_BASE, ACTION_VARIANTS.ghost, "text-[#1A1717]/60 sm:mr-auto", className)}
    {...props}
  />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
