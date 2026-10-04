import { PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <PageSkeleton back title="Income" cards={[2, 3, 4]} wide />;
}
