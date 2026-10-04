import { AutoLock } from "@/components/AutoLock";
import { PrivacyProvider, PrivacyToggle } from "@/components/PrivacyProvider";
import { QuickAdd } from "@/components/QuickAdd";
import { TabBar } from "@/components/TabBar";
import { getSettings, listAccounts, listCategories, listHoldings } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { cairoToday } from "@/lib/finance-core/time";
import { syncRecurring } from "./more/recurring/sync";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const userId = await requireUserId();
  // The sync only inserts ledger rows, so the lists below do not wait for it.
  const [, accounts, categories, holdings, { autoLockMinutes }] = await Promise.all([
    syncRecurring(userId),
    listAccounts(userId),
    listCategories(userId),
    listHoldings(userId),
    getSettings(userId),
  ]);

  return (
    <PrivacyProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-[calc(0.75rem+env(safe-area-inset-top))] focus:left-3 focus:z-50 focus:rounded-xl focus:bg-foreground focus:px-4 focus:py-3 focus:font-semibold focus:text-background"
      >
        Skip to content
      </a>
      <AutoLock minutes={autoLockMinutes} />
      <div className="md:pl-60">
        <header className="sticky top-0 z-10 bg-background pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-5 md:justify-end">
            <span className="text-lg font-semibold tracking-tight md:hidden">Till</span>
            <PrivacyToggle />
          </div>
        </header>
        {/* Bottom padding clears the tab bar and the floating + button. tabIndex lets the skip link move focus here. */}
        <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-5 pb-[calc(9rem+env(safe-area-inset-bottom))] outline-none md:pb-28">
          {children}
        </main>
      </div>
      <TabBar />
      <QuickAdd
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, archived: false }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: false }))}
        holdings={holdings.map((h) => ({ id: h.id, name: h.name, ticker: h.ticker, accountId: h.accountId, kind: h.kind }))}
        today={cairoToday()}
      />
    </PrivacyProvider>
  );
}
