import { PrivacyProvider, PrivacyToggle } from "@/components/PrivacyProvider";
import { QuickAdd } from "@/components/QuickAdd";
import { TabBar } from "@/components/TabBar";
import { listAccounts, listCategories, listHoldings } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { cairoToday } from "@/lib/finance-core/time";
import { syncRecurring } from "./more/recurring/sync";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const userId = await requireUserId();
  await syncRecurring(userId);
  const [accounts, categories, holdings] = await Promise.all([
    listAccounts(userId),
    listCategories(userId),
    listHoldings(userId),
  ]);

  return (
    <PrivacyProvider>
      <div className="md:pl-60">
        <header className="sticky top-0 z-10 bg-background pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-5 md:justify-end">
            <span className="text-lg font-semibold tracking-tight md:hidden">Till</span>
            <PrivacyToggle />
          </div>
        </header>
        {/* Bottom padding clears the tab bar and the floating + button. */}
        <main className="mx-auto max-w-2xl px-5 pb-[calc(9rem+env(safe-area-inset-bottom))] md:pb-28">
          {children}
        </main>
      </div>
      <TabBar />
      <QuickAdd
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, archived: false }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: false }))}
        holdings={holdings.map((h) => ({ id: h.id, name: h.name, ticker: h.ticker, accountId: h.accountId }))}
        today={cairoToday()}
      />
    </PrivacyProvider>
  );
}
