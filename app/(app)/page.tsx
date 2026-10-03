import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";

export default function Home() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
      <div className="mt-8">
        <p className="text-sm text-muted">Net worth</p>
        <Amount value={0} className="mt-1 block text-5xl font-semibold tracking-tight" />
      </div>
      <div className="mt-8">
        <EmptyState
          accent="cash"
          title="Nothing tracked yet"
          items={["Net worth", "This month", "Goals", "Portfolio", "Insights", "Monthly plan"]}
        >
          Once you add accounts and transactions, your overview will appear here.
        </EmptyState>
      </div>
    </>
  );
}
