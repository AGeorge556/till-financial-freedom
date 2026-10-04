import "server-only";
import {
  getReminderSwitches,
  getSettings,
  listAccounts,
  listCategories,
  listTransactions,
  loadMonth,
  loadReminderInput,
} from "@/db/queries";
import { buildReminders, type Reminder } from "@/lib/finance-core/reminders";
import { cairoToday, financialMonth } from "@/lib/finance-core/time";
import { loadGoalData } from "../../goals/data";
import { loadInvestments } from "../../investments/data";
import { loadBudgetLines } from "../../spending/data";

/**
 * The reminders Home shows for one user, built the same way (app/(app)/page.tsx), for the daily push job that has no
 * session. Read-only: unlike Home it does not create recurring items that have come due.
 */
export async function loadReminders(userId: string): Promise<Reminder[]> {
  const today = cairoToday();
  const [accounts, txRows, settings, inv] = await Promise.all([
    listAccounts(userId, { includeArchived: true }),
    listTransactions(userId),
    getSettings(userId),
    loadInvestments(userId, today),
  ]);
  if (accounts.length === 0) return [];

  const monthData = await loadMonth(userId, financialMonth(today, settings.monthStartDay));
  const categoryNames = new Map((await listCategories(userId, { includeArchived: true })).map((c) => [c.id, c.name]));
  const budgets = (await loadBudgetLines(userId, monthData, today, categoryNames)).lines;
  const goalData = await loadGoalData(userId, { accounts, txRows, monthStartDay: settings.monthStartDay, wealth: inv.wealth });

  const [input, switches] = await Promise.all([
    loadReminderInput(userId, { goalData, budgets, accounts, txRows, wealth: inv.wealth }),
    getReminderSwitches(userId),
  ]);
  return buildReminders(input, switches, today);
}
