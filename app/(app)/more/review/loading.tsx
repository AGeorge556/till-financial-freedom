import { PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <PageSkeleton back title="Monthly review" cards={[4, 4, 4]} wide />;
}
