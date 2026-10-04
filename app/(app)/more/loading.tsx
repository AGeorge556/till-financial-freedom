import { PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <PageSkeleton back cards={[3, 4]} />;
}
