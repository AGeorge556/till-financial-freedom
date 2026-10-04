import { PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <PageSkeleton title="Spending" cards={[1, 4, 5]} wide />;
}
