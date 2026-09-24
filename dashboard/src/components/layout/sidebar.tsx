import { SidebarNav } from "./sidebar-nav";

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r bg-card md:flex">
      <SidebarNav />
    </aside>
  );
}
