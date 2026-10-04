import { PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <PageSkeleton back title="Net worth history" cards={[8, 3]} />;
}
