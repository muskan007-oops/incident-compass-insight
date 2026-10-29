import { Link, useRouterState } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Activity, BookOpen, LayoutDashboard, Menu, Radar, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { dataSourceLabel, incidentsQuery } from "@/lib/data-source";
import { SeverityDot } from "./status";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Incidents", icon: LayoutDashboard },
  { to: "/methodology", label: "Methodology & setup", icon: BookOpen },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { data: incidents } = useSuspenseQuery(incidentsQuery());
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2 px-2">
        <div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
          <Radar className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">RCA Console</div>
          <div className="text-[11px] text-muted-foreground">Incident root cause analysis</div>
        </div>
      </div>
      <div className="space-y-1">
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
              path === n.to && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <n.icon className="size-4" /> {n.label}
          </Link>
        ))}
      </div>
      <div>
        <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Incidents</div>
        <div className="space-y-1">
          {incidents.map((i) => (
            <Link
              key={i.id}
              to="/incidents/$id"
              params={{ id: i.id }}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-xs text-sidebar-foreground hover:bg-sidebar-accent",
                path === `/incidents/${i.id}` && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <SeverityDot severity={i.severity} />
              <span className="font-mono">{i.id}</span>
              <span className="truncate text-muted-foreground">{i.affectedService}</span>
            </Link>
          ))}
        </div>
      </div>
      <div className="mt-auto rounded-md border border-sidebar-border p-3 text-[11px] text-muted-foreground">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-sidebar-foreground">
          <Activity className="size-3 text-success" /> Data source
        </div>
        {dataSourceLabel}
        <div className="mt-2">Ingestion stays in browser storage; production is untouched.</div>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen w-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-background/80" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-sidebar-border bg-sidebar">
            <button aria-label="Close menu" className="absolute right-3 top-4 text-muted-foreground" onClick={() => setOpen(false)}>
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-semibold">RCA Console</span>
        </header>
        <main className="glow-bg flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
