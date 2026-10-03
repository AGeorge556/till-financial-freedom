import { PrivacyProvider, PrivacyToggle } from "@/components/PrivacyProvider";
import { TabBar } from "@/components/TabBar";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <PrivacyProvider>
      <div className="md:pl-60">
        <header className="sticky top-0 z-10 bg-background pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-5 md:justify-end">
            <span className="text-lg font-semibold tracking-tight md:hidden">Till</span>
            <PrivacyToggle />
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-5 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-12">
          {children}
        </main>
      </div>
      <TabBar />
    </PrivacyProvider>
  );
}
