import { Loading, Skeleton, SkeletonCard } from "@/components/Skeleton";
import { Wide } from "@/components/Wide";

// Home is the only page that falls back to this one; every other tab and More page has its own loading.tsx.
// The wrapper classes match app/(app)/page.tsx so the columns do not move when the page arrives.
export default function HomeLoading() {
  return (
    <Loading>
      <Wide>
        <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
        <div className="mt-8 lg:columns-2 lg:gap-6">
          <section className="mb-6 break-inside-avoid">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-2 h-10 w-56" />
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          </section>
          <SkeletonCard rows={6} className="mb-6 break-inside-avoid" />
          <SkeletonCard rows={4} className="mb-6 break-inside-avoid" />
          <SkeletonCard rows={5} className="mb-6 break-inside-avoid" />
        </div>
      </Wide>
    </Loading>
  );
}
