import { PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <PageSkeleton title="Investments" cards={[3, 4, 4]} wide />;
}
