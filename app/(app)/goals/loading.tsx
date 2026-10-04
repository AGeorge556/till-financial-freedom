import { PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <PageSkeleton title="Goals" cards={[3, 3, 3]} wide />;
}
