import { SidebarNav } from "./sidebar-nav";

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:w-64">
      <SidebarNav />
    </aside>
  );
}
