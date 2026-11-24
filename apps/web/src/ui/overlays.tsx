import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "./controls";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  footer?: ReactNode;
};

function Overlay({ open, onOpenChange, title, description, closeLabel, initialFocusRef, children, footer, sheet = false }: DialogProps & { sheet?: boolean }) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLDivElement>(null);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    const initialFocus = initialFocusRef?.current;
    if (initialFocus && dialog.contains(initialFocus)) initialFocus.focus({ preventScroll: true });
    else closeRef.current?.querySelector("button")?.focus({ preventScroll: true });

    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, initialFocusRef]);

  return (
    <dialog ref={dialogRef} className={`bb-overlay ${sheet ? "bb-overlay--sheet" : ""}`}
      aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={(event) => {
        if (!event.currentTarget.open && open) onOpenChange(false);
      }}>
      {sheet && <div className="bb-sheet-handle" aria-hidden="true" />}
      <header className="bb-overlay-header">
        <h2 id={titleId} className="text-section-title">{title}</h2>
        <div ref={closeRef}><Button variant="text" onClick={() => onOpenChange(false)}>{closeLabel}</Button></div>
      </header>
      <div className="bb-overlay-body">
        {description && <p id={descriptionId} className="mb-4 text-muted">{description}</p>}
        {children}
      </div>
      {footer && <footer className="bb-overlay-footer">{footer}</footer>}
    </dialog>
  );
}

export function Dialog(props: DialogProps) {
  return <Overlay {...props} />;
}

export function Sheet(props: DialogProps) {
  return <Overlay {...props} sheet />;
}
